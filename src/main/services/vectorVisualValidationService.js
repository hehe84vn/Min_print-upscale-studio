'use strict';

const sharp = require('sharp');

const DEFAULT_RENDER_SIZE = 1024;

async function rasterizeSvg(svg, size = DEFAULT_RENDER_SIZE) {
  const rendered = await sharp(Buffer.from(String(svg || '')), { density: 144, failOn: 'none' })
    .resize({ width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return rendered;
}

function compareRgba(reference, candidate, options = {}) {
  if (reference.info.width !== candidate.info.width || reference.info.height !== candidate.info.height) {
    throw new Error('Visual validation requires equal raster dimensions.');
  }

  const alphaThreshold = Number(options.alphaThreshold ?? 12);
  const changedThreshold = Number(options.changedThreshold ?? 18);
  const pixels = reference.info.width * reference.info.height;
  let intersection = 0;
  let union = 0;
  let changedPixels = 0;
  let totalDelta = 0;
  let foregroundPixels = 0;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const referenceAlpha = reference.data[offset + 3];
    const candidateAlpha = candidate.data[offset + 3];
    const referenceForeground = referenceAlpha > alphaThreshold;
    const candidateForeground = candidateAlpha > alphaThreshold;

    if (referenceForeground && candidateForeground) intersection += 1;
    if (referenceForeground || candidateForeground) union += 1;
    if (referenceForeground || candidateForeground) foregroundPixels += 1;

    let pixelDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      pixelDelta += Math.abs(reference.data[offset + channel] - candidate.data[offset + channel]);
    }
    totalDelta += pixelDelta / 4;
    if (pixelDelta / 4 > changedThreshold) changedPixels += 1;
  }

  return {
    shapeIoU: union > 0 ? Number((intersection / union).toFixed(6)) : 1,
    changedPixelRatio: Number((changedPixels / Math.max(1, pixels)).toFixed(6)),
    changedForegroundRatio: Number((changedPixels / Math.max(1, foregroundPixels)).toFixed(6)),
    meanChannelDelta: Number((totalDelta / Math.max(1, pixels)).toFixed(4)),
    width: reference.info.width,
    height: reference.info.height
  };
}

function evaluateVisualMetrics(metrics, options = {}) {
  const thresholds = {
    minimumShapeIoU: Number(options.minimumShapeIoU ?? 0.992),
    maximumChangedPixelRatio: Number(options.maximumChangedPixelRatio ?? 0.018),
    maximumChangedForegroundRatio: Number(options.maximumChangedForegroundRatio ?? 0.055),
    maximumMeanChannelDelta: Number(options.maximumMeanChannelDelta ?? 2.8)
  };
  const reasons = [];
  if (metrics.shapeIoU < thresholds.minimumShapeIoU) reasons.push(`Shape IoU ${metrics.shapeIoU} < ${thresholds.minimumShapeIoU}`);
  if (metrics.changedPixelRatio > thresholds.maximumChangedPixelRatio) reasons.push(`Changed pixels ${(metrics.changedPixelRatio * 100).toFixed(2)}% > ${(thresholds.maximumChangedPixelRatio * 100).toFixed(2)}%`);
  if (metrics.changedForegroundRatio > thresholds.maximumChangedForegroundRatio) reasons.push(`Foreground delta ${(metrics.changedForegroundRatio * 100).toFixed(2)}% > ${(thresholds.maximumChangedForegroundRatio * 100).toFixed(2)}%`);
  if (metrics.meanChannelDelta > thresholds.maximumMeanChannelDelta) reasons.push(`Mean color delta ${metrics.meanChannelDelta} > ${thresholds.maximumMeanChannelDelta}`);
  return { accepted: reasons.length === 0, reasons, thresholds };
}

async function validateSvgVisual(referenceSvg, candidateSvg, options = {}) {
  const size = Math.max(256, Math.min(1600, Number(options.renderSize) || DEFAULT_RENDER_SIZE));
  const [reference, candidate] = await Promise.all([
    rasterizeSvg(referenceSvg, size),
    rasterizeSvg(candidateSvg, size)
  ]);
  const metrics = compareRgba(reference, candidate, options);
  const gate = evaluateVisualMetrics(metrics, options);
  return { ...gate, metrics, renderSize: size };
}

module.exports = {
  DEFAULT_RENDER_SIZE,
  compareRgba,
  evaluateVisualMetrics,
  rasterizeSvg,
  validateSvgVisual
};
