import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { inspectImage, processImage } = require('../src/main/services/imageService');
const { buildPrompt } = require('../src/main/services/aiProviderService');
const { listPresets } = require('../src/main/services/benchmarkService');
const { EXPERIMENTAL_MODELS } = require('../src/main/services/engineService');

const sourceSvg = Buffer.from(`
  <svg width="96" height="72" xmlns="http://www.w3.org/2000/svg">
    <rect width="96" height="72" fill="white"/>
    <circle cx="36" cy="36" r="22" fill="black"/>
    <rect x="64" y="18" width="18" height="36" rx="3" fill="#d84b2a"/>
  </svg>
`);

const settingsService = { read: async () => ({}) };
const workspace = await mkdtemp(path.join(os.tmpdir(), 'print-upscale-studio-'));
const inputPath = path.join(workspace, 'input.png');

try {
  await sharp(sourceSvg).png().toFile(inputPath);

  const metadata = await inspectImage(inputPath);
  if (metadata.width !== 96 || metadata.height !== 72 || !metadata.printSizes?.[300]) {
    throw new Error('Print Inspector returned unexpected metadata.');
  }
  console.log(`Inspector OK: ${metadata.width}x${metadata.height}`);

  const prompt = buildPrompt({ mode: 'safe', protectFace: true, protectText: true, protectLogo: true });
  if (!prompt.includes('Preserve every face') || !prompt.includes('Preserve all existing text')) {
    throw new Error('AI Enhance prompt builder omitted protection requirements.');
  }
  console.log('AI prompt builder OK');

  const benchmarkPresets = listPresets();
  const expectedPresetIds = ['current-packaging', 'official-fidelity', 'official-detail', 'packaging-hybrid'];
  if (!expectedPresetIds.every((id) => benchmarkPresets.some((preset) => preset.id === id))) {
    throw new Error('Model Lab preset registry is incomplete.');
  }
  if (!['realesrnet-x4plus', 'realesrgan-x4plus'].every((model) => EXPERIMENTAL_MODELS.includes(model))) {
    throw new Error('Experimental Real-ESRGAN models are not registered.');
  }
  console.log(`Model Lab registry OK: ${benchmarkPresets.length} presets`);

  const jobs = [
    ['upscale', 'upscale.png', { scale: 2, useNcnn: false, sharpen: true, dpi: 300 }],
    ['restore', 'restore.png', { scale: 2, denoise: 1, saturation: 1.05, contrast: 1.05, dpi: 300 }],
    ['text-print', 'text-print.png', { scale: 2, edge: 1.2, dpi: 300 }],
    ['vector-logo', 'vector-logo.svg', {
      colorMode: 'color',
      threshold: 170,
      turdSize: 2,
      invert: false,
      colorPrecision: 6,
      layerDifference: 5
    }]
  ];

  for (const [operation, filename, options] of jobs) {
    const outputPath = path.join(workspace, filename);
    await processImage({
      operation,
      inputPath,
      outputPath,
      options,
      settingsService,
      onProgress: () => {}
    });

    const outputStat = await stat(outputPath);
    if (outputStat.size < 64) throw new Error(`${operation} produced an unexpectedly small file.`);

    if (operation === 'vector-logo') {
      const svg = await readFile(outputPath, 'utf8');
      if (!svg.includes('<svg')) throw new Error('Vector Logo did not produce SVG output.');
    }

    console.log(`Smoke OK: ${operation} (${outputStat.size} bytes)`);
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
