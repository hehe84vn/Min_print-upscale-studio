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

async function readCmykMetadata(filePath) {
  const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
  return {
    ...metadata,
    valid: metadata.space === 'cmyk' && Number(metadata.channels) >= 4
  };
}

function createCmykPipeline(inputPath, profilePath, attachProfile, dpi, compression, strategy) {
  let pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .pipelineColourspace('rgb16');

  if (strategy === 'explicit-cmyk-first') {
    pipeline = pipeline
      .toColourspace('cmyk')
      .withIccProfile(profilePath, { attach: attachProfile });
  } else {
    // withIccProfile performs the RGB -> destination-profile transform.
    // Calling toColourspace after it can force Sharp back to a generic output space.
    pipeline = pipeline.withIccProfile(profilePath, { attach: attachProfile });
  }

  return pipeline
    .withMetadata({ density: Number(dpi) || 300 })
    .tiff({ compression, predictor: 'horizontal' });
}

async function writeVerifiedCmyk({ inputPath, targetPath, profile, settings, dpi }) {
  const temporaryPath = `${targetPath}.cmyk-${process.pid}-${Date.now()}.tif`;
  const attempts = ['profile-transform', 'explicit-cmyk-first'];
  const diagnostics = [];

  try {
    for (const strategy of attempts) {
      await fs.rm(temporaryPath, { force: true });
      try {
        await createCmykPipeline(
          inputPath,
          profile.path,
          settings.embedProfile,
          dpi,
          settings.compression,
          strategy
        ).toFile(temporaryPath);

        const metadata = await readCmykMetadata(temporaryPath);
        diagnostics.push({ strategy, space: metadata.space, channels: metadata.channels, hasProfile: metadata.hasProfile });
        if (!metadata.valid) continue;

        await fs.rm(targetPath, { force: true });
        await fs.rename(temporaryPath, targetPath);
        return { metadata, strategy };
      } catch (error) {
        diagnostics.push({ strategy, error: error.message || String(error) });
      }
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }

  throw new Error(`Chuyển CMYK không thành công sau 2 phương án ICC. Chi tiết: ${JSON.stringify(diagnostics)}`);
}

async function convertToCmyk({ inputPath, settings = {}, outputPath = null, dpi = 300 }) {
  if (!inputPath) throw new Error('Thiếu file RGB để chuyển CMYK.');
  const normalized = normalizeSettings(settings);
  const profile = await resolveProfile(normalized);
  const targetPath = outputPath || cmykOutputPath(inputPath, profile.id);
  const conversion = await writeVerifiedCmyk({
    inputPath,
    targetPath,
    profile,
    settings: normalized,
    dpi: Number(dpi) || 300
  });

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
    conversionStrategy: conversion.strategy,
    metadata: {
      width: conversion.metadata.width,
      height: conversion.metadata.height,
      channels: conversion.metadata.channels,
      space: conversion.metadata.space,
      format: conversion.metadata.format,
      density: conversion.metadata.density || dpi,
      hasProfile: Boolean(conversion.metadata.hasProfile)
    },
    note: 'ICC transform được thực hiện bằng libvips/Sharp và chỉ được chấp nhận khi TIFF đọc lại là CMYK từ 4 kênh trở lên. File vẫn cần designer kiểm tra TAC, separation, black, spot color, overprint và proof.'
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
  readCmykMetadata,
  resolveProfile,
  writeVerifiedCmyk
};
