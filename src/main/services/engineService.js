const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const sharp = require('sharp');

const CORE_MODELS = [
  'upscayl-standard-4x',
  'upscayl-lite-4x',
  'high-fidelity-4x',
  'remacri-4x',
  'ultramix-balanced-4x',
  'ultrasharp-4x',
  'digital-art-4x'
];

const EXPERIMENTAL_MODELS = [
  'realesrnet-x4plus',
  'realesrgan-x4plus'
];

const MODELS = [...CORE_MODELS, ...EXPERIMENTAL_MODELS];

function exists(target) {
  try {
    return Boolean(target) && fs.existsSync(target);
  } catch {
    return false;
  }
}

function runtimeBinary(root) {
  return path.join(root, 'bin', process.platform === 'win32' ? 'upscayl-bin.exe' : 'upscayl-bin');
}

function bundledRuntimeCandidates() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'upscayl-runtime'));
  roots.push(path.resolve(__dirname, '..', '..', '..', 'vendor', 'upscayl', `${process.platform}-${process.arch}`));
  return roots;
}

function findBundledRuntime() {
  for (const root of bundledRuntimeCandidates()) {
    const engineBinary = runtimeBinary(root);
    const modelsDirectory = path.join(root, 'models');
    if (exists(engineBinary) && exists(modelsDirectory)) {
      return {
        source: 'bundled',
        runtimeRoot: root,
        engineBinary,
        modelsDirectory,
        manifestPath: path.join(root, 'runtime-manifest.json')
      };
    }
  }
  return null;
}

function knownEngineCandidates() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    return [
      path.join(local, 'Programs', 'Upscayl', 'resources', 'bin', 'upscayl-bin.exe'),
      path.join(programFiles, 'Upscayl', 'resources', 'bin', 'upscayl-bin.exe')
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin',
      path.join(os.homedir(), 'Applications', 'Upscayl.app', 'Contents', 'Resources', 'bin', 'upscayl-bin')
    ];
  }
  return ['/usr/lib/upscayl/resources/bin/upscayl-bin', '/opt/Upscayl/resources/bin/upscayl-bin'];
}

function inferModelsDirectory(binaryPath) {
  if (!binaryPath) return null;
  const resourceRoot = path.resolve(path.dirname(binaryPath), '..');
  const candidates = [
    path.join(resourceRoot, 'models'),
    path.join(resourceRoot, 'resources', 'models'),
    path.join(resourceRoot, 'ncnn-models')
  ];
  return candidates.find(exists) || null;
}

async function readManifest(manifestPath) {
  if (!exists(manifestPath)) return null;
  try {
    return JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

async function resolveEngine(settingsService) {
  const bundled = findBundledRuntime();
  if (bundled) return bundled;

  const settings = await settingsService.read();
  const engineBinary = settings.engineBinary || null;
  const modelsDirectory = settings.modelsDirectory || inferModelsDirectory(engineBinary);
  if (exists(engineBinary) && exists(modelsDirectory)) {
    return { source: 'external', engineBinary, modelsDirectory, manifestPath: null };
  }
  return { source: 'missing', engineBinary: null, modelsDirectory: null, manifestPath: null };
}

async function getStatus(settingsService) {
  const resolved = await resolveEngine(settingsService);
  const availableModels = resolved.modelsDirectory
    ? MODELS.filter((model) => exists(path.join(resolved.modelsDirectory, `${model}.param`)) && exists(path.join(resolved.modelsDirectory, `${model}.bin`)))
    : [];
  const manifest = await readManifest(resolved.manifestPath);

  return {
    configured: exists(resolved.engineBinary) && exists(resolved.modelsDirectory),
    source: resolved.source,
    engineBinary: resolved.engineBinary,
    modelsDirectory: resolved.modelsDirectory,
    availableModels,
    coreModels: CORE_MODELS,
    experimentalModels: EXPERIMENTAL_MODELS,
    expectedModels: MODELS,
    runtimeVersion: manifest?.releaseTag || null,
    runtimeAsset: manifest?.assetName || null,
    modelSources: manifest?.modelSources || null
  };
}

async function autoDetect(settingsService) {
  const bundled = findBundledRuntime();
  if (bundled) return getStatus(settingsService);

  const engineBinary = knownEngineCandidates().find(exists) || null;
  if (!engineBinary) return getStatus(settingsService);
  if (process.platform !== 'win32') {
    try { await fsp.chmod(engineBinary, 0o755); } catch { /* best effort */ }
  }
  const modelsDirectory = inferModelsDirectory(engineBinary);
  await settingsService.write({ engineBinary, modelsDirectory });
  return getStatus(settingsService);
}

function spawnEngine(binary, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = '';
    const parse = (chunk) => {
      const match = chunk.toString().match(/(\d{1,3}(?:\.\d+)?)\s*%/);
      if (match) onProgress?.(Math.min(95, Math.round(Number(match[1]))));
    };
    child.stdout.on('data', parse);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      parse(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Local AI Engine exited with code ${code}. ${stderr.slice(-1200)}`));
    });
  });
}

async function runNcnnUpscale({ settingsService, inputPath, outputPath, model, scale, onProgress }) {
  const status = await getStatus(settingsService);
  if (!status.configured) throw new Error('Runtime Local AI tích hợp không có trong bộ cài này.');
  if (!status.availableModels.includes(model)) throw new Error(`Không tìm thấy model ${model} trong runtime tích hợp.`);

  if (process.platform !== 'win32') {
    try { await fsp.chmod(status.engineBinary, 0o755); } catch { /* best effort */ }
  }

  const metadata = await sharp(inputPath, { failOn: 'none' }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Không đọc được kích thước ảnh nguồn.');

  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempOutput = path.join(os.tmpdir(), `print-upscale-${token}.png`);
  const sourceExtension = path.extname(inputPath).toLowerCase();
  const nativeInputSupported = ['.png', '.jpg', '.jpeg', '.webp'].includes(sourceExtension);
  const tempInput = nativeInputSupported ? null : path.join(os.tmpdir(), `print-upscale-input-${token}.png`);
  const engineInput = tempInput || inputPath;
  const args = ['-i', engineInput, '-o', tempOutput, '-n', model, '-m', status.modelsDirectory, '-s', '4', '-f', 'png'];

  try {
    if (tempInput) {
      onProgress?.(2, 'Chuẩn hóa ảnh cho Local AI Engine');
      await sharp(inputPath, { failOn: 'none' }).rotate().png({ compressionLevel: 4 }).toFile(tempInput);
    }

    const sourceLabel = EXPERIMENTAL_MODELS.includes(model) ? 'Real-ESRGAN model' : 'Local model';
    onProgress?.(5, `${sourceLabel} · ${model}`);
    await spawnEngine(status.engineBinary, args, onProgress);
    onProgress?.(96, 'Chuẩn hóa kích thước đầu ra');

    const targetWidth = Math.max(1, Math.round(metadata.width * scale));
    const targetHeight = Math.max(1, Math.round(metadata.height * scale));
    await sharp(tempOutput, { failOn: 'none' })
      .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
      .toFile(outputPath);
    onProgress?.(100);
    return outputPath;
  } finally {
    await Promise.all([
      fsp.rm(tempOutput, { force: true }),
      tempInput ? fsp.rm(tempInput, { force: true }) : Promise.resolve()
    ]);
  }
}

module.exports = {
  CORE_MODELS,
  EXPERIMENTAL_MODELS,
  MODELS,
  getStatus,
  autoDetect,
  runNcnnUpscale,
  inferModelsDirectory,
  findBundledRuntime
};
