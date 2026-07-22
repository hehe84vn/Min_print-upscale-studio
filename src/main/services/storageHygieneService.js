const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');

const TEMP_PREFIXES = [
  'local-enhance-',
  'vector-input-',
  'print-ai-enhance-',
  'print-upscale-benchmark-',
  'print-upscale-studio-',
  'print-upscale-protection-',
  'print-upscale-preflight-',
  'print-upscale-color-'
];

const DEFAULT_TEMP_RETENTION_HOURS = 24;

function isOwnedTempName(name) {
  return TEMP_PREFIXES.some((prefix) => String(name || '').startsWith(prefix));
}

async function pathSize(targetPath) {
  let entry;
  try {
    entry = await fs.lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  if (!entry.isDirectory() || entry.isSymbolicLink()) return entry.size || 0;
  let total = 0;
  for (const child of await fs.readdir(targetPath)) {
    total += await pathSize(path.join(targetPath, child));
  }
  return total;
}

async function listOwnedTemp({ tempRoot = os.tmpdir() } = {}) {
  let entries;
  try {
    entries = await fs.readdir(tempRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const result = [];
  for (const entry of entries) {
    if (!isOwnedTempName(entry.name)) continue;
    const targetPath = path.join(tempRoot, entry.name);
    try {
      const stats = await fs.lstat(targetPath);
      result.push({
        name: entry.name,
        path: targetPath,
        isDirectory: stats.isDirectory(),
        modifiedAt: stats.mtime.toISOString(),
        modifiedMs: stats.mtimeMs,
        sizeBytes: await pathSize(targetPath)
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return result.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

async function cleanupOwnedTemp({
  tempRoot = os.tmpdir(),
  olderThanHours = DEFAULT_TEMP_RETENTION_HOURS
} = {}) {
  const entries = await listOwnedTemp({ tempRoot });
  const safeHours = Math.max(0, Number(olderThanHours) || 0);
  const cutoff = Date.now() - safeHours * 60 * 60 * 1000;
  const removable = entries.filter((entry) => safeHours === 0 || entry.modifiedMs < cutoff);
  let removedBytes = 0;
  let removedCount = 0;
  const errors = [];

  for (const entry of removable) {
    try {
      await fs.rm(entry.path, { recursive: true, force: true });
      removedCount += 1;
      removedBytes += entry.sizeBytes;
    } catch (error) {
      errors.push({ path: entry.path, error: error.message || String(error) });
    }
  }

  return {
    removedCount,
    removedBytes,
    retainedCount: entries.length - removedCount,
    scannedCount: entries.length,
    olderThanHours: safeHours,
    errors
  };
}

function configureSharpCache() {
  sharp.cache({ memory: 128, files: 0, items: 100 });
  return sharp.cache();
}

async function getStorageStatus({ electronSession = null, tempRoot = os.tmpdir() } = {}) {
  const entries = await listOwnedTemp({ tempRoot });
  let chromiumCacheBytes = null;
  if (electronSession?.getCacheSize) {
    try { chromiumCacheBytes = await electronSession.getCacheSize(); } catch { chromiumCacheBytes = null; }
  }
  return {
    tempRoot,
    tempCount: entries.length,
    tempBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    chromiumCacheBytes,
    sharpCache: sharp.cache(),
    retentionHours: DEFAULT_TEMP_RETENTION_HOURS,
    entries: entries.slice(0, 20)
  };
}

async function clearAppCache({ electronSession = null, tempRoot = os.tmpdir() } = {}) {
  const temp = await cleanupOwnedTemp({ tempRoot, olderThanHours: 0 });
  let chromiumCacheCleared = false;
  let codeCacheCleared = false;

  if (electronSession?.clearCache) {
    await electronSession.clearCache();
    chromiumCacheCleared = true;
  }
  if (electronSession?.clearCodeCaches) {
    await electronSession.clearCodeCaches({});
    codeCacheCleared = true;
  }
  sharp.cache(false);
  configureSharpCache();

  return {
    temp,
    chromiumCacheCleared,
    codeCacheCleared,
    sharpCache: sharp.cache()
  };
}

module.exports = {
  DEFAULT_TEMP_RETENTION_HOURS,
  TEMP_PREFIXES,
  cleanupOwnedTemp,
  clearAppCache,
  configureSharpCache,
  getStorageStatus,
  isOwnedTempName,
  listOwnedTemp,
  pathSize
};
