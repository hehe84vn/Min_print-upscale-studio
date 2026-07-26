'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const API_BASE = 'https://api.krea.ai';
const SECRET_NAME = 'kreaBetaApiKey';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled']);
const MODEL_CONFIGS = Object.freeze({
  topaz: { label: 'Topaz Faithful · Packaging / Logo / Text / Print', endpoint: '/generate/enhance/topaz/standard-enhance', maxDimension: 22000, maxScale: 32 },
  'topaz-generative': { label: 'Topaz Generative · Photo / Detail / Restore', endpoint: '/generate/enhance/topaz/generative-enhance', maxDimension: 16000, maxScale: 32 },
  'topaz-bloom': { label: 'Topaz Bloom · Creative / Illustration', endpoint: '/generate/enhance/topaz/bloom-enhance', maxDimension: 10000, maxScale: 32 },
  'krea-enhance': { label: 'Krea Enhance · Creative Enhancement', endpoint: '/generate/enhance/krea/enhance', maxDimension: 8000, maxScale: 32 }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function clamp(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function configFor(id) { const config = MODEL_CONFIGS[id]; if (!config) throw new Error('Model Krea không được hỗ trợ.'); return config; }
function compactObject(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')); }
function safeJson(value) { try { return JSON.stringify(value); } catch { return String(value); } }
async function readError(response) { const text = await response.text(); try { const data = JSON.parse(text); return data?.error?.message || data?.error || data?.message || text; } catch { return text || `HTTP ${response.status}`; } }
async function fetchWithTimeout(url, init = {}, timeoutMs = 30000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) { if (error.name === 'AbortError') throw new Error('Krea API đã quá thời gian chờ.'); throw error; }
  finally { clearTimeout(timer); }
}
async function requireApiKey(secrets) { const key = await secrets.get(SECRET_NAME); if (!key) throw new Error('Chưa có API token Krea Beta.'); return key; }
async function getStatus(secrets) {
  try { const s = await secrets.status(SECRET_NAME); return { beta: true, configured: s.configured, suffix: s.suffix, secureStorageAvailable: true, models: Object.entries(MODEL_CONFIGS).map(([id, c]) => ({ id, ...c })) }; }
  catch (error) { return { beta: true, configured: false, secureStorageAvailable: false, models: [], error: error.message }; }
}
async function saveApiKey(secrets, apiKey) { const value = String(apiKey || '').trim(); if (!value) throw new Error('API token Krea không được để trống.'); await secrets.set(SECRET_NAME, value); return getStatus(secrets); }
async function clearApiKey(secrets) { await secrets.remove(SECRET_NAME); return getStatus(secrets); }
async function testConnection(secrets) {
  const apiKey = await requireApiKey(secrets);
  const response = await fetchWithTimeout(`${API_BASE}/jobs/00000000-0000-0000-0000-000000000000`, { headers: { Authorization: `Bearer ${apiKey}` } }, 20000);
  if (response.status === 401 || response.status === 403) throw new Error(`Krea API: ${await readError(response)}`);
  if (!response.ok && response.status !== 404) throw new Error(`Krea API: ${await readError(response)}`);
  return { ok: true, provider: 'krea', beta: true };
}
async function uploadAsset(apiKey, inputPath) {
  const bytes = await fs.readFile(inputPath); if (bytes.length > 75 * 1024 * 1024) throw new Error('Krea chỉ nhận asset tối đa 75 MB.');
  const form = new FormData(); form.append('file', new Blob([bytes]), path.basename(inputPath)); form.append('description', 'Print Upscale Studio Krea input');
  const response = await fetchWithTimeout(`${API_BASE}/assets`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form }, 120000);
  if (!response.ok) throw new Error(`Krea upload: ${await readError(response)}`);
  const asset = await response.json(); if (!asset?.image_url || !asset?.width || !asset?.height) throw new Error(`Krea upload không trả về đủ dữ liệu asset: ${safeJson(asset)}`); return asset;
}
function resolveScale(config, asset, options = {}) {
  const sourceLongEdge = Math.max(Number(asset.width), Number(asset.height));
  const requestedLongEdge = Number(options.targetLongEdge);
  const requestedScale = Number.isFinite(requestedLongEdge) && requestedLongEdge > 0 ? requestedLongEdge / sourceLongEdge : clamp(options.scale, 1, config.maxScale, 2);
  const scale = Math.min(Math.max(1, requestedScale), config.maxScale, config.maxDimension / sourceLongEdge);
  return { scale, sourceLongEdge, requestedLongEdge: Number.isFinite(requestedLongEdge) ? requestedLongEdge : null, outputWidth: Math.round(Number(asset.width) * scale), outputHeight: Math.round(Number(asset.height) * scale), limited: scale + 0.0001 < requestedScale };
}
function regenerationPreset(options = {}) {
  const mode = String(options.regenerationMode || 'safe');
  if (mode === 'creative') return { generativeCreativity: 5, texture: 4, bloomCreativity: 7, aiStrength: 0.65, resemblance: 0.9, clarity: 6, sharpness: 0.6 };
  if (mode === 'balanced') return { generativeCreativity: 3, texture: 3, bloomCreativity: 4, aiStrength: 0.35, resemblance: 1.6, clarity: 4, sharpness: 0.5 };
  return { generativeCreativity: 1, texture: 2, bloomCreativity: 1, aiStrength: 0.15, resemblance: 2.3, clarity: 3, sharpness: 0.4 };
}
function baseTopaz(asset, sizing, options) { return { width: Math.round(asset.width), height: Math.round(asset.height), image_url: asset.image_url, output_format: 'png', upscaling_activated: sizing.scale > 1, image_scaling_factor: sizing.scale, prompt: String(options.prompt || '').trim().slice(0, 1024) || undefined }; }
function buildTopazFaithfulPayload(asset, sizing) { return { width: Math.round(asset.width), height: Math.round(asset.height), image_url: asset.image_url, model: 'Standard V2', output_format: 'png', upscaling_activated: sizing.scale > 1, image_scaling_factor: sizing.scale }; }
function buildTopazGenerativePayload(asset, sizing, options) { const p = regenerationPreset(options); return compactObject({ ...baseTopaz(asset, sizing, options), crop_to_fill: false, subject_detection: 'All', face_enhancement: Boolean(options.protectFace), creativity: p.generativeCreativity, texture: p.texture, sharpen: 0.5, denoise: 0.5, detail: 0.5 }); }
function buildTopazBloomPayload(asset, sizing, options) { const p = regenerationPreset(options); return compactObject({ ...baseTopaz(asset, sizing, options), crop_to_fill: false, creativity: p.bloomCreativity, face_preservation: Boolean(options.protectFace), color_preservation: options.preserveColor !== false }); }
function buildKreaEnhancePayload(asset, sizing, options) { const p = regenerationPreset(options); return compactObject({ image_url: asset.image_url, prompt: String(options.prompt || '').trim().slice(0, 1024), image_scaling_factor: sizing.scale, rescale_color: options.preserveColor !== false, ai_strength: p.aiStrength, clarity_strength: p.clarity, resemblance_strength: p.resemblance, sharpness: p.sharpness }); }
function buildPayload(modelId, asset, options = {}) {
  const sizing = resolveScale(configFor(modelId), asset, options);
  if (modelId === 'topaz') return buildTopazFaithfulPayload(asset, sizing, options);
  if (modelId === 'topaz-generative') return buildTopazGenerativePayload(asset, sizing, options);
  if (modelId === 'topaz-bloom') return buildTopazBloomPayload(asset, sizing, options);
  return buildKreaEnhancePayload(asset, sizing, options);
}
async function submit(apiKey, modelId, asset, options) {
  const payload = buildPayload(modelId, asset, options); const endpoint = configFor(modelId).endpoint;
  const response = await fetchWithTimeout(`${API_BASE}${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 60000);
  if (!response.ok) throw new Error(`Krea API: ${await readError(response)} | endpoint=${endpoint} | payload=${safeJson(payload)}`);
  const data = await response.json(); if (!data?.job_id) throw new Error(`Krea không trả về job_id: ${safeJson(data)}`); return { ...data, submittedPayload: payload, endpoint };
}
function jobFailureMessage(job, jobId) { const detail = job?.error?.message || job?.error || job?.failure_reason || job?.message || job?.result?.error; return `Krea job ${jobId} kết thúc với trạng thái ${job?.status || 'failed'}${detail ? `: ${typeof detail === 'string' ? detail : safeJson(detail)}` : ''}. Chi tiết: ${safeJson(job)}`; }
async function waitForJob(apiKey, jobId, onProgress) {
  const start = Date.now(); while (Date.now() - start < 600000) {
    const response = await fetchWithTimeout(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`Krea API: ${await readError(response)}`);
    const job = await response.json(); onProgress?.({ status: job.status || 'processing', jobId, job });
    if (TERMINAL_STATUSES.has(job.status)) { if (job.status !== 'completed') throw new Error(jobFailureMessage(job, jobId)); const url = job?.result?.urls?.[0] || job?.result?.url || job?.output_url; if (!url) throw new Error(`Krea không trả về URL kết quả. Chi tiết: ${safeJson(job)}`); return { url, job }; }
    await sleep(2500);
  } throw new Error(`Krea job ${jobId} đã quá thời gian chờ 10 phút.`);
}
function normalizeFormat(value) { return ['png', 'jpeg', 'tiff', 'webp'].includes(value) ? value : 'png'; }
async function exportResult(buffer, outputPath, options, expected) {
  const format = normalizeFormat(options.outputFormat); const dpi = clamp(options.dpi, 72, 1200, 300);
  let pipeline = sharp(buffer, { failOn: 'error' }).withMetadata({ density: dpi });
  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 96, chromaSubsampling: '4:4:4', mozjpeg: true });
  else if (format === 'tiff') pipeline = pipeline.tiff({ compression: 'lzw', bitdepth: 8 });
  else if (format === 'webp') pipeline = pipeline.webp({ lossless: true, quality: 100 });
  else pipeline = pipeline.png({ compressionLevel: 6, adaptiveFiltering: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true }); await pipeline.toFile(outputPath);
  const metadata = await sharp(outputPath).metadata(); const stat = await fs.stat(outputPath);
  const tolerance = 2; const resolutionOk = metadata.width >= expected.outputWidth - tolerance && metadata.height >= expected.outputHeight - tolerance;
  if (!resolutionOk) { await fs.rm(outputPath, { force: true }); throw new Error(`Krea trả về sai kích thước: nhận ${metadata.width} × ${metadata.height}px, dự kiến tối thiểu ${expected.outputWidth} × ${expected.outputHeight}px. File không được giữ lại.`); }
  return { width: metadata.width, height: metadata.height, format: metadata.format, density: metadata.density || dpi, sizeBytes: stat.size, resolutionOk };
}
async function enhance({ secureSecretsService, inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu đường dẫn đầu vào hoặc đầu ra.');
  const apiKey = await requireApiKey(secureSecretsService); const modelId = String(options.modelId || 'topaz'); const config = configFor(modelId);
  onProgress?.({ status: 'uploading', message: 'Đang tải ảnh lên Krea...' }); const asset = await uploadAsset(apiKey, inputPath); const sizing = resolveScale(config, asset, options);
  const submitted = await submit(apiKey, modelId, asset, options); onProgress?.({ status: submitted.status || 'queued', jobId: submitted.job_id, submittedPayload: submitted.submittedPayload, endpoint: submitted.endpoint, sizing });
  const completed = await waitForJob(apiKey, submitted.job_id, onProgress); const response = await fetchWithTimeout(completed.url, {}, 120000); if (!response.ok) throw new Error(`Không tải được kết quả Krea: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer()); onProgress?.({ status: 'exporting', message: 'Đang kiểm tra và xuất RGB Master...' }); const output = await exportResult(buffer, outputPath, options, sizing);
  return { outputPath, outputUrl: completed.url, jobId: submitted.job_id, modelId, modelLabel: config.label, sizing, output, debug: { endpoint: submitted.endpoint, payload: submitted.submittedPayload, job: completed.job, downloadUrl: completed.url }, beta: true };
}

module.exports = { API_BASE, SECRET_NAME, MODEL_CONFIGS, buildPayload, buildTopazFaithfulPayload, buildTopazGenerativePayload, buildTopazBloomPayload, buildKreaEnhancePayload, clearApiKey, enhance, getStatus, regenerationPreset, resolveScale, saveApiKey, testConnection };