const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const DEFAULT_COLOR_SETTINGS = {
  outputMode: 'rgb-cmyk',
  profileId: 'iso-coated-v2',
  customProfilePath: null,
  renderingIntent: 'relative',
  blackPointCompensation: true,
  compression: 'lzw',
  bitDepth: 8,
  embedProfile: true
};

const PROFILE_LABELS = {
  'iso-coated-v2': 'ISO Coated v2 (ECI)',
  'pso-coated-v3': 'PSO Coated v3 (FOGRA51)',
  'pso-uncoated-v3': 'PSO Uncoated v3 (FOGRA52)',
  custom: 'Custom ICC profile'
};

function profileCandidates() {
  const directories = [];
  if (process.resourcesPath) directories.push(path.join(process.resourcesPath, 'color-profiles'));
  directories.push(path.resolve(__dirname, '..', '..', '..', 'vendor', 'color-profiles'));
  return directories;
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function resolveProfile(settings = {}) {
  const merged = { ...DEFAULT_COLOR_SETTINGS, ...settings };
  if (merged.profileId === 'custom') {
    if (!merged.customProfilePath || !(await exists(merged.customProfilePath))) {
      throw new Error('Custom ICC profile không tồn tại hoặc chưa được chọn.');
    }
    return {
      id: 'custom',
      label: path.basename(merged.customProfilePath),
      path: merged.customProfilePath,
      source: 'custom'
    };
  }

  const filename = `${merged.profileId}.icc`;
  for (const directory of profileCandidates()) {
    const candidate = path.join(directory, filename);
    if (await exists(candidate)) {
      return {
        id: merged.profileId,
        label: PROFILE_LABELS[merged.profileId] || merged.profileId,
        path: candidate,
        source: 'bundled'
      };
    }
  }
  throw new Error(`Không tìm thấy ICC profile ${PROFILE_LABELS[merged.profileId] || merged.profileId} trong bộ cài.`);
}

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_COLOR_SETTINGS, ...settings };
  return {
    outputMode: ['rgb-only', 'rgb-cmyk', 'cmyk-only'].includes(merged.outputMode) ? merged.outputMode : DEFAULT_COLOR_SETTINGS.outputMode,
    profileId: Object.hasOwn(PROFILE_LABELS, merged.profileId) ? merged.profileId : DEFAULT_COLOR_SETTINGS.profileId,
    customProfilePath: typeof merged.customProfilePath === 'string' && merged.customProfilePath ? merged.customProfilePath : null,
    renderingIntent: ['relative', 'perceptual'].includes(merged.renderingIntent) ? merged.renderingIntent : 'relative',
    blackPointCompensation: merged.blackPointCompensation !== false,
    compression: ['lzw', 'deflate'].includes(merged.compression) ? merged.compression : 'lzw',
    bitDepth: 8,
    embedProfile: merged.embedProfile !== false
  };
}

function cmykOutputPath(rgbPath, profileId) {
  const parsed = path.parse(rgbPath);
  const suffix = profileId === 'custom' ? 'custom' : profileId;
  return path.join(parsed.dir, `${parsed.name}-CMYK-${suffix}.tif`);
}

async function convertToCmyk({ inputPath, settings = {}, outputPath = null, dpi = 300 }) {
  if (!inputPath) throw new Error('Thiếu file RGB để chuyển CMYK.');
  const normalized = normalizeSettings(settings);
  const profile = await resolveProfile(normalized);
  const targetPath = outputPath || cmykOutputPath(inputPath, profile.id);

  const result = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .withIccProfile(profile.path, { attach: normalized.embedProfile })
    .toColourspace('cmyk')
    .withMetadata({ density: Number(dpi) || 300 })
    .tiff({ compression: normalized.compression, predictor: 'horizontal' })
    .toFile(targetPath);

  const metadata = await sharp(targetPath, { failOn: 'none' }).metadata();
  if (metadata.space !== 'cmyk' || metadata.channels < 4) {
    await fs.rm(targetPath, { force: true });
    throw new Error('Chuyển CMYK không thành công: file kết quả không có 4 kênh CMYK.');
  }

  let rgbMasterRemoved = false;
  if (normalized.outputMode === 'cmyk-only' && path.resolve(inputPath) !== path.resolve(targetPath)) {
    await fs.rm(inputPath, { force: true });
    rgbMasterRemoved = true;
  }

  return {
    outputPath: targetPath,
    rgbMasterRemoved,
    profile,
    settings: normalized,
    metadata: {
      width: result.width,
      height: result.height,
      channels: metadata.channels,
      space: metadata.space,
      format: metadata.format,
      density: metadata.density || dpi,
      hasProfile: Boolean(metadata.hasProfile)
    },
    note: 'ICC transform được thực hiện bằng libvips/Sharp. File vẫn cần designer kiểm tra TAC, separation, black, spot color, overprint và proof.'
  };
}

async function getSettingsSummary(settingsService) {
  const saved = await settingsService.read();
  const settings = normalizeSettings(saved.colorOutput || {});
  let profileStatus;
  try {
    const profile = await resolveProfile(settings);
    profileStatus = { available: true, ...profile };
  } catch (error) {
    profileStatus = { available: false, id: settings.profileId, label: PROFILE_LABELS[settings.profileId], error: error.message };
  }
  return { settings, profiles: PROFILE_LABELS, profileStatus };
}

module.exports = {
  DEFAULT_COLOR_SETTINGS,
  PROFILE_LABELS,
  cmykOutputPath,
  convertToCmyk,
  getSettingsSummary,
  normalizeSettings,
  resolveProfile
};
