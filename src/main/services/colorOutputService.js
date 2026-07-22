const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
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

const TIFF_TAGS = {
  PHOTOMETRIC_INTERPRETATION: 262,
  SAMPLES_PER_PIXEL: 277,
  INK_SET: 332,
  EXTRA_SAMPLES: 338,
  ICC_PROFILE: 34675
};

const TIFF_TYPE_SIZES = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8
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

function parseIccHeader(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 128) {
    return { valid: false, error: 'ICC profile nhỏ hơn 128 byte.' };
  }
  const declaredSize = buffer.readUInt32BE(0);
  const signature = buffer.toString('ascii', 36, 40);
  const colorSpace = buffer.toString('ascii', 16, 20);
  const profileClass = buffer.toString('ascii', 12, 16);
  const pcs = buffer.toString('ascii', 20, 24);
  const majorVersion = buffer[8];
  const minorVersion = (buffer[9] >> 4) & 0x0f;
  return {
    valid: signature === 'acsp' && declaredSize >= 128,
    declaredSize,
    signature,
    colorSpace,
    profileClass,
    pcs,
    version: `${majorVersion}.${minorVersion}`,
    isCmyk: signature === 'acsp' && colorSpace === 'CMYK'
  };
}

async function inspectIccProfile(filePath) {
  const file = await fs.open(filePath, 'r');
  try {
    const stat = await file.stat();
    const length = Math.min(Math.max(128, stat.size), 4096);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    const header = parseIccHeader(buffer.subarray(0, bytesRead));
    return { ...header, fileSize: stat.size };
  } finally {
    await file.close();
  }
}

async function resolveProfile(settings = {}) {
  const merged = { ...DEFAULT_COLOR_SETTINGS, ...settings };
  let profile;
  if (merged.profileId === 'custom') {
    if (!merged.customProfilePath || !(await exists(merged.customProfilePath))) {
      throw new Error('Custom ICC profile không tồn tại hoặc chưa được chọn.');
    }
    profile = {
      id: 'custom',
      label: path.basename(merged.customProfilePath),
      path: merged.customProfilePath,
      source: 'custom'
    };
  } else {
    const filename = `${merged.profileId}.icc`;
    for (const directory of profileCandidates()) {
      const candidate = path.join(directory, filename);
      if (await exists(candidate)) {
        profile = {
          id: merged.profileId,
          label: PROFILE_LABELS[merged.profileId] || merged.profileId,
          path: candidate,
          source: 'bundled'
        };
        break;
      }
    }
    if (!profile) {
      throw new Error(`Không tìm thấy ICC profile ${PROFILE_LABELS[merged.profileId] || merged.profileId} trong bộ cài.`);
    }
  }

  const profileInfo = await inspectIccProfile(profile.path);
  if (!profileInfo.valid || !profileInfo.isCmyk) {
    throw new Error(`ICC profile ${profile.label} không phải output profile CMYK hợp lệ (space=${profileInfo.colorSpace || 'unknown'}, signature=${profileInfo.signature || 'unknown'}).`);
  }
  return { ...profile, profileInfo };
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

function readUnsigned(buffer, offset, bytes, littleEndian) {
  if (bytes === 2) return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  if (bytes === 4) return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (bytes === 8) {
    const value = littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TIFF offset vượt giới hạn an toàn.');
    return Number(value);
  }
  throw new Error(`Unsupported unsigned integer size: ${bytes}`);
}

function readInlineScalar(buffer, offset, type, littleEndian) {
  if (type === 1 || type === 6 || type === 7) return buffer[offset];
  if (type === 3) return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  if (type === 4) return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  if (type === 8) return littleEndian ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset);
  if (type === 9) return littleEndian ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
  return null;
}

async function readAt(file, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error('TIFF bị thiếu dữ liệu hoặc offset không hợp lệ.');
  return buffer;
}

async function inspectTiffStructure(filePath) {
  const file = await fs.open(filePath, 'r');
  try {
    const stat = await file.stat();
    const header = await readAt(file, 0, 16);
    const marker = header.toString('ascii', 0, 2);
    const littleEndian = marker === 'II';
    if (!littleEndian && marker !== 'MM') throw new Error('File không có byte-order TIFF hợp lệ.');
    const magic = readUnsigned(header, 2, 2, littleEndian);
    const isBigTiff = magic === 43;
    if (magic !== 42 && !isBigTiff) throw new Error(`Magic TIFF không hợp lệ: ${magic}`);

    let ifdOffset;
    let countBytes;
    let entryBytes;
    let inlineBytes;
    if (isBigTiff) {
      const offsetSize = readUnsigned(header, 4, 2, littleEndian);
      if (offsetSize !== 8) throw new Error(`BigTIFF offset size không được hỗ trợ: ${offsetSize}`);
      ifdOffset = readUnsigned(header, 8, 8, littleEndian);
      countBytes = 8;
      entryBytes = 20;
      inlineBytes = 8;
    } else {
      ifdOffset = readUnsigned(header, 4, 4, littleEndian);
      countBytes = 2;
      entryBytes = 12;
      inlineBytes = 4;
    }

    if (ifdOffset <= 0 || ifdOffset >= stat.size) throw new Error('TIFF IFD offset không hợp lệ.');
    const countBuffer = await readAt(file, ifdOffset, countBytes);
    const entryCount = readUnsigned(countBuffer, 0, countBytes, littleEndian);
    if (!Number.isFinite(entryCount) || entryCount < 1 || entryCount > 8192) {
      throw new Error(`Số TIFF IFD entry bất thường: ${entryCount}`);
    }
    const entries = await readAt(file, ifdOffset + countBytes, entryCount * entryBytes);
    const tags = new Map();

    for (let index = 0; index < entryCount; index += 1) {
      const base = index * entryBytes;
      const tag = readUnsigned(entries, base, 2, littleEndian);
      const type = readUnsigned(entries, base + 2, 2, littleEndian);
      const count = readUnsigned(entries, base + 4, isBigTiff ? 8 : 4, littleEndian);
      const typeSize = TIFF_TYPE_SIZES[type];
      if (!typeSize || !Number.isFinite(count) || count < 0) continue;
      const byteLength = count * typeSize;
      const valueOffset = base + (isBigTiff ? 12 : 8);
      let data;
      if (byteLength <= inlineBytes) {
        data = entries.subarray(valueOffset, valueOffset + inlineBytes);
      } else {
        const externalOffset = readUnsigned(entries, valueOffset, inlineBytes, littleEndian);
        if (externalOffset < 0 || externalOffset + byteLength > stat.size || byteLength > 32 * 1024 * 1024) continue;
        data = await readAt(file, externalOffset, byteLength);
      }
      tags.set(tag, { tag, type, count, byteLength, data });
    }

    const scalar = (tag) => {
      const entry = tags.get(tag);
      if (!entry || !entry.data?.length) return null;
      return readInlineScalar(entry.data, 0, entry.type, littleEndian);
    };
    const arrayValues = (tag) => {
      const entry = tags.get(tag);
      if (!entry || !entry.data?.length) return [];
      const values = [];
      const step = TIFF_TYPE_SIZES[entry.type] || 1;
      for (let offset = 0; offset + step <= entry.data.length && values.length < entry.count; offset += step) {
        const value = readInlineScalar(entry.data, offset, entry.type, littleEndian);
        if (value === null) break;
        values.push(value);
      }
      return values;
    };

    const iccEntry = tags.get(TIFF_TAGS.ICC_PROFILE);
    const iccProfile = iccEntry?.data?.length ? parseIccHeader(iccEntry.data) : null;
    const photometricInterpretation = scalar(TIFF_TAGS.PHOTOMETRIC_INTERPRETATION);
    const samplesPerPixel = scalar(TIFF_TAGS.SAMPLES_PER_PIXEL);
    const inkSet = scalar(TIFF_TAGS.INK_SET);
    const extraSamples = arrayValues(TIFF_TAGS.EXTRA_SAMPLES);
    const separated = photometricInterpretation === 5;
    const cmykChannels = Number(samplesPerPixel) - extraSamples.length;
    const valid = separated
      && cmykChannels >= 4
      && Boolean(iccEntry?.data?.length)
      && Boolean(iccProfile?.isCmyk);

    return {
      valid,
      isBigTiff,
      littleEndian,
      photometricInterpretation,
      samplesPerPixel,
      cmykChannels,
      inkSet,
      extraSamples,
      hasIccTag: Boolean(iccEntry?.data?.length),
      iccProfile,
      fileSize: stat.size
    };
  } finally {
    await file.close();
  }
}

function runCommand(command, args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} vượt quá thời gian xử lý.`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`${path.basename(command)} exited ${code}: ${(stderr || stdout).trim()}`));
    });
  });
}

async function normalizeRgbForColorSync(inputPath, outputPath, dpi) {
  const inputMetadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .pipelineColourspace('rgb16')
    .withIccProfile('srgb', { attach: true })
    .withMetadata({ density: Number(dpi) || 300 })
    .tiff({ compression: 'lzw', predictor: 'horizontal' })
    .toFile(outputPath);
  return { inputHadAlpha: Boolean(inputMetadata.hasAlpha) };
}

async function convertWithColorSync({ inputPath, targetPath, profile, settings, dpi, workspace }) {
  const normalizedInput = path.join(workspace, 'rgb-source-colorsync.tif');
  const normalization = await normalizeRgbForColorSync(inputPath, normalizedInput, dpi);
  const intent = settings.renderingIntent === 'perceptual' ? 'perceptual' : 'relative';
  const result = await runCommand('/usr/bin/sips', [
    '--matchToWithIntent', profile.path, intent,
    '--setProperty', 'format', 'tiff',
    '--setProperty', 'formatOptions', 'lzw',
    '--setProperty', 'dpiWidth', String(Number(dpi) || 300),
    '--setProperty', 'dpiHeight', String(Number(dpi) || 300),
    normalizedInput,
    '--out', targetPath
  ]);
  const query = await runCommand('/usr/bin/sips', [
    '--getProperty', 'space',
    '--getProperty', 'samplesPerPixel',
    '--getProperty', 'bitsPerSample',
    '--oneLine',
    targetPath
  ]);
  return {
    engine: 'macos-colorsync',
    intent,
    normalization,
    commandOutput: result.stdout.trim(),
    queryOutput: query.stdout.trim()
  };
}

function createSharpCmykPipeline(inputPath, profilePath, attachProfile, dpi, compression, strategy) {
  let pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .pipelineColourspace('rgb16');

  if (strategy === 'sharp-cmyk-first') {
    pipeline = pipeline.toColourspace('cmyk').withIccProfile(profilePath, { attach: attachProfile });
  } else {
    pipeline = pipeline.withIccProfile(profilePath, { attach: attachProfile });
  }

  return pipeline
    .withMetadata({ density: Number(dpi) || 300 })
    .tiff({ compression, predictor: 'horizontal' });
}

async function verifyCmykTiff(filePath) {
  const structure = await inspectTiffStructure(filePath);
  const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
  return {
    valid: structure.valid,
    structure,
    decoderMetadata: {
      width: metadata.width || null,
      height: metadata.height || null,
      space: metadata.space || null,
      channels: metadata.channels || null,
      density: metadata.density || null,
      hasProfile: Boolean(metadata.hasProfile),
      hasAlpha: Boolean(metadata.hasAlpha),
      format: metadata.format || null
    }
  };
}

async function writeVerifiedCmyk({ inputPath, targetPath, profile, settings, dpi }) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-cmyk-'));
  const temporaryPath = path.join(workspace, 'candidate-output.tif');
  const diagnostics = [];
  const attempts = process.platform === 'darwin'
    ? ['macos-colorsync', 'sharp-profile-transform', 'sharp-cmyk-first']
    : ['sharp-profile-transform', 'sharp-cmyk-first'];

  try {
    for (const strategy of attempts) {
      await fs.rm(temporaryPath, { force: true });
      try {
        let engineDetail;
        if (strategy === 'macos-colorsync') {
          engineDetail = await convertWithColorSync({
            inputPath,
            targetPath: temporaryPath,
            profile,
            settings,
            dpi,
            workspace
          });
        } else {
          await createSharpCmykPipeline(
            inputPath,
            profile.path,
            settings.embedProfile,
            dpi,
            settings.compression,
            strategy
          ).toFile(temporaryPath);
          engineDetail = { engine: 'sharp-libvips' };
        }

        const verification = await verifyCmykTiff(temporaryPath);
        diagnostics.push({ strategy, engineDetail, verification });
        if (!verification.valid) continue;

        await fs.rm(targetPath, { force: true });
        await fs.copyFile(temporaryPath, targetPath);
        return { verification, strategy, engineDetail, diagnostics };
      } catch (error) {
        diagnostics.push({ strategy, error: error.message || String(error) });
      }
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }

  throw new Error(`Không tạo được TIFF CMYK có PhotometricInterpretation=Separated và ICC CMYK hợp lệ. Chi tiết: ${JSON.stringify(diagnostics)}`);
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

  const verification = conversion.verification;
  return {
    outputPath: targetPath,
    rgbMasterRemoved,
    profile,
    settings: normalized,
    conversionStrategy: conversion.strategy,
    conversionEngine: conversion.engineDetail?.engine || 'unknown',
    metadata: {
      width: verification.decoderMetadata.width,
      height: verification.decoderMetadata.height,
      channels: verification.structure.cmykChannels,
      samplesPerPixel: verification.structure.samplesPerPixel,
      space: 'cmyk',
      format: 'tiff',
      density: verification.decoderMetadata.density || dpi,
      hasProfile: verification.structure.hasIccTag,
      photometricInterpretation: verification.structure.photometricInterpretation,
      embeddedProfileSpace: verification.structure.iccProfile?.colorSpace || null
    },
    note: conversion.strategy === 'macos-colorsync'
      ? 'RGB được chuyển sang CMYK bằng macOS ColorSync và xác nhận trực tiếp bằng TIFF tags. File vẫn cần designer kiểm tra TAC, separation, black, spot color, overprint và proof.'
      : 'RGB được chuyển bằng Sharp/libvips và xác nhận trực tiếp bằng TIFF tags, không dựa riêng vào Sharp metadata. File vẫn cần designer kiểm tra TAC, separation, black, spot color, overprint và proof.'
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
  inspectIccProfile,
  inspectTiffStructure,
  normalizeSettings,
  parseIccHeader,
  resolveProfile,
  verifyCmykTiff,
  writeVerifiedCmyk
};
