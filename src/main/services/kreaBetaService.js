'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE = 'https://api.krea.ai';
const SECRET_NAME = 'kreaBetaApiKey';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled']);
const SUPPORTED_MODES = new Set(['standard', 'generative', 'bloom']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readError(response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message || payload?.message || text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
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

function normalizeMode(value) {
  return SUPPORTED_MODES.has(value) ? value : 'standard';
}

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim();
  if (!endpoint) throw new Error('Chưa cấu hình endpoint enhancer Krea cho bản beta.');
  if (!endpoint.startsWith('/')) throw new Error('Endpoint Krea phải bắt đầu bằng dấu /.');
  if (endpoint.includes('..')) throw new Error('Endpoint Krea không hợp lệ.');
  return endpoint;
}

async function requireApiKey(secureSecretsService) {
  const apiKey = await secureSecretsService.get(SECRET_NAME);
  if (!apiKey) throw new Error('Chưa có API token Krea Beta. Mở Cài đặt beta để nhập token.');
  return apiKey;
}

async function getStatus(secureSecretsService) {
  try {
    const secret = await secureSecretsService.status(SECRET_NAME);
    return {
      enabled: false,
      beta: true,
      configured: secret.configured,
      suffix: secret.suffix,
      apiBase: API_BASE,
      secureStorageAvailable: true,
      supportedModes: [...SUPPORTED_MODES]
    };
  } catch (error) {
    return {
      enabled: false,
      beta: true,
      configured: false,
      suffix: null,
      apiBase: API_BASE,
      secureStorageAvailable: false,
      supportedModes: [...SUPPORTED_MODES],
      error: error.message
    };
  }
}

async function saveApiKey(secureSecretsService, apiKey) {
  const normalized = String(apiKey || '').trim();
  if (!normalized) throw new Error('API token Krea không được để trống.');
  await secureSecretsService.set(SECRET_NAME, normalized);
  return getStatus(secureSecretsService);
}

async function clearApiKey(secureSecretsService) {
  await secureSecretsService.remove(SECRET_NAME);
  return getStatus(secureSecretsService);
}

async function testConnection(secureSecretsService) {
  const apiKey = await requireApiKey(secureSecretsService);
  const probeId = '00000000-0000-0000-0000-000000000000';
  const response = await fetchWithTimeout(`${API_BASE}/jobs/${probeId}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 20000);

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Krea API: ${await readError(response)}`);
  }

  // A missing probe job normally returns 404; that still proves the token passed the auth layer.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Krea API: ${await readError(response)}`);
  }

  return { ok: true, provider: 'krea', beta: true };
}

async function submitEnhancement({ apiKey, endpoint, inputPath, mode, scale, prompt }) {
  const image = await fs.readFile(inputPath);
  const form = new FormData();
  form.append('image', new Blob([image]), path.basename(inputPath));
  form.append('mode', normalizeMode(mode));
  form.append('scale', String([2, 4].includes(Number(scale)) ? Number(scale) : 2));
  if (String(prompt || '').trim()) form.append('prompt', String(prompt).trim().slice(0, 2000));

  const response = await fetchWithTimeout(`${API_BASE}${normalizeEndpoint(endpoint)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  }, 60000);

  if (!response.ok) throw new Error(`Krea API: ${await readError(response)}`);
  const payload = await response.json();
  if (!payload?.job_id) throw new Error('Krea không trả về job_id.');
  return payload;
}

async function waitForJob({ apiKey, jobId, onProgress, timeoutMs = 300000 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetchWithTimeout(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    }, 30000);
    if (!response.ok) throw new Error(`Krea API: ${await readError(response)}`);

    const job = await response.json();
    onProgress?.({ status: job.status || 'processing', jobId });
    if (TERMINAL_STATUSES.has(job.status)) {
      if (job.status !== 'completed') throw new Error(`Krea job kết thúc với trạng thái ${job.status}.`);
      const outputUrl = job?.result?.urls?.[0];
      if (!outputUrl) throw new Error('Krea hoàn tất nhưng không trả về URL kết quả.');
      return { job, outputUrl };
    }
    await sleep(2500);
  }
  throw new Error('Krea job đã quá thời gian chờ 5 phút.');
}

async function downloadResult(outputUrl, outputPath) {
  const response = await fetchWithTimeout(outputUrl, {}, 120000);
  if (!response.ok) throw new Error(`Không tải được kết quả Krea: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

async function enhance({ secureSecretsService, inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu đường dẫn ảnh đầu vào hoặc đầu ra Krea Beta.');
  const apiKey = await requireApiKey(secureSecretsService);
  const submitted = await submitEnhancement({
    apiKey,
    endpoint: options.endpoint,
    inputPath,
    mode: options.mode,
    scale: options.scale,
    prompt: options.prompt
  });
  onProgress?.({ status: submitted.status || 'queued', jobId: submitted.job_id });
  const completed = await waitForJob({ apiKey, jobId: submitted.job_id, onProgress });
  await downloadResult(completed.outputUrl, outputPath);
  return {
    outputPath,
    outputUrl: completed.outputUrl,
    jobId: submitted.job_id,
    mode: normalizeMode(options.mode),
    beta: true
  };
}

module.exports = {
  API_BASE,
  SECRET_NAME,
  clearApiKey,
  enhance,
  getStatus,
  normalizeMode,
  saveApiKey,
  testConnection
};
