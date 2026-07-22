const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { runNcnnUpscale } = require('./engineService');
const { enhanceImage } = require('./aiProviderService');
const { vectorizeLogo } = require('./vectorLogoService');

const MAX_SCALE = 8;

function ensureScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return 2;
  return Math.max(1, Math.min(MAX_SCALE, scale));
}

function ensureDpi(value) {
  const dpi = Number(value);
  return [150, 200, 240, 300].includes(dpi) ? dpi : 300;
}

async function dimensions(inputPath, scale) {
  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh đầu vào.');
  return {
    width: Math.max(1, Math.round(metadata.width * scale)),
    height: Math.max(1, Math.round(metadata.height * scale))
  };
}

async function writeRaster(pipeline, outputPath, options = {}) {
  const extension = path.extname(outputPath).toLowerCase();
  const dpi = ensureDpi(options.dpi);
  let output = pipeline.withMetadata({ density: dpi });

  if (['.jpg', '.jpeg'].includes(extension)) {
    output = output.jpeg({ quality: Math.max(70, Math.min(100, Number(options.quality ?? 95))), chromaSubsampling: '4:4:4' });
  } else if (['.tif', '.tiff'].includes(extension)) {
    output = output.tiff({ compression: 'lzw', quality: 100 });
  } else if (extension === '.webp') {
    output = output.webp({ quality: Math.max(70, Math.min(100, Number(options.quality ?? 95))) });
  } else {
    output = output.png({ compressionLevel: 7 });
  }

  await output.toFile(outputPath);
  return outputPath;
}

async function upscaleFallback(inputPath, outputPath, scale, options, onProgress) {
  const size = await dimensions(inputPath, scale);
  onProgress?.(15, scale > 4 ? `AI 4× không khả dụng, đang resize Lanczos đến ${Number(scale.toFixed(2))}×` : 'Đang phóng lớn bằng chế độ tương thích');
  let pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 });

  if (options.sharpen !== false && scale > 1) pipeline = pipeline.sharpen({ sigma: 1.1, m1: 0.8, m2: 2.2 });

  onProgress?.(70, 'Đang hoàn thiện ảnh');
  await writeRaster(pipeline, outputPath, options);
  onProgress?.(100, 'Hoàn tất');
  return outputPath;
}

async function upscale({ settingsService, inputPath, outputPath, options, onProgress }) {
  const scale = ensureScale(options.scale);
  if (scale <= 1.001) {
    onProgress?.(20, 'Ảnh nguồn đã đủ kích thước, đang chuẩn hóa đầu ra');
    await writeRaster(sharp(inputPath, { failOn: 'none' }).rotate(), outputPath, options);
    onProgress?.(100, 'Hoàn tất');
    return outputPath;
  }

  if (options.useNcnn !== false) {
    let tempPng = null;
    try {
      tempPng = path.extname(outputPath).toLowerCase() === '.png'
        ? outputPath
        : path.join(os.tmpdir(), `local-enhance-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);

      if (scale > 4) onProgress?.(2, `AI 4× + Lanczos đến ${Number(scale.toFixed(2))}×`);
      await runNcnnUpscale({
        settingsService,
        inputPath,
        outputPath: tempPng,
        model: options.model || 'high-fidelity-4x',
        scale,
        onProgress
      });

      if (tempPng !== outputPath) {
        await writeRaster(sharp(tempPng, { failOn: 'none' }), outputPath, options);
      }
      return outputPath;
    } catch (error) {
      if (!options.allowFallback) throw error;
      onProgress?.(8, `Bộ xử lý cục bộ không chạy: ${error.message}. Chuyển sang chế độ tương thích.`);
    } finally {
      if (tempPng && tempPng !== outputPath) {
        await fs.rm(tempPng, { force: true }).catch(() => {});
      }
    }
  }
  return upscaleFallback(inputPath, outputPath, scale, options, onProgress);
}

async function restoreSafe({ inputPath, outputPath, options, onProgress }) {
  const scale = ensureScale(options.scale);
  const size = await dimensions(inputPath, scale);
  const denoise = Math.max(0, Math.min(3, Number(options.denoise ?? 1)));
  const saturation = Math.max(0.5, Math.min(1.5, Number(options.saturation ?? 1.05)));
  const contrast = Math.max(0.8, Math.min(1.3, Number(options.contrast ?? 1.05)));

  onProgress?.(10, 'Đang khử nhiễu');
  let pipeline = sharp(inputPath, { failOn: 'none' }).rotate();
  if (denoise > 0) pipeline = pipeline.median(denoise === 1 ? 3 : 5);

  pipeline = pipeline
    .resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 })
    .normalize({ lower: 1, upper: 99 })
    .modulate({ saturation })
    .linear(contrast, -(contrast - 1) * 128)
    .sharpen({ sigma: 1.15, m1: 0.75, m2: 2.1 });

  onProgress?.(75, 'Đang hoàn thiện màu và độ nét');
  await writeRaster(pipeline, outputPath, options);
  onProgress?.(100, 'Hoàn tất');
  return outputPath;
}

async function textPrintSafe({ inputPath, outputPath, options, onProgress }) {
  const scale = ensureScale(options.scale);
  const size = await dimensions(inputPath, scale);
  const edge = Math.max(0.2, Math.min(2.5, Number(options.edge ?? 1.2)));

  onProgress?.(15, 'Đang phân tích cạnh chữ');
  const pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: edge, m1: 1.0, m2: 2.5 })
    .linear(1.035, -3);

  await writeRaster(pipeline, outputPath, options);
  onProgress?.(100, 'Hoàn tất');
  return outputPath;
}

async function aiEnhance({ secureSecretsService, inputPath, outputPath, options, onProgress }) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-ai-enhance-'));
  const normalizedInput = path.join(workspace, 'cloud-input.png');

  try {
    onProgress?.(8, 'Đang chuẩn hóa ảnh trước khi gửi AI');
    await sharp(inputPath, { failOn: 'none' })
      .rotate()
      .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 6 })
      .toFile(normalizedInput);

    onProgress?.(20, 'Đang gửi ảnh tới AI Cloud');
    const result = await enhanceImage({
      secureSecretsService,
      provider: options.provider,
      inputPath: normalizedInput,
      options
    });

    onProgress?.(82, 'Đã nhận ảnh, đang hoàn thiện đầu ra');
    let pipeline = sharp(result.buffer, { failOn: 'none' }).rotate();
    if (options.finishSharpen !== false) {
      pipeline = pipeline.sharpen({ sigma: 0.75, m1: 0.35, m2: 1.2 });
    }
    await writeRaster(pipeline, outputPath, options);
    onProgress?.(100, `Hoàn tất bằng ${result.provider === 'gemini' ? 'Gemini' : 'OpenAI'}`);
    return outputPath;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function inspectImage(inputPath) {
  const [metadata, file] = await Promise.all([
    sharp(inputPath, { failOn: 'none' }).metadata(),
    fs.stat(inputPath)
  ]);
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được thông tin ảnh.');

  const printSizes = {};
  for (const dpi of [150, 200, 240, 300]) {
    printSizes[dpi] = {
      widthCm: Number(((metadata.width / dpi) * 2.54).toFixed(1)),
      heightCm: Number(((metadata.height / dpi) * 2.54).toFixed(1))
    };
  }

  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format || path.extname(inputPath).slice(1),
    colorSpace: metadata.space || 'unknown',
    channels: metadata.channels || null,
    density: metadata.density || null,
    sizeBytes: file.size,
    printSizes
  };
}

async function processImage(payload) {
  if (payload.operation === 'upscale') return upscale(payload);
  if (payload.operation === 'ai-enhance') return aiEnhance(payload);
  if (payload.operation === 'restore') return restoreSafe(payload);
  if (payload.operation === 'text-print') return textPrintSafe(payload);
  if (payload.operation === 'vector-logo') return vectorizeLogo(payload);
  throw new Error(`Unknown operation: ${payload.operation}`);
}

function suggestedOutput(inputPath, operation, extension = null) {
  const parsed = path.parse(inputPath);
  const suffixes = {
    upscale: 'local-enhanced',
    'ai-enhance': 'ai-enhanced',
    restore: 'restored',
    'text-print': 'text-print',
    'vector-logo': 'vector'
  };
  const normalizedExtension = extension && /^\.(png|jpe?g|tiff?|webp)$/i.test(extension)
    ? extension.toLowerCase()
    : operation === 'vector-logo' ? '.svg' : '.png';
  return path.join(parsed.dir, `${parsed.name}-${suffixes[operation] || 'output'}${normalizedExtension}`);
}

module.exports = { MAX_SCALE, ensureScale, inspectImage, processImage, suggestedOutput, writeRaster };
