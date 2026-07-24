import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import qualityModule from '../src/main/services/rasterProductionQualityService.js';

const { resizeBeyondFourX, validateRasterOutput } = qualityModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'raster-quality-smoke-'));
const inputPath = path.join(workspace, 'input.png');
const outputPath = path.join(workspace, 'output.png');

try {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="96" height="48" fill="#f4f4f4"/><text x="8" y="32" font-size="25" font-family="Arial" font-weight="700" fill="#111">ABC 8X</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(inputPath);
  const buffer = await resizeBeyondFourX(inputPath, 768, 384, { edgeStrength: 0.4, edgeDeltaLimit: 7 });
  await sharp(buffer).toFile(outputPath);
  const validation = await validateRasterOutput({ inputPath, outputPath, expectedWidth: 768, expectedHeight: 384 });
  assert.equal(validation.checks.dimensions, 'pass');
  assert.equal(validation.checks.blackFrame, 'pass');
  assert.notEqual(validation.status, 'fail');
  assert.ok(validation.metrics.edgeEnergy > 0.6);
  console.log(`Raster Production Quality V14 OK: ${validation.status}, edge ${validation.metrics.edgeEnergy}.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
