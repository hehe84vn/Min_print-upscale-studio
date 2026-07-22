import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import vectorModule from '../src/main/services/vectorLogoService.js';

const { vectorizeLogo, inspectSvgComplexity, selectedCandidateKeys, safeBackgroundCleanup } = vectorModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-logo-smoke-'));
const colorInputPath = path.join(workspace, 'color-logo-source.png');
const cleanedPath = path.join(workspace, 'logo-cleaned.png');
const colorOutputPath = path.join(workspace, 'color-logo-vector.svg');
const monoInputPath = path.join(workspace, 'mono-logo-source.jpg');
const monoOutputPath = path.join(workspace, 'mono-logo-vector.svg');

try {
  const colorArtwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
      <rect width="640" height="420" fill="#fff"/>
      <path d="M90 210C90 120 155 62 244 62h148c89 0 158 59 158 148s-69 148-158 148H244C155 358 90 300 90 210Z" fill="#1f6b3a"/>
      <circle cx="235" cy="210" r="74" fill="#f2d245"/>
      <path d="M205 210l24 24 48-58" fill="none" stroke="#1b2d22" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M336 154h118v24H336zm0 44h92v24h-92zm0 44h105v24H336z" fill="#fff"/>
    </svg>
  `);
  await sharp(colorArtwork).png().toFile(colorInputPath);

  const cleanup = await safeBackgroundCleanup(colorInputPath, cleanedPath);
  const cleaned = await sharp(cleanedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => cleaned.data[(y * cleaned.info.width + x) * cleaned.info.channels + 3];
  assert.equal(cleanup.applied, true);
  assert.equal(alphaAt(0, 0), 0, 'border background must become transparent');
  assert.ok(alphaAt(350, 165) >= 240, 'internal white logo detail must remain opaque');

  const colorResult = await vectorizeLogo({
    inputPath: colorInputPath,
    outputPath: colorOutputPath,
    options: {
      strategy: 'smart',
      colorMode: 'color',
      backgroundCleanup: true,
      turdSize: 1
    }
  });
  const colorSvg = await fs.readFile(colorResult.outputPath, 'utf8');
  const colorReport = JSON.parse(await fs.readFile(colorResult.reportPath, 'utf8'));
  const colorComplexity = inspectSvgComplexity(colorSvg);
  assert.match(colorSvg, /<svg\b/i);
  assert.equal(colorReport.schemaVersion, 4);
  assert.equal(colorReport.backgroundCleanup.applied, true);
  assert.ok(selectedCandidateKeys('smart').length >= 3);
  assert.ok(colorReport.candidates.length >= 2);
  assert.ok(colorReport.selectedCandidate);
  assert.ok(Number.isFinite(colorReport.selectedScore));
  assert.ok(colorComplexity.shapeCount > 0);
  assert.ok(colorComplexity.nodeEstimate > 0);

  const monoArtwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" viewBox="0 0 900 420">
      <rect width="900" height="420" fill="#fff"/>
      <path fill="#000" fill-rule="evenodd" d="
        M70 70H250V115H125V185H235V230H125V350H70Z
        M320 70H380L455 350H398L382 284H318L302 350H245ZM350 140L328 240H372Z
        M505 70H565V305H690V350H505Z
        M730 70H790V350H730Z
        M810 75H835V102H810Z
        M805 125H840V350H805Z
      "/>
    </svg>
  `);
  await sharp(monoArtwork).jpeg({ quality: 84, chromaSubsampling: '4:4:4' }).toFile(monoInputPath);

  const monoResult = await vectorizeLogo({
    inputPath: monoInputPath,
    outputPath: monoOutputPath,
    options: {
      strategy: 'smart',
      colorMode: 'color',
      backgroundCleanup: true,
      geometryLock: true,
      binaryReconstruction: true,
      turdSize: 1
    }
  });
  const monoSvg = await fs.readFile(monoResult.outputPath, 'utf8');
  const monoReport = JSON.parse(await fs.readFile(monoResult.reportPath, 'utf8'));
  const selected = monoReport.candidates.find((candidate) => candidate.id === monoReport.selectedCandidate);
  assert.equal(monoReport.schemaVersion, 4);
  assert.equal(monoReport.autoMonochrome, true);
  assert.equal(monoReport.effectiveColorMode, 'binary');
  assert.equal(monoReport.source.traceScale, 1, 'monochrome logo must not be enlarged before threshold and trace');
  assert.equal(monoReport.geometryLockEnabled, true);
  assert.equal(monoReport.binaryReconstructionEnabled, true);
  assert.ok(monoReport.candidates.some((candidate) => candidate.id === 'binary-reconstruction'));
  assert.ok(monoReport.candidates.some((candidate) => candidate.id === 'geometry-lock'));
  assert.ok(selected);
  assert.ok(Number.isFinite(selected.metrics.cornerPreservation));
  assert.ok(Number.isFinite(selected.metrics.straightnessScore));
  assert.ok(Number.isFinite(selected.metrics.componentValidation.worstComponentIoU));
  assert.ok(Number.isFinite(selected.metrics.componentValidation.p10ComponentIoU));
  assert.ok(selected.metrics.colorCount <= 2, 'monochrome result must not contain grayscale color layers');
  assert.match(monoSvg, /viewBox="0 0 900 420"/);
  assert.ok(['pass', 'review'].includes(monoReport.qualityGate.status));

  console.log(`Smart Vector color OK: ${colorReport.selectedCandidate}, ${colorComplexity.nodeEstimate} nodes.`);
  console.log(`Binary Vector mono OK: ${monoReport.selectedCandidate}, worst ${selected.metrics.componentValidation.worstComponentIoU}%, ${selected.metrics.colorCount} colors.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}