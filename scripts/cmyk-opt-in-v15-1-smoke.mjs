import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/renderer/cmyk-opt-in-v15-1.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');

assert.match(source, /id="createCmykTiff"/);
assert.match(source, /modeSelect\.value = enabled \? 'rgb-cmyk' : 'rgb-only'/);
assert.match(source, /RGB Master luôn được giữ/);
assert.match(source, /defaultMode\.value = 'rgb-only'/);
assert.match(loader, /cmyk-opt-in-v15-1\.js/);

console.log('CMYK opt-in V15.1 smoke test passed.');
