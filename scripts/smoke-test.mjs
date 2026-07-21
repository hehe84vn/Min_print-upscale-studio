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
const { createProtectionMask, protectedBlend } = require('../src/main/services/packagingProtectionService');

const sourceSvg = Buffer.from(`
  <svg width="96" height="72" xmlns="http://www.w3.org/2000/svg">
    <rect width="96" height="72" fill="white"/>
    <circle cx="36" cy="36" r="22" fill="black"/>
    <rect x="64" y="18" width="18" height="36" rx="3" fill="#d84b2a"/>
    <text x="8" y="68" font-size="10" fill="black">PACK 01</text>
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
  const expectedPresetIds = ['current-photo', 'current-packaging', 'official-detail', 'packaging-hybrid'];
  if (!expectedPresetIds.every((id) => benchmarkPresets.some((preset) => preset.id === id))) {
    throw new Error('Model Lab preset registry is incomplete.');
  }
  if (!EXPERIMENTAL_MODELS.includes('realesrgan-x4plus') || EXPERIMENTAL_MODELS.includes('realesrnet-x4plus')) {
    throw new Error('Experimental Real-ESRGAN model registry is incorrect.');
  }
  const hybrid = benchmarkPresets.find((preset) => preset.id === 'packaging-hybrid');
  if (hybrid?.baseModel !== 'high-fidelity-4x' || hybrid?.detailModel !== 'realesrgan-x4plus') {
    throw new Error('Packaging Hybrid model composition is incorrect.');
  }
  console.log(`Model Lab registry OK: ${benchmarkPresets.length} presets`);

  const maskPath = path.join(workspace, 'protection-mask.png');
  const mask = await createProtectionMask({
    inputPath,
    width: 192,
    height: 144,
    sensitivity: 65,
    outputPath: maskPath
  });
  if (mask.coveragePercent <= 0 || mask.coveragePercent >= 100) {
    throw new Error(`Protection mask coverage is unexpected: ${mask.coveragePercent}%`);
  }
  const basePath = path.join(workspace, 'base.png');
  const detailPath = path.join(workspace, 'detail.png');
  const protectedOutputPath = path.join(workspace, 'protected-blend.png');
  await sharp(inputPath).resize(192, 144).png().toFile(basePath);
  await sharp(inputPath).resize(192, 144).sharpen({ sigma: 1.2 }).png().toFile(detailPath);
  const blend = await protectedBlend({
    sourcePath: inputPath,
    basePath,
    detailPath,
    outputPath: protectedOutputPath,
    strength: 0.2,
    sensitivity: 65,
    dpi: 300,
    maskOutputPath: maskPath
  });
  const protectedStat = await stat(protectedOutputPath);
  if (!blend.protection?.enabled || protectedStat.size < 64) {
    throw new Error('Packaging Safe protected blend did not produce a valid result.');
  }
  console.log(`Protection mask OK: ${blend.protection.coveragePercent}% coverage`);

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
