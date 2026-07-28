'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const API_BASE = 'https://api.krea.ai';
const SECRET_NAME = 'kreaBetaApiKey';
const MAX_UPLOAD_BYTES = 75 * 1024 * 1024;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled']);
const RETRY_DELAYS_MS = Object.freeze([5000, 15000, 45000]);
const SUPPORTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'tiff']);
const SUPPORTED_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'tiff', 'webp']);

const MODEL_FAMILIES = Object.freeze({
  'topaz-standard': {
    label: 'Topaz Standard',
    endpoint: '/generate/enhance/topaz/standard-enhance',
    maxDimension: 22000,
    maxScale: 32,
    risk: 'precise'
  },
  'topaz-generative': {
    label: 'Topaz Generative',
    endpoint: '/generate/enhance/topaz/generative-enhance',
    maxDimension: 16000,
    maxScale: 32,
    risk: 'generative'
  },
  'topaz-bloom': {
    label: 'Topaz Bloom',
    endpoint: '/generate/enhance/topaz/bloom-enhance',
    maxDimension: 10000,
    maxScale: 32,
    risk: 'creative'
  },
  'krea-enhance': {
    label: 'Krea Enhance',
    endpoint: '/generate/enhance/krea/enhance',
    maxDimension: 8000,
    maxScale: 32,
    risk: 'creative'
  }
});

const KREA_PRESETS = Object.freeze({
  auto: {
    label: 'Auto · ưu tiên bảo toàn',
    family: null,
    risk: 'auto',
    description: 'Tự chọn preset theo vùng chữ/logo, mức tái tạo và độ phân giải nguồn.'
  },
  'print-faithful': {
    label: 'Print Faithful · High Fidelity V3',
    family: 'topaz-standard',
    model: 'Upscale High Fidelity V3',
    risk: 'precise',
    description: 'Ưu tiên giữ bố cục, sản phẩm và màu tổng thể; mặc định cho ảnh in.'
  },
  'text-graphic': {
    label: 'Text & Graphic · Text Refine',
    family: 'topaz-standard',
    model: 'Text Refine',
    risk: 'precise',
    description: 'Dành cho ảnh có chữ, logo, label hoặc graphic cần bảo toàn.'
  },
  'low-resolution': {
    label: 'Low Resolution Restore · V2',
    family: 'topaz-standard',
    model: 'Low Resolution V2',
    risk: 'precise',
    description: 'Dành cho ảnh nhỏ, JPEG nén hoặc thiếu chi tiết nguồn.'
  },
  'product-cgi': {
    label: 'Product / CGI · CGI',
    family: 'topaz-standard',
    model: 'CGI',
    risk: 'precise',
    description: 'Dành cho render sản phẩm, mockup và bề mặt vật liệu nhân tạo.'
  },
  'photo-standard': {
    label: 'Photo Standard · Standard V2',
    family: 'topaz-standard',
    model: 'Standard V2',
    risk: 'precise',
    description: 'Upscale ảnh chụp thông thường với mức xử lý cân bằng.'
  },
  'restore-photo': {
    label: 'Photo Recovery · Recovery V2',
    family: 'topaz-generative',
    model: 'Recovery V2',
    risk: 'generative',
    description: 'Phục hồi ảnh cũ hoặc ảnh xuống cấp; có thể tái tạo chi tiết.'
  },
  'detail-photo': {
    label: 'Photo Detail · Detail',
    family: 'topaz-generative',
    model: 'Detail',
    risk: 'generative',
    description: 'Tăng chi tiết ảnh chụp với mức sáng tạo thấp.'
  },
  'creative-photo': {
    label: 'Creative Photo · Krea Enhance',
    family: 'krea-enhance',
    model: null,
    risk: 'creative',
    description: 'Tăng chi tiết sáng tạo; không dùng cho chữ, logo hoặc artwork approved.'
  },
  'creative-illustration': {
    label: 'Creative Illustration · Topaz Bloom',
    family: 'topaz-bloom',
    model: null,
    risk: 'creative',
    description: 'Tái tạo texture và chi tiết minh họa; có nguy cơ làm đổi nội dung.'
  }
});

const LEGACY_PRESET_MAP = Object.freeze({
  topaz: 'print-faithful',
  'topaz-generative': 'restore-photo',
  'topaz-bloom': 'creative-illustration',
  'krea-enhance': 'creative-photo'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function normalizeOutputFormat(value) {
  const normalized = value === 'jpg' ? 'jpeg' : value;
  return SUPPORTED_OUTPUT_FORMATS.has(normalized) ? normalized : 'png';
}

function normalizePresetId(value) {
  const requested = String(value || 'auto').trim();
  const mapped = LEGACY_PRESET_MAP[requested] || requested;
  return KREA_PRESETS[mapped] ? mapped : 'auto';
}

function familyFor(preset) {
  const family = MODEL_FAMILIES[preset.family];
  if (!family) throw new Error('Preset Krea chưa được ánh xạ tới model family hợp lệ.');
  return family;
}

async function readErrorPayload(response) {
  const text = await response.text();
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

function userVisibleApiError(status, payload) {
  const message = payload?.json?.error?.message || payload?.json?.error || payload?.json?.message || payload?.text || `HTTP ${status}`;
  if (status === 401 || status === 403) return new Error('Krea từ chối API key. Hãy kiểm tra lại token trong Cài đặt.');
  if (status === 402) return new Error('Krea báo không đủ credit hoặc model yêu cầu gói cao hơn.');
  if (status === 422 || status === 400) return new Error(`Krea từ chối tham số xử lý: ${String(message).slice(0, 500)}`);
  if (status === 429) return new Error('Krea đang giới hạn số job đồng thời. Hãy thử lại sau.');
  return new Error(`Krea API lỗi ${status}: ${String(message).slice(0, 500)}`);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Krea API đã quá thời gian chờ.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(url, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const maxServerRetries = options.maxServerRetries ?? 1;
  let serverRetries = 0;
  let rateLimitAttempt = 0;

  while (true) {
    const response = await fetchWithTimeout(url, init, timeoutMs);
    if (response.ok) return response;

    if (response.status === 429 && rateLimitAttempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[rateLimitAttempt]);
      rateLimitAttempt += 1;
      continue;
    }

    if (response.status >= 500 && response.status <= 599 && serverRetries < maxServerRetries) {
      serverRetries += 1;
      await sleep(3000 * serverRetries);
      continue;
    }

    throw userVisibleApiError(response.status, await readErrorPayload(response));
  }
}

async function requireApiKey(secureSecretsService) {
  const key = await secureSecretsService.get(SECRET_NAME);
  if (!key) throw new Error('Chưa có API token Krea. Mở Cài đặt để nhập token.');
  return key;
}

async function getStatus(secureSecretsService) {
  try {
    const status = await secureSecretsService.status(SECRET_NAME);
    return {
      beta: true,
      configured: status.configured,
      suffix: status.suffix,
      secureStorageAvailable: true,
      presets: Object.entries(KREA_PRESETS).map(([id, preset]) => ({ id, ...preset }))
    };
  } catch (error) {
    return {
      beta: true,
      configured: false,
      suffix: null,
      secureStorageAvailable: false,
      presets: [],
      error: error.message
    };
  }
}

async function saveApiKey(secureSecretsService, apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) throw new Error('API token Krea không được để trống.');
  await secureSecretsService.set(SECRET_NAME, value);
  return getStatus(secureSecretsService);
}

async function clearApiKey(secureSecretsService) {
  await secureSecretsService.remove(SECRET_NAME);
  return getStatus(secureSecretsService);
}

async function testConnection(secureSecretsService) {
  const apiKey = await requireApiKey(secureSecretsService);
  const response = await fetchWithTimeout(`${API_BASE}/jobs/00000000-0000-0000-0000-000000000000`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 20000);

  if (response.status === 401 || response.status === 403) {
    throw userVisibleApiError(response.status, await readErrorPayload(response));
  }
  if (!response.ok && response.status !== 404) {
    throw userVisibleApiError(response.status, await readErrorPayload(response));
  }
  return { ok: true, provider: 'krea', beta: true };
}

async function inspectInput(inputPath) {
  const stat = await fs.stat(inputPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Ảnh đầu vào không tồn tại hoặc rỗng.');
  if (stat.size > MAX_UPLOAD_BYTES) throw new Error('Krea chỉ nhận file tối đa 75 MB.');

  let metadata;
  try {
    metadata = await sharp(inputPath, { failOn: 'error' }).metadata();
  } catch {
    throw new Error('Không đọc được ảnh đầu vào hoặc file đã hỏng.');
  }

  if (!SUPPORTED_INPUT_FORMATS.has(metadata.format)) {
    throw new Error(`Krea Beta chưa hỗ trợ định dạng đầu vào ${metadata.format || 'không xác định'}.`);
  }
  if (!(metadata.width > 0 && metadata.height > 0)) throw new Error('Không đọc được kích thước ảnh đầu vào.');
  if (metadata.space === 'cmyk') throw new Error('CMYK đầu vào chưa được hỗ trợ vì pipeline Krea xử lý RGB và có nguy cơ lệch màu.');

  return {
    width: metadata.width,
    height: metadata.height,
    longEdge: Math.max(metadata.width, metadata.height),
    format: metadata.format,
    space: metadata.space || null,
    channels: metadata.channels || null,
    hasAlpha: Boolean(metadata.hasAlpha),
    density: metadata.density || null,
    sizeBytes: stat.size
  };
}

async function prepareUpload(inputPath, inputMetadata) {
  const directlySupported = new Set(['jpeg', 'png', 'webp', 'heif']);
  if (directlySupported.has(inputMetadata.format)) {
    return {
      buffer: await fs.readFile(inputPath),
      filename: path.basename(inputPath),
      normalized: false
    };
  }

  const buffer = await sharp(inputPath, { failOn: 'error' })
    .rotate()
    .toColourspace('srgb')
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('Bản RGB chuẩn hóa vượt giới hạn 75 MB của Krea.');
  return {
    buffer,
    filename: `${path.parse(inputPath).name}-krea-input.png`,
    normalized: true
  };
}

async function uploadAsset(apiKey, prepared) {
  const form = new FormData();
  form.append('file', new Blob([prepared.buffer]), prepared.filename);
  form.append('description', 'Print Upscale Studio Krea input');
  const response = await requestWithRetry(`${API_BASE}/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  }, { timeoutMs: 120000, maxServerRetries: 1 });
  const asset = await response.json();
  if (!asset?.image_url || !(asset.width > 0) || !(asset.height > 0)) {
    throw new Error('Krea upload không trả về URL và kích thước asset hợp lệ.');
  }
  return asset;
}

function resolveAutoPreset(options, inputMetadata) {
  if (options.protectText === true || options.protectLogo === true) {
    return { presetId: 'text-graphic', reason: 'Phát hiện yêu cầu bảo vệ chữ hoặc logo.' };
  }
  if (String(options.contentType || '') === 'cgi') {
    return { presetId: 'product-cgi', reason: 'Người dùng chọn nội dung Product / CGI.' };
  }
  if (String(options.regenerationMode || '') === 'creative') {
    return { presetId: 'creative-photo', reason: 'Người dùng chọn mức tái tạo Creative.' };
  }
  if (inputMetadata.longEdge < 1200) {
    return { presetId: 'low-resolution', reason: 'Cạnh dài nguồn dưới 1.200 px.' };
  }
  return { presetId: 'print-faithful', reason: 'Mặc định ưu tiên bảo toàn cho workflow in.' };
}

function resolvePreset(options, inputMetadata) {
  const requestedPresetId = normalizePresetId(options.presetId || options.modelId);
  if (requestedPresetId !== 'auto') {
    return { requestedPresetId, presetId: requestedPresetId, reason: 'Preset do người dùng chọn.' };
  }
  const automatic = resolveAutoPreset(options, inputMetadata);
  return { requestedPresetId, ...automatic };
}

function resolveSizing(family, asset, options = {}) {
  const sourceWidth = Number(asset.width);
  const sourceHeight = Number(asset.height);
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  const requestedLongEdge = Number(options.targetLongEdge);
  const requestedScale = Number.isFinite(requestedLongEdge) && requestedLongEdge > 0
    ? requestedLongEdge / sourceLongEdge
    : clamp(options.scale, 1, family.maxScale, 2);
  const scale = Math.min(
    Math.max(1, requestedScale),
    family.maxScale,
    family.maxDimension / sourceLongEdge
  );
  return {
    scale,
    requestedScale,
    sourceWidth,
    sourceHeight,
    sourceLongEdge,
    requestedLongEdge: Number.isFinite(requestedLongEdge) ? requestedLongEdge : null,
    outputWidth: Math.max(1, Math.round(sourceWidth * scale)),
    outputHeight: Math.max(1, Math.round(sourceHeight * scale)),
    limited: scale + 0.0001 < requestedScale
  };
}

function promptValue(options) {
  return String(options.prompt || '').trim().slice(0, 1024);
}

function buildTopazStandardPayload(preset, asset, sizing, options) {
  const defaults = {
    'print-faithful': { sharpen: 0.35, denoise: 0.2, fixCompression: 0.2, strength: 0.3 },
    'text-graphic': { sharpen: 0.25, denoise: 0.15, fixCompression: 0.25, strength: 0.25 },
    'low-resolution': { sharpen: 0.45, denoise: 0.55, fixCompression: 0.65, strength: 0.55 },
    'product-cgi': { sharpen: 0.45, denoise: 0.2, fixCompression: 0.15, strength: 0.35 },
    'photo-standard': { sharpen: 0.4, denoise: 0.35, fixCompression: 0.35, strength: 0.45 }
  }[preset.id] || { sharpen: 0.35, denoise: 0.25, fixCompression: 0.25, strength: 0.35 };

  return compactObject({
    width: Math.round(asset.width),
    height: Math.round(asset.height),
    image_url: asset.image_url,
    model: preset.model,
    prompt: promptValue(options),
    output_format: 'png',
    subject_detection: 'All',
    face_enhancement: Boolean(options.protectFace),
    face_enhancement_creativity: options.protectFace ? 0.1 : undefined,
    face_enhancement_strength: options.protectFace ? 0.35 : undefined,
    crop_to_fill: false,
    upscaling_activated: sizing.scale > 1,
    image_scaling_factor: sizing.scale,
    sharpen: clamp(options.sharpen, 0, 1, defaults.sharpen),
    denoise: clamp(options.denoise, 0, 1, defaults.denoise),
    fix_compression: clamp(options.fixCompression, 0, 1, defaults.fixCompression),
    strength: clamp(options.strength, 0.01, 1, defaults.strength)
  });
}

function buildTopazGenerativePayload(preset, asset, sizing, options) {
  const defaults = preset.id === 'detail-photo'
    ? { creativity: 1, texture: 2, sharpen: 0.45, denoise: 0.35, detail: 0.6 }
    : { creativity: 1, texture: 1, sharpen: 0.4, denoise: 0.5, detail: 0.5 };
  return compactObject({
    width: Math.round(asset.width),
    height: Math.round(asset.height),
    image_url: asset.image_url,
    prompt: promptValue(options),
    seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : undefined,
    model: preset.model,
    output_format: 'png',
    subject_detection: 'All',
    face_enhancement: Boolean(options.protectFace),
    face_enhancement_creativity: options.protectFace ? 0.1 : undefined,
    face_enhancement_strength: options.protectFace ? 0.35 : undefined,
    crop_to_fill: false,
    upscaling_activated: sizing.scale > 1,
    image_scaling_factor: sizing.scale,
    creativity: Math.round(clamp(options.creativity, 1, 6, defaults.creativity)),
    texture: Math.round(clamp(options.texture, 1, 5, defaults.texture)),
    sharpen: clamp(options.sharpen, 0, 1, defaults.sharpen),
    denoise: clamp(options.denoise, 0, 1, defaults.denoise),
    detail: clamp(options.detail, 0, 1, defaults.detail)
  });
}

function buildKreaEnhancePayload(asset, sizing, options) {
  return compactObject({
    image_url: asset.image_url,
    prompt: promptValue(options),
    image_scaling_factor: sizing.scale,
    rescale_color: options.preserveColor !== false,
    seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : undefined,
    ai_strength: clamp(options.aiStrength, 0.1, 1, 0.2),
    clarity_strength: clamp(options.clarity, 1, 12, 3),
    resemblance_strength: clamp(options.resemblance, 0, 2.5, 2.25),
    sharpness: clamp(options.sharpness, 0.1, 1.5, 0.45)
  });
}

function buildTopazBloomPayload(asset, sizing, options) {
  return compactObject({
    width: Math.round(asset.width),
    height: Math.round(asset.height),
    image_url: asset.image_url,
    prompt: promptValue(options),
    seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : undefined,
    output_format: 'png',
    crop_to_fill: false,
    creativity: Math.round(clamp(options.creativity, 1, 9, 3)),
    face_preservation: Boolean(options.protectFace),
    color_preservation: options.preserveColor !== false,
    upscaling_activated: sizing.scale > 1,
    image_scaling_factor: sizing.scale
  });
}

function buildPayload(presetId, asset, sizing, options = {}) {
  const preset = { id: presetId, ...KREA_PRESETS[presetId] };
  if (preset.family === 'topaz-standard') return buildTopazStandardPayload(preset, asset, sizing, options);
  if (preset.family === 'topaz-generative') return buildTopazGenerativePayload(preset, asset, sizing, options);
  if (preset.family === 'krea-enhance') return buildKreaEnhancePayload(asset, sizing, options);
  if (preset.family === 'topaz-bloom') return buildTopazBloomPayload(asset, sizing, options);
  throw new Error('Preset Krea chưa có payload builder.');
}

async function submit(apiKey, presetId, asset, sizing, options) {
  const preset = KREA_PRESETS[presetId];
  const family = familyFor(preset);
  const payload = buildPayload(presetId, asset, sizing, options);
  const response = await requestWithRetry(`${API_BASE}${family.endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, { timeoutMs: 60000, maxServerRetries: 1 });
  const data = await response.json();
  if (!data?.job_id) throw new Error('Krea không trả về job_id hợp lệ.');
  return { jobId: data.job_id, initialStatus: data.status || 'queued' };
}

function progressMessage(status) {
  const messages = {
    backlogged: 'Krea đã đưa job vào hàng chờ...',
    queued: 'Krea đã xếp hàng xử lý...',
    scheduled: 'Krea đang lên lịch xử lý...',
    processing: 'Krea đang xử lý ảnh...',
    sampling: 'Krea đang tái tạo chi tiết...',
    'intermediate-complete': 'Krea đang hoàn thiện kết quả...'
  };
  return messages[status] || 'Krea đang xử lý ảnh...';
}

function jobFailureMessage(job) {
  const detail = job?.error?.message || job?.error?.code || job?.failure_reason || job?.message || 'Không có chi tiết.';
  return `Krea không hoàn tất job: ${String(detail).slice(0, 500)}`;
}

async function waitForJob(apiKey, jobId, onProgress, timeoutMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await requestWithRetry(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    }, { timeoutMs: 30000, maxServerRetries: 1 });
    const job = await response.json();
    const status = job.status || 'processing';
    onProgress?.({ status, jobId, message: progressMessage(status) });
    if (TERMINAL_STATUSES.has(status)) {
      if (status !== 'completed') throw new Error(jobFailureMessage(job));
      const outputUrl = job?.result?.urls?.[0] || job?.result?.url || job?.output_url;
      if (!outputUrl) throw new Error('Krea hoàn tất nhưng không trả về URL kết quả.');
      return { outputUrl, status };
    }
    await sleep(2500);
  }
  throw new Error('Krea job đã quá thời gian chờ 10 phút.');
}

function validateOutputUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Krea trả về URL kết quả không hợp lệ.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Krea trả về URL kết quả không an toàn.');
  return url.toString();
}

async function downloadResult(outputUrl) {
  const response = await requestWithRetry(validateOutputUrl(outputUrl), {}, { timeoutMs: 120000, maxServerRetries: 1 });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error('File Krea trả về quá nhỏ hoặc không hợp lệ.');
  return buffer;
}

async function exportResult(buffer, outputPath, options, expected) {
  const format = normalizeOutputFormat(options.outputFormat);
  const dpi = clamp(options.dpi, 72, 1200, 300);
  const sourceMetadata = await sharp(buffer, { failOn: 'error' }).metadata();
  if (!(sourceMetadata.width > 0 && sourceMetadata.height > 0)) throw new Error('Không đọc được kích thước ảnh Krea trả về.');

  const expectedRatio = expected.outputWidth / expected.outputHeight;
  const actualRatio = sourceMetadata.width / sourceMetadata.height;
  const aspectDrift = Math.abs(actualRatio - expectedRatio) / expectedRatio;
  if (aspectDrift > 0.005) {
    throw new Error(`Krea trả về sai tỷ lệ khung hình: nhận ${sourceMetadata.width} × ${sourceMetadata.height}px, dự kiến ${expected.outputWidth} × ${expected.outputHeight}px.`);
  }

  let pipeline = sharp(buffer, { failOn: 'error' })
    .resize(expected.outputWidth, expected.outputHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('srgb')
    .withMetadata({ density: dpi });

  if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 96, chromaSubsampling: '4:4:4', mozjpeg: true });
  else if (format === 'tiff') pipeline = pipeline.tiff({ compression: 'lzw', bitdepth: 8 });
  else if (format === 'webp') pipeline = pipeline.webp({ lossless: true, quality: 100 });
  else pipeline = pipeline.png({ compressionLevel: 6, adaptiveFiltering: true });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await pipeline.toFile(outputPath);

  const metadata = await sharp(outputPath, { failOn: 'error' }).metadata();
  const stat = await fs.stat(outputPath);
  const geometryPassed = metadata.width === expected.outputWidth && metadata.height === expected.outputHeight;
  if (!geometryPassed) {
    await fs.rm(outputPath, { force: true });
    throw new Error(`Hậu kiểm kích thước thất bại: nhận ${metadata.width} × ${metadata.height}px, cần ${expected.outputWidth} × ${expected.outputHeight}px.`);
  }

  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    density: metadata.density || dpi,
    space: metadata.space || 'srgb',
    sizeBytes: stat.size,
    geometryPassed: true,
    sourceWidth: sourceMetadata.width,
    sourceHeight: sourceMetadata.height,
    normalizedToExactGeometry: sourceMetadata.width !== expected.outputWidth || sourceMetadata.height !== expected.outputHeight
  };
}

async function enhance({ secureSecretsService, inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu đường dẫn đầu vào hoặc đầu ra Krea.');
  const apiKey = await requireApiKey(secureSecretsService);
  const input = await inspectInput(inputPath);
  const route = resolvePreset(options, input);
  const preset = KREA_PRESETS[route.presetId];
  const family = familyFor(preset);
  const prepared = await prepareUpload(inputPath, input);

  onProgress?.({ status: 'uploading', message: 'Đang tải bản RGB làm việc lên Krea...' });
  const asset = await uploadAsset(apiKey, prepared);
  const sizing = resolveSizing(family, asset, options);

  onProgress?.({
    status: 'preparing',
    message: `Đã chọn ${preset.label}. ${route.reason}`,
    presetId: route.presetId,
    sizing
  });
  const submitted = await submit(apiKey, route.presetId, asset, sizing, options);
  onProgress?.({ status: submitted.initialStatus, jobId: submitted.jobId, message: progressMessage(submitted.initialStatus) });
  const completed = await waitForJob(apiKey, submitted.jobId, onProgress);

  onProgress?.({ status: 'exporting', message: 'Đang chuẩn hóa kích thước và hậu kiểm RGB Master...' });
  const buffer = await downloadResult(completed.outputUrl);
  const output = await exportResult(buffer, outputPath, options, sizing);

  const warnings = [];
  if (preset.risk === 'generative') warnings.push('Preset generative có thể tái tạo chi tiết không có trong nguồn.');
  if (preset.risk === 'creative') warnings.push('Preset creative không phù hợp với chữ, logo hoặc artwork approved.');
  if (input.hasAlpha) warnings.push('Krea có thể không giữ nguyên transparency của ảnh nguồn.');
  if (sizing.limited) warnings.push('Kích thước yêu cầu đã được giới hạn theo mức tối đa của model.');

  return {
    outputPath,
    jobId: submitted.jobId,
    requestedPresetId: route.requestedPresetId,
    presetId: route.presetId,
    presetLabel: preset.label,
    familyId: preset.family,
    model: preset.model || family.label,
    routeReason: route.reason,
    sizing,
    input,
    output,
    warnings,
    beta: true
  };
}

module.exports = {
  API_BASE,
  SECRET_NAME,
  KREA_PRESETS,
  MODEL_FAMILIES,
  buildKreaEnhancePayload,
  buildPayload,
  buildTopazBloomPayload,
  buildTopazGenerativePayload,
  buildTopazStandardPayload,
  clearApiKey,
  enhance,
  exportResult,
  getStatus,
  inspectInput,
  normalizePresetId,
  resolvePreset,
  resolveSizing,
  saveApiKey,
  testConnection
};
