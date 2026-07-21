const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { runNcnnUpscale } = require('./engineService');
const { flatBlend, protectedBlend } = require('./packagingProtectionService');

const BENCHMARK_PRESETS = [
  {
    id: 'current-photo',
    label: 'Current · High Fidelity',
    description: 'Model ảnh chụp hiện tại của app, dùng làm nền fidelity.',
    type: 'model',
    model: 'high-fidelity-4x'
  },
  {
    id: 'current-packaging',
    label: 'Current · Packaging',
    description: 'Remacri hiện tại, dùng làm mốc cho artwork và bao bì.',
    type: 'model',
    model: 'remacri-4x'
  },
  {
    id: 'official-detail',
    label: 'RealESRGAN x4plus · Detail',
    description: 'Model chính thức ưu tiên độ nét cảm nhận và texture.',
    type: 'model',
    model: 'realesrgan-x4plus'
  },
  {
    id: 'packaging-hybrid',
    label: 'Packaging Hybrid · Protected',
    description: 'Trộn High Fidelity với RealESRGAN Detail và tự giảm Detail tại chữ, logo, đường biên và hình học mạnh.',
    type: 'blend',
    baseModel: 'high-fidelity-4x',
    detailModel: 'realesrgan-x4plus'
  }
];

const PRESET_BY_ID = new Map(BENCHMARK_PRESETS.map((preset) => [preset.id, preset]));

function sanitizeName(value) {
  return String(value || 'image')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
}

function sessionStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureScale(value) {
  const scale = Number(value);
  return [2, 3, 4].includes(scale) ? scale : 2;
}

function ensureDpi(value) {
  const dpi = Number(value);
  return [150, 200, 300].includes(dpi) ? dpi : 300;
}

function ensureBlendStrength(value) {
  const strength = Number(value);
  if (!Number.isFinite(strength)) return 0.2;
  return Math.max(0.05, Math.min(0.45, strength));
}

function ensureProtectionSensitivity(value) {
  const sensitivity = Number(value);
  if (!Number.isFinite(sensitivity)) return 65;
  return Math.max(20, Math.min(95, sensitivity));
}

async function imageSummary(filePath) {
  const [metadata, stat] = await Promise.all([
    sharp(filePath, { failOn: 'none' }).metadata(),
    fs.stat(filePath)
  ]);
  return {
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || path.extname(filePath).slice(1),
    colorSpace: metadata.space || 'unknown',
    channels: metadata.channels || null,
    density: metadata.density || null,
    sizeBytes: stat.size
  };
}

async function copyAsPng(sourcePath, outputPath, dpi) {
  await sharp(sourcePath, { failOn: 'none' })
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 7 })
    .toFile(outputPath);
}

async function runBenchmark({
  settingsService,
  inputPath,
  outputDirectory,
  referencePath = null,
  presetIds = [],
  scale = 2,
  dpi = 300,
  blendStrength = 0.2,
  protectionEnabled = true,
  protectionSensitivity = 65,
  onProgress
}) {
  if (!inputPath) throw new Error('Chưa chọn ảnh nguồn cho Model Lab.');
  if (!outputDirectory) throw new Error('Chưa chọn thư mục lưu benchmark.');

  const selected = [...new Set(presetIds)]
    .map((id) => PRESET_BY_ID.get(id))
    .filter(Boolean);
  if (!selected.length) throw new Error('Chọn ít nhất một model để benchmark.');

  const safeScale = ensureScale(scale);
  const safeDpi = ensureDpi(dpi);
  const safeStrength = ensureBlendStrength(blendStrength);
  const safeSensitivity = ensureProtectionSensitivity(protectionSensitivity);
  const parsed = path.parse(inputPath);
  const sessionDirectory = path.join(
    outputDirectory,
    `Print-Upscale-Lab-${sanitizeName(parsed.name)}-${sessionStamp()}`
  );
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-upscale-benchmark-'));
  const modelCache = new Map();
  const results = [];

  await fs.mkdir(sessionDirectory, { recursive: true });

  const runModel = async (model, progress) => {
    if (modelCache.has(model)) return modelCache.get(model);
    const tempPath = path.join(workspace, `${sanitizeName(model)}-${safeScale}x.png`);
    await runNcnnUpscale({
      settingsService,
      inputPath,
      outputPath: tempPath,
      model,
      scale: safeScale,
      onProgress: (percent, message) => progress(percent, message)
    });
    modelCache.set(model, tempPath);
    return tempPath;
  };

  try {
    for (let index = 0; index < selected.length; index += 1) {
      const preset = selected[index];
      const segmentStart = 3 + (index / selected.length) * 92;
      const segmentSize = 92 / selected.length;
      const progress = (percent, message) => {
        const overall = segmentStart + (Math.max(0, Math.min(100, Number(percent) || 0)) / 100) * segmentSize;
        onProgress?.(Math.min(96, Math.round(overall)), `${preset.label}: ${message || 'đang xử lý'}`);
      };
      const outputPath = path.join(
        sessionDirectory,
        `${String(index + 1).padStart(2, '0')}_${sanitizeName(preset.id)}_${safeScale}x.png`
      );
      const startedAt = Date.now();

      try {
        let blendInfo = null;
        if (preset.type === 'blend') {
          const basePath = await runModel(preset.baseModel, progress);
          const detailPath = await runModel(preset.detailModel, progress);
          const maskPath = protectionEnabled
            ? path.join(sessionDirectory, `${String(index + 1).padStart(2, '0')}_${sanitizeName(preset.id)}_protection-mask.png`)
            : null;
          progress(92, protectionEnabled ? 'đang tạo mask bảo vệ chữ, logo và cạnh' : 'đang trộn toàn ảnh');
          blendInfo = protectionEnabled
            ? await protectedBlend({
              sourcePath: inputPath,
              basePath,
              detailPath,
              outputPath,
              strength: safeStrength,
              sensitivity: safeSensitivity,
              dpi: safeDpi,
              maskOutputPath: maskPath
            })
            : await flatBlend({
              basePath,
              detailPath,
              outputPath,
              strength: safeStrength,
              dpi: safeDpi
            });
        } else {
          const modelOutput = await runModel(preset.model, progress);
          await copyAsPng(modelOutput, outputPath, safeDpi);
        }

        results.push({
          id: preset.id,
          label: preset.label,
          description: preset.description,
          outputPath,
          durationMs: Date.now() - startedAt,
          metadata: await imageSummary(outputPath),
          protection: blendInfo?.protection || null,
          blendStrength: blendInfo?.strength || null,
          error: null
        });
      } catch (error) {
        results.push({
          id: preset.id,
          label: preset.label,
          description: preset.description,
          outputPath: null,
          durationMs: Date.now() - startedAt,
          metadata: null,
          protection: null,
          blendStrength: null,
          error: error.message || String(error)
        });
      }
    }

    const reportPath = path.join(sessionDirectory, 'benchmark-report.json');
    const report = {
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      inputPath,
      referencePath,
      scale: safeScale,
      dpi: safeDpi,
      blendStrength: safeStrength,
      packagingProtection: {
        enabled: Boolean(protectionEnabled),
        sensitivity: safeSensitivity
      },
      results
    };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    onProgress?.(100, 'Model Lab hoàn tất');

    return {
      outputDirectory: sessionDirectory,
      reportPath,
      results
    };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

function listPresets() {
  return BENCHMARK_PRESETS.map((preset) => ({ ...preset }));
}

module.exports = {
  BENCHMARK_PRESETS,
  ensureProtectionSensitivity,
  listPresets,
  runBenchmark
};
