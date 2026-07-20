const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const sharp = require('sharp');

const MODELS = [
  'upscayl-standard-4x',
  'upscayl-lite-4x',
  'high-fidelity-4x',
  'remacri-4x',
  'ultramix-balanced-4x',
  'ultrasharp-4x',
  'digital-art-4x'
];

function exists(target) {
  try {
    return Boolean(target) && fs.existsSync(target);
  } catch {
    return false;
  }
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

  return [
    '/usr/lib/upscayl/resources/bin/upscayl-bin',
    '/opt/Upscayl/resources/bin/upscayl-bin'
  ];
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

async function getStatus(settingsService) {
  const settings = await settingsService.read();
  const engineBinary = settings.engineBinary || null;
  const modelsDirectory = settings.modelsDirectory || inferModelsDirectory(engineBinary);
  const availableModels = modelsDirectory
    ? MODELS.filter((model) => exists(path.join(modelsDirectory, `${model}.param`)) && exists(path.join(modelsDirectory, `${model}.bin`)))
    : [];

  return {
    configured: exists(engineBinary) && exists(modelsDirectory),
    engineBinary,
    modelsDirectory,
    availableModels,
    expectedModels: MODELS
  };
}

async function autoDetect(settingsService) {
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
      const text = chunk.toString();
      const match = text.match(/(\d{1,3})\s*%/);
      if (match) onProgress?.(Math.min(95, Number(match[1])));
    };

    child.stdout.on('data', parse);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      parse(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`upscayl-bin exited with code ${code}. ${stderr.slice(-1200)}`));
    });
  });
}

async function runNcnnUpscale({ settingsService, inputPath, outputPath, model, scale, onProgress }) {
  const status = await getStatus(settingsService);
  if (!status.configured) throw new Error('Upscayl NCNN engine is not configured.');
  if (!status.availableModels.includes(model)) {
    throw new Error(`Model ${model} was not found in the selected model directory.`);
  }

  const metadata = await sharp(inputPath).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot read source image dimensions.');

  const tempOutput = path.join(os.tmpdir(), `print-upscale-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  const args = ['-i', inputPath, '-o', tempOutput, '-n', model, '-m', status.modelsDirectory, '-s', '4', '-f', 'png'];

  try {
    onProgress?.(5);
    await spawnEngine(status.engineBinary, args, onProgress);
    onProgress?.(96);

    const targetWidth = Math.max(1, Math.round(metadata.width * scale));
    const targetHeight = Math.max(1, Math.round(metadata.height * scale));
    await sharp(tempOutput)
      .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
      .toFile(outputPath);

    onProgress?.(100);
    return outputPath;
  } finally {
    await fsp.rm(tempOutput, { force: true });
  }
}

module.exports = {
  MODELS,
  getStatus,
  autoDetect,
  runNcnnUpscale,
  inferModelsDirectory
};
