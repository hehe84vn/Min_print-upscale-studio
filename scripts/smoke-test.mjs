import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { processImage } = require('../src/main/services/imageService');

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

  const jobs = [
    ['upscale', 'upscale.png', { scale: 2, useNcnn: false, sharpen: true }],
    ['restore', 'restore.png', { scale: 2, denoise: 1, saturation: 1.05, contrast: 1.05 }],
    ['text-print', 'text-print.png', { scale: 2, edge: 1.2 }],
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
