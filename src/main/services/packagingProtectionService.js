const sharp = require('sharp');
const {
  createBarcodeMask,
  decodeBarcode,
  guardBarcode,
  publicDetection
} = require('./barcodeGuardService');

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeSensitivity(value) {
  return clamp(value, 20, 95, 65);
}

function normalizeStrength(value) {
  return clamp(value, 0.05, 0.45, 0.2);
}

function thresholdForSensitivity(sensitivity) {
  return Math.round(172 - normalizeSensitivity(sensitivity) * 1.25);
}

async function maskCoverage(mask) {
  const stats = await sharp(mask).stats();
  return Number((((stats.channels[0]?.mean || 0) / 255) * 100).toFixed(1));
}

async function createStructuralMask({ inputPath, width, height, sensitivity }) {
  const threshold = thresholdForSensitivity(sensitivity);
  const sourceGray = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalise({ lower: 1, upper: 99 })
    .png()
    .toBuffer();
  const blurred = await sharp(sourceGray)
    .blur(1.25)
    .png()
    .toBuffer();
  const hardEdges = await sharp(sourceGray)
    .composite([{ input: blurred, blend: 'difference' }])
    .normalise({ lower: 2, upper: 99.5 })
    .threshold(threshold)
    .png()
    .toBuffer();
  const buffer = await sharp(hardEdges)
    .blur(1.35)
    .linear(1.45)
    .png({ compressionLevel: 7 })
    .toBuffer();

  return { buffer, threshold, coveragePercent: await maskCoverage(buffer) };
}

async function createSemanticTextLogoMask({ inputPath, width, height, sensitivity = 65, outputPath = null }) {
  const safeSensitivity = normalizeSensitivity(sensitivity);
  const analysisScale = Math.min(1, 1100 / Math.max(width, height));
  const analysisWidth = Math.max(48, Math.round(width * analysisScale));
  const analysisHeight = Math.max(48, Math.round(height * analysisScale));
  const { data, info } = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(analysisWidth, analysisHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tileWidth = 12;
  const tileHeight = 8;
  const columns = Math.ceil(info.width / tileWidth);
  const rows = Math.ceil(info.height / tileHeight);
  const tiles = Buffer.alloc(columns * rows, 0);
  const edgeThreshold = Math.round(68 - safeSensitivity * 0.45);

  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < columns; tileX += 1) {
      const startX = tileX * tileWidth;
      const startY = tileY * tileHeight;
      const endX = Math.min(info.width - 1, startX + tileWidth);
      const endY = Math.min(info.height - 1, startY + tileHeight);
      let samples = 0;
      let edgeCount = 0;
      let verticalEnergy = 0;
      let horizontalEnergy = 0;
      let sum = 0;
      let sumSquares = 0;

      for (let y = Math.max(1, startY); y < endY; y += 1) {
        for (let x = Math.max(1, startX); x < endX; x += 1) {
          const index = y * info.width + x;
          const value = data[index];
          const gx = Math.abs(data[index + 1] - data[index - 1]);
          const gy = Math.abs(data[index + info.width] - data[index - info.width]);
          if (gx + gy >= edgeThreshold) edgeCount += 1;
          verticalEnergy += gx;
          horizontalEnergy += gy;
          sum += value;
          sumSquares += value * value;
          samples += 1;
        }
      }

      if (!samples) continue;
      const density = edgeCount / samples;
      const mean = sum / samples;
      const variance = Math.max(0, sumSquares / samples - mean * mean);
      const directionBalance = (verticalEnergy + 1) / (horizontalEnergy + 1);
      const textLike = density >= 0.11
        && density <= 0.68
        && variance >= 110
        && variance <= 5200
        && directionBalance >= 0.16
        && directionBalance <= 6.2;
      const flatGraphicLike = density >= 0.06
        && density <= 0.38
        && variance >= 55
        && variance <= 2200;

      if (textLike) tiles[tileY * columns + tileX] = 255;
      else if (flatGraphicLike) tiles[tileY * columns + tileX] = 175;
    }
  }

  const buffer = await sharp(tiles, { raw: { width: columns, height: rows, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.nearest })
    .blur(Math.max(1.1, Math.min(3.5, Math.max(width, height) / 1100)))
    .linear(1.2)
    .png({ compressionLevel: 7 })
    .toBuffer();
  if (outputPath) await sharp(buffer).png({ compressionLevel: 7 }).toFile(outputPath);

  return {
    buffer,
    coveragePercent: await maskCoverage(buffer),
    analysisWidth: info.width,
    analysisHeight: info.height,
    edgeThreshold
  };
}

async function createProtectionMask({
  inputPath,
  width,
  height,
  sensitivity = 65,
  semanticEnabled = true,
  codeGuardEnabled = true,
  outputPath = null,
  semanticOutputPath = null,
  barcodeMaskOutputPath = null
}) {
  if (!inputPath) throw new Error('Thiếu ảnh nguồn để tạo protection mask.');
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Kích thước protection mask không hợp lệ.');
  }

  const safeSensitivity = normalizeSensitivity(sensitivity);
  const structural = await createStructuralMask({ inputPath, width, height, sensitivity: safeSensitivity });
  const semantic = semanticEnabled
    ? await createSemanticTextLogoMask({
      inputPath,
      width,
      height,
      sensitivity: safeSensitivity,
      outputPath: semanticOutputPath
    })
    : null;
  const barcodeDetection = codeGuardEnabled ? await decodeBarcode(inputPath) : { detected: false };
  const barcodeMask = codeGuardEnabled
    ? await createBarcodeMask({
      detection: barcodeDetection,
      width,
      height,
      outputPath: barcodeMaskOutputPath
    })
    : null;
  const overlays = [];
  if (semantic?.buffer) overlays.push({ input: semantic.buffer, blend: 'lighten' });
  if (barcodeMask?.buffer) overlays.push({ input: barcodeMask.buffer, blend: 'lighten' });
  const buffer = overlays.length
    ? await sharp(structural.buffer).composite(overlays).png({ compressionLevel: 7 }).toBuffer()
    : structural.buffer;
  const coveragePercent = await maskCoverage(buffer);

  if (outputPath) await sharp(buffer).png({ compressionLevel: 7 }).toFile(outputPath);

  return {
    buffer,
    coveragePercent,
    sensitivity: safeSensitivity,
    threshold: structural.threshold,
    structuralCoveragePercent: structural.coveragePercent,
    semantic: semantic ? {
      enabled: true,
      coveragePercent: semantic.coveragePercent,
      maskPath: semanticOutputPath,
      analysisWidth: semantic.analysisWidth,
      analysisHeight: semantic.analysisHeight
    } : { enabled: false, coveragePercent: 0, maskPath: null },
    barcodeDetection,
    barcodeMaskPath: barcodeMask?.outputPath || null
  };
}

async function flatBlend({ basePath, detailPath, outputPath, strength, dpi }) {
  const safeStrength = normalizeStrength(strength);
  const detailAlpha = await sharp(detailPath, { failOn: 'none' })
    .ensureAlpha()
    .extractChannel('alpha')
    .linear(safeStrength)
    .png()
    .toBuffer();
  const detailOverlay = await sharp(detailPath, { failOn: 'none' })
    .removeAlpha()
    .joinChannel(detailAlpha)
    .png()
    .toBuffer();

  await sharp(basePath, { failOn: 'none' })
    .composite([{ input: detailOverlay, blend: 'over' }])
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 7 })
    .toFile(outputPath);

  return { strength: safeStrength, protection: null, barcodeGuard: null };
}

async function protectedBlend({
  sourcePath,
  basePath,
  detailPath,
  outputPath,
  strength,
  sensitivity = 65,
  semanticEnabled = true,
  codeGuardEnabled = true,
  dpi = 300,
  maskOutputPath = null,
  semanticMaskOutputPath = null,
  barcodeMaskOutputPath = null
}) {
  const safeStrength = normalizeStrength(strength);
  const metadata = await sharp(basePath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh nền Fidelity.');

  const mask = await createProtectionMask({
    inputPath: sourcePath,
    width: metadata.width,
    height: metadata.height,
    sensitivity,
    semanticEnabled,
    codeGuardEnabled,
    outputPath: maskOutputPath,
    semanticOutputPath: semanticMaskOutputPath,
    barcodeMaskOutputPath
  });
  const allowedDetailAlpha = await sharp(mask.buffer)
    .negate({ alpha: false })
    .linear(safeStrength)
    .png()
    .toBuffer();
  const detailOverlay = await sharp(detailPath, { failOn: 'none' })
    .removeAlpha()
    .joinChannel(allowedDetailAlpha)
    .png()
    .toBuffer();

  await sharp(basePath, { failOn: 'none' })
    .composite([{ input: detailOverlay, blend: 'over' }])
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 7 })
    .toFile(outputPath);

  const barcodeGuard = await guardBarcode({
    sourcePath,
    outputPath,
    sourceDetection: mask.barcodeDetection,
    enabled: codeGuardEnabled,
    dpi
  });

  return {
    strength: safeStrength,
    barcodeGuard,
    protection: {
      enabled: true,
      sensitivity: mask.sensitivity,
      threshold: mask.threshold,
      coveragePercent: mask.coveragePercent,
      structuralCoveragePercent: mask.structuralCoveragePercent,
      maskPath: maskOutputPath,
      semantic: mask.semantic,
      barcode: {
        enabled: Boolean(codeGuardEnabled),
        detection: publicDetection(mask.barcodeDetection),
        maskPath: mask.barcodeMaskPath,
        guard: barcodeGuard
      }
    }
  };
}

module.exports = {
  createProtectionMask,
  createSemanticTextLogoMask,
  flatBlend,
  normalizeSensitivity,
  normalizeStrength,
  protectedBlend,
  thresholdForSensitivity
};
