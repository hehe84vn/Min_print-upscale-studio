import fs from 'node:fs';
import assert from 'node:assert/strict';

const service = fs.readFileSync(new URL('../src/main/services/modelStudioPreviewService.js', import.meta.url), 'utf8');
const ipc = fs.readFileSync(new URL('../src/main/modelStudioV15Ipc.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../src/main/preload.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/renderer/model-studio-v15-suite-ui.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/main/bootstrap.js', import.meta.url), 'utf8');

assert.match(service, /selectSmartTestRegion/);
assert.match(service, /regionReason/);
assert.match(service, /for \(let gy = 0; gy < 5/);
assert.match(service, /crops\[0\]/);
assert.match(service, /normalizeCrop/);
assert.match(service, /qualityScore/);
assert.match(service, /sharpnessGain/);
assert.match(service, /edgeDrift/);
assert.match(service, /haloRisk/);
assert.match(service, /hybridRecommended/);
assert.match(service, /fullImagePreset/);
assert.match(service, /packaging-hybrid/);
assert.match(ipc, /model-studio:preview/);
assert.match(preload, /runModelStudioPreview/);
assert.match(bootstrap, /'model-studio:preview'/);
assert.match(ui, /SMART TEST REGION/);
assert.match(ui, /Phân tích và test vùng đại diện/);
assert.match(ui, /Chọn vùng khác/);
assert.match(ui, /Original crop/);
assert.match(ui, /Áp dụng .*toàn ảnh|Áp dụng model tốt nhất cho toàn ảnh/);
assert.match(ui, /Packaging Hybrid/);
assert.match(loader, /model-studio-v15-suite-ui\.js/);

console.log('Smart Test Region V17 smoke test passed.');