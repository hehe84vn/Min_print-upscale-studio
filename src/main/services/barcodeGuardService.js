const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource
} = require('@zxing/library');

const SUPPORTED_FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.PDF_417,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR
];

const TWO_DIMENSIONAL_FORMATS = new Set([
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.AZTEC,
  BarcodeFormat.PDF_417
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function formatName(format) {
  return BarcodeFormat[format] || String(format);
}

function safePreview(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

function normalizedRegion(points, width, height, format) {
  if (!Array.isArray(points) || !points.length || !width || !height) return null;
  const xs = points.map((point) => Number(point.getX?.() ?? point.x)).filter(Number.isFinite);
  const ys = points.map((point) => Number(point.getY?.() ?? point.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;

  let left = Math.min(...xs) / width;
  let right = Math.max(...xs) / width;
  let top = Math.min(...ys) / height;
  let bottom = Math.max(...ys) / height;
  const measuredWidth = Math.max(0.02, right - left);
  const measuredHeight = Math.max(0.02, bottom - top);

  if (TWO_DIMENSIONAL_FORMATS.has(format)) {
    const padding = Math.max(measuredWidth, measuredHeight) * 0.18;
    left -= padding;
    right += padding;
    top -= padding;
    bottom += padding;
  } else {
    const centerY = (top + bottom) / 2;
    const estimatedHeight = Math.max(0.08, measuredWidth * 0.34, measuredHeight * 4);
    left -= measuredWidth * 0.08;
    right += measuredWidth * 0.08;
    top = centerY - estimatedHeight / 2;
    bottom = centerY + estimatedHeight / 2;
  }

  return {
    left: clamp(left, 0, 1),
    top: clamp(top, 0, 1),
    right: clamp(right, 0, 1),
    bottom: clamp(bottom, 0, 1)
  };
}

async function rawArgbForDecode(filePath, maxDimension = 2400) {
  const image = sharp(filePath, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được ảnh để kiểm tra QR/barcode.');

  const scale = Math.min(1, maxDimension / Math.max(metadata.width, metadata.height));
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));
  const { data, info } = await image
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const argb = new Int32Array(info.width * info.height);
  for (let source = 0, target = 0; target < argb.length; source += 3, target += 1) {
    argb[target] = (255 << 24) | (data[source] << 16) | (data[source + 1] << 8) | data[source + 2];
  }

  return { argb, width: info.width, height: info.height };
}

async function decodeBarcode(filePath) {
  try {
    const { argb, width, height } = await rawArgbForDecode(filePath);
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new MultiFormatReader();
    const source = new RGBLuminanceSource(argb, width, height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    const result = reader.decode(bitmap, hints);
    reader.reset();

    const value = result.getText();
    const format = result.getBarcodeFormat();
    return {
      detected: true,
      value,
      valueHash: hashValue(value),
      valuePreview: safePreview(value),
      format,
      formatName: formatName(format),
      region: normalizedRegion(result.getResultPoints?.() || [], width, height, format),
      analysisWidth: width,
      analysisHeight: height
    };
  } catch (error) {
    return {
      detected: false,
      errorName: error?.name || 'NotFoundException',
      error: error?.message || 'Không tìm thấy QR/barcode có thể đọc.'
    };
  }
}

function publicDetection(detection) {
  if (!detection?.detected) return { detected: false };
  return {
    detected: true,
    format: detection.formatName,
    valueHash: detection.valueHash,
    valuePreview: detection.valuePreview,
    region: detection.region
  };
}

async function validateBarcode(sourceDetection, outputPath) {
  if (!sourceDetection?.detected) {
    return { status: 'not-detected', source: { detected: false }, output: { detected: false } };
  }

  const outputDetection = await decodeBarcode(outputPath);
  const matches = outputDetection.detected
    && outputDetection.valueHash === sourceDetection.valueHash
    && outputDetection.format === sourceDetection.format;

  return {
    status: matches ? 'pass' : outputDetection.detected ? 'mismatch' : 'unreadable',
    source: publicDetection(sourceDetection),
    output: publicDetection(outputDetection)
  };
}

function regionToPixels(region, width, height) {
  if (!region) return null;
  const left = clamp(Math.floor(region.left * width), 0, width - 1);
  const top = clamp(Math.floor(region.top * height), 0, height - 1);
  const right = clamp(Math.ceil(region.right * width), left + 1, width);
  const bottom = clamp(Math.ceil(region.bottom * height), top + 1, height);
  return { left, top, width: right - left, height: bottom - top };
}

async function createBarcodeMask({ detection, width, height, outputPath = null }) {
  if (!detection?.detected || !detection.region) return null;
  const rect = regionToPixels(detection.region, width, height);
  if (!rect) return null;

  const pixels = Buffer.alloc(width * height, 0);
  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    pixels.fill(255, y * width + rect.left, y * width + rect.left + rect.width);
  }

  const mask = await sharp(pixels, { raw: { width, height, channels: 1 } })
    .blur(Math.max(1, Math.min(5, Math.round(Math.max(width, height) / 900))))
    .png({ compressionLevel: 7 })
    .toBuffer();
  if (outputPath) await sharp(mask).png({ compressionLevel: 7 }).toFile(outputPath);

  return { buffer: mask, rect, outputPath };
}

async function restoreBarcodeRegion({ sourcePath, outputPath, region, dpi = 300 }) {
  const metadata = await sharp(outputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được ảnh kết quả để phục hồi QR/barcode.');
  const rect = regionToPixels(region, metadata.width, metadata.height);
  if (!rect) throw new Error('Không xác định được vùng QR/barcode để phục hồi.');

  const sourcePatch = await sharp(sourcePath, { failOn: 'none' })
    .rotate()
    .resize(metadata.width, metadata.height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .extract(rect)
    .png({ compressionLevel: 4 })
    .toBuffer();
  const temporaryPath = `${outputPath}.barcode-guard-${process.pid}-${Date.now()}${path.extname(outputPath) || '.png'}`;

  try {
    await sharp(outputPath, { failOn: 'none' })
      .composite([{ input: sourcePatch, left: rect.left, top: rect.top, blend: 'over' }])
      .withMetadata({ density: dpi })
      .png({ compressionLevel: 7 })
      .toFile(temporaryPath);
    await fs.rename(temporaryPath, outputPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }

  return rect;
}

async function guardBarcode({ sourcePath, outputPath, sourceDetection = null, enabled = true, dpi = 300 }) {
  if (!enabled) return { enabled: false, status: 'disabled', source: { detected: false }, output: { detected: false } };
  const source = sourceDetection || await decodeBarcode(sourcePath);
  const firstValidation = await validateBarcode(source, outputPath);
  if (!source.detected || firstValidation.status === 'pass' || !source.region) {
    return { enabled: true, restored: false, ...firstValidation };
  }

  const restoredRect = await restoreBarcodeRegion({
    sourcePath,
    outputPath,
    region: source.region,
    dpi
  });
  const secondValidation = await validateBarcode(source, outputPath);
  return {
    enabled: true,
    restored: true,
    restoredRect,
    initialStatus: firstValidation.status,
    ...secondValidation
  };
}

module.exports = {
  SUPPORTED_FORMATS,
  createBarcodeMask,
  decodeBarcode,
  guardBarcode,
  publicDetection,
  regionToPixels,
  restoreBarcodeRegion,
  validateBarcode
};
