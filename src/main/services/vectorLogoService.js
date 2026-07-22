'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const engine = require('./vectorLogoEngine');
const { vectorizeMonochromeWithPotrace } = require('./potraceSmartService');
const { runColorMultiEngine } = require('./colorVectorRouterService');
const {
  analyzeVectorInput,
  formatVectorInputRejection
} = require('./vectorInputQualityService');

const CLEANUP_MAX_DIMENSION = 2400;

function colorDistance(data, offset, background) {
  return Math.sqrt(
    (data[offset] - background.red) ** 2
    + (data[offset + 1] - background.green) ** 2
    + (data[offset + 2] - background.blue) ** 2
  );
}

function detectBorderBackground(data, info) {
  if (info.channels < 4) return null;
  const samples = [];
  const add = (x, y) => {
    const offset = (y * info.width + x) * info.channels;
    samples.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
  };
  const stepX = Math.max(1, Math.floor(info.width / 100));
  const stepY = Math.max(1, Math.floor(info.height / 100));
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
  const nearWhite = mean[0] >= 230 && mean[1] >= 230 && mean[2] >= 230;
  if (!nearWhite || mean[3] < 245 || deviation > 12) return null;
  return { red: mean[0], green: mean[1], blue: mean[2], deviation };
}

function clearConnectedBorder(data, info, background) {
  if (!background || info.channels < 4) return { data, removedPixels: 0 };
  const output = Buffer.from(data);
  const pixels = info.width * info.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  let removedPixels = 0;

  const enqueue = (pixel) => {
    if (pixel < 0 || pixel >= pixels || visited[pixel]) return;
    const offset = pixel * info.channels;
    if (output[offset + 3] === 0 || colorDistance(output, offset, background) > 30) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x);
    enqueue((info.height - 1) * info.width + x);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(y * info.width);
    enqueue(y * info.width + info.width - 1);
  }

  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    const offset = pixel * info.channels;
    const distance = colorDistance(output, offset, background);
    if (distance <= 12) {
      output[offset + 3] = 0;
      removedPixels += 1;
    } else {
      output[offset + 3] = Math.min(output[offset + 3], Math.round(((distance - 12) / 18) * 255));
    }
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < info.width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - info.width);
    if (y + 1 < info.height) enqueue(pixel + info.width);
  }

  return { data: output, removedPixels };
}

async function safeBackgroundCleanup(inputPath, outputPath) {
  const raw = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize({ width: CLEANUP_MAX_DIMENSION, height: CLEANUP_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = detectBorderBackground(raw.data, raw.info);
  const cleaned = clearConnectedBorder(raw.data, raw.info, background);
  await sharp(cleaned.data, { raw: raw.info }).png({ compressionLevel: 6 }).toFile(outputPath);
  return {
    applied: Boolean(background),
    removedPixels: cleaned.removedPixels,
    width: raw.info.width,
    height: raw.info.height
  };
}

function applyConservativeInputPolicy(inputQuality) {
  const gate = inputQuality?.gate;
  if (!gate || gate.status !== 'reject') return inputQuality;

  const metrics = inputQuality.metrics || inputQuality;
  const longest = Math.max(
    Number(metrics.logoBounds?.width || 0),
    Number(metrics.logoBounds?.height || 0)
  );
  const contrast = Number(metrics.contrastRange || 0);
  const sharpness = Number(metrics.edge?.sharpnessScore || 0);
  const transition = Number(metrics.edge?.transitionWidthPx || 99);
  const stroke = Number(metrics.stroke?.minimumStrokePx || 0);
  const coverage = Number(metrics.foregroundCoveragePercent || 0);

  // Size is a review signal, not proof that geometry is unrecoverable. A small,
  // high-contrast and crisp logo can still trace reliably with Potrace.
  const sizeRisk = longest > 0 && longest < 180;
  const destructiveSignals = {
    lowContrast: contrast > 0 && contrast < 48,
    heavyBlur: sharpness < 20 && transition > 5.5,
    weakStroke: stroke > 0 && stroke < 1.8,
    missingForeground: coverage < 0.12
  };

  const catastrophic = [];
  if (contrast > 0 && contrast < 20) catastrophic.push('contrast-collapsed');
  if (sharpness < 8 && transition > 8) catastrophic.push('severe-blur');
  if (stroke > 0 && stroke < 0.75) catastrophic.push('stroke-unrecoverable');
  if (coverage < 0.02) catastrophic.push('foreground-not-detected');

  const severeSignalCount = Object.values(destructiveSignals).filter(Boolean).length;
  if (catastrophic.length || severeSignalCount >= 2) {
    gate.policy = 'conservative-reject';
    gate.catastrophicSignals = catastrophic;
    gate.severeSignalCount = severeSignalCount;
    gate.sizeRisk = sizeRisk;
    return inputQuality;
  }

  gate.status = 'review';
  gate.policy = 'downgraded-to-review';
  gate.sizeRisk = sizeRisk;
  gate.catastrophicSignals = [];
  gate.severeSignalCount = severeSignalCount;
  gate.warnings = [
    ...(gate.reasons || []).map((reason) => `Ảnh yếu nhưng vẫn cho phép thử trace: ${reason}`),
    ...(sizeRisk ? [`Vùng logo chỉ dài ${Math.round(longest)}px; sẽ trace ở chế độ REVIEW thay vì chặn.`] : []),
    ...(gate.warnings || [])
  ];
  gate.reasons = [];
  gate.score = Math.max(Number(gate.score || 0), 50);
  return inputQuality;
}

async function attachInputQuality(result, inputPath, inputQuality, backgroundCleanup = null) {
  result.vectorReport.inputPath = inputPath;
  result.vectorReport.inputQuality = inputQuality;
  if (backgroundCleanup) result.vectorReport.backgroundCleanup = backgroundCleanup;
  if (inputQuality.gate.status === 'review') {
    result.vectorReport.warnings = [
      ...inputQuality.gate.warnings.map((warning) => `Input Quality: ${warning}`),
      ...(result.vectorReport.warnings || [])
    ];
    if (result.vectorReport.qualityGate) result.vectorReport.qualityGate.status = 'review';
  }
  await fs.writeFile(result.reportPath, JSON.stringify(result.vectorReport, null, 2), 'utf8');
  return result;
}

async function runVTracerFallback(payload, options, sourceAnalysis, fallbackError = null) {
  const result = await engine.vectorizeLogo({
    ...payload,
    options: { ...options, sourceAnalysis }
  });
  if (fallbackError) {
    result.vectorReport.engineRouter = {
      selectedEngine: 'vtracer',
      actualEngine: 'vtracer',
      attemptedEngine: 'potrace',
      sourceType: 'monochrome',
      fallbackReason: fallbackError.message || String(fallbackError)
    };
    result.vectorReport.warnings = [
      `Potrace không chạy được; đã fallback sang VTracer: ${fallbackError.message || String(fallbackError)}`,
      ...(result.vectorReport.warnings || [])
    ];
  }
  return result;
}

async function runColorRouter(payload, options, sourceAnalysis, inputPath) {
  return runColorMultiEngine({
    inputPath,
    outputPath: payload.outputPath,
    options: { ...options, sourceAnalysis },
    onProgress: payload.onProgress
  });
}

async function vectorizeLogo(payload) {
  const options = payload.options || {};
  payload.onProgress?.(2, 'Đang kiểm tra chất lượng ảnh đầu vào');
  const inputQuality = applyConservativeInputPolicy(await analyzeVectorInput(payload.inputPath));
  if (inputQuality.gate.status === 'reject') {
    const error = new Error(formatVectorInputRejection(inputQuality));
    error.code = 'VECTOR_INPUT_REJECTED';
    error.inputQuality = inputQuality;
    throw error;
  }

  const sourceAnalysis = await engine.analyzeMonochromeSource(payload.inputPath);
  const forcedBinary = options.colorMode === 'binary';
  const useGeometrySource = forcedBinary || sourceAnalysis.isMonochrome;

  if (useGeometrySource && options.vectorEngine !== 'vtracer') {
    try {
      const result = await vectorizeMonochromeWithPotrace({
        ...payload,
        options,
        sourceAnalysis
      });
      return attachInputQuality(result, payload.inputPath, inputQuality);
    } catch (error) {
      payload.onProgress?.(12, 'Potrace không khả dụng, đang fallback sang VTracer');
      const result = await runVTracerFallback(payload, options, sourceAnalysis, error);
      return attachInputQuality(result, payload.inputPath, inputQuality);
    }
  }

  if (useGeometrySource) {
    const result = await runVTracerFallback(payload, options, sourceAnalysis);
    return attachInputQuality(result, payload.inputPath, inputQuality);
  }

  const shouldCleanup = options.backgroundCleanup !== false
    && options.colorMode !== 'binary';

  if (!shouldCleanup) {
    const result = await runColorRouter(payload, options, sourceAnalysis, payload.inputPath);
    return attachInputQuality(result, payload.inputPath, inputQuality);
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-vector-background-'));
  const cleanedInput = path.join(workspace, 'background-cleaned.png');
  try {
    const cleanup = await safeBackgroundCleanup(payload.inputPath, cleanedInput);
    const workingInput = cleanup.applied ? cleanedInput : payload.inputPath;
    const result = await runColorRouter(payload, options, sourceAnalysis, workingInput);
    return attachInputQuality(result, payload.inputPath, inputQuality, cleanup);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  ...engine,
  analyzeVectorInput,
  applyConservativeInputPolicy,
  clearConnectedBorder,
  detectBorderBackground,
  safeBackgroundCleanup,
  vectorizeLogo
};
