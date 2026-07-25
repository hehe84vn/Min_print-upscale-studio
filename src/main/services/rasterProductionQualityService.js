'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function luminance(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

async function resizeBeyondFourX(input, targetWidth, targetHeight, options = {}) {
  const base = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate();
  const resized = await base
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const blurred = await sharp(data, { raw: info }).blur(0.72).raw().toBuffer();
  const output = Buffer.from(data);
  const strength = clamp(Number(options.edgeStrength ?? 0.42), 0, 0.85);
  const deltaLimit = clamp(Number(options.edgeDeltaLimit ?? 7), 2, 16);

  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * info.channels;
    const y0 = luminance(data[offset], data[offset + 1], data[offset + 2]);
    const y1 = luminance(blurred[offset], blurred[offset + 1], blurred[offset + 2]);
    const delta = clamp((y0 - y1) * strength, -deltaLimit, deltaLimit);
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = clamp(Math.round(data[offset + channel] + delta), 0, 255);
    }
  }

  return sharp(output, { raw: info }).png({ compressionLevel: 4 }).toBuffer();
}

function stripeScore(gray, width, height, axis) {
  const values = [];
  const count = axis === 'vertical' ? width : height;
  const length = axis === 'vertical' ? height : width;
  for (let primary = 0; primary < count; primary += 1) {
    let total = 0;
    for (let secondary = 0; secondary < length; secondary += 1) {
      const x = axis === 'vertical' ? primary : secondary;
      const y = axis === 'vertical' ? secondary : primary;
      total += gray[y * width + x];
    }
    values.push(total / Math.max(1, length));
  }
  let maximumJump = 0;
  for (let index = 1; index < values.length; index += 1) {
    maximumJump = Math.max(maximumJump, Math.abs(values[index] - values[index - 1]));
  }
  return Number(maximumJump.toFixed(2));
}

async function validateRasterOutput({ inputPath, outputPath, expectedWidth, expectedHeight }) {
  const [inputMeta, outputMeta] = await Promise.all([
    sharp(inputPath, { failOn: 'none' }).metadata(),
    sharp(outputPath, { failOn: 'none' }).metadata()
  ]);
  if (!outputMeta.width || !outputMeta.height) throw new Error('Không đọc được ảnh upscale đầu ra.');

  const sample = await sharp(outputPath, { failOn: 'none' })
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(sample.info.width * sample.info.height);
  let black = 0;
  let white = 0;
  let edgeTotal = 0;
  for (let y = 0; y < sample.info.height; y += 1) {
    for (let x = 0; x < sample.info.width; x += 1) {
      const pixel = y * sample.info.width + x;
      const offset = pixel * sample.info.channels;
      const value = luminance(sample.data[offset], sample.data[offset + 1], sample.data[offset + 2]);
      gray[pixel] = value;
      if (value < 4) black += 1;
      if (value > 251) white += 1;
      if (x > 0) edgeTotal += Math.abs(value - gray[pixel - 1]);
      if (y > 0) edgeTotal += Math.abs(value - gray[pixel - sample.info.width]);
    }
  }

  const pixels = Math.max(1, gray.length);
  const dimensionPass = (!expectedWidth || outputMeta.width === expectedWidth)
    && (!expectedHeight || outputMeta.height === expectedHeight);
  const blackRatio = black / pixels;
  const whiteRatio = white / pixels;
  const verticalStripe = stripeScore(gray, sample.info.width, sample.info.height, 'vertical');
  const horizontalStripe = stripeScore(gray, sample.info.width, sample.info.height, 'horizontal');
  const edgeEnergy = edgeTotal / pixels;
  const checks = {
    dimensions: dimensionPass ? 'pass' : 'fail',
    blackFrame: blackRatio < 0.97 ? 'pass' : 'fail',
    stripeArtifact: Math.max(verticalStripe, horizontalStripe) < 95 ? 'pass' : 'review',
    edgeRetention: edgeEnergy > 0.6 ? 'pass' : 'review'
  };
  const status = Object.values(checks).includes('fail') ? 'fail'
    : Object.values(checks).includes('review') ? 'review' : 'pass';

  return {
    status,
    checks,
    input: { width: inputMeta.width || null, height: inputMeta.height || null },
    output: { width: outputMeta.width, height: outputMeta.height },
    metrics: {
      blackRatio: Number((blackRatio * 100).toFixed(3)),
      whiteRatio: Number((whiteRatio * 100).toFixed(3)),
      verticalStripe,
      horizontalStripe,
      edgeEnergy: Number(edgeEnergy.toFixed(3))
    }
  };
}

async function writeQualityReport(outputPath, report) {
  const reportPath = `${outputPath}.quality.json`;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

module.exports = {
  resizeBeyondFourX,
  stripeScore,
  validateRasterOutput,
  writeQualityReport
};
