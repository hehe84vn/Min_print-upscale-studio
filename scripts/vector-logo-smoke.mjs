import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import vectorModule from '../src/main/services/vectorLogoService.js';
import potraceRuntimeModule from '../src/main/services/potraceRuntimeService.js';
import autotraceRuntimeModule from '../src/main/services/autotraceRuntimeService.js';

const { vectorizeLogo, inspectSvgComplexity, selectedCandidateKeys, safeBackgroundCleanup } = vectorModule;
const { detectPotraceRuntime } = potraceRuntimeModule;
const { detectAutoTraceRuntime } = autotraceRuntimeModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-logo-smoke-'));
const colorInputPath = path.join(workspace, 'color-logo-source.png');
const cleanedPath = path.join(workspace, 'logo-cleaned.png');
const colorOutputPath = path.join(workspace, 'color-logo-vector.svg');
const monoInputPath = path.join(workspace, 'mono-logo-source.jpg');
const monoOutputPath = path.join(workspace, 'mono-logo-vector.svg');

try {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
    const runtime = detectPotraceRuntime({ platform, arch });
    assert.equal(runtime.supportedTarget, true, `${platform}-${arch} must be recognized`);
    assert.equal(runtime.runtimeType, 'node-package');
    assert.equal(runtime.binaryRequired, false);
  }
  assert.equal(detectPotraceRuntime({ platform: 'linux', arch: 'arm64' }).supportedTarget, false);

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
  const selectedColor = colorReport.candidates.find((candidate) => candidate.id === colorReport.selectedCandidate);
  const autoTraceRuntime = detectAutoTraceRuntime();
  assert.match(colorSvg, /<svg\b/i);
  assert.ok(colorReport.schemaVersion >= 7);
  assert.equal(colorReport.backgroundCleanup.applied, true);
  assert.equal(colorReport.engineRouter.sourceType, 'color');
  assert.ok(colorReport.engineRouter.attemptedEngines.includes('vtracer'));
  assert.ok(colorReport.engineRouter.attemptedEngines.includes('autotrace'));
  assert.ok(['vtracer', 'autotrace'].includes(colorReport.engineRouter.selectedEngine));
  assert.ok(selectedCandidateKeys('smart').length >= 3);
  assert.ok(colorReport.candidates.length >= 2);
  assert.ok(selectedColor);
  assert.ok(Number.isFinite(colorReport.selectedScore));
  assert.ok(Number.isFinite(selectedColor.metrics.fidelity));
  assert.ok(Number.isFinite(selectedColor.metrics.edgeAgreement));
  assert.ok(colorComplexity.shapeCount > 0);
  assert.ok(colorComplexity.nodeEstimate > 0);
  if (autoTraceRuntime.available) {
    assert.ok(colorReport.candidates.some((candidate) => candidate.engine === 'autotrace'));
    assert.equal(colorReport.engineComparison.length, 2);
  } else {
    assert.equal(colorReport.engineRouter.selectedEngine, 'vtracer');
    assert.match(colorReport.engineRouter.fallbackReason, /AutoTrace/);
  }

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
        M590 170C590 110 640 70 700 70C760 70 810 110 810 170C810 230 760 270 700 270C640 270 590 230 590 170ZM645 170C645 205 670 225 700 225C730 225 755 205 755 170C755 135 730 115 700 115C670 115 645 135 645 170Z
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
      turdSize: 1
    }
  });
  const monoSvg = await fs.readFile(monoResult.outputPath, 'utf8');
  const monoReport = JSON.parse(await fs.readFile(monoResult.reportPath, 'utf8'));
  const selected = monoReport.candidates.find((candidate) => candidate.id === monoReport.selectedCandidate);
  assert.equal(monoReport.schemaVersion, 6);
  assert.equal(monoReport.autoMonochrome, true);
  assert.equal(monoReport.effectiveColorMode, 'binary');
  assert.equal(monoReport.source.traceScale, 1, 'monochrome logo must stay at original resolution');
  assert.equal(monoReport.engineRouter.selectedEngine, 'potrace');
  assert.equal(monoReport.engineRouter.actualEngine, 'potrace-js');
  assert.equal(monoReport.engineRouter.fallbackEngine, 'vtracer');
  assert.equal(monoReport.engineRouter.runtime.supportedTarget, true);
  assert.equal(monoReport.engineRouter.runtime.available, true);
  assert.match(monoReport.engineRouter.runtime.packageLicense, /GPL/i);
  assert.ok(monoReport.candidates.some((candidate) => candidate.trace.engine === 'potrace-js'));
  assert.ok(selected);
  assert.ok(Number.isFinite(selected.metrics.foregroundIoU));
  assert.ok(Number.isFinite(selected.metrics.componentValidation.worstComponentIoU));
  assert.ok(Number.isFinite(selected.metrics.componentValidation.p10ComponentIoU));
  assert.equal(selected.metrics.componentValidation.unmatchedSourceComponents, 0);
  assert.ok(selected.metrics.colorCount <= 2, 'monochrome result must not contain grayscale color layers');
  assert.match(monoSvg, /viewBox="0 0 900 420"/);
  assert.match(monoSvg, /fill-rule="evenodd"/i, 'counter and holes must use evenodd fill rule');
  assert.equal(selected.trace.optCurve, true, 'selected Potrace preset must keep curve optimization enabled');
  assert.equal(selected.trace.fillRule, 'evenodd');
  assert.ok(['pass', 'review'].includes(monoReport.qualityGate.status));

  console.log(`Smart Vector color OK: ${colorReport.engineRouter.selectedEngine}, ${colorReport.selectedCandidate}, ${colorComplexity.nodeEstimate} nodes.`);
  console.log(`Potrace mono OK: ${monoReport.selectedCandidate}, IoU ${selected.metrics.foregroundIoU}%, worst ${selected.metrics.componentValidation.worstComponentIoU}%.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
