import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loader = readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../src/renderer/navigation-structure-safe.js', import.meta.url), 'utf8');
const nodePreview = readFileSync(new URL('../src/renderer/vector-node-preview-ui.js', import.meta.url), 'utf8');

assert.match(loader, /loadScript\('navigation-structure-safe\.js'\)/, 'Renderer must load the non-reentrant navigation script.');
assert.match(loader, /loadScript\('vector-node-preview-ui\.js'\)/, 'Renderer must load the vector node preview after Smart Vector controls.');
assert.doesNotMatch(loader, /loadScript\('navigation-structure\.js'\)/, 'Legacy navigation observer must not be loaded.');
assert.doesNotMatch(navigation, /observe\(document\.body/, 'Navigation copy observers must never watch the complete document body.');
assert.match(navigation, /observeTextTarget\(document\.getElementById\('engineStatus'\)\)/, 'Engine status copy normalization must stay target-scoped.');
assert.match(navigation, /observeTextTarget\(document\.getElementById\('resultBox'\)\)/, 'Result copy normalization must stay target-scoped.');
assert.match(navigation, /benchmarkEyebrow\.textContent !== 'MODEL STUDIO RESULTS'/, 'Static Model Studio copy must be idempotent.');
assert.match(navigation, /vectorNotice\.textContent !== QUICK_VECTOR_NOTICE/, 'Quick Vector notice updates must be idempotent.');
assert.match(nodePreview, /MAX_RENDERED_NODES = 2500/, 'Node preview must cap rendered anchors to protect renderer performance.');
assert.match(nodePreview, /Chỉ là lớp preview, không thay đổi file SVG/, 'Node preview must clearly remain non-destructive.');
assert.match(nodePreview, /new MutationObserver\(refreshOverlay\)/, 'Node preview must refresh when the generated SVG changes.');

console.log('Navigation renderer smoke test passed.');
