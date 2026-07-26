'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE = 'https://kiraai.vn/api/v1';
const ENDPOINT = '/images/generations';
const SECRET_NAME = 'kiraAiApiKey';
const MODELS = Object.freeze({
  'kira-3.0-image': { label: 'Kira 3.0 Image' },
  'kira-2.0-image': { label: 'Kira 2.0 Image' }
});
const ALLOWED_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);

async function fetchWithTimeout(url, init = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) { if (error.name === 'AbortError') throw new Error('KiraAI API đã quá thời gian chờ.'); throw error; }
  finally { clearTimeout(timer); }
}

async function readError(response) {
  const text = await response.text();
  try { const data = JSON.parse(text); return data?.error?.message || data?.error || data?.message || text; }
  catch { return text || `HTTP ${response.status}`; }
}

async function requireApiKey(secrets) {
  const key = await secrets.get(SECRET_NAME);
  if (!key) throw new Error('Chưa có API key KiraAI.vn.');
  return key;
}

async function getStatus(secrets) {
  try {
    const status = await secrets.status(SECRET_NAME);
    return { beta: true, configured: status.configured, suffix: status.suffix, apiBase: API_BASE, endpoint: ENDPOINT, models: Object.entries(MODELS).map(([id, item]) => ({ id, label: item.label })) };
  } catch (error) {
    return { beta: true, configured: false, models: [], error: error.message };
  }
}

async function saveApiKey(secrets, apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) throw new Error('API key KiraAI.vn không được để trống.');
  await secrets.set(SECRET_NAME, value);
  return getStatus(secrets);
}

async function clearApiKey(secrets) {
  await secrets.remove(SECRET_NAME);
  return getStatus(secrets);
}

async function testConnection(secrets) {
  const apiKey = await requireApiKey(secrets);
  const response = await fetchWithTimeout(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, 30000);
  if (!response.ok) throw new Error(`KiraAI API: ${await readError(response)}`);
  return { ok: true, provider: 'kiraai', beta: true };
}

function normalizeAspectRatio(value) {
  const ratio = String(value || '').trim();
  return ALLOWED_ASPECT_RATIOS.has(ratio) ? ratio : '1:1';
}

function aspectRatioFromDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0 && h > 0)) return '1:1';
  const ratio = w / h;
  const candidates = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4]
  ];
  candidates.sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio));
  return candidates[0][0];
}

function extractOutput(payload) {
  const item = payload?.data?.[0];
  const direct = item?.url || item?.b64_json || payload?.image_url || payload?.url;
  if (typeof direct === 'string' && direct) return direct;
  throw new Error(`KiraAI không trả về ảnh theo schema Images API: ${JSON.stringify(payload)}`);
}

async function writeOutput(source, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (source.startsWith('data:image/')) {
    const comma = source.indexOf(',');
    await fs.writeFile(outputPath, Buffer.from(source.slice(comma + 1), 'base64'));
    return;
  }
  if (/^[A-Za-z0-9+/=]+$/.test(source) && source.length > 1000) {
    await fs.writeFile(outputPath, Buffer.from(source, 'base64'));
    return;
  }
  const response = await fetchWithTimeout(source, {}, 120000);
  if (!response.ok) throw new Error(`Không tải được kết quả KiraAI: HTTP ${response.status}`);
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function enhance({ secureSecretsService, inputPath, outputPath, options = {}, onProgress }) {
  if (!outputPath) throw new Error('Thiếu đường dẫn đầu ra KiraAI.');
  const apiKey = await requireApiKey(secureSecretsService);
  const model = MODELS[options.modelId] ? options.modelId : 'kira-3.0-image';
  const prompt = String(options.prompt || '').trim();
  if (!prompt) {
    throw new Error('KiraAI Images API yêu cầu prompt. Guide hiện tại chưa công bố tham số ảnh tham chiếu cho API, nên app không tự gửi file nguồn bằng schema suy đoán.');
  }
  const aspectRatio = normalizeAspectRatio(options.aspectRatio || aspectRatioFromDimensions(options.inputWidth, options.inputHeight));
  const payload = { model, prompt, aspect_ratio: aspectRatio };

  onProgress?.({ status: 'uploading', message: 'Đang gửi yêu cầu tạo ảnh tới KiraAI.vn...' });
  const response = await fetchWithTimeout(`${API_BASE}${ENDPOINT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`KiraAI API: ${await readError(response)}`);
  onProgress?.({ status: 'processing', message: 'KiraAI.vn đang tạo ảnh...' });
  const data = await response.json();
  const source = extractOutput(data);
  await writeOutput(source, outputPath);
  return { outputPath, modelId: model, modelLabel: MODELS[model].label, aspectRatio, endpoint: ENDPOINT, beta: true, referenceImageUsed: false };
}

module.exports = { API_BASE, ALLOWED_ASPECT_RATIOS, ENDPOINT, MODELS, SECRET_NAME, aspectRatioFromDimensions, clearApiKey, enhance, extractOutput, getStatus, normalizeAspectRatio, saveApiKey, testConnection };
