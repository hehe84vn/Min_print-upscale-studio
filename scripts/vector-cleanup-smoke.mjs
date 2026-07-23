import assert from 'node:assert/strict';
import cleanupModule from '../src/main/services/vectorCleanupService.js';
import engineModule from '../src/main/services/vectorLogoEngine.js';

const { cleanupVectorSvg } = cleanupModule;
const { inspectSvgComplexity } = engineModule;

const noisySvg = `
<svg width="1000" height="1000" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
  <path fill="#000" d="M10 10L10.01 10.01L300 10.2L600 10.1L900 10Z"/>
  <path fill="#000" d="M10 10L10.01 10.01L300 10.2L600 10.1L900 10Z"/>
  <path fill="#000" d="M500 500L500.02 500.01L500.03 500.02Z"/>
  <path fill="#000" d="M100 100L300 100L300 300L100 300L100.2 100.1"/>
  <path fill="#000" d="M50 700C150 700 250 700.1 350 700L650 700"/>
</svg>`;

const before = inspectSvgComplexity(noisySvg);
const cleaned = cleanupVectorSvg(noisySvg, { profile: 'balanced', pathPrecision: 3 });
const after = inspectSvgComplexity(cleaned.svg);

assert.equal(cleaned.stats.pathCountBefore, 5);
assert.ok(cleaned.stats.pathCountAfter < cleaned.stats.pathCountBefore, 'cleanup must remove duplicate/tiny paths');
assert.ok(cleaned.stats.duplicatePathsRemoved >= 1, 'duplicate path should be removed');
assert.ok(cleaned.stats.tinyPathsRemoved >= 1, 'tiny path should be removed');
assert.ok(cleaned.stats.microSegmentsRemoved >= 1, 'micro segments should be removed');
assert.ok(cleaned.stats.collinearNodesRemoved >= 1 || cleaned.stats.curvesConvertedToLines >= 1, 'straight geometry should be simplified');
assert.ok(cleaned.stats.autoClosedSubpaths >= 1, 'near-closed subpath should be closed');
assert.ok(after.nodeEstimate < before.nodeEstimate, `node count should decrease (${before.nodeEstimate} -> ${after.nodeEstimate})`);
assert.doesNotMatch(cleaned.svg, /500\.02/);

console.log(`Vector cleanup OK: ${before.nodeEstimate} -> ${after.nodeEstimate} nodes, ${cleaned.stats.pathCountBefore} -> ${cleaned.stats.pathCountAfter} paths.`);
