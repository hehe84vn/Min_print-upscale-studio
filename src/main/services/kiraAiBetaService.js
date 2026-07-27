'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE = 'https://kiraai.vn/api/v1';
const IMAGE_ENDPOINT = '/images/generations';
const CHAT_ENDPOINT = '/chat/completions';
const MODELS_ENDPOINT = '/models';
const SECRET_NAME = 'kiraAiApiKey';
const FALLBACK_MODELS = Object.freeze({
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

function normalizeModelRecord(item) {
  if (!item?.id) return null;
  const type = String(item.type || '').toLowerCase();
  if (type && type !== 'image') return null;
  if (item.status && item.status !== 'active') return null;
  return {
    id: item.id,
    label: item.name || item.id,
    description: item.description || '',
    isPartner: Boolean(item.is_partner),
    priceInputVnd: Number(item.price_input_vnd) || null,
    priceOutputVnd: Number(item.price_output_vnd) || null
  };
}

async function listImageModels(apiKey = '') {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const response = await fetchWithTimeout(`${API_BASE}${MODELS_ENDPOINT}`, { headers }, 30000);
  if (!response.ok) throw new Error(`KiraAI models: ${await readError(response)}`);
  const data = await response.json();
  const models = (Array.isArray(data?.data) ? data.data : []).map(normalizeModelRecord).filter(Boolean);
  return models.length ? models : Object.entries(FALLBACK_MODELS).map(([id, value]) => ({ id, label: value.label }));
}

async function getStatus(secrets) {
  try {
    const status = await secrets.status(SECRET_NAME);
    let models;
    try { models = await listImageModels(status.configured ? await secrets.get(SECRET_NAME) : ''); }
    catch { models = Object.entries(FALLBACK_MODELS).map(([id, value]) => ({ id, label: value.label })); }
    return { beta: true, configured: status.configured, suffix: status.suffix, apiBase: API_BASE, endpoint: IMAGE_ENDPOINT, models };
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

async function clearApiKey(secrets) { await secrets.remove(SECRET_NAME); return getStatus(secrets); }
async function testConnection(secrets) { const apiKey = await requireApiKey(secrets); const models = await listImageModels(apiKey); return { ok: true, provider: 'kiraai', beta: true, models }; }

function normalizeAspectRatio(value) { const ratio = String(value || '').trim(); return ALLOWED_ASPECT_RATIOS.has(ratio) ? ratio : '1:1'; }
function aspectRatioFromDimensions(width, height) {
  const w = Number(width); const h = Number(height); if (!(w > 0 && h > 0)) return '1:1';
  const ratio = w / h;
  return [['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4]].sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0][0];
}
function mimeFromPath(filePath) { const ext = path.extname(filePath || '').toLowerCase(); return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'; }
function extractOutput(payload) {
  const item = payload?.data?.[0]; const direct = item?.url || item?.b64_json || payload?.image_url || payload?.url;
  if (typeof direct === 'string' && direct) return { source: direct, mimeType: item?.mime_type || 'image/png' };
  throw new Error(`KiraAI không trả về ảnh theo schema Images API: ${JSON.stringify(payload)}`);
}
async function writeOutput(source, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (source.startsWith('data:image/')) { const comma = source.indexOf(','); await fs.writeFile(outputPath, Buffer.from(source.slice(comma + 1), 'base64')); return; }
  if (/^[A-Za-z0-9+/=]+$/.test(source) && source.length > 1000) { await fs.writeFile(outputPath, Buffer.from(source, 'base64')); return; }
  const response = await fetchWithTimeout(source, {}, 120000); if (!response.ok) throw new Error(`Không tải được kết quả KiraAI: HTTP ${response.status}`);
  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

const REBUILD_SYSTEM_PROMPT = `Analyze the supplied image for faithful visual reconstruction. Return one production-ready English image-generation prompt only. Preserve composition, object placement, perspective, dominant colors, lighting direction, visual hierarchy and subject identity. Improve material detail, natural texture, edge definition and perceived resolution. Do not add unrelated objects. For posters or packaging, preserve empty zones and layout geometry, but do not attempt to reproduce readable text or logos; describe those areas as clean placeholders because typography and logos will be restored separately.`;

async function buildReconstructionPrompt(apiKey, inputPath, userPrompt, mode = 'safe') {
  const bytes = await fs.readFile(inputPath);
  const dataUri = `data:${mimeFromPath(inputPath)};base64,${bytes.toString('base64')}`;
  const modeInstruction = mode === 'creative' ? 'Allow moderate creative reinterpretation while keeping the main composition.' : mode === 'balanced' ? 'Improve details naturally while staying close to the source.' : 'Stay extremely close to the source and minimize invented details.';
  const response = await fetchWithTimeout(`${API_BASE}${CHAT_ENDPOINT}`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'kira-3.5-flash', stream: false, temperature: 0.2, max_tokens: 1800, messages: [{ role: 'system', content: REBUILD_SYSTEM_PROMPT }, { role: 'user', content: [{ type: 'text', text: `${modeInstruction}\nAdditional user request: ${String(userPrompt || '').trim() || 'None'}` }, { type: 'image_url', image_url: { url: dataUri } }] }] })
  }, 120000);
  if (!response.ok) throw new Error(`KiraAI Vision: ${await readError(response)}`);
  const data = await response.json();
  const prompt = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!prompt) throw new Error(`KiraAI Vision không trả về prompt tái dựng: ${JSON.stringify(data)}`);
  return prompt;
}

async function enhance({ secureSecretsService, inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu ảnh đầu vào hoặc đường dẫn đầu ra KiraAI.');
  const apiKey = await requireApiKey(secureSecretsService);
  const models = await listImageModels(apiKey);
  const selected = models.find((item) => item.id === options.modelId) || models[0] || { id: 'kira-3.0-image', label: 'Kira 3.0 Image' };
  const aspectRatio = normalizeAspectRatio(options.aspectRatio || aspectRatioFromDimensions(options.inputWidth, options.inputHeight));

  onProgress?.({ status: 'analyzing', message: 'Kira Vision đang phân tích ảnh và tạo prompt tái dựng...' });
  const generatedPrompt = await buildReconstructionPrompt(apiKey, inputPath, options.prompt, options.rebuildMode || 'safe');
  const payload = { model: selected.id, prompt: generatedPrompt, aspect_ratio: aspectRatio };

  onProgress?.({ status: 'uploading', message: `Đang gửi prompt tái dựng tới ${selected.label}...`, generatedPrompt });
  const response = await fetchWithTimeout(`${API_BASE}${IMAGE_ENDPOINT}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 180000);
  if (!response.ok) throw new Error(`KiraAI Image: ${await readError(response)} | payload=${JSON.stringify(payload)}`);
  onProgress?.({ status: 'processing', message: 'KiraAI.vn đang tái dựng ảnh...' });
  const data = await response.json(); const output = extractOutput(data); await writeOutput(output.source, outputPath);
  return { outputPath, modelId: selected.id, modelLabel: selected.label, aspectRatio, endpoint: IMAGE_ENDPOINT, generatedPrompt, beta: true, referenceImageUsed: false, sourceAnalyzedByVision: true };
}

module.exports = { API_BASE, ALLOWED_ASPECT_RATIOS, CHAT_ENDPOINT, IMAGE_ENDPOINT, MODELS_ENDPOINT, SECRET_NAME, aspectRatioFromDimensions, buildReconstructionPrompt, clearApiKey, enhance, extractOutput, getStatus, listImageModels, normalizeAspectRatio, saveApiKey, testConnection };
