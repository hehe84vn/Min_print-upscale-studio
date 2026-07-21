const sharp = require('sharp');
const {
  createBarcodeMask,
  decodeBarcode,
  guardBarcode,
  publicDetection
} = require('./barcodeGuardService');

const MASK_REFINEMENT_VERSION = '3.1';

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
  return Math.round(58 - normalizeSensitivity(sensitivity) * 0.35);
}

function analysisDimensions(width, height, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(48, Math.round(width * scale)),
    height: Math.max(48, Math.round(height * scale))
  };
}

async function maskCoverage(mask) {
  const stats = await sharp(mask).stats();
  return Number((((stats.channels[0]?.mean || 0) / 255) * 100).toFixed(1));
}

async function readGray(inputPath, width, height, maxDimension) {
  const analysis = analysisDimensions(width, height, maxDimension);
  return sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(analysis.width, analysis.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function sobelMagnitude(data, width, height) {
  const output = Buffer.alloc(width * height, 0);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const topLeft = data[index - width - 1];
      const top = data[index - width];
      const topRight = data[index - width + 1];
      const left = data[index - 1];
      const right = data[index + 1];
      const bottomLeft = data[index + width - 1];
      const bottom = data[index + width];
      const bottomRight = data[index + width + 1];
      const gx = -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
      const gy = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      output[index] = Math.min(255, Math.round((Math.abs(gx) + Math.abs(gy)) / 4));
    }
  }

  return output;
}

function extremaFilter(source, width, height, radius, mode) {
  if (radius <= 0) return Buffer.from(source);
  const horizontal = Buffer.alloc(source.length, mode === 'max' ? 0 : 255);
  const output = Buffer.alloc(source.length, mode === 'max' ? 0 : 255);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let value = mode === 'max' ? 0 : 255;
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      for (let sampleX = start; sampleX <= end; sampleX += 1) {
        const candidate = source[row + sampleX];
        value = mode === 'max' ? Math.max(value, candidate) : Math.min(value, candidate);
      }
      horizontal[row + x] = value;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = mode === 'max' ? 0 : 255;
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      for (let sampleY = start; sampleY <= end; sampleY += 1) {
        const candidate = horizontal[sampleY * width + x];
        value = mode === 'max' ? Math.max(value, candidate) : Math.min(value, candidate);
      }
      output[y * width + x] = value;
    }
  }

  return output;
}

function dilateBinary(source, width, height, radius = 1) {
  return extremaFilter(source, width, height, radius, 'max');
}

function erodeBinary(source, width, height, radius = 1) {
  return extremaFilter(source, width, height, radius, 'min');
}

function closeBinary(source, width, height, radius = 1) {
  return erodeBinary(dilateBinary(source, width, height, radius), width, height, radius);
}

function suppressSinglePixels(source, width, height) {
  const output = Buffer.from(source);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!source[index]) continue;
      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          if (source[index + offsetY * width + offsetX]) neighbors += 1;
        }
      }
      if (neighbors === 0) output[index] = 0;
    }
  }
  return output;
}

async function renderSoftMask({ binary, analysisWidth, analysisHeight, width, height, featherSigma }) {
  return sharp(binary, { raw: { width: analysisWidth, height: analysisHeight, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .blur(Math.max(0.3, featherSigma))
    .linear(1.08)
    .png({ compressionLevel: 7 })
    .toBuffer();
}

async function createStructuralMask({ inputPath, width, height, sensitivity }) {
  const safeSensitivity = normalizeSensitivity(sensitivity);
  const threshold = thresholdForSensitivity(safeSensitivity);
  const { data, info } = await readGray(inputPath, width, height, 1800);
  const gradient = sobelMagnitude(data, info.width, info.height);
  const binary = Buffer.alloc(gradient.length, 0);

  for (let index = 0; index < gradient.length; index += 1) {
    if (gradient[index] >= threshold) binary[index] = 255;
  }

  const closed = closeBinary(binary, info.width, info.height, 1);
  const expanded = dilateBinary(closed, info.width, info.height, 1);
  const cleaned = suppressSinglePixels(expanded, info.width, info.height);
  const featherSigma = Math.max(0.65, Math.min(1.8, Math.max(width, height) / 3600));
  const buffer = await renderSoftMask({
    binary: cleaned,
    analysisWidth: info.width,
    analysisHeight: info.height,
    width,
    height,
    featherSigma
  });

  return {
    buffer,
    threshold,
    coveragePercent: await maskCoverage(buffer),
    analysisWidth: info.width,
    analysisHeight: info.height,
    closeRadius: 1,
    dilationRadius: 1,
    featherSigma,
    refinementVersion: MASK_REFINEMENT_VERSION
  };
}

async function createSemanticTextLogoMask({ inputPath, width, height, sensitivity = 65, outputPath = null }) {
  const safeSensitivity = normalizeSensitivity(sensitivity);
  const { data, info } = await readGray(inputPath, width, height, 1600);
  const gradient = sobelMagnitude(data, info.width, info.height);
  const strideX = 4;
  const strideY = 3;
  const windowWidth = 12;
  const windowHeight = 8;
  const columns = Math.ceil(info.width / strideX);
  const rows = Math.ceil(info.height / strideY);
  const confidenceGrid = Buffer.alloc(columns * rows, 0);
  const edgeThreshold = Math.round(68 - safeSensitivity * 0.45);

  for (let gridY = 0; gridY < rows; gridY += 1) {
    for (let gridX = 0; gridX < columns; gridX += 1) {
      const centerX = Math.min(info.width - 2, gridX * strideX + Math.floor(strideX / 2));
      const centerY = Math.min(info.height - 2, gridY * strideY + Math.floor(strideY / 2));
      const startX = Math.max(1, centerX - Math.floor(windowWidth / 2));
      const startY = Math.max(1, centerY - Math.floor(windowHeight / 2));
      const endX = Math.min(info.width - 1, centerX + Math.ceil(windowWidth / 2));
      const endY = Math.min(info.height - 1, centerY + Math.ceil(windowHeight / 2));
      let samples = 0;
      let edgeCount = 0;
      let verticalEnergy = 0;
      let horizontalEnergy = 0;
      let sum = 0;
      let sumSquares = 0;

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
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
      const textLike = density >= 0.1
        && density <= 0.7
        && variance >= 90
        && variance <= 6000
        && directionBalance >= 0.14
        && directionBalance <= 7;
      const flatGraphicLike = density >= 0.05
        && density <= 0.42
        && variance >= 45
        && variance <= 2600;

      if (textLike) confidenceGrid[gridY * columns + gridX] = 255;
      else if (flatGraphicLike) confidenceGrid[gridY * columns + gridX] = 150;
    }
  }

  const confidence = await sharp(confidenceGrid, { raw: { width: columns, height: rows, channels: 1 } })
    .resize(info.width, info.height, { fit: 'fill', kernel: sharp.kernel.cubic })
    .blur(0.7)
    .raw()
    .toBuffer();
  const binary = Buffer.alloc(gradient.length, 0);

  for (let index = 0; index < gradient.length; index += 1) {
    if (gradient[index] >= edgeThreshold && confidence[index] >= 72) binary[index] = 255;
  }

  const closeRadius = Math.max(1, Math.min(2, Math.round(Math.max(info.width, info.height) / 900)));
  const closed = closeBinary(binary, info.width, info.height, closeRadius);
  const expanded = dilateBinary(closed, info.width, info.height, 1);
  const cleaned = suppressSinglePixels(expanded, info.width, info.height);
  const featherSigma = Math.max(0.75, Math.min(2.2, Math.max(width, height) / 3200));
  const buffer = await renderSoftMask({
    binary: cleaned,
    analysisWidth: info.width,
    analysisHeight: info.height,
    width,
    height,
    featherSigma
  });
  if (outputPath) await sharp(buffer).png({ compressionLevel: 7 }).toFile(outputPath);

  return {
    buffer,
    coveragePercent: await maskCoverage(buffer),
    analysisWidth: info.width,
    analysisHeight: info.height,
    edgeThreshold,
    strideX,
    strideY,
    windowWidth,
    windowHeight,
    closeRadius,
    dilationRadius: 1,
    featherSigma,
    refinementVersion: MASK_REFINEMENT_VERSION
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
    refinementVersion: MASK_REFINEMENT_VERSION,
    structural: {
      analysisWidth: structural.analysisWidth,
      analysisHeight: structural.analysisHeight,
      closeRadius: structural.closeRadius,
      dilationRadius: structural.dilationRadius,
      featherSigma: structural.featherSigma
    },
    semantic: semantic ? {
      enabled: true,
      coveragePercent: semantic.coveragePercent,
      maskPath: semanticOutputPath,
      analysisWidth: semantic.analysisWidth,
      analysisHeight: semantic.analysisHeight,
      edgeThreshold: semantic.edgeThreshold,
      closeRadius: semantic.closeRadius,
      dilationRadius: semantic.dilationRadius,
      featherSigma: semantic.featherSigma,
      refinementVersion: semantic.refinementVersion
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
      refinementVersion: mask.refinementVersion,
      structural: mask.structural,
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
  MASK_REFINEMENT_VERSION,
  createProtectionMask,
  createSemanticTextLogoMask,
  flatBlend,
  normalizeSensitivity,
  normalizeStrength,
  protectedBlend,
  thresholdForSensitivity
};
