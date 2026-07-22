'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const sharp = require('sharp');
const vectorEngine = require('./vectorLogoEngine');
const { requireAutoTraceRuntime } = require('./autotraceRuntimeService');

const execFileAsync = promisify(execFile);

const PRESETS = {
  detail: {
    id: 'autotrace-detail',
    label: 'AutoTrace · Giữ chi tiết màu',
    despeckleLevel: 0,
    defaultColors: 24
  },
  balanced: {
    id: 'autotrace-balanced',
    label: 'AutoTrace · Cân bằng màu',
    despeckleLevel: 1,
    defaultColors: 16
  },
  compact: {
    id: 'autotrace-compact',
    label: 'AutoTrace · Ít node',
    despeckleLevel: 2,
    defaultColors: 12
  }
};

function presetForStrategy(strategy = 'smart') {
  if (strategy === 'detail') return PRESETS.detail;
  if (strategy === 'compact') return PRESETS.compact;
  return PRESETS.balanced;
}

function normalizeSvgCanvas(svg, source) {
  return String(svg).replace(/<svg\b([^>]*)>/i, (_match, attributes) => {
    const next = attributes
      .replace(/\swidth=["'][^"']*["']/i, '')
      .replace(/\sheight=["'][^"']*["']/i, '')
      .replace(/\sviewBox=["'][^"']*["']/i, '');
    return `<svg${next} width="${source.width}" height="${source.height}" viewBox="0 0 ${source.traceWidth} ${source.traceHeight}">`;
  });
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

async function prepareAutoTracePpm(inputPath, outputPath, options = {}) {
  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước artwork màu cho AutoTrace.');
  const trace = vectorEngine.traceDimensions(metadata.width, metadata.height, { allowUpscale: false });
  const raw = await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(trace.width, trace.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = rgbBuffer(raw.data, raw.info);
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
    background: 'FFFFFF',
    paletteColors: Number(options.paletteColors) || null
  };
}

async function runAutoTrace({ binaryPath, inputPath, outputPath, params }) {
  const args = [
    '-output-format', 'svg',
    '-output-file', outputPath,
    '-color-count', String(params.colorCount),
    '-background-color', params.backgroundColor,
    '-despeckle-level', String(params.despeckleLevel),
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
    const wrapped = new Error(`AutoTrace CLI thất bại: ${error.stderr || error.message || String(error)}`);
    wrapped.code = 'AUTOTRACE_FAILED';
    wrapped.cause = error;
    wrapped.args = args;
    throw wrapped;
  }
}

async function buildAutoTraceColorCandidate({ inputPath, options = {}, onProgress }) {
  const runtime = requireAutoTraceRuntime();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'print-autotrace-color-'));
  const ppmPath = path.join(workspace, 'autotrace-source.ppm');
  const svgPath = path.join(workspace, 'autotrace-output.svg');
  try {
    const preset = presetForStrategy(options.strategy);
    const colorCount = Number(options.paletteColors) || preset.defaultColors;
    onProgress?.(56, `AutoTrace: chuẩn hóa ${colorCount} màu phẳng`);
    const source = await prepareAutoTracePpm(inputPath, ppmPath, { ...options, paletteColors: colorCount });
    const params = {
      colorCount,
      backgroundColor: 'FFFFFF',
      despeckleLevel: preset.despeckleLevel,
      outputFormat: 'svg',
      outline: true
    };
    onProgress?.(64, 'AutoTrace: đang fit spline cho artwork màu');
    const execution = await runAutoTrace({
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
    const reference = await vectorEngine.comparisonReference(inputPath, { monochrome: false });
    const metrics = await vectorEngine.assessSvg(svg, reference, { monochrome: false });
    return {
      id: preset.id,
      label: preset.label,
      engine: 'autotrace',
      preprocessing: {
        source: 'sharp-rgb-to-ppm',
        inputFormat: 'ppm-p6',
        backgroundColor: params.backgroundColor,
        paletteColors: colorCount,
        traceScale: source.traceScale
      },
      trace: {
        engine: 'autotrace-cli',
        algorithm: 'autotrace',
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
  normalizeSvgCanvas,
  prepareAutoTracePpm,
  presetForStrategy,
  rgbBuffer,
  runAutoTrace
};
