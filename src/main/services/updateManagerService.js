'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const crypto = require('node:crypto');

const OWNER = 'hehe84vn';
const REPOSITORY = 'Min_print-upscale-studio';
const RELEASES_URL = `https://github.com/${OWNER}/${REPOSITORY}/releases`;
const API_URL = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`;

function normalizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
    .slice(0, 4);
}

function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function requestJson(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Print-Upscale-Studio-Update-Manager',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        if (response.statusCode === 404) return resolve(null);
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(`GitHub Releases trả về HTTP ${response.statusCode || 'unknown'}.`));
        }
        try { return resolve(JSON.parse(raw)); }
        catch { return reject(new Error('Không đọc được dữ liệu cập nhật từ GitHub Releases.')); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Kiểm tra cập nhật quá thời gian.')));
    request.on('error', reject);
  });
}

function assetForPlatform(release, platform, arch) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const names = assets.map((asset) => ({ ...asset, lower: String(asset.name || '').toLowerCase() }));
  if (platform === 'win32') {
    return names.find((asset) => asset.lower.endsWith('.exe') && !asset.lower.includes('portable'))
      || names.find((asset) => asset.lower.endsWith('.exe'))
      || null;
  }
  if (platform === 'darwin') {
    const archToken = arch === 'arm64' ? 'arm64' : 'x64';
    return names.find((asset) => asset.lower.endsWith('.dmg') && asset.lower.includes(archToken))
      || names.find((asset) => asset.lower.endsWith('.dmg'))
      || null;
  }
  return null;
}

function safeAssetName(value) {
  const name = path.basename(String(value || 'Print-Upscale-Studio-Update.exe'));
  return name.replace(/[^a-zA-Z0-9._ -]+/g, '-').slice(0, 180);
}

function expectedSha256(asset) {
  const digest = String(asset?.digest || '').trim();
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest);
  return match ? match[1].toLowerCase() : null;
}

function downloadResponse(url, options, redirects = 0) {
  if (redirects > 6) return Promise.reject(new Error('GitHub chuyển hướng tải xuống quá nhiều lần.'));
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'Print-Upscale-Studio-Update-Manager'
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        downloadResponse(next, options, redirects + 1).then(resolve, reject);
        return;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Không tải được bộ cài: HTTP ${response.statusCode || 'unknown'}.`));
        return;
      }
      resolve(response);
    });
    request.setTimeout(options.timeoutMs || 30000, () => request.destroy(new Error('Tải bộ cài quá thời gian.')));
    request.on('error', reject);
  });
}

async function downloadAsset({ asset, destinationDirectory, onProgress, timeoutMs = 30000 }) {
  if (!asset?.downloadUrl || !/^https:\/\//i.test(asset.downloadUrl)) throw new Error('Release không có đường dẫn tải hợp lệ.');
  await fsp.mkdir(destinationDirectory, { recursive: true });
  const finalPath = path.join(destinationDirectory, safeAssetName(asset.name));
  const partialPath = `${finalPath}.partial`;
  await fsp.rm(partialPath, { force: true });

  const response = await downloadResponse(asset.downloadUrl, { timeoutMs });
  const total = Number(response.headers['content-length']) || Number(asset.size) || 0;
  const hash = crypto.createHash('sha256');
  let received = 0;
  const output = fs.createWriteStream(partialPath, { flags: 'wx' });

  try {
    await new Promise((resolve, reject) => {
      response.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        onProgress?.({ received, total, percent: total ? Math.min(99, Math.round(received / total * 100)) : null });
      });
      response.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      response.pipe(output);
    });

    const actualSha256 = hash.digest('hex');
    const expected = expectedSha256(asset);
    if (expected && expected !== actualSha256) throw new Error('Checksum SHA-256 của bộ cài không khớp. Đã hủy cập nhật.');
    await fsp.rm(finalPath, { force: true });
    await fsp.rename(partialPath, finalPath);
    onProgress?.({ received, total, percent: 100 });
    return { filePath: finalPath, size: received, sha256: actualSha256, verified: Boolean(expected) };
  } catch (error) {
    output.destroy();
    await fsp.rm(partialPath, { force: true });
    throw error;
  }
}

async function checkForUpdates({ currentVersion, platform = process.platform, arch = process.arch } = {}) {
  const release = await requestJson(API_URL);
  if (!release || release.draft || release.prerelease) {
    return {
      checked: true,
      updateAvailable: false,
      currentVersion,
      latestVersion: null,
      releasesUrl: RELEASES_URL,
      reason: 'Chưa có bản phát hành ổn định trên GitHub Releases.'
    };
  }

  const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
  const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
  const asset = assetForPlatform(release, platform, arch);
  return {
    checked: true,
    updateAvailable,
    currentVersion,
    latestVersion,
    title: release.name || `Version ${latestVersion}`,
    notes: String(release.body || '').slice(0, 12000),
    publishedAt: release.published_at || null,
    releaseUrl: release.html_url || RELEASES_URL,
    releasesUrl: RELEASES_URL,
    asset: asset ? {
      name: asset.name,
      size: asset.size,
      digest: asset.digest || null,
      downloadUrl: asset.browser_download_url
    } : null,
    platform,
    arch
  };
}

module.exports = {
  API_URL,
  RELEASES_URL,
  normalizeVersion,
  compareVersions,
  assetForPlatform,
  safeAssetName,
  expectedSha256,
  downloadAsset,
  checkForUpdates
};