import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/renderer/model-studio-v15-ui.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');

assert.match(source, /scoreModels\(report\)/);
assert.match(source, /printScore\(report\)/);
assert.match(source, /analyzeImage/);
assert.match(source, /Áp dụng đề xuất/);
assert.match(source, /packaging-artwork/);
assert.match(loader, /model-studio-v15-ui\.js/);

console.log('Model Studio Intelligence V15 UI smoke OK.');
