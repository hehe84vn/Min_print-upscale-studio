import assert from 'node:assert/strict';
import cleanupModule from '../src/main/services/vectorCleanupService.js';
import bezierModule from '../src/main/services/vectorBezierOptimizer.js';
import geometryModule from '../src/main/services/vectorGeometryLock.js';
import engineModule from '../src/main/services/vectorLogoEngine.js';

const { cleanupVectorSvg } = cleanupModule;
const { optimizeBezierSegments } = bezierModule;
const { parsePathData } = geometryModule;
const { inspectSvgComplexity } = engineModule;

const noisySvg = `
<svg width="1000" height="1000" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
  <path fill="#000" d="M10 10L10.01 10.01L300 10.2L600 10.1L900 10Z"/>
  <path fill="#000" d="M10 10L10.01 10.01L300 10.2L600 10.1L900 10Z"/>
  <path fill="#000" d="M500 500L500.02 500.01L500.03 500.02Z"/>
  <path fill="#000" d="M100 100L300 100L300 300L100 300L100.2 100.1"/>
  <path fill="#000" d="M50 700C150 700 250 700.1 350 700L650 700"/>
  <path fill="#000" d="M100 500C200 300 300 300 400 500C500.5 700 600 700 700 500"/>
</svg>`;

const before = inspectSvgComplexity(noisySvg);
const cleaned = cleanupVectorSvg(noisySvg, { profile: 'balanced', pathPrecision: 3 });
const after = inspectSvgComplexity(cleaned.svg);

assert.equal(cleaned.stats.pathCountBefore, 6);
assert.ok(cleaned.stats.pathCountAfter < cleaned.stats.pathCountBefore, 'cleanup must remove duplicate/tiny paths');
assert.ok(cleaned.stats.duplicatePathsRemoved >= 1, 'duplicate path should be removed');
assert.ok(cleaned.stats.tinyPathsRemoved >= 1, 'tiny path should be removed');
assert.ok(cleaned.stats.microSegmentsRemoved >= 1, 'micro segments should be removed');
assert.ok(cleaned.stats.collinearNodesRemoved >= 1 || cleaned.stats.curvesConvertedToLines >= 1, 'straight geometry should be simplified');
assert.ok(cleaned.stats.autoClosedSubpaths >= 1, 'near-closed subpath should be closed');
assert.ok(cleaned.stats.tangentJunctionsSmoothed >= 1, 'small Bezier tangent jitter should be smoothed');
assert.ok(cleaned.stats.maximumBezierDeviation <= cleaned.stats.bezierErrorTolerance, 'Bezier edits must stay inside the configured error bound');
assert.ok(after.nodeEstimate < before.nodeEstimate, `node count should decrease (${before.nodeEstimate} -> ${after.nodeEstimate})`);
assert.doesNotMatch(cleaned.svg, /500\.02/);

const mergeable = parsePathData('M0 0C30 0 60 0 100 0C140 0 170 0 200 0');
const merged = optimizeBezierSegments(mergeable, {
  errorTolerance: 0.01,
  junctionTolerance: 0.01,
  smoothAngleDegrees: 8,
  mergeAngleDegrees: 3
});
assert.equal(merged.stats.cubicPairsMerged, 1, 'two collinear cubic spans should collapse into one cubic');
assert.equal(merged.segments.filter((segment) => segment.type === 'C').length, 1);

const corner = parsePathData('M0 0C30 0 70 0 100 0C100 30 100 70 100 100');
const preserved = optimizeBezierSegments(corner, {
  errorTolerance: 2,
  junctionTolerance: 0.01,
  smoothAngleDegrees: 12,
  mergeAngleDegrees: 5
});
assert.equal(preserved.stats.tangentJunctionsSmoothed, 0, 'a true 90-degree corner must not be rounded');
assert.equal(preserved.stats.cubicPairsMerged, 0, 'a true corner must not be merged');

console.log(`Vector cleanup V2 OK: ${before.nodeEstimate} -> ${after.nodeEstimate} nodes, ${cleaned.stats.tangentJunctionsSmoothed} tangents smoothed, ${cleaned.stats.cubicPairsMerged} curve pairs merged.`);
