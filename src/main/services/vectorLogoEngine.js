'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const {
  applyGeometryLockToSvg,
  compareRasterGeometry,
  inspectPathGeometry
} = require('./vectorGeometryLock');
const {
  compareBinaryComponents,
  reconstructBinarySvg
} = require('./binaryShapeReconstruction');

const STRATEGIES = new Set(['smart', 'detail', 'balanced', 'compact']);
const TRACE_MAX = 3200;
const TRACE_MIN = 1100;
const REVIEW_SIZE = 640;

const PRESETS = {
  reconstruct: {
    id: 'binary-reconstruction', label: 'Binary Reconstruction', direct: true
  },
  geometry: {
    id: 'geometry-lock', label: 'Geometry Lock', colors: 2, mode: 'polygon',
    colorPrecision: 8, filterSpeckle: 0, spliceThreshold: 18,
    cornerThreshold: 22, layerDifference: 2, lengthThreshold: 2.5,
    maxIterations: 4, pathPrecision: 4, hierarchy: 'stacked'
  },
  detail: {
    id: 'detail-preserve', label: 'Giữ chi tiết', colors: 32, mode: 'spline',
    colorPrecision: 8, filterSpeckle: 0, spliceThreshold: 28,
    cornerThreshold: 34, layerDifference: 2, lengthThreshold: 3.5,
    maxIterations: 4, pathPrecision: 5, hierarchy: 'stacked'
  },
  balanced: {
    id: 'balanced-logo', label: 'Cân bằng', colors: 24, mode: 'spline',
    colorPrecision: 7, filterSpeckle: 1, spliceThreshold: 44,
    cornerThreshold: 44, layerDifference: 4, lengthThreshold: 5,
    maxIterations: 3, pathPrecision: 4, hierarchy: 'cutout'
  },
  compact: {
    id: 'compact-logo', label: 'Ít node', colors: 16, mode: 'polygon',
    colorPrecision: 6, filterSpeckle: 2, spliceThreshold: 62,
    cornerThreshold: 52, layerDifference: 7, lengthThreshold: 6.5,
    maxIterations: 2, pathPrecision: 4, hierarchy: 'cutout'
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
    geometryLock: options.geometryLock !== false,
    binaryReconstruction: options.binaryReconstruction !== false,
    paletteColors: [8, 12, 16, 24, 32, 48, 64].includes(colors) ? colors : null,
    turdSize: clamp(options.turdSize, 0, 12, 1),
    sourceAnalysis: options.sourceAnalysis || null
  };
}

function selectedCandidateKeys(strategy, monochrome = false, binaryReconstruction = true) {
  if (monochrome) {
    const direct = binaryReconstruction ? ['reconstruct'] : [];
    if (strategy === 'detail') return [...direct, 'geometry', 'detail'];
    if (strategy === 'balanced') return [...direct, 'geometry', 'balanced'];
    if (strategy === 'compact') return [...direct, 'compact', 'geometry'];
    return [...direct, 'geometry', 'balanced'];
  }
  if (strategy === 'detail') return ['detail', 'balanced'];
  if (strategy === 'compact') return ['compact', 'balanced'];
  return ['detail', 'balanced', 'compact'];
}

function traceDimensions(width, height, { allowUpscale = true } = {}) {
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  let scale = 1;
  if (longest > TRACE_MAX) scale = TRACE_MAX / longest;
  else if (allowUpscale && shortest < TRACE_MIN && longest < 2200) scale = Math.min(2, TRACE_MIN / Math.max(1, shortest));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale: Number(scale.toFixed(4))
  };
}

function otsuThreshold(histogram, total) {
  let weightedSum = 0;
  for (let value = 0; value < 256; value += 1) weightedSum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let maximumVariance = -1;
  let threshold = 170;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > maximumVariance) {
      maximumVariance = variance;
      threshold = value;
    }
  }
  return clamp(threshold, 40, 225, 170);
}

async function analyzeMonochromeSource(inputPath) {
  const { data, info } = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const histogram = new Uint32Array(256);
  let lowChroma = 0;
  let extreme = 0;
  let midtone = 0;
  let dark = 0;
  let bright = 0;
  const pixels = Math.max(1, info.width * info.height);
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1] ?? red;
    const blue = data[offset + 2] ?? red;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    if (maximum - minimum <= 18) lowChroma += 1;
    const luminance = Math.max(0, Math.min(255, Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722)));
    histogram[luminance] += 1;
    if (luminance <= 48) { dark += 1; extreme += 1; }
    else if (luminance >= 207) { bright += 1; extreme += 1; }
    else midtone += 1;
  }
  const lowChromaRatio = lowChroma / pixels;
  const extremeRatio = extreme / pixels;
  const midtoneRatio = midtone / pixels;
  const darkRatio = dark / pixels;
  const brightRatio = bright / pixels;
  const threshold = otsuThreshold(histogram, pixels);
  const monochromeScore = clamp((lowChromaRatio * 0.52 + extremeRatio * 0.38 + (1 - midtoneRatio) * 0.10) * 100, 0, 100, 0);
  const isMonochrome = lowChromaRatio >= 0.94
    && extremeRatio >= 0.68
    && darkRatio >= 0.015
    && brightRatio >= 0.12;
  return {
    isMonochrome,
    confidence: Number(monochromeScore.toFixed(2)),
    threshold,
    lowChromaRatio: Number((lowChromaRatio * 100).toFixed(2)),
    extremeRatio: Number((extremeRatio * 100).toFixed(2)),
    midtoneRatio: Number((midtoneRatio * 100).toFixed(2)),
    darkRatio: Number((darkRatio * 100).toFixed(2)),
    brightRatio: Number((brightRatio * 100).toFixed(2)),
    sampleWidth: info.width,
    sampleHeight: info.height
  };
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
  return { pathCount, shapeCount, nodeEstimate, colorCount: colors.size, colors: [...colors], svgBytes: Buffer.byteLength(text, 'utf8') };
}

function restoreSvgCanvas(svg, source) {
  const width = source.width;
  const height = source.height;
  const viewWidth = source.traceWidth;
  const viewHeight = source.traceHeight;
  return String(svg).replace(/<svg\b([^>]*)>/i, (_match, attributes) => {
    const next = attributes
      .replace(/\swidth=["'][^"']*["']/i, '')
      .replace(/\sheight=["'][^"']*["']/i, '')
      .replace(/\sviewBox=["'][^"']*["']/i, '');
    return `<svg${next} width="${width}" height="${height}" viewBox="0 0 ${viewWidth} ${viewHeight}">`;
  });
}

async function prepareSource(inputPath, workspace, options) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước logo nguồn.');
  const analysis = options.sourceAnalysis || await analyzeMonochromeSource(inputPath);
  const monochrome = options.colorMode === 'binary' || analysis.isMonochrome;
  const autoMonochrome = options.colorMode !== 'binary' && analysis.isMonochrome;
  const threshold = options.colorMode === 'binary' ? options.threshold : analysis.threshold;
  const trace = traceDimensions(metadata.width, metadata.height, { allowUpscale: !monochrome });
  const normalizedPath = path.join(workspace, monochrome ? 'monochrome-source.png' : 'normalized-source.png');

  if (monochrome) {
    let pipeline = sharp(inputPath, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .grayscale()
      .threshold(threshold);
    if (trace.scale !== 1) pipeline = pipeline.resize(trace.width, trace.height, { fit: 'fill', kernel: sharp.kernel.nearest });
    if (options.invert) pipeline = pipeline.negate();
    await pipeline.png({ palette: true, colours: 2, dither: 0, compressionLevel: 7 }).toFile(normalizedPath);
  } else {
    await sharp(inputPath, { failOn: 'none' })
      .rotate()
      .resize(trace.width, trace.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .ensureAlpha()
      .png({ compressionLevel: 6 })
      .toFile(normalizedPath);
  }

  return {
    normalizedPath,
    effective: { monochrome, autoMonochrome, threshold, colorMode: monochrome ? 'binary' : 'color' },
    source: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || path.extname(inputPath).slice(1),
      traceWidth: trace.width,
      traceHeight: trace.height,
      traceScale: trace.scale,
      analysis
    }
  };
}

async function makeCandidateInput(sourcePath, outputPath, preset, options, effective) {
  if (effective.monochrome) {
    await fs.copyFile(sourcePath, outputPath);
    return { threshold: effective.threshold, paletteColors: 2, resizeKernel: 'none-after-threshold' };
  }
  const paletteColors = options.paletteColors || preset.colors;
  await sharp(sourcePath, { failOn: 'none' }).png({
    palette: true,
    colours: paletteColors,
    dither: 0,
    effort: 8,
    compressionLevel: 7
  }).toFile(outputPath);
  return { threshold: null, paletteColors, resizeKernel: 'lanczos3' };
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

async function comparisonReference(sourcePath, effective) {
  let pipeline = sharp(sourcePath, { failOn: 'none' }).flatten({ background: '#ffffff' });
  if (effective.monochrome) pipeline = pipeline.grayscale().threshold(128);
  else pipeline = pipeline.removeAlpha();
  return pipeline
    .resize({ width: REVIEW_SIZE, height: REVIEW_SIZE, fit: 'inside', withoutEnlargement: false, kernel: effective.monochrome ? sharp.kernel.nearest : sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function colorSimplicityScore(colorCount, monochrome) {
  if (!monochrome) return 100;
  if (colorCount <= 2) return 100;
  if (colorCount === 3) return 50;
  if (colorCount === 4) return 20;
  return 0;
}

async function assessSvg(svg, reference, effective) {
  let pipeline = sharp(Buffer.from(svg), { density: 144, failOn: 'none' })
    .flatten({ background: '#ffffff' })
    .resize(reference.info.width, reference.info.height, { fit: 'fill', kernel: effective.monochrome ? sharp.kernel.nearest : sharp.kernel.lanczos3 });
  if (effective.monochrome) pipeline = pipeline.grayscale().threshold(128);
  else pipeline = pipeline.removeAlpha();
  const rendered = await pipeline.raw().toBuffer();
  const complexity = inspectSvgComplexity(svg);
  const pathGeometry = inspectPathGeometry(svg);
  const rasterGeometry = effective.monochrome
    ? compareRasterGeometry(reference.data, rendered, reference.info)
    : { orientationAgreement: 100, axisAgreement: 100, cornerPreservation: 100 };
  const componentValidation = effective.monochrome
    ? compareBinaryComponents(reference.data, rendered, reference.info)
    : {
        sourceComponentCount: 0,
        renderedComponentCount: 0,
        worstComponentIoU: 100,
        p10ComponentIoU: 100,
        medianComponentIoU: 100,
        weightedComponentIoU: 100,
        unmatchedSourceComponents: 0,
        worstComponents: []
      };
  const straightnessScore = effective.monochrome
    ? Number((pathGeometry.straightnessScore * 0.55 + rasterGeometry.orientationAgreement * 0.30 + rasterGeometry.axisAgreement * 0.15).toFixed(2))
    : pathGeometry.straightnessScore;
  const componentScore = Number((
    componentValidation.weightedComponentIoU * 0.55
    + componentValidation.p10ComponentIoU * 0.25
    + componentValidation.worstComponentIoU * 0.20
  ).toFixed(2));
  return {
    ...comparePixels(reference.data, rendered, reference.info),
    ...complexity,
    ...rasterGeometry,
    pathGeometry,
    straightnessScore,
    colorSimplicity: colorSimplicityScore(complexity.colorCount, effective.monochrome),
    componentScore,
    componentValidation
  };
}

function scoreCandidates(candidates, strategy, monochrome = false) {
  const nodes = candidates.map((item) => item.metrics.nodeEstimate || item.metrics.shapeCount || 1);
  const minNodes = Math.min(...nodes);
  const maxNodes = Math.max(...nodes);
  for (const candidate of candidates) {
    const count = candidate.metrics.nodeEstimate || candidate.metrics.shapeCount || 1;
    const complexity = maxNodes === minNodes ? 100 : 100 - ((count - minNodes) / (maxNodes - minNodes)) * 100;
    candidate.metrics.complexityScore = Number(complexity.toFixed(2));
    if (monochrome) {
      candidate.score = Number((
        candidate.metrics.fidelity * 0.20
        + candidate.metrics.edgeAgreement * 0.15
        + candidate.metrics.cornerPreservation * 0.15
        + candidate.metrics.straightnessScore * 0.12
        + candidate.metrics.componentScore * 0.25
        + complexity * 0.08
        + candidate.metrics.colorSimplicity * 0.05
      ).toFixed(2));
      candidate.rejected = candidate.metrics.colorCount > 2;
      candidate.rejectedReason = candidate.rejected ? `Nguồn đơn sắc nhưng SVG có ${candidate.metrics.colorCount} màu.` : null;
    } else {
      const weights = strategy === 'detail'
        ? { fidelity: 0.58, edge: 0.37, complexity: 0.05 }
        : strategy === 'compact'
          ? { fidelity: 0.42, edge: 0.28, complexity: 0.30 }
          : { fidelity: 0.52, edge: 0.33, complexity: 0.15 };
      candidate.score = Number((
        candidate.metrics.fidelity * weights.fidelity
        + candidate.metrics.edgeAgreement * weights.edge
        + complexity * weights.complexity
      ).toFixed(2));
      candidate.rejected = false;
      candidate.rejectedReason = null;
    }
  }
  return candidates.sort((left, right) => {
    if (left.rejected !== right.rejected) return left.rejected ? 1 : -1;
    return right.score - left.score;
  });
}

async function buildDirectCandidate(prepared, reference, optimize) {
  const reconstructed = await reconstructBinarySvg(prepared.normalizedPath, {
    outputWidth: prepared.source.width,
    outputHeight: prepared.source.height
  });
  const optimized = String(await optimize(reconstructed.svg, {
    plugins: ['preset-default', { name: 'removeTitle' }],
    multipass: true,
    multipassIterations: 2
  }));
  return {
    id: PRESETS.reconstruct.id,
    label: PRESETS.reconstruct.label,
    preprocessing: {
      threshold: prepared.effective.threshold,
      paletteColors: 2,
      source: 'binary-mask-original-resolution'
    },
    trace: { engine: 'direct-boundary-contour', mode: 'line-polygon' },
    reconstruction: reconstructed.stats,
    geometryLock: null,
    metrics: await assessSvg(optimized, reference, prepared.effective),
    svg: optimized
  };
}

async function vectorizeLogo({ inputPath, outputPath, options = {}, onProgress }) {
  const normalized = normalizeOptions(options);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-vector-logo-'));
  const candidateErrors = [];
  try {
    onProgress?.(4, 'Đang nhận diện logo đơn sắc và phân tách component');
    const prepared = await prepareSource(inputPath, workspace, normalized);
    const reference = await comparisonReference(prepared.normalizedPath, prepared.effective);
    const { vectorize, optimize, ColorMode, Hierarchical, PathSimplifyMode } = await import('@neplex/vectorizer');
    const keys = selectedCandidateKeys(normalized.strategy, prepared.effective.monochrome, normalized.binaryReconstruction);
    const candidates = [];

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const preset = PRESETS[key];
      onProgress?.(14 + Math.round((index / keys.length) * 62), `${index + 1}/${keys.length}: ${preset.label}`);
      try {
        if (preset.direct) {
          candidates.push(await buildDirectCandidate(prepared, reference, optimize));
          continue;
        }

        const candidatePath = path.join(workspace, `${preset.id}.png`);
        const preprocessing = await makeCandidateInput(prepared.normalizedPath, candidatePath, preset, normalized, prepared.effective);
        const source = await fs.readFile(candidatePath);
        const speckle = preset.id === 'detail-preserve'
          ? Math.max(0, normalized.turdSize - 1)
          : preset.id === 'compact-logo'
            ? Math.min(12, normalized.turdSize + 1)
            : normalized.turdSize;
        const hierarchy = preset.hierarchy === 'cutout'
          ? (Hierarchical.Cutout ?? Hierarchical.Stacked)
          : Hierarchical.Stacked;
        const vectorMode = preset.mode === 'polygon'
          ? (PathSimplifyMode.Polygon ?? PathSimplifyMode.Spline)
          : PathSimplifyMode.Spline;
        const traced = await vectorize(source, {
          colorMode: prepared.effective.monochrome ? ColorMode.Binary : ColorMode.Color,
          colorPrecision: preset.colorPrecision,
          filterSpeckle: speckle,
          spliceThreshold: preset.spliceThreshold,
          cornerThreshold: preset.cornerThreshold,
          hierarchical: hierarchy,
          mode: vectorMode,
          layerDifference: preset.layerDifference,
          lengthThreshold: preset.lengthThreshold,
          maxIterations: preset.maxIterations,
          pathPrecision: preset.pathPrecision
        });
        let optimized = String(await optimize(String(traced), {
          plugins: ['preset-default', { name: 'removeTitle' }],
          multipass: true,
          multipassIterations: 2
        }));
        optimized = restoreSvgCanvas(optimized, prepared.source);
        let geometryLock = null;
        if (prepared.effective.monochrome && normalized.geometryLock) {
          const locked = applyGeometryLockToSvg(optimized, {
            pathPrecision: 3,
            axisAngleDegrees: 1.8,
            collinearAngleDegrees: 1.25
          });
          optimized = locked.svg;
          geometryLock = locked.stats;
        }
        candidates.push({
          id: preset.id,
          label: preset.label,
          preprocessing,
          trace: { ...preset, filterSpeckle: speckle, actualMode: preset.mode },
          geometryLock,
          reconstruction: null,
          metrics: await assessSvg(optimized, reference, prepared.effective),
          svg: optimized
        });
      } catch (error) {
        candidateErrors.push({ id: preset.id, error: error.message || String(error) });
      }
    }

    if (!candidates.length) throw new Error(`Không candidate nào thành công. ${candidateErrors.map((item) => `${item.id}: ${item.error}`).join(' | ')}`);
    onProgress?.(84, prepared.effective.monochrome
      ? 'Đang chấm từng component, góc, độ thẳng và lòng chữ'
      : 'Đang chọn kết quả theo fidelity, cạnh và số node');
    const ranked = scoreCandidates(candidates, normalized.strategy, prepared.effective.monochrome);
    const selected = ranked.find((candidate) => !candidate.rejected) || ranked[0];
    await fs.writeFile(outputPath, selected.svg, 'utf8');
    const reportPath = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}.vector-report.json`);
    const warnings = [];
    if (selected.metrics.edgeRecall < 75) warnings.push('Edge recall thấp; nên kiểm tra chi tiết nhỏ trong Illustrator.');
    if (selected.metrics.nodeEstimate > 5000) warnings.push('SVG vẫn có nhiều node; thử chế độ Ít node hoặc giảm số màu.');
    if (prepared.effective.monochrome && selected.metrics.cornerPreservation < 84) warnings.push('Corner Preservation chưa đạt mức an toàn; cần soi các góc chữ ở 400%.');
    if (prepared.effective.monochrome && selected.metrics.straightnessScore < 90) warnings.push('Một số cạnh gần thẳng vẫn còn độ cong; nên kiểm tra trong Illustrator.');
    if (prepared.effective.monochrome && selected.metrics.componentValidation.worstComponentIoU < 90) {
      warnings.push(`Component yếu nhất chỉ đạt ${selected.metrics.componentValidation.worstComponentIoU}%; không nên tự động PASS.`);
    }
    if (prepared.effective.monochrome && selected.metrics.componentValidation.p10ComponentIoU < 92) {
      warnings.push(`10% component yếu nhất đạt ${selected.metrics.componentValidation.p10ComponentIoU}%; cần kiểm tra dấu, counter và đầu nét.`);
    }
    if (prepared.effective.monochrome && selected.metrics.colorCount > 2) warnings.push(`Logo đơn sắc nhưng SVG còn ${selected.metrics.colorCount} màu; cần kiểm tra separation.`);
    const report = {
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      inputPath,
      outputPath,
      strategy: normalized.strategy,
      requestedColorMode: normalized.colorMode,
      effectiveColorMode: prepared.effective.colorMode,
      autoMonochrome: prepared.effective.autoMonochrome,
      geometryLockEnabled: normalized.geometryLock,
      binaryReconstructionEnabled: normalized.binaryReconstruction,
      threshold: prepared.effective.threshold,
      source: prepared.source,
      selectedCandidate: selected.id,
      selectedScore: selected.score,
      qualityGate: {
        status: warnings.length ? 'review' : 'pass',
        worstComponentIoU: selected.metrics.componentValidation.worstComponentIoU,
        p10ComponentIoU: selected.metrics.componentValidation.p10ComponentIoU,
        cornerPreservation: selected.metrics.cornerPreservation,
        straightnessScore: selected.metrics.straightnessScore
      },
      warnings,
      candidates: ranked.map(({ svg, ...candidate }) => candidate),
      candidateErrors
    };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    onProgress?.(100, `Hoàn tất · ${selected.label} · worst component ${selected.metrics.componentValidation.worstComponentIoU ?? '—'}% · khoảng ${selected.metrics.nodeEstimate} node`);
    return { outputPath, reportPath, vectorReport: report };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  PRESETS,
  analyzeMonochromeSource,
  inspectSvgComplexity,
  normalizeOptions,
  otsuThreshold,
  scoreCandidates,
  selectedCandidateKeys,
  traceDimensions,
  vectorizeLogo
};