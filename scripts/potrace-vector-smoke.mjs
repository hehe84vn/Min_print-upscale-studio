import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import serviceModule from '../src/main/services/potraceSmartService.js';

const { vectorizeMonochromeWithPotrace } = serviceModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'potrace-vector-smoke-'));

async function runCase({ name, artwork, width, height, requireCurve = false }) {
  const inputPath = path.join(workspace, `${name}-source.jpg`);
  const outputPath = path.join(workspace, `${name}-output.svg`);

  await sharp(Buffer.from(artwork))
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

  assert.ok(report.schemaVersion >= 6);
  assert.equal(report.engineRouter.selectedEngine, 'potrace');
  assert.equal(report.engineRouter.sourceType, 'monochrome');
  assert.ok(report.candidates.length >= 2);
  assert.ok(selected);
  assert.equal(selected.trace.engine, 'potrace-js');
  assert.ok(selected.metrics.nodeEstimate > 0);
  assert.equal(selected.metrics.componentValidation.unmatchedSourceComponents, 0);
  assert.match(svg, /<svg\b/i);
  assert.match(svg, /<path\b/i);
  assert.match(svg, new RegExp(`viewBox="0 0 ${width} ${height}"`));
  assert.match(svg, /fill-rule="evenodd"/i);

  if (requireCurve) {
    assert.match(svg, /[Cc]/, 'Curved Potrace benchmark should contain cubic Bezier commands');
  }

  return { report, selected };
}

try {
  const geometry = await runCase({
    name: 'geometry',
    width: 900,
    height: 520,
    artwork: `
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
        <rect width="900" height="520" fill="#fff"/>
        <path fill="#000" fill-rule="evenodd" d="
          M80 80H245V125H140V215H230V260H140V420H80Z
          M305 80H430V420H305Z
          M365 145H420V355H365Z
          M620 385H680V435H620Z
        "/>
      </svg>
    `
  });

  const curved = await runCase({
    name: 'curved',
    width: 900,
    height: 520,
    requireCurve: true,
    artwork: `
      <svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
        <rect width="900" height="520" fill="#fff"/>
        <circle cx="235" cy="255" r="150" fill="#000"/>
        <circle cx="235" cy="255" r="72" fill="#fff"/>
        <ellipse cx="610" cy="255" rx="190" ry="125" fill="#000"/>
        <ellipse cx="610" cy="255" rx="105" ry="55" fill="#fff"/>
      </svg>
    `
  });

  console.log(`Potrace geometry OK: ${geometry.report.selectedCandidate}, ${geometry.selected.metrics.nodeEstimate} nodes.`);
  console.log(`Potrace curves OK: ${curved.report.selectedCandidate}, IoU ${curved.selected.metrics.foregroundIoU}%, ${curved.selected.metrics.nodeEstimate} nodes.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
