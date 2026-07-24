'use strict';

const https = require('node:https');

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
        if (response.statusCode === 404) {
          resolve(null);
          return;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub Releases trả về HTTP ${response.statusCode || 'unknown'}.`));
          return;
        }
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Không đọc được dữ liệu cập nhật từ GitHub Releases.')); }
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
  checkForUpdates
};
