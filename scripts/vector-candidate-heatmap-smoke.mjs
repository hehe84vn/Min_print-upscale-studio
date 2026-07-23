import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile('src/renderer/vector-engine-comparison-ui.js', 'utf8');

assert.match(source, /id="vectorEngineHeatmap"/, 'Heatmap control must be present in the engine comparison panel.');
assert.match(source, /function buildHeatmap\(/, 'Heatmap pixel comparison helper must be implemented.');
assert.match(source, /referenceVisible !== candidateVisible/, 'Geometry differences must be detected from alpha coverage.');
assert.match(source, /delta > COLOR_THRESHOLD/, 'Color differences must use an explicit threshold.');
assert.match(source, /canvas\.toDataURL\('image\/png'\)/, 'Heatmap must remain an in-memory preview.');
assert.match(source, /Heatmap chỉ là preview, không thay đổi SVG đầu ra/, 'UI must state that heatmap is non-destructive.');
assert.doesNotMatch(source, /operation:\s*['"]vector-logo['"][\s\S]{0,300}previewHeatmap/, 'Heatmap must not retrace the source image.');

console.log('Vector candidate heatmap V10 smoke test passed.');
