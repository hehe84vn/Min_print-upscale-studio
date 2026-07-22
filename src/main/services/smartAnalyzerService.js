const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { decodeBarcode } = require('./barcodeGuardService');

const MAX_SCALE = 8;
const FIXED_SCALES = [2, 3, 4, 6, 8];
const SAFE_OUTPUT_PIXELS = 300_000_000;

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeScale(value, fallback = 2) {
  return clamp(value, 1, MAX_SCALE, fallback);
}

function normalizeFixedScale(value, fallback = 2) {
  const scale = Number(value);
  return FIXED_SCALES.includes(scale) ? scale : fallback;
}

function unitToInches(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (unit === 'mm') return number / 25.4;
  if (unit === 'cm') return number / 2.54;
  if (unit === 'in') return number;
  return null;
}

function nearestSupportedScale(requiredScale) {
  const required = normalizeScale(requiredScale, 2);
  return FIXED_SCALES.find((value) => value >= required) || MAX_SCALE;
}

function calculateTargetPlan({
  inputWidth,
  inputHeight,
  width,
  height,
  unit = 'cm',
  dpi = 300
}) {
  const sourceWidth = Number(inputWidth);
  const sourceHeight = Number(inputHeight);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Kích thước ảnh nguồn không hợp lệ.');
  }

  const widthInches = unitToInches(width, unit);
  const heightInches = unitToInches(height, unit);
  if (!widthInches && !heightInches) throw new Error('Nhập ít nhất chiều rộng hoặc chiều cao thành phẩm.');

  const safeDpi = [150, 200, 240, 300].includes(Number(dpi)) ? Number(dpi) : 300;
  const targetWidth = widthInches ? Math.max(1, Math.round(widthInches * safeDpi)) : null;
  const targetHeight = heightInches ? Math.max(1, Math.round(heightInches * safeDpi)) : null;
  const widthScale = targetWidth ? targetWidth / sourceWidth : 1;
  const heightScale = targetHeight ? targetHeight / sourceHeight : 1;
  const requiredScale = Math.max(1, widthScale, heightScale);
  const appliedScale = Math.min(MAX_SCALE, requiredScale);
  const outputWidth = Math.max(1, Math.round(sourceWidth * appliedScale));
  const outputHeight = Math.max(1, Math.round(sourceHeight * appliedScale));
  const outputPixels = outputWidth * outputHeight;

  return {
    mode: 'target-print',
    unit,
    dpi: safeDpi,
    targetWidth,
    targetHeight,
    requiredScale: Number(requiredScale.toFixed(3)),
    appliedScale: Number(appliedScale.toFixed(3)),
    suggestedFixedScale: nearestSupportedScale(requiredScale),
    outputWidth,
    outputHeight,
    outputPixels,
    exceedsScaleLimit: requiredScale > MAX_SCALE,
    exceedsPixelSafetyLimit: outputPixels > SAFE_OUTPUT_PIXELS
  };
}

function estimateOutput({ width, height, format = 'png', cmyk = false }) {
  const pixels = Math.max(1, Number(width) * Number(height));
  const rgbFactor = format === 'tiff' ? 2.15 : format === 'jpeg' ? 0.55 : 1.35;
  const rgbBytes = Math.round(pixels * rgbFactor);
  const cmykBytes = cmyk ? Math.round(pixels * 2.6) : 0;
  return {
    pixels,
    megapixels: Number((pixels / 1_000_000).toFixed(1)),
    rgbBytes,
    cmykBytes,
    totalBytes: rgbBytes + cmykBytes
  };
}

function recommendScale(width, height) {
  const minimum = Math.min(width, height);
  if (minimum < 900) return 4;
  if (minimum < 1600) return 3;
  return 2;
}

function classifySample({ edgeDensity, averageSaturation, contrast, barcodeDetected }) {
  if (barcodeDetected || (edgeDensity >= 0.17 && averageSaturation <= 0.48)) return 'packaging-artwork';
  if (averageSaturation <= 0.09 && edgeDensity >= 0.12) return 'text-line-art';
  if (edgeDensity >= 0.27 || contrast >= 68) return 'detail-rich';
  return 'photo';
}

function recommendationFor(classification, width, height, barcodeDetected) {
  const base = {
    scale: recommendScale(width, height),
    model: 'high-fidelity-4x',
    detailStrength: 15,
    protectionSensitivity: 65,
    semanticProtectionEnabled: false,
    codeGuardEnabled: Boolean(barcodeDetected),
    reason: 'Ảnh chụp tổng quát, ưu tiên fidelity và cấu trúc tự nhiên.'
  };

  if (classification === 'packaging-artwork') {
    return {
      ...base,
      model: 'remacri-4x',
      detailStrength: 15,
      protectionSensitivity: 70,
      semanticProtectionEnabled: true,
      codeGuardEnabled: true,
      reason: 'Artwork có nhiều cạnh phẳng hoặc vùng mã; ưu tiên Remacri và bảo vệ cấu trúc.'
    };
  }
  if (classification === 'text-line-art') {
    return {
      ...base,
      model: 'high-fidelity-4x',
      detailStrength: 10,
      protectionSensitivity: 75,
      semanticProtectionEnabled: true,
      reason: 'Ảnh thiên về chữ hoặc line art; ưu tiên fidelity, hạn chế texture giả.'
    };
  }
  if (classification === 'detail-rich') {
    return {
      ...base,
      model: 'realesrgan-x4plus',
      detailStrength: 20,
      protectionSensitivity: 60,
      reason: 'Ảnh có mật độ chi tiết cao; RealESRGAN phù hợp để tăng texture cảm nhận.'
    };
  }
  return base;
}

async function sampleMetrics(inputPath) {
  const { data, info } = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const width = info.width;
  const height = info.height;
  let saturationSum = 0;
  let luminanceSum = 0;
  let luminanceSquared = 0;
  let edgeCount = 0;
  let edgeSamples = 0;

  const luminance = new Float32Array(width * height);
  for (let index = 0, pixel = 0; index < data.length; index += channels, pixel += 1) {
    const red = data[index];
    const green = data[index + 1] ?? red;
    const blue = data[index + 2] ?? red;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    saturationSum += maximum === 0 ? 0 : (maximum - minimum) / maximum;
    const value = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    luminance[pixel] = value;
    luminanceSum += value;
    luminanceSquared += value * value;
  }

  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x;
      const difference = Math.abs(luminance[index] - luminance[index - 1])
        + Math.abs(luminance[index] - luminance[index - width]);
      if (difference >= 42) edgeCount += 1;
      edgeSamples += 1;
    }
  }

  const pixels = Math.max(1, width * height);
  const mean = luminanceSum / pixels;
  const variance = Math.max(0, luminanceSquared / pixels - mean * mean);
  return {
    sampleWidth: width,
    sampleHeight: height,
    edgeDensity: Number((edgeCount / Math.max(1, edgeSamples)).toFixed(4)),
    averageSaturation: Number((saturationSum / pixels).toFixed(4)),
    contrast: Number(Math.sqrt(variance).toFixed(2))
  };
}

async function analyzeImage(inputPath, options = {}) {
  if (!inputPath) throw new Error('Thiếu ảnh cần phân tích.');
  const [metadata, file, metrics] = await Promise.all([
    sharp(inputPath, { failOn: 'none' }).metadata(),
    fs.stat(inputPath),
    sampleMetrics(inputPath)
  ]);
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh.');

  let barcode = null;
  try {
    barcode = await decodeBarcode(inputPath);
  } catch (error) {
    barcode = { detected: false, error: error.message || String(error) };
  }
  const barcodeDetected = Boolean(barcode?.detected);
  const classification = classifySample({ ...metrics, barcodeDetected });
  const recommendation = recommendationFor(classification, metadata.width, metadata.height, barcodeDetected);

  let targetPlan = null;
  if (options.targetPrint) {
    targetPlan = calculateTargetPlan({
      inputWidth: metadata.width,
      inputHeight: metadata.height,
      ...options.targetPrint
    });
  }

  const selectedScale = targetPlan?.appliedScale || normalizeFixedScale(options.scale, recommendation.scale);
  const outputWidth = Math.max(1, Math.round(metadata.width * selectedScale));
  const outputHeight = Math.max(1, Math.round(metadata.height * selectedScale));
  const estimate = estimateOutput({
    width: outputWidth,
    height: outputHeight,
    format: options.format || 'png',
    cmyk: Boolean(options.cmyk)
  });

  const warnings = [];
  if (targetPlan?.exceedsScaleLimit) warnings.push('Kích thước in yêu cầu vượt giới hạn 8×; cần giảm DPI, giảm khổ in hoặc dùng ảnh nguồn lớn hơn.');
  if (estimate.pixels > SAFE_OUTPUT_PIXELS) warnings.push('Ảnh đầu ra vượt ngưỡng an toàn 300 MP; job sẽ bị chặn để tránh lỗi bộ nhớ.');
  if (estimate.megapixels >= 180) warnings.push('Ảnh đầu ra rất lớn; thời gian xử lý và dung lượng TIFF CMYK sẽ tăng mạnh.');

  return {
    inputPath,
    fileName: path.basename(inputPath),
    metadata: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || path.extname(inputPath).slice(1),
      colorSpace: metadata.space || 'unknown',
      channels: metadata.channels || null,
      sizeBytes: file.size
    },
    metrics,
    barcode: barcodeDetected ? {
      detected: true,
      format: barcode.formatName || barcode.format || 'CODE',
      visualOnly: Boolean(barcode.visualOnly)
    } : { detected: false },
    classification,
    recommendation,
    targetPlan,
    selectedScale: Number(selectedScale.toFixed(3)),
    output: {
      width: outputWidth,
      height: outputHeight,
      ...estimate
    },
    warnings,
    limits: {
      maxScale: MAX_SCALE,
      safeOutputPixels: SAFE_OUTPUT_PIXELS,
      fixedScales: FIXED_SCALES
    }
  };
}

module.exports = {
  FIXED_SCALES,
  MAX_SCALE,
  SAFE_OUTPUT_PIXELS,
  analyzeImage,
  calculateTargetPlan,
  estimateOutput,
  nearestSupportedScale,
  normalizeFixedScale,
  normalizeScale
};