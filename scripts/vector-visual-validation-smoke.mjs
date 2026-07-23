import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { inspectSvgComplexity } = require('../src/main/services/vectorLogoEngine');
const { enforceVisualValidation } = require('../src/main/services/vectorCleanupRerunService');
const { validateSvgVisual } = require('../src/main/services/vectorVisualValidationService');

const master = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path fill="#146c43" d="M20 20H180V100H20Z"/></svg>';
const identical = await validateSvgVisual(master, master, { renderSize: 512 });
assert.equal(identical.accepted, true, 'Identical SVGs must pass visual validation.');
assert.equal(identical.metrics.shapeIoU, 1, 'Identical SVGs must have perfect Shape IoU.');

const shifted = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path fill="#146c43" d="M35 20H195V100H35Z"/></svg>';
const rejected = await validateSvgVisual(master, shifted, { renderSize: 512 });
assert.equal(rejected.accepted, false, 'Clearly shifted geometry must fail visual validation.');
assert.ok(rejected.metrics.shapeIoU < 0.992, 'Shifted geometry must lower Shape IoU below the safety threshold.');

const fallback = await enforceVisualValidation(
  master,
  'smooth',
  { svg: shifted, stats: {} },
  inspectSvgComplexity(master),
  3,
  { visualValidationOptions: { renderSize: 512 } }
);
assert.equal(fallback.selectedProfile, 'precise', 'Unsafe Smooth output must fall back to Precise when Precise matches Master.');
assert.equal(fallback.visualValidation.fallbackApplied, true, 'Fallback must be reported explicitly.');
assert.equal(fallback.visualValidation.initialProfile, 'smooth');
assert.equal(fallback.visualValidation.finalProfile, 'precise');

console.log('Vector visual validation smoke test passed.');
