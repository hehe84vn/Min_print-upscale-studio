const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { runNcnnUpscale } = require('./engineService');
const { flatBlend, protectedBlend } = require('./packagingProtectionService');
const { createPreflightContext, runPackagingPreflight } = require('./preflightService');
const { convertToCmyk, normalizeSettings: normalizeColorSettings } = require('./colorOutputService');

const BENCHMARK_PRESETS = [
  { id: 'current-photo', label: 'Current · High Fidelity', description: 'Model ảnh chụp hiện tại của app, dùng làm nền fidelity.', type: 'model', model: 'high-fidelity-4x' },
  { id: 'current-packaging', label: 'Current · Packaging', description: 'Remacri hiện tại, dùng làm mốc cho artwork và bao bì.', type: 'model', model: 'remacri-4x' },
  { id: 'official-detail', label: 'RealESRGAN x4plus · Detail', description: 'Model chính thức ưu tiên độ nét cảm nhận và texture.', type: 'model', model: 'realesrgan-x4plus' },
  { id: 'packaging-hybrid', label: 'Packaging Hybrid · Quality Check', description: 'Trộn High Fidelity với RealESRGAN Detail, bảo vệ chữ/logo và kiểm tra lỗi do upscale.', type: 'blend', baseModel: 'high-fidelity-4x', detailModel: 'realesrgan-x4plus' }
];

const PRESET_BY_ID = new Map(BENCHMARK_PRESETS.map((preset) => [preset.id, preset]));

function sanitizeName(value) {
  return String(value || 'image').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'image';
}
function sessionStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function ensureScale(value) { const scale = Number(value); return [2, 3, 4, 6, 8].includes(scale) ? scale : 2; }
function ensureDpi(value) { const dpi = Number(value); return [150, 200, 240, 300].includes(dpi) ? dpi : 300; }
function ensureBlendStrength(value) { const strength = Number(value); return Number.isFinite(strength) ? Math.max(0.05, Math.min(0.45, strength)) : 0.2; }
function ensureProtectionSensitivity(value) { const sensitivity = Number(value); return Number.isFinite(sensitivity) ? Math.max(20, Math.min(95, sensitivity)) : 65; }

async function imageSummary(filePath) {
  const [metadata, stat] = await Promise.all([sharp(filePath, { failOn: 'none' }).metadata(), fs.stat(filePath)]);
  return { width: metadata.width || null, height: metadata.height || null, format: metadata.format || path.extname(filePath).slice(1), colorSpace: metadata.space || 'unknown', channels: metadata.channels || null, density: metadata.density || null, hasProfile: Boolean(metadata.hasProfile), sizeBytes: stat.size };
}

async function copyAsPng(sourcePath, outputPath, dpi) {
  await sharp(sourcePath, { failOn: 'none' }).withMetadata({ density: dpi }).png({ compressionLevel: 7 }).toFile(outputPath);
}

async function safeQualityCheck({ context, outputPath, semanticMaskPath, protection }) {
  if (!context) return null;
  try { return await runPackagingPreflight({ context, outputPath, semanticMaskPath, protection }); }
  catch (error) {
    return { version: 'preflight-v1', status: 'warning', score: null, error: error.message || String(error), metrics: {}, recommendations: ['Upscale Quality Check gặp lỗi kỹ thuật; cần kiểm tra thủ công kết quả này.'] };
  }
}

async function safeCmykCopy({ outputPath, dpi, enabled, settings }) {
  if (!enabled) return null;
  try {
    return await convertToCmyk({ inputPath: outputPath, dpi, settings: normalizeColorSettings({ ...(settings || {}), outputMode: 'rgb-cmyk' }) });
  } catch (error) {
    return { outputPath: null, error: error.message || String(error), settings: normalizeColorSettings({ ...(settings || {}), outputMode: 'rgb-cmyk' }) };
  }
}

async function runBenchmark({ settingsService, inputPath, outputDirectory, referencePath = null, presetIds = [], scale = 2, dpi = 300, blendStrength = 0.2, protectionEnabled = true, protectionSensitivity = 65, semanticProtectionEnabled = true, codeGuardEnabled = true, preflightEnabled = true, cmykOutputEnabled = false, colorOutputSettings = null, onProgress }) {
  if (!inputPath) throw new Error('Chưa chọn ảnh nguồn cho Model Lab.');
  if (!outputDirectory) throw new Error('Chưa chọn thư mục lưu benchmark.');
  const selected = [...new Set(presetIds)].map((id) => PRESET_BY_ID.get(id)).filter(Boolean);
  if (!selected.length) throw new Error('Chọn ít nhất một model để benchmark.');

  const safeScale = ensureScale(scale);
  const safeDpi = ensureDpi(dpi);
  const safeStrength = ensureBlendStrength(blendStrength);
  const safeSensitivity = ensureProtectionSensitivity(protectionSensitivity);
  const parsed = path.parse(inputPath);
  const sessionDirectory = path.join(outputDirectory, `Print-Upscale-Lab-${sanitizeName(parsed.name)}-${sessionStamp()}`);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-upscale-benchmark-'));
  const maskWorkspace = path.join(workspace, 'masks');
  const modelCache = new Map();
  const results = [];

  await Promise.all([fs.mkdir(sessionDirectory, { recursive: true }), fs.mkdir(maskWorkspace, { recursive: true })]);
  onProgress?.(2, preflightEnabled ? 'Đang phân tích ảnh nguồn cho Upscale Quality Check' : 'Đang chuẩn bị Model Lab');
  const qualityCheckContext = preflightEnabled ? await createPreflightContext(inputPath) : null;

  const runModel = async (model, progress) => {
    if (modelCache.has(model)) return modelCache.get(model);
    const tempPath = path.join(workspace, `${sanitizeName(model)}-${safeScale}x.png`);
    await runNcnnUpscale({ settingsService, inputPath, outputPath: tempPath, model, scale: safeScale, onProgress: (percent, message) => progress(percent, message) });
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
      const outputPath = path.join(sessionDirectory, `${String(index + 1).padStart(2, '0')}_${sanitizeName(preset.id)}_${safeScale}x.png`);
      const startedAt = Date.now();
      try {
        let blendInfo = null;
        let semanticMaskPath = null;
        if (preset.type === 'blend') {
          const basePath = await runModel(preset.baseModel, progress);
          const detailPath = await runModel(preset.detailModel, progress);
          const prefix = `${String(index + 1).padStart(2, '0')}_${sanitizeName(preset.id)}`;
          const maskPath = protectionEnabled ? path.join(maskWorkspace, `${prefix}_protection-mask.png`) : null;
          semanticMaskPath = protectionEnabled && semanticProtectionEnabled ? path.join(maskWorkspace, `${prefix}_text-logo-mask.png`) : null;
          const barcodeMaskPath = protectionEnabled && codeGuardEnabled ? path.join(maskWorkspace, `${prefix}_barcode-mask.png`) : null;
          progress(89, protectionEnabled ? 'đang tạo protection mask nội bộ và kiểm tra QR/barcode' : 'đang trộn toàn ảnh');
          blendInfo = protectionEnabled
            ? await protectedBlend({ sourcePath: inputPath, basePath, detailPath, outputPath, strength: safeStrength, sensitivity: safeSensitivity, semanticEnabled: Boolean(semanticProtectionEnabled), codeGuardEnabled: Boolean(codeGuardEnabled), dpi: safeDpi, maskOutputPath: maskPath, semanticMaskOutputPath: semanticMaskPath, barcodeMaskOutputPath: barcodeMaskPath })
            : await flatBlend({ basePath, detailPath, outputPath, strength: safeStrength, dpi: safeDpi });
        } else {
          const modelOutput = await runModel(preset.model, progress);
          await copyAsPng(modelOutput, outputPath, safeDpi);
        }

        progress(94, preflightEnabled ? 'đang chạy Upscale Quality Check nội bộ' : 'đang hoàn tất RGB');
        const preflight = await safeQualityCheck({ context: qualityCheckContext, outputPath, semanticMaskPath, protection: blendInfo?.protection || null });
        progress(98, cmykOutputEnabled ? 'đang tạo CMYK TIFF copy' : 'đang hoàn tất');
        const cmykOutput = await safeCmykCopy({ outputPath, dpi: safeDpi, enabled: Boolean(cmykOutputEnabled), settings: colorOutputSettings });
        results.push({ id: preset.id, label: preset.label, description: preset.description, outputPath, durationMs: Date.now() - startedAt, metadata: await imageSummary(outputPath), protection: blendInfo?.protection || null, barcodeGuard: blendInfo?.barcodeGuard || null, blendStrength: blendInfo?.strength || null, preflight, cmykOutput, error: null });
      } catch (error) {
        results.push({ id: preset.id, label: preset.label, description: preset.description, outputPath: null, durationMs: Date.now() - startedAt, metadata: null, protection: null, barcodeGuard: null, blendStrength: null, preflight: null, cmykOutput: null, error: error.message || String(error) });
      }
    }

    const qualityCheckSummary = { enabled: Boolean(preflightEnabled), pass: results.filter((result) => result.preflight?.status === 'pass').length, warning: results.filter((result) => result.preflight?.status === 'warning').length, fail: results.filter((result) => result.preflight?.status === 'fail').length, skipped: results.filter((result) => !result.preflight).length };
    const cmykSummary = { enabled: Boolean(cmykOutputEnabled), success: results.filter((result) => result.cmykOutput?.outputPath).length, failed: results.filter((result) => result.cmykOutput?.error).length, skipped: results.filter((result) => !result.cmykOutput).length, settings: cmykOutputEnabled ? normalizeColorSettings({ ...(colorOutputSettings || {}), outputMode: 'rgb-cmyk' }) : null };
    const diagnostics = { schemaVersion: 7, createdAt: new Date().toISOString(), inputPath, referencePath, scale: safeScale, dpi: safeDpi, blendStrength: safeStrength, packagingProtection: { enabled: Boolean(protectionEnabled), sensitivity: safeSensitivity, semanticProtectionEnabled: Boolean(semanticProtectionEnabled), codeGuardEnabled: Boolean(codeGuardEnabled) }, upscaleQualityCheck: { enabled: Boolean(preflightEnabled), summary: qualityCheckSummary }, colorOutput: cmykSummary, results };
    onProgress?.(100, cmykOutputEnabled ? 'Model Lab hoàn tất: RGB và CMYK đã sẵn sàng' : 'Model Lab hoàn tất');
    return { outputDirectory: sessionDirectory, reportPath: null, qualityCheckReportPath: null, preflightReportPath: null, qualityCheckSummary, preflightSummary: qualityCheckSummary, cmykSummary, diagnostics, results };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

function listPresets() { return BENCHMARK_PRESETS.map((preset) => ({ ...preset })); }
module.exports = { BENCHMARK_PRESETS, ensureProtectionSensitivity, listPresets, runBenchmark };
