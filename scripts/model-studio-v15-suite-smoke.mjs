import fs from 'node:fs';
import assert from 'node:assert/strict';

const service = fs.readFileSync(new URL('../src/main/services/modelStudioPreviewService.js', import.meta.url), 'utf8');
const ipc = fs.readFileSync(new URL('../src/main/modelStudioV15Ipc.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../src/main/preload.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/renderer/model-studio-v15-suite-ui.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/main/bootstrap.js', import.meta.url), 'utf8');

assert.match(service, /selectAutoCrops/);
assert.match(service, /normalizeCrop/);
assert.match(service, /qualityScore/);
assert.match(service, /sharpnessGain/);
assert.match(service, /edgeDrift/);
assert.match(service, /haloRisk/);
assert.match(service, /hybridRecommended/);
assert.match(service, /fullImagePreset/);
assert.match(ipc, /model-studio:preview/);
assert.match(preload, /runModelStudioPreview/);
assert.match(bootstrap, /'model-studio:preview'/);
assert.match(ui, /Auto Preview Crop/);
assert.match(ui, /Chọn crop thủ công/);
assert.match(ui, /Dùng kết quả tốt nhất cho toàn ảnh/);
assert.match(ui, /packaging-hybrid/);
assert.match(loader, /model-studio-v15-suite-ui\.js/);

console.log('Complete Model Studio V15 suite smoke test passed.');
