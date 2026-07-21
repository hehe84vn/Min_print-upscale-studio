import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  createProtectionMask,
  createSemanticTextLogoMask,
  protectedBlend
} = require('../src/main/services/packagingProtectionService');

const sourceSvg = Buffer.from(`
  <svg width="96" height="72" xmlns="http://www.w3.org/2000/svg">
    <rect width="96" height="72" fill="white"/>
    <circle cx="36" cy="36" r="22" fill="black"/>
    <rect x="64" y="18" width="18" height="36" rx="3" fill="#d84b2a"/>
    <text x="8" y="68" font-size="10" fill="black">PACK 01</text>
  </svg>
`);

const qrText = 'PRINT-UPSCALE-STUDIO-V2.3-CODE-GUARD';
const qrFixtureBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAAklEQVR4AewaftIAAAXYSURBVO3BQY7DSBIEQY+E/v/l2L7OgQUMtRqqO90s/YGklQZJaw2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK01SFprkLTWIGmtQdJag6S1BklrDZLWGiStNUhaa5C01iBprUHSWoOktQZJaw2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK01SFprkLTWIGmtQdJaLx6WhL+oLXcl4R1teUoS7mrLSRL+orY8ZZC01iBprUHSWoOktQZJaw2S1nrxxdryrZLwjiTc1ZaTJHxKW07a8pS2fKskfKNB0lqDpLUGSWsNktYaJK01SFprkLTWi18sCZ/Slk9qy5UkfFJb7krCSVtOknClLZ+UhE9py280SFprkLTWIGmtQdJag6S1BklrDZLWeqFfJwknbblrCe9Iwkld9xokrTVIWmuQtNYgaa1B0lqDpLUGSWu90COScKUtJ0k4ScJdbTlJwjuScKUt+m8NktYaJK01SFprkLTWIGmtQdJaL36xtvxWbblShE9qy1Pa8pS2fKNB0lqDpLUGSWsNktYaJK01SFprkLTWi+WhL8qCVfacpKEk7acJOFKW97RlpMkXGnLO5Kgf2eQtNYgaa1B0lqDpLUGSWsNktYaJK314mFt2agtV5LwrdpykoRPaYv+vwZJaw2S1hokrTVIWmuQtNYgaa1B0lovHpaEK205ScJJW06ScKUtJ0k4actdbflWSThpy0kSnpKEK215RxJO2vKNBklrDZLWGiStNUhaa5C01iBprRdfLAknbTlJwklbriThpC1PScI72nJXW06ScNKWu5Jw0paTtlxJwklb/qJB0lqDpLUGSWsNktYaJK01SFprkLRW+oOlkvApbXlKEu5qy0kSTtpyVxJO2vIpSThpy180SFprkLTWIGmtQdJag6S1BklrDZLWSn/woCRcactJEp7SlpMk6PdoyzuScFdbnjJIWmuQtNYgaa1B0lqDpLUGSWsNktZ68bC2fEpbPiUJJ225KwlPactGSdhokLTWIGmtQdJag6S1BklrDZLWevGHJeFT2nKShL8oCU9pyzuScFdbTpJw0pZvNEhaa5C01iBprUHSWoOktQZJaw2S1kp/8KAkXGnLSRJO2nJXEt7RlruScNKWkyR8SltOknDSlitJeEdbPiUJJ205ScKVtjxlkLTWIGmtQdJag6S1BklrDZLWGiStlf7gSyXhpC0nSbirLe9Iwl1tOUnCSVtOknClLSdJeEpbTpLwrdryjQZJaw2S1hokrTVIWmuQtNYgaa1B0lrpDx6UhCtteUoS3tGWu5LwW7XlJAnfqC0bDZLWGiStNUhaa5C01iBprUHSWukP9J9LwpW2vCMJJ225koSTtpwk4a62fFISntKWbzRIWmuQtNYgaa1B0lqDpLUGSWsNktZ68bAk/EVtOWnLlSS8oy0nSbgrCSdtOUnCXUk4actdbXlHEk6ScKUtTxkkrTVIWmuQtNYgaa1B0lqDpLUGSWu9+GJt+VZJ+JS2nCThJAknbfmUJHxKW56ShL9okLTWIGmtQdJag6S1BklrDZLWGiSt9eIXS8KntOWTkqB/SsJTknDSlnck4RsNktYaJK01SFprkLTWIGmtQdJaL/SItlxJwklbTpJwVxKe0paTJJy05SQJV9pykoSTtpy05RsNktYaJK01SFprkLTWIGmtQdJag6S1XugRSbjSlqe05R1JuCsJf1USrrTlKYOktQZJaw2S1hokrTVIWmuQtNYgaa0Xv1hbfqu2fKMkvKMtJ0m40pZ3JOGkLZ+ShN9okLTWIGmtQdJag6S1BklrDZLWGiSt9eKLJeGvSsJdbXlHEq605SQJn5KEd7TlriSctOUdSfhGg6S1BklrDZLWGiStNUhaa5C0VvoDSSsNktYaJK01SFprkLTWIGmtQdJag6S1BklrDZLWGiStNUhaa5C01iBprUHSWoOktQZJaw2S1hokrTVIWmuQtNYgaa1B0lqDpLUGSWsNktYaJK01SFprkLTWIGmtQdJa/wMxS5kR1yGMfwAAAABJRU5ErkJggg==';

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
  if (!blend.protection?.enabled || !blend.protection.semantic?.enabled || protectedStat.size < 64) {
    throw new Error('Semantic protected blend did not produce a valid result.');
  }
  console.log(`Semantic protection OK: ${blend.protection.coveragePercent}% combined coverage`);

  const qrPath = path.join(workspace, 'code-guard-qr.png');
  await writeFile(qrPath, Buffer.from(qrFixtureBase64, 'base64'));
  const qrDetection = await decodeBarcode(qrPath);
  if (!qrDetection.detected || qrDetection.value !== qrText || qrDetection.formatName !== 'QR_CODE') {
    throw new Error(`QR Code Guard decode failed: ${qrDetection.error || qrDetection.valuePreview || 'unknown'}`);
  }
  const qrMaskPath = path.join(workspace, 'qr-mask.png');
  const qrMask = await createBarcodeMask({
    detection: qrDetection,
    width: 512,
    height: 512,
    outputPath: qrMaskPath
  });
  if (!qrMask?.rect || (await stat(qrMaskPath)).size < 64) {
    throw new Error('QR Code Guard mask was not created.');
  }
  console.log(`QR Code Guard OK: ${qrDetection.formatName}`);

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
