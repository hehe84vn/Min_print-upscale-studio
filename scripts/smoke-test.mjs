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
const { createBarcodeMask, decodeBarcode } = require('../src/main/services/barcodeGuardService');
const {
  MASK_REFINEMENT_VERSION,
  createProtectionMask,
  createSemanticTextLogoMask,
  protectedBlend
} = require('../src/main/services/packagingProtectionService');
const {
  PREFLIGHT_VERSION,
  createPreflightContext,
  runPackagingPreflight
} = require('../src/main/services/preflightService');

const sourceSvg = Buffer.from(`
  <svg width="96" height="72" xmlns="http://www.w3.org/2000/svg">
    <rect width="96" height="72" fill="white"/>
    <circle cx="36" cy="36" r="22" fill="black"/>
    <rect x="64" y="18" width="18" height="36" rx="3" fill="#d84b2a"/>
    <text x="8" y="68" font-size="10" fill="black">PACK 01</text>
  </svg>
`);

function invalidBarcodeArtwork() {
  const widths = [2, 1, 3, 2, 4, 1, 2, 3];
  let x = 92;
  let black = true;
  const bars = [];
  for (let index = 0; index < 92; index += 1) {
    const width = widths[index % widths.length];
    if (black) {
      const guard = index < 4 || index > 87 || index === 44 || index === 45;
      bars.push(`<rect x="${x}" y="110" width="${width}" height="${guard ? 150 : 132}" fill="black"/>`);
    }
    x += width;
    black = !black;
  }

  return Buffer.from(`
    <svg width="640" height="420" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="420" fill="white"/>
      <text x="78" y="75" font-size="28" font-family="sans-serif" fill="#164a2a">INVALID EAN ARTWORK</text>
      ${bars.join('')}
      <text x="82" y="292" font-size="30" font-family="monospace" letter-spacing="5" fill="black">8938549876543</text>
      <rect x="55" y="45" width="390" height="300" fill="none" stroke="#d8d8d8" stroke-width="2"/>
    </svg>
  `);
}

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

  const semanticMaskPath = path.join(workspace, 'semantic-mask.png');
  const semanticMask = await createSemanticTextLogoMask({
    inputPath,
    width: 192,
    height: 144,
    sensitivity: 65,
    outputPath: semanticMaskPath
  });
  if (semanticMask.coveragePercent < 0 || semanticMask.coveragePercent >= 100) {
    throw new Error(`Semantic mask coverage is unexpected: ${semanticMask.coveragePercent}%`);
  }
  if (semanticMask.refinementVersion !== MASK_REFINEMENT_VERSION || semanticMask.closeRadius < 1) {
    throw new Error('Semantic mask refinement metadata is missing.');
  }
  const semanticPixels = await sharp(semanticMask.buffer).greyscale().raw().toBuffer();
  const semanticLevels = new Set(semanticPixels).size;
  if (semanticLevels < 8) {
    throw new Error(`Semantic mask has too few feather levels (${semanticLevels}); block refinement may be disabled.`);
  }

  const maskPath = path.join(workspace, 'protection-mask.png');
  const mask = await createProtectionMask({
    inputPath,
    width: 192,
    height: 144,
    sensitivity: 65,
    semanticEnabled: true,
    codeGuardEnabled: false,
    outputPath: maskPath,
    semanticOutputPath: semanticMaskPath
  });
  if (mask.coveragePercent <= 0 || mask.coveragePercent >= 100) {
    throw new Error(`Protection mask coverage is unexpected: ${mask.coveragePercent}%`);
  }
  if (mask.refinementVersion !== MASK_REFINEMENT_VERSION || !mask.structural?.featherSigma) {
    throw new Error('Combined mask refinement metadata is missing.');
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
    semanticEnabled: true,
    codeGuardEnabled: false,
    dpi: 300,
    maskOutputPath: maskPath,
    semanticMaskOutputPath: semanticMaskPath
  });
  const protectedStat = await stat(protectedOutputPath);
  if (
    !blend.protection?.enabled
    || blend.protection.refinementVersion !== MASK_REFINEMENT_VERSION
    || !blend.protection.semantic?.enabled
    || protectedStat.size < 64
  ) {
    throw new Error('Refined semantic protected blend did not produce a valid result.');
  }
  console.log(`Mask refinement ${MASK_REFINEMENT_VERSION} OK: ${blend.protection.coveragePercent}% combined coverage`);

  const preflightContext = await createPreflightContext(inputPath, 320);
  const preflight = await runPackagingPreflight({
    context: preflightContext,
    outputPath: protectedOutputPath,
    semanticMaskPath,
    protection: blend.protection
  });
  if (
    preflight.version !== PREFLIGHT_VERSION
    || !['pass', 'warning'].includes(preflight.status)
    || !Number.isFinite(preflight.score)
    || !preflight.metrics?.color
    || !preflight.metrics?.geometry
    || !preflight.metrics?.halo
  ) {
    throw new Error(`Packaging Preflight returned an invalid result: ${JSON.stringify(preflight)}`);
  }
  console.log(`Packaging Preflight OK: ${preflight.status.toUpperCase()} ${preflight.score}/100`);

  const barcodePath = path.join(workspace, 'invalid-barcode-artwork.png');
  await sharp(invalidBarcodeArtwork()).png().toFile(barcodePath);
  const barcodeDetection = await decodeBarcode(barcodePath);
  if (!barcodeDetection.detected || !barcodeDetection.visualOnly || barcodeDetection.formatName !== 'BARCODE_LIKE') {
    throw new Error(`Visual Barcode Guard fallback failed: ${barcodeDetection.error || barcodeDetection.valuePreview || 'unknown'}`);
  }
  const barcodeMaskPath = path.join(workspace, 'barcode-mask.png');
  const barcodeMask = await createBarcodeMask({
    detection: barcodeDetection,
    width: 1280,
    height: 840,
    outputPath: barcodeMaskPath
  });
  if (!barcodeMask?.rect || (await stat(barcodeMaskPath)).size < 64) {
    throw new Error('Visual Barcode Guard mask was not created.');
  }
  console.log(`Visual Barcode Guard OK: ${barcodeDetection.formatName} confidence ${barcodeDetection.confidence}`);

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
