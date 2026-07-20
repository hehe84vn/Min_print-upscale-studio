const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { runNcnnUpscale } = require('./engineService');

function ensureScale(value) {
  const scale = Number(value);
  return [2, 3, 4].includes(scale) ? scale : 2;
}

async function dimensions(inputPath, scale) {
  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh đầu vào.');
  return {
    width: Math.max(1, Math.round(metadata.width * scale)),
    height: Math.max(1, Math.round(metadata.height * scale))
  };
}

async function upscaleFallback(inputPath, outputPath, scale, options, onProgress) {
  const size = await dimensions(inputPath, scale);
  onProgress?.(15);
  let pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 });

  if (options.sharpen !== false) pipeline = pipeline.sharpen({ sigma: 1.1, m1: 0.8, m2: 2.2 });

  onProgress?.(70);
  await pipeline.png({ compressionLevel: 7 }).toFile(outputPath);
  onProgress?.(100);
  return outputPath;
}

async function upscale({ settingsService, inputPath, outputPath, options, onProgress }) {
  const scale = ensureScale(options.scale);
  if (options.useNcnn !== false) {
    try {
      return await runNcnnUpscale({
        settingsService,
        inputPath,
        outputPath,
        model: options.model || 'upscayl-standard-4x',
        scale,
        onProgress
      });
    } catch (error) {
      if (!options.allowFallback) throw error;
      onProgress?.(8, `NCNN không chạy: ${error.message}. Chuyển sang Lanczos.`);
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

  onProgress?.(10);
  let pipeline = sharp(inputPath, { failOn: 'none' }).rotate();
  if (denoise > 0) pipeline = pipeline.median(denoise === 1 ? 3 : 5);

  pipeline = pipeline
    .resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 })
    .normalize({ lower: 1, upper: 99 })
    .modulate({ saturation })
    .linear(contrast, -(contrast - 1) * 128)
    .sharpen({ sigma: 1.15, m1: 0.75, m2: 2.1 });

  onProgress?.(75);
  await pipeline.png({ compressionLevel: 7 }).toFile(outputPath);
  onProgress?.(100);
  return outputPath;
}

async function textPrintSafe({ inputPath, outputPath, options, onProgress }) {
  const scale = ensureScale(options.scale);
  const size = await dimensions(inputPath, scale);
  const edge = Math.max(0.2, Math.min(2.5, Number(options.edge ?? 1.2)));

  onProgress?.(15);
  await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize(size.width, size.height, { kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: edge, m1: 1.0, m2: 2.5 })
    .linear(1.035, -3)
    .png({ compressionLevel: 7 })
    .toFile(outputPath);
  onProgress?.(100);
  return outputPath;
}

async function vectorLogo({ inputPath, outputPath, options, onProgress }) {
  const threshold = Math.max(0, Math.min(255, Number(options.threshold ?? 170)));
  const colorMode = options.colorMode === 'color' ? 'color' : 'binary';
  const tempPath = path.join(os.tmpdir(), `vector-input-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);

  try {
    onProgress?.(10);
    let pipeline = sharp(inputPath, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .normalize();

    if (colorMode === 'binary') {
      pipeline = pipeline.grayscale().threshold(threshold);
      if (options.invert) pipeline = pipeline.negate();
    }
    await pipeline.png().toFile(tempPath);

    onProgress?.(45);
    const { vectorize, optimize, ColorMode, Hierarchical, PathSimplifyMode } = await import('@neplex/vectorizer');
    const source = await fs.readFile(tempPath);
    const svg = await vectorize(source, {
      colorMode: colorMode === 'color' ? ColorMode.Color : ColorMode.Binary,
      colorPrecision: Math.max(1, Math.min(8, Number(options.colorPrecision ?? 6))),
      filterSpeckle: Math.max(0, Number(options.turdSize ?? 4)),
      spliceThreshold: 45,
      cornerThreshold: 60,
      hierarchical: Hierarchical.Stacked,
      mode: PathSimplifyMode.Spline,
      layerDifference: Math.max(1, Number(options.layerDifference ?? 5)),
      lengthThreshold: 5,
      maxIterations: 2,
      pathPrecision: 3
    });

    onProgress?.(80);
    const optimized = await optimize(svg, {
      plugins: ['preset-default', { name: 'removeTitle' }],
      multipass: true,
      multipassIterations: 3
    });

    await fs.writeFile(outputPath, optimized, 'utf8');
    onProgress?.(100);
    return outputPath;
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

async function processImage(payload) {
  if (payload.operation === 'upscale') return upscale(payload);
  if (payload.operation === 'restore') return restoreSafe(payload);
  if (payload.operation === 'text-print') return textPrintSafe(payload);
  if (payload.operation === 'vector-logo') return vectorLogo(payload);
  throw new Error(`Unknown operation: ${payload.operation}`);
}

function suggestedOutput(inputPath, operation) {
  const parsed = path.parse(inputPath);
  const suffixes = {
    upscale: 'upscaled',
    restore: 'restored',
    'text-print': 'text-print',
    'vector-logo': 'vector'
  };
  const extension = operation === 'vector-logo' ? '.svg' : '.png';
  return path.join(parsed.dir, `${parsed.name}-${suffixes[operation] || 'output'}${extension}`);
}

module.exports = { processImage, suggestedOutput };
