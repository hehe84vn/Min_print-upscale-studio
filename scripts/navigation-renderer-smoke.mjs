import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loader = readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../src/renderer/navigation-structure-safe.js', import.meta.url), 'utf8');

assert.match(loader, /loadScript\('navigation-structure-safe\.js'\)/, 'Renderer must load the non-reentrant navigation script.');
assert.doesNotMatch(loader, /loadScript\('navigation-structure\.js'\)/, 'Legacy navigation observer must not be loaded.');
assert.doesNotMatch(navigation, /observe\(document\.body/, 'Navigation copy observers must never watch the complete document body.');
assert.match(navigation, /observeTextTarget\(document\.getElementById\('engineStatus'\)\)/, 'Engine status copy normalization must stay target-scoped.');
assert.match(navigation, /observeTextTarget\(document\.getElementById\('resultBox'\)\)/, 'Result copy normalization must stay target-scoped.');
assert.match(navigation, /benchmarkEyebrow\.textContent !== 'MODEL STUDIO RESULTS'/, 'Static Model Studio copy must be idempotent.');
assert.match(navigation, /vectorNotice\.textContent !== QUICK_VECTOR_NOTICE/, 'Quick Vector notice updates must be idempotent.');

console.log('Navigation renderer smoke test passed.');