import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { persistCandidateAssets } = require('../src/main/services/colorVectorRouterService');
const { selectVectorCandidate } = require('../src/main/services/vectorCandidateSelectionService');

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-engine-preview-smoke-'));
const outputPath = path.join(workspace, 'selected.svg');
const vtracerSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#135b42" d="M10 10H90V90H10Z"/></svg>';
const autotraceSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#135b42" d="M12 10H88V90H12Z"/></svg>';

try {
  const assets = await persistCandidateAssets([
    { id: 'vtracer-detail', engine: 'vtracer', label: 'VTracer', svg: vtracerSvg, selected: true, rejected: false, score: 84, consensusScore: 86, metrics: { nodeEstimate: 4 } },
    { id: 'autotrace-color', engine: 'autotrace', label: 'AutoTrace', svg: autotraceSvg, rejected: false, score: 82, consensusScore: 83, metrics: { nodeEstimate: 4 } }
  ], 'vtracer-detail');

  assert.equal(assets.length, 2, 'Both engine candidates must be persisted.');
  assert.equal(assets.filter((asset) => asset.selected).length, 1, 'Exactly one candidate must be marked selected.');
  await Promise.all(assets.map((asset) => fs.access(asset.path)));

  const alternate = assets.find((asset) => asset.engine === 'autotrace');
  const selected = await selectVectorCandidate({
    inputPath: alternate.path,
    outputPath,
    options: {
      candidateId: alternate.id,
      engine: alternate.engine,
      profile: 'precise',
      visualValidation: false
    }
  });

  assert.equal(selected.selectedWithoutRetrace, true, 'Candidate selection must explicitly report no retrace.');
  assert.equal(selected.engine, 'autotrace');
  assert.equal(selected.candidateId, alternate.id);
  assert.equal(await fs.readFile(selected.masterPath, 'utf8'), autotraceSvg, 'Chosen candidate must become the immutable Master SVG.');
  assert.match(await fs.readFile(outputPath, 'utf8'), /<svg\b/i, 'Selection must write a valid SVG output.');

  const renderer = await fs.readFile(new URL('../src/renderer/vector-engine-comparison-ui.js', import.meta.url), 'utf8');
  assert.match(renderer, /vector-candidate-select/, 'Renderer must use the no-retrace candidate selection operation.');
  assert.doesNotMatch(renderer, /operation:\s*['"]vector-logo['"]/, 'Manual override must never call the trace operation again.');

  console.log('Vector engine comparison V9 smoke test passed.');
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}
