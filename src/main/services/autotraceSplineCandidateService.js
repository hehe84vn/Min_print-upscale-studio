'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const vectorEngine = require('./vectorLogoEngine');
const { requireAutoTraceRuntime } = require('./autotraceRuntimeService');
const { assessColorSvg, normalizeSvgCanvas } = require('./autotraceVectorEngine');

const execFileAsync = promisify(execFile);

const PRESETS = {
  detail: {
    id: 'autotrace-spline-detail',
    label: 'AutoTrace · Spline chi tiết',
    defaultColors: 16,
    despeckleLevel: 0,
    cornerThreshold: 88,
    cornerAlwaysThreshold: 50,
    cornerSurround: 5,
    errorThreshold: 1.25,
    filterIterations: 4,
    lineThreshold: 0.5,
    lineReversionThreshold: 0.006,
    tangentSurround: 4
  },
  balanced: {
    id: 'autotrace-spline-balanced',
    label: 'AutoTrace · Spline cân bằng',
    defaultColors: 12,
    despeckleLevel: 1,
    cornerThreshold: 82,
    cornerAlwaysThreshold: 46,
    cornerSurround: 6,
    errorThreshold: 1.6,
    filterIterations: 5,
    lineThreshold: 0.6,
    lineReversionThreshold: 0.008,
    tangentSurround: 4
  },
  compact: {
    id: 'autotrace-spline-compact',
    label: 'AutoTrace · Spline gọn',
    defaultColors: 8,
    despeckleLevel: 2,
    cornerThreshold: 78,
    cornerAlwaysThreshold: 42,
    cornerSurround: 7,
    errorThreshold: 2.2,
    filterIterations: 6,
    lineThreshold: 0.8,
    lineReversionThreshold: 0.01,
    tangentSurround: 5
  }
};

function presetForStrategy(strategy = 'smart') {
  if (strategy === 'detail') return PRESETS.detail;
  if (strategy === 'compact') return PRESETS.compact;
  return PRESETS.balanced;
}

function clampColorCount(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(2, Math.min(64, Math.round(number)));
}

function rgbBuffer(data, info) {
  if (info.channels === 3) return data;
  const output = Buffer.alloc(info.width * info.height * 3);
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const sourceOffset = pixel * info.channels;
    const targetOffset = pixel * 3;
    const value = data[sourceOffset];
    output[targetOffset] = value;
    output[targetOffset + 1] = data[sourceOffset + 1] ?? value;
    output[targetOffset + 2] = data[sourceOffset + 2] ?? value;
  }
  return output;
}

function countUniqueRgb(data, channels = 3, stopAfter = 257) {
  const colors = new Set();
  for (let offset = 0; offset < data.length; offset += channels) {
    colors.add(`${data[offset]},${data[offset + 1] ?? data[offset]},${data[offset + 2] ?? data[offset]}`);
    if (colors.size >= stopAfter) break;
  }
  return colors.size;
}

async function prepareFlatPalettePpm(inputPath, outputPath, options = {}) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước artwork màu cho AutoTrace.');
  const trace = vectorEngine.traceDimensions(metadata.width, metadata.height, { allowUpscale: false });
  const colorCount = clampColorCount(options.paletteColors, 12);
  const quantizedPng = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(trace.width, trace.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .png({ palette: true, colours: colorCount, dither: 0, effort: 10, compressionLevel: 7 })
    .toBuffer();
  const raw = await sharp(quantizedPng, { failOn: 'none' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = rgbBuffer(raw.data, raw.info);
  const actualPaletteColors = countUniqueRgb(pixels, 3, colorCount + 2);
  const header = Buffer.from(`P6\n${raw.info.width} ${raw.info.height}\n255\n`, 'ascii');
  await fs.writeFile(outputPath, Buffer.concat([header, pixels]));
  return {
    width: metadata.width,
    height: metadata.height,
    traceWidth: raw.info.width,
    traceHeight: raw.info.height,
    traceScale: trace.scale,
    format: metadata.format || path.extname(inputPath).slice(1),
    inputFormat: 'ppm-p6',
    cliInputHandler: 'pnm',
    background: 'FFFFFF',
    requestedPaletteColors: colorCount,
    actualPaletteColors,
    quantization: 'sharp-palette-no-dither'
  };
}

async function runAutoTraceSpline({ binaryPath, inputPath, outputPath, params }) {
  const args = [
    '-input-format', 'pnm',
    '-output-format', 'svg',
    '-output-file', outputPath,
    '-color-count', String(params.colorCount),
    '-background-color', params.backgroundColor,
    '-despeckle-level', String(params.despeckleLevel),
    '-corner-threshold', String(params.cornerThreshold),
    '-corner-always-threshold', String(params.cornerAlwaysThreshold),
    '-corner-surround', String(params.cornerSurround),
    '-error-threshold', String(params.errorThreshold),
    '-filter-iterations', String(params.filterIterations),
    '-line-threshold', String(params.lineThreshold),
    '-line-reversion-threshold', String(params.lineReversionThreshold),
    '-tangent-surround', String(params.tangentSurround),
    '-remove-adjacent-corners',
    inputPath
  ];
  try {
    const result = await execFileAsync(binaryPath, args, {
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024
    });
    return {
      args,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim()
    };
  } catch (error) {
    const wrapped = new Error(`AutoTrace spline CLI thất bại: ${error.stderr || error.message || String(error)}`);
    wrapped.code = 'AUTOTRACE_SPLINE_FAILED';
    wrapped.cause = error;
    wrapped.args = args;
    throw wrapped;
  }
}

async function buildAutoTraceColorCandidate({ inputPath, options = {}, onProgress }) {
  const runtime = requireAutoTraceRuntime();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-autotrace-spline-'));
  const ppmPath = path.join(workspace, 'flat-palette-source.ppm');
  const svgPath = path.join(workspace, 'autotrace-spline.svg');
  try {
    const preset = presetForStrategy(options.strategy);
    const colorCount = clampColorCount(options.paletteColors, preset.defaultColors);
    onProgress?.(56, `AutoTrace: lượng tử hóa ${colorCount} màu phẳng bằng Sharp`);
    const source = await prepareFlatPalettePpm(inputPath, ppmPath, { paletteColors: colorCount });
    const params = {
      colorCount,
      backgroundColor: 'FFFFFF',
      despeckleLevel: preset.despeckleLevel,
      cornerThreshold: preset.cornerThreshold,
      cornerAlwaysThreshold: preset.cornerAlwaysThreshold,
      cornerSurround: preset.cornerSurround,
      errorThreshold: preset.errorThreshold,
      filterIterations: preset.filterIterations,
      lineThreshold: preset.lineThreshold,
      lineReversionThreshold: preset.lineReversionThreshold,
      tangentSurround: preset.tangentSurround,
      removeAdjacentCorners: true,
      inputFormat: source.cliInputHandler,
      outputFormat: 'svg',
      outline: true
    };
    onProgress?.(64, 'AutoTrace: đang fit spline trên palette phẳng');
    const execution = await runAutoTraceSpline({
      binaryPath: runtime.binaryPath,
      inputPath: ppmPath,
      outputPath: svgPath,
      params
    });
    let svg = normalizeSvgCanvas(await fs.readFile(svgPath, 'utf8'), source);
    const { optimize } = await import('@neplex/vectorizer');
    svg = String(await optimize(svg, {
      plugins: ['preset-default', { name: 'removeTitle' }],
      multipass: true,
      multipassIterations: 2
    }));
    svg = normalizeSvgCanvas(svg, source);
    const reference = await require('./autotraceVectorEngine').colorReference(inputPath);
    const metrics = await assessColorSvg(svg, reference);
    return {
      id: preset.id,
      label: preset.label,
      engine: 'autotrace',
      preprocessing: {
        source: source.quantization,
        inputFormat: source.inputFormat,
        cliInputHandler: source.cliInputHandler,
        backgroundColor: params.backgroundColor,
        paletteColors: colorCount,
        actualPaletteColors: source.actualPaletteColors,
        traceScale: source.traceScale
      },
      trace: {
        engine: 'autotrace-cli',
        algorithm: 'autotrace-spline',
        runtime,
        params,
        commandArgs: execution.args
      },
      geometryLock: null,
      reconstruction: null,
      metrics,
      source,
      svg
    };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  PRESETS,
  buildAutoTraceColorCandidate,
  clampColorCount,
  countUniqueRgb,
  prepareFlatPalettePpm,
  presetForStrategy,
  rgbBuffer,
  runAutoTraceSpline
};
