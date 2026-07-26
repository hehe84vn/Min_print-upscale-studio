'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE = 'https://kiraai.vn/api/v1';
const ENDPOINT = '/chat/completions';
const SECRET_NAME = 'kiraAiApiKey';
const MODELS = Object.freeze({
  'kira-3.0-image': { label: 'Kira 3.0 Image' },
  'kira-2.0-image': { label: 'Kira 2.0 Image' }
});

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'image/png';
}

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
    return { beta: true, configured: status.configured, suffix: status.suffix, apiBase: API_BASE, models: Object.entries(MODELS).map(([id, item]) => ({ id, label: item.label })) };
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
  if (response.status === 404 || response.status === 405) return { ok: true, provider: 'kiraai', beta: true, note: 'Endpoint models không được công bố; key sẽ được kiểm tra khi chạy ảnh.' };
  if (!response.ok) throw new Error(`KiraAI API: ${await readError(response)}`);
  return { ok: true, provider: 'kiraai', beta: true };
}

function extractOutput(payload) {
  const direct = payload?.data?.[0]?.url || payload?.data?.[0]?.b64_json || payload?.image_url || payload?.url;
  if (direct) return direct;
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const value = part?.image_url?.url || part?.image_url || part?.url || part?.b64_json || part?.text;
      if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('data:image/'))) return value;
    }
  }
  if (typeof content === 'string') {
    const match = content.match(/https?:\/\/[^\s)"']+|data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
    if (match) return match[0];
  }
  throw new Error(`KiraAI không trả về ảnh kết quả theo định dạng đã biết: ${JSON.stringify(payload)}`);
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
  if (!inputPath || !outputPath) throw new Error('Thiếu đường dẫn đầu vào hoặc đầu ra KiraAI.');
  const apiKey = await requireApiKey(secureSecretsService);
  const model = MODELS[options.modelId] ? options.modelId : 'kira-3.0-image';
  const bytes = await fs.readFile(inputPath);
  const imageDataUrl = `data:${mimeFor(inputPath)};base64,${bytes.toString('base64')}`;
  const prompt = String(options.prompt || '').trim() || 'Enhance and upscale this image for professional print production. Preserve composition, identity, text, logos, geometry and original colors. Do not add or remove content.';
  const sizeHint = options.scale ? `${Number(options.scale)}x` : 'highest practical resolution';
  const payload = {
    model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: `${prompt}\nRequested output: ${sizeHint}. Return only the enhanced image.` },
      { type: 'image_url', image_url: { url: imageDataUrl } }
    ] }],
    stream: false
  };
  onProgress?.({ status: 'uploading', message: 'Đang gửi ảnh tới KiraAI.vn...' });
  const response = await fetchWithTimeout(`${API_BASE}${ENDPOINT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`KiraAI API: ${await readError(response)}`);
  onProgress?.({ status: 'processing', message: 'KiraAI.vn đang xử lý ảnh...' });
  const data = await response.json();
  const source = extractOutput(data);
  await writeOutput(source, outputPath);
  return { outputPath, modelId: model, modelLabel: MODELS[model].label, beta: true };
}

module.exports = { API_BASE, ENDPOINT, MODELS, SECRET_NAME, clearApiKey, enhance, getStatus, saveApiKey, testConnection };