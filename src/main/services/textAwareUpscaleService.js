'use strict';

const sharp = require('sharp');

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function luminance(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))];
}

function buildTextMask(data, info, options = {}) {
  const { width, height, channels } = info;
  const pixels = width * height;
  const gray = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * channels;
    gray[index] = luminance(data[offset], data[offset + 1] ?? data[offset], data[offset + 2] ?? data[offset]);
  }

  const gradients = new Float32Array(pixels);
  const samples = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = -gray[index - width - 1] + gray[index - width + 1]
        - 2 * gray[index - 1] + 2 * gray[index + 1]
        - gray[index + width - 1] + gray[index + width + 1];
      const gy = -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1]
        + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1];
      const magnitude = Math.hypot(gx, gy);
      gradients[index] = magnitude;
      if ((x + y) % 11 === 0) samples.push(magnitude);
    }
  }

  const automaticThreshold = clamp(percentile(samples, 0.72), 22, 150);
  const threshold = clamp(Number(options.edgeThreshold ?? automaticThreshold), 8, 220);
  const mask = new Uint8Array(pixels);
  let selected = 0;

  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const index = y * width + x;
      const edge = gradients[index];
      if (edge < threshold) continue;

      let horizontalSupport = 0;
      let verticalSupport = 0;
      let localEdges = 0;
      for (let step = -2; step <= 2; step += 1) {
        if (gradients[index + step] >= threshold * 0.62) horizontalSupport += 1;
        if (gradients[index + step * width] >= threshold * 0.62) verticalSupport += 1;
      }
      for (let yy = -2; yy <= 2; yy += 1) {
        for (let xx = -2; xx <= 2; xx += 1) {
          if (gradients[index + yy * width + xx] >= threshold * 0.55) localEdges += 1;
        }
      }

      const strokeLike = horizontalSupport >= 2 || verticalSupport >= 2;
      const clustered = localEdges >= 5;
      if (!strokeLike || !clustered) continue;
      mask[index] = 255;
      selected += 1;
    }
  }

  const dilated = new Uint8Array(mask);
  const radius = Math.max(1, Math.min(3, Math.round(Number(options.maskRadius ?? 1))));
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      for (let yy = -radius; yy <= radius; yy += 1) {
        for (let xx = -radius; xx <= radius; xx += 1) {
          const distance = Math.hypot(xx, yy);
          const weight = clamp(1 - distance / (radius + 1), 0, 1);
          const target = index + yy * width + xx;
          dilated[target] = Math.max(dilated[target], Math.round(255 * weight));
        }
      }
    }
  }

  return {
    mask: dilated,
    coverage: selected / Math.max(1, pixels),
    threshold
  };
}

function localRange(data, info, x, y, channel) {
  const { width, height, channels } = info;
  let minimum = 255;
  let maximum = 0;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
      const value = data[(yy * width + xx) * channels + channel];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
  }
  return { minimum, maximum };
}

async function enhanceTextAware(input, options = {}) {
  const strength = clamp(Number(options.textStrength ?? 0.58), 0, 1.25);
  const haloLimit = clamp(Number(options.haloLimit ?? 12), 3, 32);
  const maximumPixels = Math.max(1_000_000, Number(options.maximumPixels ?? 48_000_000));

  const baseImage = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate().ensureAlpha();
  const metadata = await baseImage.metadata();
  const pixelCount = Number(metadata.width || 0) * Number(metadata.height || 0);
  if (!metadata.width || !metadata.height || pixelCount > maximumPixels || strength <= 0.001) {
    return {
      buffer: await baseImage.png({ compressionLevel: 6 }).toBuffer(),
      stats: { applied: false, reason: pixelCount > maximumPixels ? 'pixel-limit' : 'disabled', pixelCount }
    };
  }

  const [{ data: base, info }, blurred] = await Promise.all([
    baseImage.clone().raw().toBuffer({ resolveWithObject: true }),
    baseImage.clone().blur(0.85).raw().toBuffer()
  ]);
  const detection = buildTextMask(base, info, options);
  const output = Buffer.from(base);
  const { width, height, channels } = info;
  let changed = 0;
  let haloClamped = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const maskWeight = detection.mask[pixel] / 255;
      if (maskWeight <= 0.01) continue;
      const offset = pixel * channels;
      for (let channel = 0; channel < Math.min(3, channels); channel += 1) {
        const original = base[offset + channel];
        const highPass = original - blurred[offset + channel];
        const proposedDelta = highPass * strength * maskWeight;
        const limitedDelta = clamp(proposedDelta, -haloLimit, haloLimit);
        const range = localRange(base, info, x, y, channel);
        const protectedMinimum = range.minimum - 2;
        const protectedMaximum = range.maximum + 2;
        const candidate = clamp(original + limitedDelta, protectedMinimum, protectedMaximum);
        const value = clamp(Math.round(candidate), 0, 255);
        if (Math.abs(proposedDelta - limitedDelta) > 0.5 || candidate !== original + limitedDelta) haloClamped += 1;
        if (value !== original) changed += 1;
        output[offset + channel] = value;
      }
    }
  }

  const buffer = await sharp(output, { raw: info })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return {
    buffer,
    stats: {
      applied: changed > 0,
      pixelCount,
      changedChannels: changed,
      haloClamped,
      textCoverage: Number((detection.coverage * 100).toFixed(2)),
      edgeThreshold: Number(detection.threshold.toFixed(2)),
      strength,
      haloLimit
    }
  };
}

module.exports = {
  buildTextMask,
  enhanceTextAware
};
