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

async function quantizedPalette(inputPath, options = {}) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước artwork màu cho AutoTrace.');
  const trace = vectorEngine.traceDimensions(metadata.width, metadata.height, { allowUpscale: false });
  const colorCount = clampColorCount(options.paletteColors, 12);
  const png = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(trace.width, trace.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .png({ palette: true, colours: colorCount, dither: 0, effort: 10, compressionLevel: 7 })
    .toBuffer();
  const raw = await sharp(png, { failOn: 'none' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const actualPaletteColors = countUniqueRgb(rgbBuffer(raw.data, raw.info), 3, colorCount + 2);
  return { metadata, trace, colorCount, png, raw, actualPaletteColors };
}

async function prepareFlatPalettePng(inputPath, outputPath, options = {}) {
  const prepared = await quantizedPalette(inputPath, options);
  await fs.writeFile(outputPath, prepared.png);
  return {
    width: prepared.metadata.width,
    height: prepared.metadata.height,
    traceWidth: prepared.raw.info.width,
    traceHeight: prepared.raw.info.height,
    traceScale: prepared.trace.scale,
    format: prepared.metadata.format || path.extname(inputPath).slice(1),
    inputFormat: 'png-palette',
    cliInputHandler: 'png',
    background: 'FFFFFF',
    requestedPaletteColors: prepared.colorCount,
    actualPaletteColors: prepared.actualPaletteColors,
    quantization: 'sharp-palette-no-dither'
  };
}

async function prepareFlatPalettePpm(inputPath, outputPath, options = {}) {
  const prepared = await quantizedPalette(inputPath, options);
  const pixels = rgbBuffer(prepared.raw.data, prepared.raw.info);
  const header = Buffer.from(`P6\n${prepared.raw.info.width} ${prepared.raw.info.height}\n255\n`, 'ascii');
  await fs.writeFile(outputPath, Buffer.concat([header, pixels]));
  return {
    width: prepared.metadata.width,
    height: prepared.metadata.height,
    traceWidth: prepared.raw.info.width,
    traceHeight: prepared.raw.info.height,
    traceScale: prepared.trace.scale,
    format: prepared.metadata.format || path.extname(inputPath).slice(1),
    inputFormat: 'ppm-p6',
    cliInputHandler: 'pnm',
    background: 'FFFFFF',
    requestedPaletteColors: prepared.colorCount,
    actualPaletteColors: prepared.actualPaletteColors,
    quantization: 'sharp-palette-no-dither'
  };
}

async function runAutoTraceSpline({ binaryPath, inputPath, outputPath, params }) {
  const args = [
    '-input-format', params.inputFormat || 'png',
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
  const palettePath = path.join(workspace, 'flat-palette-source.png');
  const svgPath = path.join(workspace, 'autotrace-spline.svg');
  try {
    const preset = presetForStrategy(options.strategy);
    const colorCount = clampColorCount(options.paletteColors, preset.defaultColors);
    onProgress?.(56, `AutoTrace: lượng tử hóa ${colorCount} màu phẳng bằng Sharp`);
    const source = await prepareFlatPalettePng(inputPath, palettePath, { paletteColors: colorCount });
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
      inputPath: palettePath,
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
  prepareFlatPalettePng,
  prepareFlatPalettePpm,
  presetForStrategy,
  rgbBuffer,
  runAutoTraceSpline
};
