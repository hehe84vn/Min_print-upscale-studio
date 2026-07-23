import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loader = readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../src/renderer/vector-auto-cleanup-ui.js', import.meta.url), 'utf8');

assert.match(loader, /loadScript\('vector-auto-cleanup-ui\.js'\)/, 'Renderer must load automatic cleanup after manual cleanup controls.');
assert.match(integration, /operation: 'vector-cleanup'/, 'Automatic integration must reuse the no-retrace cleanup operation.');
assert.match(integration, /profile: 'auto'/, 'Initial cleanup must use the safety-gated Auto profile.');
assert.match(integration, /Đã lưu SVG:/, 'Automatic cleanup must only trigger after a fresh trace result.');
assert.match(integration, /lastTraceSignature/, 'Automatic cleanup must avoid repeated runs for the same trace result.');
assert.match(integration, /masterPathFor\(outputPath\)/, 'Automatic cleanup must always read the immutable Master SVG.');
assert.doesNotMatch(integration, /vectorizeLogo|Potrace|VTracer|AutoTrace/, 'Automatic cleanup integration must not invoke or couple to trace engines.');

console.log('Vector auto cleanup integration smoke test passed.');
