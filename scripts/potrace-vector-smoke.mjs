import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import serviceModule from '../src/main/services/potraceSmartService.js';

const { vectorizeMonochromeWithPotrace } = serviceModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'potrace-vector-smoke-'));
const inputPath = path.join(workspace, 'potrace-source.jpg');
const outputPath = path.join(workspace, 'potrace-output.svg');

try {
  const artwork = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
      <rect width="900" height="520" fill="#fff"/>
      <path fill="#000" fill-rule="evenodd" d="
        M80 80H245V125H140V215H230V260H140V420H80Z
        M305 80H430C510 80 555 145 555 250S510 420 430 420H305Z
        M365 145H420C465 145 490 180 490 250S465 355 420 355H365Z
        M625 105C690 55 790 85 820 165C845 235 805 320 720 345C660 362 610 335 585 300C660 320 730 292 752 235C772 185 735 130 680 132C650 133 630 145 610 165Z
        M620 385H680V435H620Z
      "/>
    </svg>
  `);

  await sharp(artwork)
    .jpeg({ quality: 78, chromaSubsampling: '4:4:4' })
    .toFile(inputPath);

  const result = await vectorizeMonochromeWithPotrace({
    inputPath,
    outputPath,
    options: { strategy: 'smart', colorMode: 'color', turdSize: 1 },
    sourceAnalysis: { isMonochrome: true, threshold: 150, confidence: 99 }
  });

  const svg = await fs.readFile(result.outputPath, 'utf8');
  const report = JSON.parse(await fs.readFile(result.reportPath, 'utf8'));
  const selected = report.candidates.find((candidate) => candidate.id === report.selectedCandidate);

  assert.equal(report.schemaVersion, 5);
  assert.equal(report.engineRouter.selectedEngine, 'potrace');
  assert.equal(report.engineRouter.sourceType, 'monochrome');
  assert.ok(report.candidates.length >= 2);
  assert.ok(selected);
  assert.ok(selected.trace.engine === 'potrace-js');
  assert.ok(selected.metrics.nodeEstimate > 0);
  assert.ok(selected.metrics.componentValidation.unmatchedSourceComponents === 0);
  assert.match(svg, /<svg\b/i);
  assert.match(svg, /<path\b/i);
  assert.match(svg, /[Cc]/, 'Potrace output should contain smooth cubic curves');
  assert.match(svg, /viewBox="0 0 900 520"/);

  console.log(`Potrace OK: ${report.selectedCandidate}, IoU ${selected.metrics.foregroundIoU}%, ${selected.metrics.nodeEstimate} nodes.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
