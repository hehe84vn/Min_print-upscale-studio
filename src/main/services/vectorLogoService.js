const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');

const VECTOR_STRATEGIES = new Set(['smart', 'detail', 'balanced', 'compact']);
const MAX_TRACE_DIMENSION = 3200;
const MIN_TRACE_DIMENSION = 1100;
const COMPARISON_DIMENSION = 640;

const CANDIDATES = {
  detail: {
    id: 'detail-preserve',
    label: 'Giữ chi tiết',
    paletteColors: 32,
    colorPrecision: 8,
    filterSpeckle: 0,
    spliceThreshold: 28,
    cornerThreshold: 38,
    layerDifference: 2,
    lengthThreshold: 3.5,
    maxIterations: 4,
    pathPrecision: 5,
    hierarchy: 'stacked',
    thresholdOffset: -4
  },
  balanced: {
    id: 'balanced-logo',
    label: 'Cân bằng',
    paletteColors: 24,
    colorPrecision: 7,
    filterSpeckle: 1,
    spliceThreshold: 46,
    cornerThreshold: 48,
    layerDifference: 4,
    lengthThreshold: 5,
    maxIterations: 3,
    pathPrecision: 4,
    hierarchy: 'cutout',
    thresholdOffset: 0
  },
  compact: {
    id: 'compact-logo',
    label: 'Ít node',
    paletteColors: 16,
    colorPrecision: 6,
    filterSpeckle: 2,
    spliceThreshold: 64,
    cornerThreshold: 56,
    layerDifference: 7,
    lengthThreshold: 7,
    maxIterations: 2,
    pathPrecision: 4,
    hierarchy: 'cutout',
    thresholdOffset: 4
  }
};

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeOptions(options = {}) {
  const strategy = VECTOR_STRATEGIES.has(options.strategy) ? options.strategy : 'smart';
  const paletteColors = Number(options.paletteColors);
  return {
    strategy,
    colorMode: options.colorMode === 'binary' ? 'binary' : 'color',
    threshold: clamp(options.threshold, 0, 255, 170),
    invert: Boolean(options.invert),
    backgroundCleanup: options.backgroundCleanup !== false,
    paletteColors: [8, 12, 16, 24, 32, 48, 64].includes(paletteColors) ? paletteColors : null,
    turdSize: clamp(options.turdSize, 0, 12, 1)
  };
}

function selectedCandidateKeys(strategy) {
  if (strategy === 'detail') return ['detail', 'balanced'];
  if (strategy === 'compact') return ['compact', 'balanced'];
  if (strategy === 'balanced') return ['balanced', 'detail', 'compact'];
  return ['detail', 'balanced', 'compact'];
}

function traceDimensions(width, height) {
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  let scale = 1;
  if (longest > MAX_TRACE_DIMENSION) scale = MAX_TRACE_DIMENSION / longest;
  else if (shortest < MIN_TRACE_DIMENSION && longest < 2200) scale = Math.min(2, MIN_TRACE_DIMENSION / Math.max(1, shortest));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale: Number(scale.toFixed(4))
  };
}

function borderBackground(data, info) {
  if (info.channels < 4) return null;
  const { width, height, channels } = info;
  const samples = [];
  const stepX = Math.max(1, Math.floor(width / 80));
  const stepY = Math.max(1, Math.floor(height / 80));
  const add = (x, y) => {
    const offset = (y * width + x) * channels;
    samples.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
  };
  for (let x = 0; x < width; x += stepX) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = stepY; y < height - 1; y += stepY) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  if (!samples.length) return null;

  const mean = [0, 0, 0, 0];
  for (const sample of samples) {
    for (let channel = 0; channel < 4; channel += 1) mean[channel] += sample[channel];
  }
  for (let channel = 0; channel < 4; channel += 1) mean[channel] /= samples.length;

  let variance = 0;
  for (const sample of samples) {
    variance += ((sample[0] - mean[0]) ** 2 + (sample[1] - mean[1]) ** 2 + (sample[2] - mean[2]) ** 2) / 3;
  }
  const deviation = Math.sqrt(variance / samples.length);
  const nearWhite = mean[0] >= 230 && mean[1] >= 230 && mean[2] >= 230;
  const opaque = mean[3] >= 245;
  if (!opaque || !nearWhite || deviation > 12) return null;
  return { red: mean[0], green: mean[1], blue: mean[2], deviation };
}

function removeFlatWhiteBackground(data, info, background) {
  if (!background || info.channels < 4) return { data, removedPixels: 0 };
  const output = Buffer.from(data);
  let removedPixels = 0;
  for (let offset = 0; offset < output.length; offset += info.channels) {
    const distance = Math.sqrt(
      (output[offset] - background.red) ** 2
      + (output[offset + 1] - background.green) ** 2
      + (output[offset + 2] - background.blue) ** 2
    );
    if (distance <= 12) {
      output[offset + 3] = 0;
      removedPixels += 1;
    } else if (distance < 30) {
      output[offset + 3] = Math.min(output[offset + 3], Math.round(((distance - 12) / 18) * 255));
    }
  }
  return { data: output, removedPixels };
}

async function prepareSource(inputPath, workspace, options) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước logo nguồn.');
  const traceSize = traceDimensions(metadata.width, metadata.height);
  let pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(traceSize.width, traceSize.height, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .ensureAlpha();

  if (['jpeg', 'jpg'].includes(String(metadata.format).toLowerCase())) pipeline = pipeline.median(3);
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const background = options.backgroundCleanup && options.colorMode === 'color' ? borderBackground(data, info) : null;
  const cleaned = removeFlatWhiteBackground(data, info, background);
  const normalizedPath = path.join(workspace, 'normalized-source.png');

  let normalized = sharp(cleaned.data, { raw: info });
  if (options.colorMode === 'binary') {
    normalized = normalized.flatten({ background: '#ffffff' }).grayscale().threshold(options.threshold);
    if (options.invert) normalized = normalized.negate();
  }
  await normalized.png({ compressionLevel: 6 }).toFile(normalizedPath);

  return {
    normalizedPath,
    source: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || path.extname(inputPath).slice(1),
      traceWidth: info.width,
      traceHeight: info.height,
      traceScale: traceSize.scale,
      backgroundRemoved: Boolean(background),
      removedBackgroundPixels: cleaned.removedPixels
    }
  };
}

async function candidateInput(sourcePath, targetPath, candidate, options) {
  let pipeline = sharp(sourcePath, { failOn: 'none' });
  if (options.colorMode === 'binary') {
    const threshold = clamp(options.threshold + candidate.thresholdOffset, 0, 255, options.threshold);
    pipeline = pipeline.flatten({ background: '#ffffff' }).grayscale().threshold(threshold);
    if (options.invert) pipeline = pipeline.negate();
    await pipeline.png({ compressionLevel: 6 }).toFile(targetPath);
    return { threshold, paletteColors: 2 };
  }

  const paletteColors = options.paletteColors || candidate.paletteColors;
  await pipeline.png({
    palette: true,
    colours: paletteColors,
    dither: 0,
    compressionLevel: 7,
    effort: 8
  }).toFile(targetPath);
  return { threshold: null, paletteColors };
}

function inspectSvgComplexity(svg) {
  const text = String(svg || '');
  const pathCount = (text.match(/<path\b/gi) || []).length;
  const shapeCount = pathCount
    + (text.match(/<(?:polygon|polyline|rect|circle|ellipse|line)\b/gi) || []).length;
  const pathData = [...text.matchAll(/\sd=["']([^"']+)["']/gi)].map((match) => match[1]).join(' ');
  const nodeEstimate = (pathData.match(/[MLHVCSQTA](?=[\s,\-+.\d])/gi) || []).length;
  const colors = new Set();
  for (const match of text.matchAll(/(?:fill|stroke)=["']([^"']+)["']/gi)) {
    const value = match[1].trim().toLowerCase();
    if (!['none', 'currentcolor'].includes(value)) colors.add(value);
  }
  return {
    pathCount,
    shapeCount,
    nodeEstimate,
    colorCount: colors.size,
    svgBytes: Buffer.byteLength(text, 'utf8')
  };
}

function grayscaleAt(data, offset, channels) {
  const red = data[offset];
  const green = data[offset + 1] ?? red;
  const blue = data[offset + 2] ?? red;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function compareRaw(source, rendered, info) {
  const channels = info.channels;
  let absoluteError = 0;
  let edgeSource = 0;
  let edgeRendered = 0;
  let edgeIntersection = 0;
  const threshold = 26;

  for (let offset = 0; offset < source.length; offset += channels) {
    absoluteError += Math.abs(source[offset] - rendered[offset]);
    absoluteError += Math.abs((source[offset + 1] ?? source[offset]) - (rendered[offset + 1] ?? rendered[offset]));
    absoluteError += Math.abs((source[offset + 2] ?? source[offset]) - (rendered[offset + 2] ?? rendered[offset]));
  }

  const { width, height } = info;
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const left = offset - channels;
      const above = offset - width * channels;
      const sourceGradient = Math.abs(grayscaleAt(source, offset, channels) - grayscaleAt(source, left, channels))
        + Math.abs(grayscaleAt(source, offset, channels) - grayscaleAt(source, above, channels));
      const renderedGradient = Math.abs(grayscaleAt(rendered, offset, channels) - grayscaleAt(rendered, left, channels))
        + Math.abs(grayscaleAt(rendered, offset, channels) - grayscaleAt(rendered, above, channels));
      const sourceEdge = sourceGradient >= threshold;
      const renderedEdge = renderedGradient >= threshold;
      if (sourceEdge) edgeSource += 1;
      if (renderedEdge) edgeRendered += 1;
      if (sourceEdge && renderedEdge) edgeIntersection += 1;
    }
  }

  const pixelChannels = Math.max(1, (source.length / channels) * 3);
  const fidelity = Math.max(0, 100 * (1 - absoluteError / (pixelChannels * 255)));
  const precision = edgeIntersection / Math.max(1, edgeRendered);
  const recall = edgeIntersection / Math.max(1, edgeSource);
  const edgeAgreement = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) * 100 : 100;
  return {
    fidelity: Number(fidelity.toFixed(2)),
    edgeAgreement: Number(edgeAgreement.toFixed(2)),
    edgePrecision: Number((precision * 100).toFixed(2)),
    edgeRecall: Number((recall * 100).toFixed(2))
  };
}

async function comparisonSource(sourcePath) {
  return sharp(sourcePath, { failOn: 'none' })
    .flatten({ background: '#ffffff' })
    .resize({ width: COMPARISON_DIMENSION, height: COMPARISON_DIMENSION, fit: 'inside', withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function assessSvg(svg, reference) {
  const { width, height } = reference.info;
  const rendered = await sharp(Buffer.from(svg), { density: 144, failOn: 'none' })
    .flatten({ background: '#ffffff' })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer();
  return {
    ...compareRaw(reference.data, rendered, reference.info),
    ...inspectSvgComplexity(svg)
  };
}

function scoreCandidates(candidates, strategy) {
  const nodeValues = candidates.map((candidate) => candidate.metrics.nodeEstimate || candidate.metrics.shapeCount || 1);
  const minimumNodes = Math.min(...nodeValues);
  const maximumNodes = Math.max(...nodeValues);
  const weights = strategy === 'detail'
    ? { fidelity: 0.58, edge: 0.37, complexity: 0.05 }
    : strategy === 'compact'
      ? { fidelity: 0.42, edge: 0.28, complexity: 0.30 }
      : { fidelity: 0.52, edge: 0.33, complexity: 0.15 };

  for (const candidate of candidates) {
    const nodes = candidate.metrics.nodeEstimate || candidate.metrics.shapeCount || 1;
    const complexity = maximumNodes === minimumNodes
      ? 100
      : 100 - ((nodes - minimumNodes) / (maximumNodes - minimumNodes)) * 100;
    candidate.metrics.complexityScore = Number(complexity.toFixed(2));
    candidate.score = Number((
      candidate.metrics.fidelity * weights.fidelity
      + candidate.metrics.edgeAgreement * weights.edge
      + complexity * weights.complexity
    ).toFixed(2));
  }
  return candidates.sort((left, right) => right.score - left.score);
}

async function vectorizeLogo({ inputPath, outputPath, options = {}, onProgress }) {
  const normalizedOptions = normalizeOptions(options);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-vector-logo-'));
  const candidateErrors = [];

  try {
    onProgress?.(5, 'Đang phân tích và làm sạch logo nguồn');
    const prepared = await prepareSource(inputPath, workspace, normalizedOptions);
    const reference = await comparisonSource(prepared.normalizedPath);
    const module = await import('@neplex/vectorizer');
    const { vectorize, optimize, ColorMode, Hierarchical, PathSimplifyMode } = module;
    const candidateKeys = selectedCandidateKeys(normalizedOptions.strategy);
    const candidates = [];

    for (let index = 0; index < candidateKeys.length; index += 1) {
      const candidate = CANDIDATES[candidateKeys[index]];
      const input = path.join(workspace, `${candidate.id}.png`);
      const progressStart = 18 + (index / candidateKeys.length) * 58;
      onProgress?.(Math.round(progressStart), `Đang trace candidate ${index + 1}/${candidateKeys.length}: ${candidate.label}`);
      try {
        const preprocessing = await candidateInput(prepared.normalizedPath, input, candidate, normalizedOptions);
        const source = await fs.readFile(input);
        const userSpeckle = normalizedOptions.turdSize;
        const speckle = candidate.id === 'detail-preserve'
          ? Math.max(0, userSpeckle - 1)
          : candidate.id === 'compact-logo'
            ? Math.min(12, userSpeckle + 1)
            : userSpeckle;
        const hierarchy = candidate.hierarchy === 'cutout'
          ? (Hierarchical.Cutout ?? Hierarchical.Stacked)
          : Hierarchical.Stacked;
        const rawSvg = await vectorize(source, {
          colorMode: normalizedOptions.colorMode === 'color' ? ColorMode.Color : ColorMode.Binary,
          colorPrecision: candidate.colorPrecision,
          filterSpeckle: speckle,
          spliceThreshold: candidate.spliceThreshold,
          cornerThreshold: candidate.cornerThreshold,
          hierarchical: hierarchy,
          mode: PathSimplifyMode.Spline,
          layerDifference: candidate.layerDifference,
          lengthThreshold: candidate.lengthThreshold,
          maxIterations: candidate.maxIterations,
          pathPrecision: candidate.pathPrecision
        });
        const optimized = await optimize(String(rawSvg), {
          plugins: ['preset-default', { name: 'removeTitle' }],
          multipass: true,
          multipassIterations: 2
        });
        const svg = String(optimized);
        const metrics = await assessSvg(svg, reference);
        candidates.push({
          id: candidate.id,
          label: candidate.label,
          preprocessing,
          trace: {
            colorPrecision: candidate.colorPrecision,
            filterSpeckle: speckle,
            spliceThreshold: candidate.spliceThreshold,
            cornerThreshold: candidate.cornerThreshold,
            layerDifference: candidate.layerDifference,
            lengthThreshold: candidate.lengthThreshold,
            maxIterations: candidate.maxIterations,
            pathPrecision: candidate.pathPrecision,
            hierarchy: candidate.hierarchy
          },
          metrics,
          svg
        });
      } catch (error) {
        candidateErrors.push({ id: candidate.id, error: error.message || String(error) });
      }
    }

    if (!candidates.length) {
      throw new Error(`Không candidate nào vector hóa thành công. ${candidateErrors.map((item) => `${item.id}: ${item.error}`).join(' | ')}`);
    }

    onProgress?.(82, 'Đang so sánh fidelity, cạnh và độ phức tạp node');
    const ranked = scoreCandidates(candidates, normalizedOptions.strategy);
    const selected = ranked[0];
    await fs.writeFile(outputPath, selected.svg, 'utf8');

    const reportPath = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.vector-report.json`);
    const report = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      inputPath,
      outputPath,
      strategy: normalizedOptions.strategy,
      colorMode: normalizedOptions.colorMode,
      source: prepared.source,
      selectedCandidate: selected.id,
      selectedScore: selected.score,
      candidates: ranked.map(({ svg, ...candidate }) => candidate),
      candidateErrors
    };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    onProgress?.(100, `Hoàn tất · ${selected.label} · ${selected.metrics.nodeEstimate} node ước tính`);

    return {
      outputPath,
      reportPath,
      vectorReport: report
    };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  CANDIDATES,
  inspectSvgComplexity,
  normalizeOptions,
  scoreCandidates,
  selectedCandidateKeys,
  traceDimensions,
  vectorizeLogo
};
