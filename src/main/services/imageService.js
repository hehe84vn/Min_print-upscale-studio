const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { runNcnnUpscaleAdaptive } = require('./engineService');
const { enhanceImage } = require('./aiProviderService');
const { vectorizeLogo } = require('./vectorLogoService');
const { rerunVectorCleanup } = require('./vectorCleanupRerunService');
const { selectVectorCandidate } = require('./vectorCandidateSelectionService');
const { enhanceTextAware } = require('./textAwareUpscaleService');
const {
  resizeBeyondFourX,
  validateRasterOutput,
  writeQualityReport
} = require('./rasterProductionQualityService');

const MAX_SCALE = 8;
function ensureScale(value) { const scale = Number(value); return Number.isFinite(scale) ? Math.max(1, Math.min(MAX_SCALE, scale)) : 2; }
function ensureDpi(value) { const dpi = Number(value); return [150, 200, 240, 300].includes(dpi) ? dpi : 300; }
async function dimensions(inputPath, scale) {
  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh đầu vào.');
  return { width: Math.max(1, Math.round(metadata.width * scale)), height: Math.max(1, Math.round(metadata.height * scale)) };
}
async function writeRaster(pipeline, outputPath, options = {}) {
  const extension = path.extname(outputPath).toLowerCase();
  const dpi = ensureDpi(options.dpi);
  let output = pipeline.withMetadata({ density: dpi });
  if (['.jpg', '.jpeg'].includes(extension)) output = output.jpeg({ quality: Math.max(70, Math.min(100, Number(options.quality ?? 95))), chromaSubsampling: '4:4:4' });
  else if (['.tif', '.tiff'].includes(extension)) output = output.tiff({ compression: 'lzw', quality: 100 });
  else if (extension === '.webp') output = output.webp({ quality: Math.max(70, Math.min(100, Number(options.quality ?? 95))) });
  else output = output.png({ compressionLevel: 7 });
  await output.toFile(outputPath);
  return outputPath;
}
function textAwareEnabled(options = {}) { return options.textPriority !== false && options.textAware !== false; }
async function finishUpscale(input, outputPath, options, onProgress) {
  if (!textAwareEnabled(options)) {
    await writeRaster(sharp(input, { failOn: 'none' }), outputPath, options);
    return { outputPath, textAware: null };
  }
  onProgress?.(82, 'Đang làm rõ chữ, giữ độ dày nét và khử viền màu');
  const enhanced = await enhanceTextAware(input, {
    textStrength: options.textStrength ?? 0.64,
    haloLimit: options.haloLimit ?? 10,
    edgeThreshold: options.textEdgeThreshold,
    maskRadius: options.textMaskRadius ?? 1,
    maximumPixels: options.textMaximumPixels ?? 48_000_000
  });
  await writeRaster(sharp(enhanced.buffer, { failOn: 'none' }), outputPath, options);
  return { outputPath, textAware: enhanced.stats };
}
async function validateAndReport({ inputPath, outputPath, scale, engine, textAware, options, onProgress }) {
  if (options.outputValidation === false) return null;
  onProgress?.(96, 'Đang kiểm tra lỗi ảnh, kích thước và độ sắc đầu ra');
  const expected = await dimensions(inputPath, scale);
  const validation = await validateRasterOutput({ inputPath, outputPath, expectedWidth: expected.width, expectedHeight: expected.height });
  const report = { schemaVersion: 14, scale, engine, textAware, validation, generatedAt: new Date().toISOString() };
  report.reportPath = await writeQualityReport(outputPath, report);
  if (validation.status === 'fail') {
    const error = new Error('Ảnh upscale không vượt qua kiểm tra chất lượng đầu ra.');
    error.code = 'RASTER_OUTPUT_VALIDATION_FAILED';
    error.report = report;
    throw error;
  }
  return report;
}
async function upscaleFallback(inputPath, outputPath, scale, options, onProgress) {
  const size = await dimensions(inputPath, scale);
  onProgress?.(15, 'Local AI không khả dụng, đang dùng chế độ edge-safe tương thích');
  let resized;
  if (scale > 4) resized = await resizeBeyondFourX(inputPath, size.width, size.height, options);
  else resized = await sharp(inputPath, { failOn: 'none' }).rotate().resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 }).png({ compressionLevel: 4 }).toBuffer();
  const finished = await finishUpscale(resized, outputPath, options, onProgress);
  await validateAndReport({ inputPath, outputPath, scale, engine: { type: 'fallback-edge-safe' }, textAware: finished.textAware, options, onProgress });
  onProgress?.(100, 'Hoàn tất');
  return outputPath;
}
async function upscale({ settingsService, inputPath, outputPath, options = {}, onProgress }) {
  const scale = ensureScale(options.scale);
  if (scale <= 1.001) {
    const normalized = await sharp(inputPath, { failOn: 'none' }).rotate().png().toBuffer();
    const finished = await finishUpscale(normalized, outputPath, options, onProgress);
    await validateAndReport({ inputPath, outputPath, scale, engine: { type: 'normalize' }, textAware: finished.textAware, options, onProgress });
    onProgress?.(100, 'Hoàn tất');
    return outputPath;
  }
  if (options.useNcnn !== false) {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'production-upscale-'));
    const aiFourX = path.join(workspace, 'ai-4x.png');
    try {
      const nativeScale = Math.min(4, scale);
      if (scale > 4) onProgress?.(2, `AI 4× + Edge-Safe Reconstruction đến ${scale}×`);
      const engineRun = await runNcnnUpscaleAdaptive({
        settingsService,
        inputPath,
        outputPath: aiFourX,
        model: options.model || 'high-fidelity-4x',
        scale: nativeScale,
        tileSize: options.tileSize,
        tta: options.tta === true,
        onProgress
      });
      let productionInput = aiFourX;
      if (scale > 4) {
        onProgress?.(76, `Đang dựng cạnh an toàn từ 4× lên ${scale}×`);
        const size = await dimensions(inputPath, scale);
        productionInput = await resizeBeyondFourX(aiFourX, size.width, size.height, options);
      }
      const finished = await finishUpscale(productionInput, outputPath, options, onProgress);
      await validateAndReport({
        inputPath,
        outputPath,
        scale,
        engine: { type: 'ncnn-adaptive', model: options.model || 'high-fidelity-4x', ...engineRun },
        textAware: finished.textAware,
        options,
        onProgress
      });
      onProgress?.(100, 'Hoàn tất');
      return outputPath;
    } catch (error) {
      if (!options.allowFallback) throw error;
      onProgress?.(8, `Local AI không hoàn tất: ${error.message}. Chuyển sang edge-safe fallback.`);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  }
  return upscaleFallback(inputPath, outputPath, scale, options, onProgress);
}
async function restoreSafe({ inputPath, outputPath, options, onProgress }) {
  const scale = ensureScale(options.scale); const size = await dimensions(inputPath, scale);
  const denoise = Math.max(0, Math.min(3, Number(options.denoise ?? 1)));
  const saturation = Math.max(0.5, Math.min(1.5, Number(options.saturation ?? 1.05)));
  const contrast = Math.max(0.8, Math.min(1.3, Number(options.contrast ?? 1.05)));
  let pipeline = sharp(inputPath, { failOn: 'none' }).rotate();
  if (denoise > 0) pipeline = pipeline.median(denoise === 1 ? 3 : 5);
  pipeline = pipeline.resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 }).normalize({ lower: 1, upper: 99 }).modulate({ saturation }).linear(contrast, -(contrast - 1) * 128).sharpen({ sigma: 1.15, m1: 0.75, m2: 2.1 });
  await writeRaster(pipeline, outputPath, options); onProgress?.(100, 'Hoàn tất'); return outputPath;
}
async function textPrintSafe({ inputPath, outputPath, options, onProgress }) {
  const scale = ensureScale(options.scale); const size = await dimensions(inputPath, scale);
  const resized = scale > 4
    ? await resizeBeyondFourX(inputPath, size.width, size.height, options)
    : await sharp(inputPath, { failOn: 'none' }).rotate().resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 }).linear(1.02, -2).png({ compressionLevel: 4 }).toBuffer();
  await finishUpscale(resized, outputPath, { ...options, textPriority: true, textStrength: options.textStrength ?? Math.max(0.4, Math.min(0.95, Number(options.edge ?? 1.2) * 0.5)), haloLimit: options.haloLimit ?? 9 }, onProgress);
  onProgress?.(100, 'Hoàn tất'); return outputPath;
}
async function aiEnhance({ secureSecretsService, inputPath, outputPath, options, onProgress }) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-ai-enhance-')); const normalizedInput = path.join(workspace, 'cloud-input.png');
  try {
    await sharp(inputPath, { failOn: 'none' }).rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 6 }).toFile(normalizedInput);
    const result = await enhanceImage({ secureSecretsService, provider: options.provider, inputPath: normalizedInput, options });
    let pipeline = sharp(result.buffer, { failOn: 'none' }).rotate();
    if (options.finishSharpen !== false) pipeline = pipeline.sharpen({ sigma: 0.75, m1: 0.35, m2: 1.2 });
    await writeRaster(pipeline, outputPath, options); onProgress?.(100, `Hoàn tất bằng ${result.provider === 'gemini' ? 'Gemini' : 'OpenAI'}`); return outputPath;
  } finally { await fs.rm(workspace, { recursive: true, force: true }); }
}
async function inspectImage(inputPath) {
  const [metadata, file] = await Promise.all([sharp(inputPath, { failOn: 'none' }).metadata(), fs.stat(inputPath)]);
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được thông tin ảnh.');
  const printSizes = {};
  for (const dpi of [150, 200, 240, 300]) printSizes[dpi] = { widthCm: Number(((metadata.width / dpi) * 2.54).toFixed(1)), heightCm: Number(((metadata.height / dpi) * 2.54).toFixed(1)) };
  return { width: metadata.width, height: metadata.height, format: metadata.format || path.extname(inputPath).slice(1), colorSpace: metadata.space || 'unknown', channels: metadata.channels || null, density: metadata.density || null, sizeBytes: file.size, printSizes };
}
async function processImage(payload) {
  if (payload.operation === 'upscale') return upscale(payload);
  if (payload.operation === 'ai-enhance') return aiEnhance(payload);
  if (payload.operation === 'restore') return restoreSafe(payload);
  if (payload.operation === 'text-print') return textPrintSafe(payload);
  if (payload.operation === 'vector-logo') return vectorizeLogo(payload);
  if (payload.operation === 'vector-cleanup') return rerunVectorCleanup(payload);
  if (payload.operation === 'vector-candidate-select') return selectVectorCandidate(payload);
  throw new Error(`Unknown operation: ${payload.operation}`);
}
function suggestedOutput(inputPath, operation, extension = null) {
  const parsed = path.parse(inputPath);
  const suffixes = { upscale: 'local-enhanced', 'ai-enhance': 'ai-enhanced', restore: 'restored', 'text-print': 'text-print', 'vector-logo': 'vector' };
  const normalizedExtension = extension && /^\.(png|jpe?g|tiff?|webp)$/i.test(extension) ? extension.toLowerCase() : operation === 'vector-logo' ? '.svg' : '.png';
  return path.join(parsed.dir, `${parsed.name}-${suffixes[operation] || 'output'}${normalizedExtension}`);
}
module.exports = { MAX_SCALE, ensureScale, inspectImage, processImage, suggestedOutput, writeRaster };
