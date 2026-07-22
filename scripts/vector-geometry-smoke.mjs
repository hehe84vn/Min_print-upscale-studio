import assert from 'node:assert/strict';
import geometryModule from '../src/main/services/vectorGeometryLock.js';

const {
  applyGeometryLockToSvg,
  inspectPathGeometry,
  normalizeMonochromePaint,
  parsePathData
} = geometryModule;

const source = '<svg width="1000" height="500"><path fill="#060606" d="m0 0c30 .2 70 -.2 100 0l50 .5 50 -.5q25 .3 50 0z"/><path fill="silver" d="M300 20L300.4 200L420 200.3Z"/></svg>';
const locked = applyGeometryLockToSvg(source, {
  lineTolerance: 1,
  axisTolerance: 0.8,
  axisAngleDegrees: 2,
  collinearAngleDegrees: 1.5
});
const geometry = inspectPathGeometry(locked.svg);
const paint = normalizeMonochromePaint(locked.svg);

assert.match(locked.svg, /fill="#000"/);
assert.match(locked.svg, /fill="#fff"/);
assert.equal(locked.stats.parseErrors, 0);
assert.ok(locked.stats.curvesConvertedToLines >= 2);
assert.ok(locked.stats.axisSnaps >= 1);
assert.ok(locked.stats.collinearNodesRemoved >= 1);
assert.equal(geometry.nearLinearCurveCount, 0);
assert.ok(geometry.lineCount >= 2);
assert.deepEqual(new Set(paint.colors), new Set(['#000', '#fff']));
assert.ok(parsePathData('m10 10h20v20h-20z').length >= 5);

console.log(`Geometry Lock OK: ${locked.stats.curvesConvertedToLines} curve→line, ${locked.stats.axisSnaps} snaps, ${locked.stats.collinearNodesRemoved} nodes removed.`);