const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');

const STRATEGIES = new Set(['smart', 'detail', 'balanced', 'compact']);
const TRACE_MAX = 3200;
const TRACE_MIN = 1100;
const REVIEW_SIZE = 640;

const PRESETS = {
  detail: {
    id: 'detail-preserve', label: 'Giữ chi tiết', colors: 32,
    colorPrecision: 8, filterSpeckle: 0, spliceThreshold: 28,
    cornerThreshold: 38, layerDifference: 2, lengthThreshold: 3.5,
    maxIterations: 4, pathPrecision: 5, hierarchy: 'stacked', thresholdOffset: -4
  },
  balanced: {
    id: 'balanced-logo', label: 'Cân bằng', colors: 24,
    colorPrecision: 7, filterSpeckle: 1, spliceThreshold: 46,
    cornerThreshold: 48, layerDifference: 4, lengthThreshold: 5,
    maxIterations: 3, pathPrecision: 4, hierarchy: 'cutout', thresholdOffset: 0
  },
  compact: {
    id: 'compact-logo', label: 'Ít node', colors: 16,
    colorPrecision: 6, filterSpeckle: 2, spliceThreshold: 64,
    cornerThreshold: 56, layerDifference: 7, lengthThreshold: 7,
    maxIterations: 2, pathPrecision: 4, hierarchy: 'cutout', thresholdOffset: 4
  }
};

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeOptions(options = {}) {
  const strategy = STRATEGIES.has(options.strategy) ? options.strategy : 'smart';
  const colors = Number(options.paletteColors);
  return {
    strategy,
    colorMode: options.colorMode === 'binary' ? 'binary' : 'color',
    threshold: clamp(options.threshold, 0, 255, 170),
    invert: Boolean(options.invert),
    backgroundCleanup: options.backgroundCleanup !== false,
    paletteColors: [8, 12, 16, 24, 32, 48, 64].includes(colors) ? colors : null,
    turdSize: clamp(options.turdSize, 0, 12, 1)
  };
}

function selectedCandidateKeys(strategy) {
  if (strategy === 'detail') return ['detail', 'balanced'];
  if (strategy === 'compact') return ['compact', 'balanced'];
  return ['detail', 'balanced', 'compact'];
}

function traceDimensions(width, height) {
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  let scale = 1;
  if (longest > TRACE_MAX) scale = TRACE_MAX / longest;
  else if (shortest < TRACE_MIN && longest < 2200) scale = Math.min(2, TRACE_MIN / Math.max(1, shortest));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale: Number(scale.toFixed(4))
  };
}

function detectWhiteBorder(data, info) {
  if (info.channels < 4) return null;
  const samples = [];
  const add = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    samples.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
  };
  const stepX = Math.max(1, Math.floor(info.width / 80));
  const stepY = Math.max(1, Math.floor(info.height / 80));
  for (let x = 0; x < info.width; x += stepX) {
    add(x, 0);
    if (info.height > 1) add(x, info.height - 1);
  }
  for (let y = stepY; y < info.height - 1; y += stepY) {
    add(0, y);
    if (info.width > 1) add(info.width - 1, y);
  }
  if (!samples.length) return null;

  const mean = [0, 0, 0, 0];
  for (const sample of samples) for (let channel = 0; channel < 4; channel += 1) mean[channel] += sample[channel];
  for (let channel = 0; channel < 4; channel += 1) mean[channel] /= samples.length;
  let variance = 0;
  for (const sample of samples) {
    variance += ((sample[0] - mean[0]) ** 2 + (sample[1] - mean[1]) ** 2 + (sample[2] - mean[2]) ** 2) / 3;
  }
  const deviation = Math.sqrt(variance / samples.length);
  if (mean[3] < 245 || mean[0] < 230 || mean[1] < 230 || mean[2] < 230 || deviation > 12) return null;
  return { red: mean[0], green: mean[1], blue: mean[2], deviation };
}

function clearWhiteBorder(data, info, background) {
  if (!background) return { data, removedPixels: 0 };
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
  const trace = traceDimensions(metadata.width, metadata.height);
  const raw = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(trace.width, trace.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = options.backgroundCleanup && options.colorMode === 'color'
    ? detectWhiteBorder(raw.data, raw.info)
    : null;
  const cleaned = clearWhiteBorder(raw.data, raw.info, background);
  const normalizedPath = path.join(workspace, 'normalized-source.png');
  await sharp(cleaned.data, { raw: raw.info }).png({ compressionLevel: 6 }).toFile(normalizedPath);
  return {
    normalizedPath,
    source: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || path.extname(inputPath).slice(1),
      traceWidth: raw.info.width,
      traceHeight: raw.info.height,
      traceScale: trace.scale,
      backgroundRemoved: Boolean(background),
      removedBackgroundPixels: cleaned.removedPixels
    }
  };
}

async function makeCandidateInput(sourcePath, outputPath, preset, options) {
  if (options.colorMode === 'binary') {
    const threshold = clamp(options.threshold + preset.thresholdOffset, 0, 255, options.threshold);
    let pipeline = sharp(sourcePath, { failOn: 'none' })
      .flatten({ background: '#ffffff' })
      .grayscale()
      .normalize()
      .threshold(threshold);
    if (options.invert) pipeline = pipeline.negate();
    await pipeline.png({ compressionLevel: 6 }).toFile(outputPath);
    return { threshold, paletteColors: 2 };
  }
  const paletteColors = options.paletteColors || preset.colors;
  await sharp(sourcePath, { failOn: 'none' }).png({
    palette: true,
    colours: paletteColors,
    dither: 0,
    effort: 8,
    compressionLevel: 7
  }).toFile(outputPath);
  return { threshold: null, paletteColors };
}

function inspectSvgComplexity(svg) {
  const text = String(svg || '');
  const pathCount = (text.match(/<path\b/gi) || []).length;
  const shapeCount = pathCount + (text.match(/<(?:polygon|polyline|rect|circle|ellipse|line)\b/gi) || []).length;
  const pathData = [...text.matchAll(/\sd=["']([^"']+)["']/gi)].map((match) => match[1]).join(' ');
  const nodeEstimate = (pathData.match(/[MLHVCSQTA](?=[\s,\-+.\d])/gi) || []).length;
  const colors = new Set();
  for (const match of text.matchAll(/(?:fill|stroke)=["']([^"']+)["']/gi)) {
    const value = match[1].trim().toLowerCase();
    if (!['none', 'currentcolor'].includes(value)) colors.add(value);
  }
  return { pathCount, shapeCount, nodeEstimate, colorCount: colors.size, svgBytes: Buffer.byteLength(text, 'utf8') };
}

function luminance(data, offset, channels) {
  const red = data[offset];
  const green = data[offset + 1] ?? red;
  const blue = data[offset + 2] ?? red;
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function comparePixels(source, rendered, info) {
  const channels = info.channels;
  let error = 0;
  let sourceEdges = 0;
  let renderedEdges = 0;
  let intersection = 0;
  for (let offset = 0; offset < source.length; offset += channels) {
    error += Math.abs(source[offset] - rendered[offset]);
    error += Math.abs((source[offset + 1] ?? source[offset]) - (rendered[offset + 1] ?? rendered[offset]));
    error += Math.abs((source[offset + 2] ?? source[offset]) - (rendered[offset + 2] ?? rendered[offset]));
  }
  for (let y = 1; y < info.height; y += 1) {
    for (let x = 1; x < info.width; x += 1) {
      const offset = (y * info.width + x) * channels;
      const left = offset - channels;
      const above = offset - info.width * channels;
      const sourceGradient = Math.abs(luminance(source, offset, channels) - luminance(source, left, channels))
        + Math.abs(luminance(source, offset, channels) - luminance(source, above, channels));
      const renderedGradient = Math.abs(luminance(rendered, offset, channels) - luminance(rendered, left, channels))
        + Math.abs(luminance(rendered, offset, channels) - luminance(rendered, above, channels));
      const sourceEdge = sourceGradient >= 26;
      const renderedEdge = renderedGradient >= 26;
      if (sourceEdge) sourceEdges += 1;
      if (renderedEdge) renderedEdges += 1;
      if (sourceEdge && renderedEdge) intersection += 1;
    }
  }
  const fidelity = Math.max(0, 100 * (1 - error / (Math.max(1, source.length / channels) * 3 * 255)));
  const precision = intersection / Math.max(1, renderedEdges);
  const recall = intersection / Math.max(1, sourceEdges);
  const edge = precision + recall ? (2 * precision * recall) / (precision + recall) * 100 : 100;
  return {
    fidelity: Number(fidelity.toFixed(2)),
    edgeAgreement: Number(edge.toFixed(2)),
    edgePrecision: Number((precision * 100).toFixed(2)),
    edgeRecall: Number((recall * 100).toFixed(2))
  };
}

async function comparisonReference(sourcePath, options) {
  let pipeline = sharp(sourcePath, { failOn: 'none' }).flatten({ background: '#ffffff' });
  if (options.colorMode === 'binary') {
    pipeline = pipeline.grayscale().normalize().threshold(options.threshold);
    if (options.invert) pipeline = pipeline.negate();
  }
  return pipeline
    .resize({ width: REVIEW_SIZE, height: REVIEW_SIZE, fit: 'inside', withoutEnlargement: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function assessSvg(svg, reference) {
  const rendered = await sharp(Buffer.from(svg), { density: 144, failOn: 'none' })
    .flatten({ background: '#ffffff' })
    .resize(reference.info.width, reference.info.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer();
  return { ...comparePixels(reference.data, rendered, reference.info), ...inspectSvgComplexity(svg) };
}

function scoreCandidates(candidates, strategy) {
  const nodes = candidates.map((item) => item.metrics.nodeEstimate || item.metrics.shapeCount || 1);
  const minNodes = Math.min(...nodes);
  const maxNodes = Math.max(...nodes);
  const weights = strategy === 'detail'
    ? { fidelity: 0.58, edge: 0.37, complexity: 0.05 }
    : strategy === 'compact'
      ? { fidelity: 0.42, edge: 0.28, complexity: 0.30 }
      : { fidelity: 0.52, edge: 0.33, complexity: 0.15 };
  for (const candidate of candidates) {
    const count = candidate.metrics.nodeEstimate || candidate.metrics.shapeCount || 1;
    const complexity = maxNodes === minNodes ? 100 : 100 - ((count - minNodes) / (maxNodes - minNodes)) * 100;
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
  const normalized = normalizeOptions(options);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-vector-logo-'));
  const candidateErrors = [];
  try {
    onProgress?.(5, 'Đang làm sạch và chuẩn hóa logo nguồn');
    const prepared = await prepareSource(inputPath, workspace, normalized);
    const reference = await comparisonReference(prepared.normalizedPath, normalized);
    const { vectorize, optimize, ColorMode, Hierarchical, PathSimplifyMode } = await import('@neplex/vectorizer');
    const keys = selectedCandidateKeys(normalized.strategy);
    const candidates = [];

    for (let index = 0; index < keys.length; index += 1) {
      const preset = PRESETS[keys[index]];
      const candidatePath = path.join(workspace, `${preset.id}.png`);
      onProgress?.(18 + Math.round((index / keys.length) * 58), `Trace ${index + 1}/${keys.length}: ${preset.label}`);
      try {
        const preprocessing = await makeCandidateInput(prepared.normalizedPath, candidatePath, preset, normalized);
        const source = await fs.readFile(candidatePath);
        const speckle = preset.id === 'detail-preserve'
          ? Math.max(0, normalized.turdSize - 1)
          : preset.id === 'compact-logo'
            ? Math.min(12, normalized.turdSize + 1)
            : normalized.turdSize;
        const hierarchy = preset.hierarchy === 'cutout'
          ? (Hierarchical.Cutout ?? Hierarchical.Stacked)
          : Hierarchical.Stacked;
        const traced = await vectorize(source, {
          colorMode: normalized.colorMode === 'color' ? ColorMode.Color : ColorMode.Binary,
          colorPrecision: preset.colorPrecision,
          filterSpeckle: speckle,
          spliceThreshold: preset.spliceThreshold,
          cornerThreshold: preset.cornerThreshold,
          hierarchical: hierarchy,
          mode: PathSimplifyMode.Spline,
          layerDifference: preset.layerDifference,
          lengthThreshold: preset.lengthThreshold,
          maxIterations: preset.maxIterations,
          pathPrecision: preset.pathPrecision
        });
        const optimized = String(await optimize(String(traced), {
          plugins: ['preset-default', { name: 'removeTitle' }],
          multipass: true,
          multipassIterations: 2
        }));
        candidates.push({
          id: preset.id,
          label: preset.label,
          preprocessing,
          trace: { ...preset, filterSpeckle: speckle },
          metrics: await assessSvg(optimized, reference),
          svg: optimized
        });
      } catch (error) {
        candidateErrors.push({ id: preset.id, error: error.message || String(error) });
      }
    }

    if (!candidates.length) throw new Error(`Không candidate nào thành công. ${candidateErrors.map((item) => `${item.id}: ${item.error}`).join(' | ')}`);
    onProgress?.(84, 'Đang chọn kết quả theo fidelity, cạnh và số node');
    const ranked = scoreCandidates(candidates, normalized.strategy);
    const selected = ranked[0];
    await fs.writeFile(outputPath, selected.svg, 'utf8');
    const reportPath = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.vector-report.json`);
    const warnings = [];
    if (selected.metrics.edgeRecall < 75) warnings.push('Edge recall thấp; nên kiểm tra chi tiết nhỏ trong Illustrator.');
    if (selected.metrics.nodeEstimate > 5000) warnings.push('SVG vẫn có nhiều node; thử chế độ Ít node hoặc giảm số màu.');
    const report = {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      inputPath,
      outputPath,
      strategy: normalized.strategy,
      colorMode: normalized.colorMode,
      source: prepared.source,
      selectedCandidate: selected.id,
      selectedScore: selected.score,
      warnings,
      candidates: ranked.map(({ svg, ...candidate }) => candidate),
      candidateErrors
    };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    onProgress?.(100, `Hoàn tất · ${selected.label} · khoảng ${selected.metrics.nodeEstimate} node`);
    return { outputPath, reportPath, vectorReport: report };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  PRESETS,
  inspectSvgComplexity,
  normalizeOptions,
  scoreCandidates,
  selectedCandidateKeys,
  traceDimensions,
  vectorizeLogo
};
