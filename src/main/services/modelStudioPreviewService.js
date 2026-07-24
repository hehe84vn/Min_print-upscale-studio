'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { runNcnnUpscale } = require('./engineService');

const MODEL_LABELS = {
  'high-fidelity-4x': 'High Fidelity',
  'remacri-4x': 'Packaging / Remacri',
  'realesrgan-x4plus': 'RealESRGAN Detail'
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function safeName(value) { return String(value || 'preview').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60); }

function normalizeCrop(crop, width, height) {
  const safeWidth = Math.round(Number(width) || 0);
  const safeHeight = Math.round(Number(height) || 0);
  if (safeWidth < 64 || safeHeight < 64) throw new Error('Ảnh phải tối thiểu 64 × 64 px để crop.');

  const requestedWidth = Math.round(Number(crop?.width) || 0);
  const requestedHeight = Math.round(Number(crop?.height) || 0);
  if (requestedWidth < 64 || requestedHeight < 64) throw new Error('Vùng crop phải tối thiểu 64 × 64 px.');

  const x = clamp(Math.round(Number(crop?.x) || 0), 0, safeWidth - 64);
  const y = clamp(Math.round(Number(crop?.y) || 0), 0, safeHeight - 64);
  const w = clamp(requestedWidth, 64, safeWidth - x);
  const h = clamp(requestedHeight, 64, safeHeight - y);
  return { x, y, width: w, height: h };
}

async function tileScore(inputPath, rect) {
  const { data, info } = await sharp(inputPath, { failOn: 'none' })
    .extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
    .resize(192, 192, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let edge = 0;
  let color = 0;
  let variance = 0;
  let mean = 0;
  const pixels = info.width * info.height;
  const gray = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const r = data[i * 3]; const g = data[i * 3 + 1]; const b = data[i * 3 + 2];
    const value = r * 0.299 + g * 0.587 + b * 0.114;
    gray[i] = value; mean += value;
    color += Math.max(r, g, b) - Math.min(r, g, b);
  }
  mean /= pixels;
  for (let y = 1; y < info.height; y += 1) for (let x = 1; x < info.width; x += 1) {
    const i = y * info.width + x;
    edge += Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - info.width]);
    const d = gray[i] - mean; variance += d * d;
  }
  return { ...rect, edge: edge / pixels, color: color / pixels, variance: variance / pixels };
}

async function selectAutoCrops(inputPath, count = 3) {
  const meta = await sharp(inputPath, { failOn: 'none' }).metadata();
  const width = meta.width || 0; const height = meta.height || 0;
  if (width < 128 || height < 128) throw new Error('Ảnh quá nhỏ để chạy Preview Crop.');
  const cropW = Math.min(width, Math.max(256, Math.round(width * 0.34)));
  const cropH = Math.min(height, Math.max(256, Math.round(height * 0.34)));
  const candidates = [];
  for (let gy = 0; gy < 3; gy += 1) for (let gx = 0; gx < 3; gx += 1) {
    const x = Math.round((width - cropW) * gx / 2);
    const y = Math.round((height - cropH) * gy / 2);
    candidates.push(await tileScore(inputPath, { x, y, width: cropW, height: cropH }));
  }
  candidates.forEach((item) => { item.score = item.edge * 2.1 + Math.sqrt(item.variance) * 0.75 + item.color * 0.22; });
  candidates.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const item of candidates) {
    const farEnough = chosen.every((other) => Math.hypot(item.x - other.x, item.y - other.y) > Math.min(cropW, cropH) * 0.55);
    if (farEnough) chosen.push(item);
    if (chosen.length >= count) break;
  }
  return chosen.map(({ x, y, width: w, height: h }, index) => ({ id: `auto-${index + 1}`, label: `Vùng tự động ${index + 1}`, x, y, width: w, height: h }));
}

async function imageMetrics(filePath) {
  const { data, info } = await sharp(filePath, { failOn: 'none' }).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const gray = new Float32Array(pixels);
  let meanR = 0; let meanG = 0; let meanB = 0;
  for (let i = 0; i < pixels; i += 1) {
    const r = data[i * 3]; const g = data[i * 3 + 1]; const b = data[i * 3 + 2];
    gray[i] = r * 0.299 + g * 0.587 + b * 0.114;
    meanR += r; meanG += g; meanB += b;
  }
  let edge = 0; let lap = 0; let clipping = 0;
  for (let y = 1; y < info.height - 1; y += 1) for (let x = 1; x < info.width - 1; x += 1) {
    const i = y * info.width + x;
    edge += Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - info.width]);
    lap += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - info.width] - gray[i + info.width]);
    if (gray[i] < 2 || gray[i] > 253) clipping += 1;
  }
  return { edge: edge / pixels, laplacian: lap / pixels, clipping: clipping / pixels, color: [meanR / pixels, meanG / pixels, meanB / pixels] };
}

function qualityScore(source, output) {
  const sharpnessGain = clamp((output.laplacian / Math.max(0.1, source.laplacian) - 1) * 28, -18, 24);
  const edgeDrift = Math.abs(output.edge / Math.max(0.1, source.edge) - 1);
  const colorShift = Math.sqrt(output.color.reduce((sum, value, i) => sum + (value - source.color[i]) ** 2, 0)) / 4.42;
  const haloPenalty = clamp(Math.max(0, output.laplacian / Math.max(0.1, source.laplacian) - 2.2) * 18, 0, 25);
  const score = clamp(Math.round(78 + sharpnessGain - edgeDrift * 22 - colorShift * 0.55 - output.clipping * 28 - haloPenalty), 0, 100);
  return { score, sharpnessGain: Number(sharpnessGain.toFixed(1)), edgeDrift: Number(edgeDrift.toFixed(3)), colorShift: Number(colorShift.toFixed(2)), haloRisk: Number(haloPenalty.toFixed(1)), clipping: Number(output.clipping.toFixed(4)) };
}

async function runPreview({ settingsService, inputPath, crops = null, models = [], scale = 2, onProgress }) {
  if (!inputPath) throw new Error('Chưa chọn ảnh nguồn.');
  const meta = await sharp(inputPath, { failOn: 'none' }).metadata();
  const selectedCrops = Array.isArray(crops) && crops.length
    ? crops.map((crop, index) => ({ id: crop.id || `manual-${index + 1}`, label: crop.label || `Vùng thủ công ${index + 1}`, ...normalizeCrop(crop, meta.width, meta.height) }))
    : await selectAutoCrops(inputPath, 3);
  const selectedModels = [...new Set(models)].filter((model) => MODEL_LABELS[model]).slice(0, 3);
  if (!selectedModels.length) selectedModels.push('high-fidelity-4x', 'remacri-4x', 'realesrgan-x4plus');
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'print-upscale-preview-v15-'));
  const results = [];
  let step = 0; const total = selectedCrops.length * selectedModels.length;
  for (const crop of selectedCrops) {
    const cropPath = path.join(outputDirectory, `${safeName(crop.id)}-source.png`);
    await sharp(inputPath, { failOn: 'none' }).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).png().toFile(cropPath);
    const sourceMetrics = await imageMetrics(cropPath);
    for (const model of selectedModels) {
      step += 1;
      onProgress?.(Math.round(step / total * 92), `Preview ${crop.label}: ${MODEL_LABELS[model]}`);
      const outputPath = path.join(outputDirectory, `${safeName(crop.id)}-${safeName(model)}-${scale}x.png`);
      const started = Date.now();
      try {
        await runNcnnUpscale({ settingsService, inputPath: cropPath, outputPath, model, scale, onProgress: () => {} });
        const metrics = qualityScore(sourceMetrics, await imageMetrics(outputPath));
        results.push({ cropId: crop.id, cropLabel: crop.label, model, modelLabel: MODEL_LABELS[model], sourcePath: cropPath, outputPath, durationMs: Date.now() - started, metrics, error: null });
      } catch (error) {
        results.push({ cropId: crop.id, cropLabel: crop.label, model, modelLabel: MODEL_LABELS[model], sourcePath: cropPath, outputPath: null, durationMs: Date.now() - started, metrics: null, error: error.message || String(error) });
      }
    }
  }
  const ranking = selectedModels.map((model) => {
    const valid = results.filter((item) => item.model === model && item.metrics);
    const score = valid.length ? Math.round(valid.reduce((sum, item) => sum + item.metrics.score, 0) / valid.length) : 0;
    const risk = valid.some((item) => item.metrics.haloRisk > 12 || item.metrics.edgeDrift > 0.8);
    return { model, label: MODEL_LABELS[model], score, risk, samples: valid.length };
  }).sort((a, b) => b.score - a.score);
  const best = ranking[0];
  const hybridRecommended = ranking.length > 1 && Math.abs(ranking[0].score - ranking[1].score) <= 4 && ranking[0].score >= 66;
  onProgress?.(100, 'Preview Crop và chấm điểm hoàn tất');
  return { outputDirectory, crops: selectedCrops, results, ranking, bestModel: best?.model || null, bestScore: best?.score || 0, hybridRecommended, fullImagePreset: hybridRecommended ? 'packaging-hybrid' : ({ 'high-fidelity-4x': 'current-photo', 'remacri-4x': 'current-packaging', 'realesrgan-x4plus': 'official-detail' }[best?.model] || 'current-photo') };
}

module.exports = { normalizeCrop, selectAutoCrops, qualityScore, runPreview };
