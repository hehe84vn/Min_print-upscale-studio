'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE = 'https://kiraai.vn/api/v1';
const IMAGE_ENDPOINT = '/images/generations';
const CHAT_ENDPOINT = '/chat/completions';
const MODELS_ENDPOINT = '/models';
const SECRET_NAME = 'kiraAiApiKey';
const DIRECTOR_MODEL = 'gpt-5.4';
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

async function listAllModels(apiKey = '') {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const response = await fetchWithTimeout(`${API_BASE}${MODELS_ENDPOINT}`, { headers }, 30000);
  if (!response.ok) throw new Error(`KiraAI models: ${await readError(response)}`);
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function listImageModels(apiKey = '') {
  const records = await listAllModels(apiKey);
  const models = records.map(normalizeModelRecord).filter(Boolean);
  return models.length ? models : Object.entries(FALLBACK_MODELS).map(([id, value]) => ({ id, label: value.label }));
}

async function assertDirectorModelAvailable(apiKey, directorModelId = DIRECTOR_MODEL) {
  const records = await listAllModels(apiKey);
  const model = records.find((item) => item?.id === directorModelId);
  if (!model) throw new Error(`KiraAI chưa trả về model ${directorModelId} trong /models. Không tự đổi sang model khác để tránh sai bài test.`);
  if (model.status && model.status !== 'active') throw new Error(`Model ${directorModelId} hiện không active trên KiraAI.`);
  return { id: model.id, label: model.name || model.id };
}

async function getStatus(secrets) {
  try {
    const status = await secrets.status(SECRET_NAME);
    let models;
    let directorAvailable = false;
    try {
      const apiKey = status.configured ? await secrets.get(SECRET_NAME) : '';
      models = await listImageModels(apiKey);
      if (apiKey) directorAvailable = Boolean((await listAllModels(apiKey)).find((item) => item?.id === DIRECTOR_MODEL && (!item.status || item.status === 'active')));
    } catch { models = Object.entries(FALLBACK_MODELS).map(([id, value]) => ({ id, label: value.label })); }
    return { beta: true, configured: status.configured, suffix: status.suffix, apiBase: API_BASE, endpoint: IMAGE_ENDPOINT, models, directorModel: DIRECTOR_MODEL, directorAvailable };
  } catch (error) {
    return { beta: true, configured: false, models: [], directorModel: DIRECTOR_MODEL, directorAvailable: false, error: error.message };
  }
}

async function saveApiKey(secrets, apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) throw new Error('API key KiraAI.vn không được để trống.');
  await secrets.set(SECRET_NAME, value);
  return getStatus(secrets);
}

async function clearApiKey(secrets) { await secrets.remove(SECRET_NAME); return getStatus(secrets); }
async function testConnection(secrets) {
  const apiKey = await requireApiKey(secrets);
  const models = await listImageModels(apiKey);
  const director = await assertDirectorModelAvailable(apiKey, DIRECTOR_MODEL);
  return { ok: true, provider: 'kiraai', beta: true, models, director };
}

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

const DIRECTOR_SYSTEM_PROMPT = `You are a senior print-production reconstruction director. Analyze the supplied reference image and return strict JSON only. Decide whether the source is a photo, product photo, illustration, poster, packaging artwork, logo, or text-heavy graphic. Your job is to protect fidelity, not merely describe style. Record exact visual hierarchy, relative positions, scale relationships, perspective, lighting, materials, palette, negative space, text zones, logo zones, icon zones, and details that must not change. For text-heavy artwork, explicitly mark full-frame generation as high risk. JSON schema: {"image_type":"","risk_level":"low|medium|high","recommended_pipeline":"full_rebuild|image_area_only|faithful_upscale_only","composition":"","subjects":[],"object_positions":[],"background":"","lighting":"","materials":[],"color_palette":[],"style":"","perspective":"","text_regions":[],"logo_regions":[],"icon_regions":[],"preserve":[],"improve":[],"forbidden":[],"generation_prompt":""}. The generation_prompt must be production-ready English, highly specific, and must not request readable text or logo recreation; use clean placeholders for those protected regions.`;

function parseDirectorJson(raw) {
  const text = String(raw || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(text); }
  catch { throw new Error(`GPT-5.4 không trả về JSON hợp lệ: ${text.slice(0, 1200)}`); }
}

async function buildReconstructionPrompt(apiKey, inputPath, userPrompt, mode = 'safe', directorModelId = DIRECTOR_MODEL) {
  await assertDirectorModelAvailable(apiKey, directorModelId);
  const bytes = await fs.readFile(inputPath);
  const dataUri = `data:${mimeFromPath(inputPath)};base64,${bytes.toString('base64')}`;
  const modeInstruction = mode === 'creative' ? 'Allow moderate reinterpretation only where fidelity is not critical.' : mode === 'balanced' ? 'Improve detail while staying close to the source.' : 'Use maximum fidelity and minimize invented detail.';
  const response = await fetchWithTimeout(`${API_BASE}${CHAT_ENDPOINT}`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: directorModelId, stream: false, temperature: 0.1, max_tokens: 2600, messages: [{ role: 'system', content: DIRECTOR_SYSTEM_PROMPT }, { role: 'user', content: [{ type: 'text', text: `${modeInstruction}\nAdditional user request: ${String(userPrompt || '').trim() || 'None'}` }, { type: 'image_url', image_url: { url: dataUri } }] }] })
  }, 180000);
  if (!response.ok) throw new Error(`KiraAI GPT-5.4 Director: ${await readError(response)}`);
  const data = await response.json();
  const analysis = parseDirectorJson(data?.choices?.[0]?.message?.content);
  const generatedPrompt = String(analysis?.generation_prompt || '').trim();
  if (!generatedPrompt) throw new Error('GPT-5.4 không trả về generation_prompt.');
  return { analysis, generatedPrompt, directorModelId };
}

async function enhance({ secureSecretsService, inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu ảnh đầu vào hoặc đường dẫn đầu ra KiraAI.');
  const apiKey = await requireApiKey(secureSecretsService);
  const models = await listImageModels(apiKey);
  const selected = models.find((item) => item.id === options.modelId) || models[0] || { id: 'kira-3.0-image', label: 'Kira 3.0 Image' };
  const aspectRatio = normalizeAspectRatio(options.aspectRatio || aspectRatioFromDimensions(options.inputWidth, options.inputHeight));

  onProgress?.({ status: 'analyzing', message: 'GPT-5.4 đang phân tích ảnh và quyết định pipeline...' });
  const director = await buildReconstructionPrompt(apiKey, inputPath, options.prompt, options.rebuildMode || 'safe', DIRECTOR_MODEL);
  if (director.analysis?.recommended_pipeline === 'faithful_upscale_only' && options.forceCreativeRebuild !== true) {
    throw new Error(`GPT-5.4 đánh giá ảnh này không nên tái dựng toàn khung (${director.analysis?.risk_level || 'high risk'}). Khuyến nghị: faithful upscale only. Bật ép Creative Rebuild chỉ khi chấp nhận thay đổi bố cục, chữ và logo.`);
  }
  const payload = { model: selected.id, prompt: director.generatedPrompt, aspect_ratio: aspectRatio };

  onProgress?.({ status: 'uploading', message: `Đang gửi prompt do GPT-5.4 tạo tới ${selected.label}...`, generatedPrompt: director.generatedPrompt, analysis: director.analysis });
  const response = await fetchWithTimeout(`${API_BASE}${IMAGE_ENDPOINT}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 180000);
  if (!response.ok) throw new Error(`KiraAI Image: ${await readError(response)} | payload=${JSON.stringify(payload)}`);
  onProgress?.({ status: 'processing', message: 'KiraAI.vn đang tạo ảnh từ chỉ đạo của GPT-5.4...' });
  const data = await response.json(); const output = extractOutput(data); await writeOutput(output.source, outputPath);
  return { outputPath, modelId: selected.id, modelLabel: selected.label, aspectRatio, endpoint: IMAGE_ENDPOINT, generatedPrompt: director.generatedPrompt, analysis: director.analysis, directorModel: DIRECTOR_MODEL, beta: true, referenceImageUsed: false, sourceAnalyzedByVision: true };
}

module.exports = { API_BASE, ALLOWED_ASPECT_RATIOS, CHAT_ENDPOINT, DIRECTOR_MODEL, IMAGE_ENDPOINT, MODELS_ENDPOINT, SECRET_NAME, aspectRatioFromDimensions, assertDirectorModelAvailable, buildReconstructionPrompt, clearApiKey, enhance, extractOutput, getStatus, listAllModels, listImageModels, normalizeAspectRatio, saveApiKey, testConnection };