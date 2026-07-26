import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const servicePath = new URL('../src/main/services/kreaBetaOfficialService.js', import.meta.url);
const kiraServicePath = new URL('../src/main/services/kiraAiBetaService.js', import.meta.url);
const ipcPath = new URL('../src/main/kreaBetaIpc.js', import.meta.url);
const kiraIpcPath = new URL('../src/main/kiraAiBetaIpc.js', import.meta.url);
const bootstrapPath = new URL('../src/main/bootstrap.js', import.meta.url);
const preloadPath = new URL('../src/main/preload.js', import.meta.url);
const uiPath = new URL('../src/renderer/krea-beta-ui.js', import.meta.url);
const kiraUiPath = new URL('../src/renderer/kiraai-beta-ui.js', import.meta.url);
const loaderPath = new URL('../src/renderer/zoom.js', import.meta.url);
const rulePath = new URL('../docs/DELIVERY_STATUS_RULE.md', import.meta.url);

const [service, kiraService, ipc, kiraIpc, bootstrap, preload, ui, kiraUi, loader, deliveryRule] = await Promise.all([
  fs.readFile(servicePath, 'utf8'), fs.readFile(kiraServicePath, 'utf8'), fs.readFile(ipcPath, 'utf8'), fs.readFile(kiraIpcPath, 'utf8'),
  fs.readFile(bootstrapPath, 'utf8'), fs.readFile(preloadPath, 'utf8'), fs.readFile(uiPath, 'utf8'), fs.readFile(kiraUiPath, 'utf8'),
  fs.readFile(loaderPath, 'utf8'), fs.readFile(rulePath, 'utf8')
]);

assert.match(service, /https:\/\/api\.krea\.ai/);
assert.match(service, /\/assets/);
assert.match(service, /\/generate\/enhance\/topaz\/standard-enhance/);
assert.match(service, /\/generate\/enhance\/topaz\/generative-enhance/);
assert.match(service, /\/generate\/enhance\/topaz\/bloom-enhance/);
assert.match(service, /\/generate\/enhance\/krea\/enhance/);
assert.match(service, /model: 'Standard V2'/);
assert.match(service, /upscale_factor: scale/);
assert.match(service, /subject_detection: 'All'/);
assert.match(service, /face_enhancement_strength/);
assert.match(service, /failure_reason/);
assert.doesNotMatch(service, /upscaling_activated/);
assert.doesNotMatch(service, /High Fidelity V2|Text Refine|Recovery V2/);
assert.doesNotMatch(service, /apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}/);

assert.match(ipc, /kreaBetaOfficialService/);
assert.match(ipc, /krea-beta:enhance/);
assert.match(bootstrap, /'krea-beta:enhance'/);
assert.match(preload, /runKreaBetaEnhance/);
assert.match(preload, /onKreaBetaProgress/);
assert.match(ui, /option\.value = 'krea'/);
assert.match(ui, /runKreaAsProvider/);
assert.match(loader, /loadScript\('krea-beta-ui\.js'\)/);

assert.match(kiraService, /https:\/\/kiraai\.vn\/api\/v1/);
assert.match(kiraService, /\/images\/generations/);
assert.match(kiraService, /kira-3\.0-image/);
assert.match(kiraService, /kira-2\.0-image/);
assert.match(kiraService, /aspect_ratio/);
assert.doesNotMatch(kiraService, /\/chat\/completions/);
assert.doesNotMatch(kiraService, /apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}/);
assert.match(kiraIpc, /kiraai-beta:enhance/);
assert.match(bootstrap, /'kiraai-beta:enhance'/);
assert.match(preload, /runKiraAiBetaEnhance/);
assert.match(preload, /onKiraAiBetaProgress/);
assert.match(kiraUi, /option\.value = 'kiraai'/);
assert.match(kiraUi, /KiraAI\.vn Beta/);
assert.match(kiraUi, /stopImmediatePropagation/);
assert.match(loader, /loadScript\('kiraai-beta-ui\.js'\)/);
assert.match(deliveryRule, /Không được dùng từ “đã xong”/);

console.log('Cloud provider smoke test passed for Krea and KiraAI beta wiring.');
