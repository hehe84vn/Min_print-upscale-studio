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
    .resize(224, 224, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const gray = new Float32Array(pixels);
  let mean = 0; let color = 0; let dark = 0; let light = 0;
  for (let i = 0; i < pixels; i += 1) {
    const r = data[i * 3]; const g = data[i * 3 + 1]; const b = data[i * 3 + 2];
    const value = r * 0.299 + g * 0.587 + b * 0.114;
    gray[i] = value; mean += value;
    color += Math.max(r, g, b) - Math.min(r, g, b);
    if (value < 55) dark += 1;
    if (value > 200) light += 1;
  }
  mean /= pixels;
  let edge = 0; let fineEdge = 0; let variance = 0;
  for (let y = 1; y < info.height; y += 1) for (let x = 1; x < info.width; x += 1) {
    const i = y * info.width + x;
    const local = Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - info.width]);
    edge += local;
    if (local > 42) fineEdge += 1;
    const d = gray[i] - mean; variance += d * d;
  }
  const contrastMix = Math.min(dark, light) / pixels;
  return {
    ...rect,
    edge: edge / pixels,
    fineEdge: fineEdge / pixels,
    color: color / pixels,
    variance: variance / pixels,
    contrastMix
  };
}

function regionReason(item) {
  if (item.fineEdge > 0.18 && item.contrastMix > 0.08) return 'Vùng có chữ nhỏ hoặc đường biên tương phản cao';
  if (item.color > 34 && item.edge > 18) return 'Vùng có logo, màu phẳng và đường biên rõ';
  if (Math.sqrt(item.variance) > 58) return 'Vùng có texture và chi tiết ảnh phức tạp';
  return 'Vùng có mật độ chi tiết cao nhất trong artwork';
}

async function selectSmartTestRegion(inputPath) {
  const meta = await sharp(inputPath, { failOn: 'none' }).metadata();
  const width = meta.width || 0; const height = meta.height || 0;
  if (width < 128 || height < 128) throw new Error('Ảnh quá nhỏ để chạy Smart Test Region.');
  const target = Math.min(768, Math.max(320, Math.round(Math.min(width, height) * 0.42)));
  const cropW = Math.min(width, target);
  const cropH = Math.min(height, target);
  const candidates = [];
  for (let gy = 0; gy < 5; gy += 1) for (let gx = 0; gx < 5; gx += 1) {
    const x = Math.round((width - cropW) * gx / 4);
    const y = Math.round((height - cropH) * gy / 4);
    candidates.push(await tileScore(inputPath, { x, y, width: cropW, height: cropH }));
  }
  candidates.forEach((item) => {
    item.score = item.edge * 2.4 + item.fineEdge * 115 + Math.sqrt(item.variance) * 0.72 + item.color * 0.16 + item.contrastMix * 80;
  });
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    id: 'smart-region-1',
    label: 'Vùng đại diện AI',
    reason: regionReason(best),
    x: best.x, y: best.y, width: best.width, height: best.height
  };
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
  const crop = Array.isArray(crops) && crops.length
    ? { id: crops[0].id || 'manual-1', label: crops[0].label || 'Vùng thủ công', reason: 'Vùng do người dùng chọn', ...normalizeCrop(crops[0], meta.width, meta.height) }
    : await selectSmartTestRegion(inputPath);
  const selectedModels = [...new Set(models)].filter((model) => MODEL_LABELS[model]).slice(0, 3);
  if (!selectedModels.length) selectedModels.push('high-fidelity-4x', 'remacri-4x', 'realesrgan-x4plus');
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'print-upscale-smart-region-v17-'));
  const cropPath = path.join(outputDirectory, `${safeName(crop.id)}-source.png`);
  await sharp(inputPath, { failOn: 'none' }).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height }).png().toFile(cropPath);
  const sourceMetrics = await imageMetrics(cropPath);
  const results = [];
  for (let index = 0; index < selectedModels.length; index += 1) {
    const model = selectedModels[index];
    onProgress?.(Math.round((index + 1) / selectedModels.length * 92), `Đang test ${MODEL_LABELS[model]}`);
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
  const ranking = results.map((item) => ({
    model: item.model,
    label: item.modelLabel,
    score: item.metrics?.score || 0,
    risk: Boolean(item.metrics && (item.metrics.haloRisk > 12 || item.metrics.edgeDrift > 0.8)),
    samples: item.metrics ? 1 : 0
  })).sort((a, b) => b.score - a.score);
  const best = ranking[0];
  const hybridRecommended = ranking.length > 1 && Math.abs(ranking[0].score - ranking[1].score) <= 3 && ranking[0].score >= 70;
  onProgress?.(100, 'Smart Test Region hoàn tất');
  return {
    outputDirectory,
    crops: [crop],
    smartRegion: crop,
    results,
    ranking,
    bestModel: best?.model || null,
    bestScore: best?.score || 0,
    hybridRecommended,
    fullImagePreset: hybridRecommended ? 'packaging-hybrid' : ({ 'high-fidelity-4x': 'current-photo', 'remacri-4x': 'current-packaging', 'realesrgan-x4plus': 'official-detail' }[best?.model] || 'current-photo')
  };
}

module.exports = { normalizeCrop, selectSmartTestRegion, qualityScore, runPreview };