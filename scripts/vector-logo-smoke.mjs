import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import vectorModule from '../src/main/services/vectorLogoService.js';

const { vectorizeLogo, inspectSvgComplexity, selectedCandidateKeys, safeBackgroundCleanup } = vectorModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-logo-smoke-'));
const inputPath = path.join(workspace, 'logo-source.png');
const cleanedPath = path.join(workspace, 'logo-cleaned.png');
const outputPath = path.join(workspace, 'logo-vector.svg');

try {
  const artwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
      <rect width="640" height="420" fill="#fff"/>
      <path d="M90 210C90 120 155 62 244 62h148c89 0 158 59 158 148s-69 148-158 148H244C155 358 90 300 90 210Z" fill="#1f6b3a"/>
      <circle cx="235" cy="210" r="74" fill="#f2d245"/>
      <path d="M205 210l24 24 48-58" fill="none" stroke="#1b2d22" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M336 154h118v24H336zm0 44h92v24h-92zm0 44h105v24H336z" fill="#fff"/>
    </svg>
  `);
  await sharp(artwork).png().toFile(inputPath);

  const cleanup = await safeBackgroundCleanup(inputPath, cleanedPath);
  const cleaned = await sharp(cleanedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => cleaned.data[(y * cleaned.info.width + x) * cleaned.info.channels + 3];
  assert.equal(cleanup.applied, true);
  assert.equal(alphaAt(0, 0), 0, 'border background must become transparent');
  assert.ok(alphaAt(350, 165) >= 240, 'internal white logo detail must remain opaque');

  const result = await vectorizeLogo({
    inputPath,
    outputPath,
    options: {
      strategy: 'smart',
      colorMode: 'color',
      backgroundCleanup: true,
      turdSize: 1
    }
  });

  const svg = await fs.readFile(result.outputPath, 'utf8');
  const report = JSON.parse(await fs.readFile(result.reportPath, 'utf8'));
  const complexity = inspectSvgComplexity(svg);

  assert.match(svg, /<svg\b/i);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.backgroundCleanup.applied, true);
  assert.ok(selectedCandidateKeys('smart').length >= 3);
  assert.ok(report.candidates.length >= 2);
  assert.ok(report.selectedCandidate);
  assert.ok(Number.isFinite(report.selectedScore));
  assert.ok(complexity.shapeCount > 0);
  assert.ok(complexity.nodeEstimate > 0);

  console.log(`Smart Vector OK: ${report.selectedCandidate}, score ${report.selectedScore}, ${complexity.nodeEstimate} nodes.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
