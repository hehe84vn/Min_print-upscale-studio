const fs = require('node:fs/promises');
const path = require('node:path');

const PROVIDERS = new Set(['gemini', 'openai']);
const SECRET_NAMES = {
  gemini: 'geminiApiKey',
  openai: 'openAiApiKey'
};

const MODE_PROMPTS = {
  safe: [
    'Enhance image quality and apparent resolution with very conservative reconstruction.',
    'Preserve the exact composition, geometry, identity, facial structure, product shape, lighting direction and color relationships.',
    'Remove compression artifacts, noise and softness while restoring only plausible fine detail.',
    'Do not add, remove, move or redesign any object. Avoid plastic skin, halos, oversharpening and invented patterns.'
  ].join(' '),
  balanced: [
    'Enhance this image to professional high-resolution quality with moderate detail reconstruction.',
    'Improve natural texture in hair, skin, fabric, foliage and materials while preserving identity, composition, product geometry and color relationships.',
    'Reduce blur, noise and compression artifacts. Keep the result photographic and believable.',
    'Do not add or remove objects. Avoid artificial microtexture, halos and excessive sharpening.'
  ].join(' '),
  creative: [
    'Perform a strong high-resolution enhancement and reconstruct missing fine detail where the source is too soft.',
    'Keep the same scene, subject identity, pose, composition and major object geometry, but improve texture, depth and clarity decisively.',
    'Do not add unrelated objects or change the intended design. Keep the result coherent and photorealistic.'
  ].join(' ')
};

function normalizeProvider(value) {
  return PROVIDERS.has(value) ? value : 'gemini';
}

function buildPrompt(options = {}) {
  const mode = ['safe', 'balanced', 'creative'].includes(options.mode) ? options.mode : 'safe';
  const protections = [];
  if (options.protectFace !== false) protections.push('Preserve every face and recognizable identity with high fidelity.');
  if (options.protectText !== false) protections.push('Preserve all existing text exactly; do not rewrite, translate or invent letters.');
  if (options.protectLogo !== false) protections.push('Preserve logos, labels, packaging graphics and brand marks exactly.');
  if (options.preserveColor !== false) protections.push('Preserve the original color palette and white balance unless correction is clearly necessary.');

  const custom = typeof options.customPrompt === 'string' ? options.customPrompt.trim().slice(0, 2000) : '';
  return [
    MODE_PROMPTS[mode],
    ...protections,
    'Return one enhanced image only, without borders, captions, comparison layouts or watermarks added by the composition.',
    custom ? `Additional user instruction: ${custom}` : ''
  ].filter(Boolean).join(' ');
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Yêu cầu AI đã quá thời gian chờ.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readError(response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.message || text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

function findImageData(value, visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return null;
  visited.add(value);

  if (typeof value.data === 'string' && (
    value.type === 'image' ||
    typeof value.mime_type === 'string' ||
    typeof value.mimeType === 'string'
  )) {
    return {
      data: value.data,
      mimeType: value.mime_type || value.mimeType || 'image/jpeg'
    };
  }

  if (value.output_image && typeof value.output_image.data === 'string') {
    return {
      data: value.output_image.data,
      mimeType: value.output_image.mime_type || value.output_image.mimeType || 'image/jpeg'
    };
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findImageData(child, visited);
      if (found) return found;
    }
  }
  return null;
}

async function enhanceWithGemini({ apiKey, inputPath, prompt, options }) {
  const imageData = await fs.readFile(inputPath);
  const model = options.model === 'gemini-3-pro-image'
    ? 'gemini-3-pro-image'
    : 'gemini-3.1-flash-image';
  const imageSize = options.imageSize === '4K' ? '4K' : '2K';

  const response = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        { type: 'text', text: prompt },
        { type: 'image', data: imageData.toString('base64'), mime_type: 'image/png' }
      ],
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        image_size: imageSize
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini API: ${await readError(response)}`);
  const payload = await response.json();
  const image = findImageData(payload);
  if (!image) throw new Error('Gemini không trả về dữ liệu hình ảnh.');

  return {
    buffer: Buffer.from(image.data, 'base64'),
    mimeType: image.mimeType,
    provider: 'gemini',
    model
  };
}

async function enhanceWithOpenAI({ apiKey, inputPath, prompt, options }) {
  const imageData = await fs.readFile(inputPath);
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('image', new Blob([imageData], { type: 'image/png' }), path.basename(inputPath));
  form.append('quality', options.mode === 'safe' ? 'medium' : 'high');
  form.append('size', 'auto');
  form.append('input_fidelity', 'high');
  form.append('output_format', 'png');

  const response = await fetchWithTimeout('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  if (!response.ok) throw new Error(`OpenAI API: ${await readError(response)}`);
  const payload = await response.json();
  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded) throw new Error('OpenAI không trả về dữ liệu hình ảnh.');

  return {
    buffer: Buffer.from(encoded, 'base64'),
    mimeType: 'image/png',
    provider: 'openai',
    model: 'gpt-image-2'
  };
}

async function getApiKey(secureSecretsService, provider) {
  if (!secureSecretsService) throw new Error('Bộ lưu API key chưa được khởi tạo.');
  const apiKey = await secureSecretsService.get(SECRET_NAMES[provider]);
  if (!apiKey) {
    const label = provider === 'gemini' ? 'Gemini' : 'OpenAI';
    throw new Error(`Chưa có API key ${label}. Mở Cài đặt để nhập key.`);
  }
  return apiKey;
}

async function enhanceImage({ secureSecretsService, provider, inputPath, options = {} }) {
  const normalizedProvider = normalizeProvider(provider);
  const apiKey = await getApiKey(secureSecretsService, normalizedProvider);
  const prompt = buildPrompt(options);

  if (normalizedProvider === 'openai') {
    return enhanceWithOpenAI({ apiKey, inputPath, prompt, options });
  }
  return enhanceWithGemini({ apiKey, inputPath, prompt, options });
}

async function testConnection({ secureSecretsService, provider }) {
  const normalizedProvider = normalizeProvider(provider);
  const apiKey = await getApiKey(secureSecretsService, normalizedProvider);
  const request = normalizedProvider === 'openai'
    ? {
        url: 'https://api.openai.com/v1/models',
        init: { headers: { Authorization: `Bearer ${apiKey}` } }
      }
    : {
        url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
        init: { headers: { 'x-goog-api-key': apiKey } }
      };

  const response = await fetchWithTimeout(request.url, request.init, 30000);
  if (!response.ok) {
    const label = normalizedProvider === 'openai' ? 'OpenAI' : 'Gemini';
    throw new Error(`${label} API: ${await readError(response)}`);
  }
  return { ok: true, provider: normalizedProvider };
}

module.exports = {
  buildPrompt,
  enhanceImage,
  normalizeProvider,
  testConnection
};