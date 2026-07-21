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

async function detectVisualBarcodeRegion(filePath, maxDimension = 1800) {
  const image = sharp(filePath, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) return null;

  const scale = Math.min(1, maxDimension / Math.max(metadata.width, metadata.height));
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));
  const { data, info } = await image
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tileWidth = 24;
  const tileHeight = 24;
  const columns = Math.ceil(info.width / tileWidth);
  const rows = Math.ceil(info.height / tileHeight);
  const candidate = new Uint8Array(columns * rows);
  const tileScore = new Float64Array(columns * rows);

  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const startX = tileX * tileWidth;
      const startY = tileY * tileHeight;
      const endX = Math.min(info.width - 1, startX + tileWidth);
      const endY = Math.min(info.height - 1, startY + tileHeight);
      let samples = 0;
      let strongVertical = 0;
      let verticalEnergy = 0;
      let horizontalEnergy = 0;
      let darkPixels = 0;
      let sum = 0;
      let sumSquares = 0;

      for (let y = Math.max(1, startY); y < endY; y += 1) {
        for (let x = Math.max(1, startX); x < endX; x += 1) {
          const index = y * info.width + x;
          const value = data[index];
          const gx = Math.abs(data[index + 1] - data[index - 1]);
          const gy = Math.abs(data[index + info.width] - data[index - info.width]);
          if (gx >= 45) strongVertical += 1;
          verticalEnergy += gx;
          horizontalEnergy += gy;
          if (value < 120) darkPixels += 1;
          sum += value;
          sumSquares += value * value;
          samples += 1;
        }
      }

      if (!samples) continue;
      const verticalDensity = strongVertical / samples;
      const directionRatio = (verticalEnergy + samples) / (horizontalEnergy + samples);
      const darkRatio = darkPixels / samples;
      const mean = sum / samples;
      const variance = Math.max(0, sumSquares / samples - mean * mean);
      const index = tileY * columns + tileX;
      const score = verticalDensity * Math.min(directionRatio, 8) * (1 - Math.abs(darkRatio - 0.35));
      tileScore[index] = score;

      if (
        verticalDensity >= 0.1
        && directionRatio >= 1.7
        && darkRatio >= 0.04
        && darkRatio <= 0.78
        && variance >= 280
      ) {
        candidate[index] = 1;
      }
    }
  }

  const visited = new Uint8Array(candidate.length);
  const components = [];
  const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const startIndex = tileY * columns + tileX;
      if (!candidate[startIndex] || visited[startIndex]) continue;
      const queue = [[tileX, tileY]];
      const points = [];
      visited[startIndex] = 1;

      while (queue.length) {
        const [currentX, currentY] = queue.pop();
        points.push([currentX, currentY]);
        for (const [offsetX, offsetY] of neighbors) {
          const nextX = currentX + offsetX;
          const nextY = currentY + offsetY;
          if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) continue;
          const nextIndex = nextY * columns + nextX;
          if (!candidate[nextIndex] || visited[nextIndex]) continue;
          visited[nextIndex] = 1;
          queue.push([nextX, nextY]);
        }
      }
      components.push(points);
    }
  }

  let best = null;
  for (const points of components) {
    if (points.length < 6) continue;
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minTileX = Math.min(...xs);
    const maxTileX = Math.max(...xs);
    const minTileY = Math.min(...ys);
    const maxTileY = Math.max(...ys);
    const boxWidth = Math.min(info.width, (maxTileX + 1) * tileWidth) - minTileX * tileWidth;
    const boxHeight = Math.min(info.height, (maxTileY + 1) * tileHeight) - minTileY * tileHeight;
    const aspectRatio = boxWidth / Math.max(1, boxHeight);
    const areaRatio = (boxWidth * boxHeight) / (info.width * info.height);
    const widthRatio = boxWidth / info.width;
    const heightRatio = boxHeight / info.height;
    const fillRatio = points.length / ((maxTileX - minTileX + 1) * (maxTileY - minTileY + 1));

    if (
      aspectRatio < 1.15
      || aspectRatio > 8
      || areaRatio < 0.002
      || areaRatio > 0.25
      || widthRatio < 0.07
      || heightRatio < 0.025
      || fillRatio < 0.18
    ) continue;

    let scoreTotal = 0;
    for (const [x, y] of points) scoreTotal += tileScore[y * columns + x];
    const averageScore = scoreTotal / points.length;
    const score = points.length * fillRatio * Math.min(aspectRatio, 4) * averageScore;
    if (!best || score > best.score) {
      best = { minTileX, maxTileX, minTileY, maxTileY, boxWidth, boxHeight, score, fillRatio, points: points.length };
    }
  }

  if (!best) return null;
  const leftPx = best.minTileX * tileWidth;
  const topPx = best.minTileY * tileHeight;
  const rightPx = Math.min(info.width, (best.maxTileX + 1) * tileWidth);
  const bottomPx = Math.min(info.height, (best.maxTileY + 1) * tileHeight);
  const padX = Math.max(5, (rightPx - leftPx) * 0.08);
  const padY = Math.max(8, (bottomPx - topPx) * 0.24);
  const region = {
    left: clamp((leftPx - padX) / info.width, 0, 1),
    top: clamp((topPx - padY) / info.height, 0, 1),
    right: clamp((rightPx + padX) / info.width, 0, 1),
    bottom: clamp((bottomPx + padY) / info.height, 0, 1)
  };
  const confidence = Number(clamp(0.48 + best.points / 140 + best.fillRatio * 0.18, 0.5, 0.94).toFixed(2));

  return {
    detected: true,
    decoded: false,
    visualOnly: true,
    value: null,
    valueHash: null,
    valuePreview: 'Barcode chưa xác thực',
    format: null,
    formatName: 'BARCODE_LIKE',
    region,
    confidence,
    warning: 'Phát hiện vùng giống barcode nhưng không giải mã được. Có thể checksum sai hoặc artwork chưa phải mã hợp lệ.',
    analysisWidth: info.width,
    analysisHeight: info.height
  };
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
      decoded: true,
      visualOnly: false,
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
    const visual = await detectVisualBarcodeRegion(filePath);
    if (visual) {
      return {
        ...visual,
        decodeErrorName: error?.name || 'NotFoundException',
        decodeError: error?.message || 'Không giải mã được barcode.'
      };
    }
    return {
      detected: false,
      decoded: false,
      visualOnly: false,
      errorName: error?.name || 'NotFoundException',
      error: error?.message || 'Không tìm thấy QR/barcode có thể đọc.'
    };
  }
}

function publicDetection(detection) {
  if (!detection?.detected) return { detected: false, decoded: false, visualOnly: false };
  return {
    detected: true,
    decoded: detection.decoded !== false,
    visualOnly: Boolean(detection.visualOnly),
    format: detection.formatName,
    valueHash: detection.valueHash,
    valuePreview: detection.valuePreview,
    region: detection.region,
    confidence: detection.confidence || null,
    warning: detection.warning || null
  };
}

async function validateBarcode(sourceDetection, outputPath) {
  if (!sourceDetection?.detected) {
    return { status: 'not-detected', source: { detected: false }, output: { detected: false } };
  }

  const outputDetection = await decodeBarcode(outputPath);
  if (sourceDetection.visualOnly) {
    return {
      status: outputDetection.detected ? 'visual-pass' : 'visual-unreadable',
      source: publicDetection(sourceDetection),
      output: publicDetection(outputDetection)
    };
  }

  const matches = outputDetection.detected
    && !outputDetection.visualOnly
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
    await fs.rm(outputPath, { force: true });
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
  if (
    !source.detected
    || firstValidation.status === 'pass'
    || firstValidation.status === 'visual-pass'
    || !source.region
  ) {
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
  detectVisualBarcodeRegion,
  guardBarcode,
  publicDetection,
  regionToPixels,
  restoreBarcodeRegion,
  validateBarcode
};
