const sharp = require('sharp');

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

async function createProtectionMask({ inputPath, width, height, sensitivity = 65, outputPath = null }) {
  if (!inputPath) throw new Error('Thiếu ảnh nguồn để tạo protection mask.');
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('Kích thước protection mask không hợp lệ.');
  }

  const safeSensitivity = normalizeSensitivity(sensitivity);
  const threshold = thresholdForSensitivity(safeSensitivity);
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
  const mask = await sharp(hardEdges)
    .blur(1.35)
    .linear(1.45)
    .png({ compressionLevel: 7 })
    .toBuffer();
  const stats = await sharp(mask).stats();
  const coveragePercent = Number((((stats.channels[0]?.mean || 0) / 255) * 100).toFixed(1));

  if (outputPath) await sharp(mask).png({ compressionLevel: 7 }).toFile(outputPath);

  return {
    buffer: mask,
    coveragePercent,
    sensitivity: safeSensitivity,
    threshold
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

  return { strength: safeStrength, protection: null };
}

async function protectedBlend({
  sourcePath,
  basePath,
  detailPath,
  outputPath,
  strength,
  sensitivity = 65,
  dpi = 300,
  maskOutputPath = null
}) {
  const safeStrength = normalizeStrength(strength);
  const metadata = await sharp(basePath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh nền Fidelity.');

  const mask = await createProtectionMask({
    inputPath: sourcePath,
    width: metadata.width,
    height: metadata.height,
    sensitivity,
    outputPath: maskOutputPath
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

  return {
    strength: safeStrength,
    protection: {
      enabled: true,
      sensitivity: mask.sensitivity,
      threshold: mask.threshold,
      coveragePercent: mask.coveragePercent,
      maskPath: maskOutputPath
    }
  };
}

module.exports = {
  createProtectionMask,
  flatBlend,
  normalizeSensitivity,
  normalizeStrength,
  protectedBlend,
  thresholdForSensitivity
};
