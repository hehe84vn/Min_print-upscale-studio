'use strict';

const sharp = require('sharp');

const ANALYSIS_MAX = 1400;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values, fraction, fallback = 0) {
  if (!values.length) return fallback;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

function otsuThreshold(histogram, total) {
  let weighted = 0;
  for (let value = 0; value < 256; value += 1) weighted += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const meanBackground = backgroundSum / backgroundWeight;
    const meanForeground = (weighted - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return clamp(threshold, 24, 232);
}

function grayscaleFromRaw(data, info) {
  const gray = new Uint8Array(info.width * info.height);
  const histogram = new Uint32Array(256);
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const offset = pixel * info.channels;
    const red = data[offset];
    const green = data[offset + 1] ?? red;
    const blue = data[offset + 2] ?? red;
    const value = clamp(Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722), 0, 255);
    gray[pixel] = value;
    histogram[value] += 1;
  }
  return { gray, histogram };
}

function detectForeground(gray, width, height, threshold) {
  let dark = 0;
  let light = 0;
  for (const value of gray) {
    if (value <= threshold) dark += 1;
    else light += 1;
  }
  const foregroundDark = dark <= light;
  const mask = new Uint8Array(gray.length);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const foreground = foregroundDark ? gray[index] <= threshold : gray[index] > threshold;
    if (!foreground) continue;
    mask[index] = 1;
    pixels += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    mask,
    foregroundDark,
    pixels,
    bounds: maxX >= minX && maxY >= minY
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : { x: 0, y: 0, width: 0, height: 0 }
  };
}

function edgeMetrics(gray, width, height) {
  const magnitudes = [];
  const laplacian = [];
  let totalGradient = 0;
  let maximumGradient = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const a = gray[index - width - 1];
      const b = gray[index - width];
      const c = gray[index - width + 1];
      const d = gray[index - 1];
      const e = gray[index];
      const f = gray[index + 1];
      const g = gray[index + width - 1];
      const h = gray[index + width];
      const i = gray[index + width + 1];
      const gx = -a + c - 2 * d + 2 * f - g + i;
      const gy = -a - 2 * b - c + g + 2 * h + i;
      const magnitude = Math.hypot(gx, gy);
      totalGradient += magnitude;
      maximumGradient = Math.max(maximumGradient, magnitude);
      magnitudes.push(magnitude);
      laplacian.push(Math.abs(4 * e - b - d - f - h));
    }
  }
  const strongThreshold = Math.max(55, percentile(magnitudes, 0.90, 55));
  const strong = magnitudes.filter((value) => value >= strongThreshold);
  const meanStrong = strong.reduce((sum, value) => sum + value, 0) / Math.max(1, strong.length);
  const p90Laplacian = percentile(laplacian, 0.90, 0);
  const edgeDensity = strong.length / Math.max(1, magnitudes.length);
  const sharpnessScore = clamp(
    (meanStrong / 720) * 58
    + (p90Laplacian / 255) * 30
    + clamp(edgeDensity / 0.12, 0, 1) * 12,
    0,
    100
  );
  const transitionWidthPx = clamp(7.2 - sharpnessScore * 0.065, 0.7, 7.2);
  return {
    sharpnessScore: Number(sharpnessScore.toFixed(2)),
    transitionWidthPx: Number(transitionWidthPx.toFixed(2)),
    meanStrongGradient: Number(meanStrong.toFixed(2)),
    p90Laplacian: Number(p90Laplacian.toFixed(2)),
    edgeDensity: Number((edgeDensity * 100).toFixed(2)),
    maximumGradient: Number(maximumGradient.toFixed(2)),
    meanGradient: Number((totalGradient / Math.max(1, magnitudes.length)).toFixed(2))
  };
}

function minimumStrokeEstimate(mask, width, height, bounds) {
  const runs = [];
  const addRuns = (start, end, step) => {
    let run = 0;
    for (let index = start; index !== end; index += step) {
      if (mask[index]) run += 1;
      else if (run) {
        if (run >= 2) runs.push(run);
        run = 0;
      }
    }
    if (run >= 2) runs.push(run);
  };
  const xStep = Math.max(1, Math.floor(bounds.width / 80));
  const yStep = Math.max(1, Math.floor(bounds.height / 80));
  for (let y = bounds.y; y < bounds.y + bounds.height; y += yStep) {
    addRuns(y * width + bounds.x, y * width + bounds.x + bounds.width, 1);
  }
  for (let x = bounds.x; x < bounds.x + bounds.width; x += xStep) {
    addRuns(bounds.y * width + x, (bounds.y + bounds.height) * width + x, width);
  }
  const estimate = percentile(runs, 0.10, 0);
  return {
    minimumStrokePx: Number(estimate.toFixed(2)),
    sampledRuns: runs.length,
    medianStrokePx: Number(percentile(runs, 0.50, 0).toFixed(2))
  };
}

function jpegBlockiness(gray, width, height) {
  let boundary = 0;
  let boundaryCount = 0;
  let regular = 0;
  let regularCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const difference = Math.abs(gray[y * width + x] - gray[y * width + x - 1]);
      if (x % 8 === 0) { boundary += difference; boundaryCount += 1; }
      else { regular += difference; regularCount += 1; }
    }
  }
  for (let y = 1; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const difference = Math.abs(gray[y * width + x] - gray[(y - 1) * width + x]);
      if (y % 8 === 0) { boundary += difference; boundaryCount += 1; }
      else { regular += difference; regularCount += 1; }
    }
  }
  const boundaryMean = boundary / Math.max(1, boundaryCount);
  const regularMean = regular / Math.max(1, regularCount);
  const ratio = boundaryMean / Math.max(1, regularMean);
  const score = clamp((ratio - 1) * 48, 0, 100);
  return {
    jpegArtifactScore: Number(score.toFixed(2)),
    blockBoundaryRatio: Number(ratio.toFixed(3))
  };
}

function classify(metrics) {
  const reasons = [];
  const warnings = [];
  const longest = Math.max(metrics.logoBounds.width, metrics.logoBounds.height);
  const contrast = metrics.contrastRange;
  const sharpness = metrics.edge.sharpnessScore;
  const transition = metrics.edge.transitionWidthPx;
  const stroke = metrics.stroke.minimumStrokePx;
  const artifact = metrics.compression.jpegArtifactScore;
  const coverage = metrics.foregroundCoveragePercent;

  if (longest < 220) reasons.push(`Vùng logo chỉ dài ${longest}px, không đủ dữ liệu hình học.`);
  else if (longest < 420) warnings.push(`Vùng logo chỉ dài ${longest}px; chi tiết nhỏ có thể sai.`);

  if (contrast < 55) reasons.push(`Độ tương phản chỉ ${contrast}; logo và nền không tách biệt đủ rõ.`);
  else if (contrast < 90) warnings.push(`Độ tương phản thấp (${contrast}); biên màu có thể nhập nhằng.`);

  if (sharpness < 24 || transition > 5.1) reasons.push(`Cạnh quá mờ: sharpness ${sharpness}/100, transition khoảng ${transition}px.`);
  else if (sharpness < 42 || transition > 3.8) warnings.push(`Ảnh hơi mềm: sharpness ${sharpness}/100, transition khoảng ${transition}px.`);

  if (stroke > 0 && stroke < 2.2) reasons.push(`Nét nhỏ nhất ước tính ${stroke}px, không đủ để dựng vector ổn định.`);
  else if (stroke > 0 && stroke < 3.5) warnings.push(`Nét nhỏ nhất chỉ khoảng ${stroke}px; có nguy cơ mất dấu hoặc counter.`);

  if (artifact > 64) reasons.push(`JPEG artifact cao (${artifact}/100) quanh các block 8px.`);
  else if (artifact > 38) warnings.push(`JPEG artifact đáng kể (${artifact}/100).`);

  if (coverage < 0.18) reasons.push('Không nhận diện được vùng logo đủ lớn trong ảnh.');
  else if (coverage > 96) warnings.push('Logo gần như phủ toàn canvas; có thể nhận diện sai nền/foreground.');

  const status = reasons.length ? 'reject' : warnings.length ? 'review' : 'pass';
  let score = 100;
  score -= Math.max(0, 420 - longest) / 6;
  score -= Math.max(0, 48 - sharpness) * 0.85;
  score -= Math.max(0, transition - 2.4) * 7;
  score -= Math.max(0, 95 - contrast) * 0.22;
  score -= Math.max(0, 3.8 - stroke) * 6;
  score -= artifact * 0.16;
  if (status === 'reject') score = Math.min(score, 49);
  else if (status === 'review') score = Math.min(score, 79);
  return { status, score: Number(clamp(score, 0, 100).toFixed(2)), reasons, warnings };
}

async function analyzeVectorInput(inputPath) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh đầu vào.');
  const raw = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: ANALYSIS_MAX, height: ANALYSIS_MAX, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { gray, histogram } = grayscaleFromRaw(raw.data, raw.info);
  const threshold = otsuThreshold(histogram, gray.length);
  const foreground = detectForeground(gray, raw.info.width, raw.info.height, threshold);
  const values = Array.from(gray);
  const p05 = percentile(values, 0.05, 0);
  const p95 = percentile(values, 0.95, 255);
  const edge = edgeMetrics(gray, raw.info.width, raw.info.height);
  const stroke = minimumStrokeEstimate(foreground.mask, raw.info.width, raw.info.height, foreground.bounds);
  const compression = jpegBlockiness(gray, raw.info.width, raw.info.height);
  const scaleX = metadata.width / raw.info.width;
  const scaleY = metadata.height / raw.info.height;
  const logoBounds = {
    x: Math.round(foreground.bounds.x * scaleX),
    y: Math.round(foreground.bounds.y * scaleY),
    width: Math.round(foreground.bounds.width * scaleX),
    height: Math.round(foreground.bounds.height * scaleY)
  };
  stroke.minimumStrokePx = Number((stroke.minimumStrokePx * Math.min(scaleX, scaleY)).toFixed(2));
  stroke.medianStrokePx = Number((stroke.medianStrokePx * Math.min(scaleX, scaleY)).toFixed(2));
  const report = {
    schemaVersion: 1,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format || 'unknown',
    analysisWidth: raw.info.width,
    analysisHeight: raw.info.height,
    threshold,
    foregroundDark: foreground.foregroundDark,
    foregroundCoveragePercent: Number((foreground.pixels / Math.max(1, gray.length) * 100).toFixed(2)),
    logoBounds,
    contrastRange: Number((p95 - p05).toFixed(2)),
    intensityP05: p05,
    intensityP95: p95,
    edge,
    stroke,
    compression
  };
  report.gate = classify(report);
  return report;
}

function formatVectorInputRejection(report) {
  const lines = [
    'Không thể vector hóa đáng tin cậy — Input Quality: REJECT',
    `Điểm đầu vào: ${report.gate.score}/100`,
    ...report.gate.reasons.map((reason, index) => `${index + 1}. ${reason}`),
    '',
    'Vui lòng cung cấp PNG/PDF/AI/EPS/SVG rõ hơn hoặc ảnh có vùng logo lớn hơn.'
  ];
  return lines.join('\n');
}

module.exports = {
  analyzeVectorInput,
  classify,
  edgeMetrics,
  formatVectorInputRejection,
  jpegBlockiness,
  minimumStrokeEstimate,
  otsuThreshold
};