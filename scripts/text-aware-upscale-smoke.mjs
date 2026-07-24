import assert from 'node:assert/strict';
import sharp from 'sharp';
import textAwareModule from '../src/main/services/textAwareUpscaleService.js';

const { buildTextMask, enhanceTextAware } = textAwareModule;
const width = 160;
const height = 80;
const channels = 4;
const raw = Buffer.alloc(width * height * channels, 245);

for (let index = 0; index < width * height; index += 1) raw[index * channels + 3] = 255;

function fillRect(left, top, rectangleWidth, rectangleHeight, value) {
  for (let y = top; y < top + rectangleHeight; y += 1) {
    for (let x = left; x < left + rectangleWidth; x += 1) {
      const offset = (y * width + x) * channels;
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
    }
  }
}

// Synthetic typography: repeated vertical stems, crossbars and a small diacritic.
fillRect(20, 22, 8, 38, 42);
fillRect(28, 22, 22, 7, 42);
fillRect(28, 38, 17, 7, 42);
fillRect(55, 22, 8, 38, 42);
fillRect(72, 22, 8, 38, 42);
fillRect(80, 22, 22, 7, 42);
fillRect(94, 22, 8, 38, 42);
fillRect(84, 12, 7, 5, 42);

const mask = buildTextMask(raw, { width, height, channels }, { edgeThreshold: 25, maskRadius: 1 });
assert.ok(mask.coverage > 0.01, 'Text-like synthetic artwork must produce a non-empty mask.');
assert.ok(mask.coverage < 0.35, 'Text mask must remain localized instead of sharpening the whole canvas.');

const source = await sharp(raw, { raw: { width, height, channels } }).blur(0.65).png().toBuffer();
const enhanced = await enhanceTextAware(source, { textStrength: 0.72, haloLimit: 9, edgeThreshold: 20 });
assert.equal(enhanced.stats.applied, true, 'Text-aware enhancement must modify eligible text edges.');
assert.ok(enhanced.stats.haloLimit <= 9, 'Configured halo bound must be preserved.');
assert.ok(enhanced.stats.textCoverage > 0, 'Enhancement must report text coverage.');

const before = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const after = await sharp(enhanced.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let maximumDelta = 0;
for (let index = 0; index < before.data.length; index += 4) {
  for (let channel = 0; channel < 3; channel += 1) {
    maximumDelta = Math.max(maximumDelta, Math.abs(after.data[index + channel] - before.data[index + channel]));
  }
}
assert.ok(maximumDelta <= 11, `Halo-safe enhancement exceeded bounded channel delta: ${maximumDelta}`);

console.log(`Text-aware Upscale V12 OK: ${enhanced.stats.textCoverage}% coverage, ${enhanced.stats.haloClamped} halo clamps, max delta ${maximumDelta}.`);
