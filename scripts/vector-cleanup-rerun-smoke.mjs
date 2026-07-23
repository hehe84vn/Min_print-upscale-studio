import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import rerunModule from '../src/main/services/vectorCleanupRerunService.js';
import engineModule from '../src/main/services/vectorLogoEngine.js';

const { masterPathForOutput, rerunVectorCleanup, saveVectorMaster } = rerunModule;
const { inspectSvgComplexity } = engineModule;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-cleanup-rerun-'));
const outputPath = path.join(workspace, 'logo.svg');
const masterSvg = `
<svg width="1000" height="1000" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
  <path fill="#000" d="M20 200C120 80 210 80 300 200C390 320 480 320 570 200C660 80 750 80 840 200Z"/>
  <path fill="#000" d="M100 500L100.02 500.01L300 500.2L500 500.1L800 500Z"/>
</svg>`;

try {
  const masterPath = await saveVectorMaster(outputPath, masterSvg);
  assert.equal(masterPath, masterPathForOutput(outputPath));
  const originalMaster = await fs.readFile(masterPath, 'utf8');

  const smooth = await rerunVectorCleanup({
    inputPath: masterPath,
    outputPath,
    options: { profile: 'smooth' }
  });
  const smoothSvg = await fs.readFile(outputPath, 'utf8');
  assert.equal(smooth.vectorCleanup.profile, 'smooth');
  assert.ok(inspectSvgComplexity(smoothSvg).nodeEstimate <= inspectSvgComplexity(masterSvg).nodeEstimate);

  const precise = await rerunVectorCleanup({
    inputPath: masterPath,
    outputPath,
    options: { profile: 'precise' }
  });
  const preciseSvg = await fs.readFile(outputPath, 'utf8');
  assert.equal(precise.vectorCleanup.profile, 'precise');
  assert.equal(await fs.readFile(masterPath, 'utf8'), originalMaster, 'Master SVG must never be overwritten by cleanup reruns');
  assert.notEqual(preciseSvg.length, 0);
  assert.equal(precise.masterPath, masterPath);

  console.log(`Vector cleanup rerun OK: master ${inspectSvgComplexity(masterSvg).nodeEstimate} nodes, smooth ${smooth.vectorCleanup.nodesAfter}, precise ${precise.vectorCleanup.nodesAfter}.`);
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
