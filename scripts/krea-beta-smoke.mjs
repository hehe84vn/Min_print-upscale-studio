import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const servicePath = new URL('../src/main/services/kreaBetaService.js', import.meta.url);
const ipcPath = new URL('../src/main/kreaBetaIpc.js', import.meta.url);
const bootstrapPath = new URL('../src/main/bootstrap.js', import.meta.url);
const preloadPath = new URL('../src/main/preload.js', import.meta.url);
const uiPath = new URL('../src/renderer/krea-beta-ui.js', import.meta.url);
const loaderPath = new URL('../src/renderer/zoom.js', import.meta.url);
const moduleDocPath = new URL('../docs/KREA_BETA_MODULE.md', import.meta.url);
const rulePath = new URL('../docs/DELIVERY_STATUS_RULE.md', import.meta.url);
const removedPaths = [
  new URL('../src/main/services/kiraAiBetaService.js', import.meta.url),
  new URL('../src/main/kiraAiBetaIpc.js', import.meta.url),
  new URL('../src/renderer/kiraai-beta-ui.js', import.meta.url),
  new URL('../src/main/services/kreaBetaOfficialService.js', import.meta.url)
];

const [service, ipc, bootstrap, preload, ui, loader, moduleDoc, deliveryRule] = await Promise.all([
  fs.readFile(servicePath, 'utf8'),
  fs.readFile(ipcPath, 'utf8'),
  fs.readFile(bootstrapPath, 'utf8'),
  fs.readFile(preloadPath, 'utf8'),
  fs.readFile(uiPath, 'utf8'),
  fs.readFile(loaderPath, 'utf8'),
  fs.readFile(moduleDocPath, 'utf8'),
  fs.readFile(rulePath, 'utf8')
]);

assert.match(service, /https:\/\/api\.krea\.ai/);
assert.match(service, /\/generate\/enhance\/topaz\/standard-enhance/);
assert.match(service, /\/generate\/enhance\/topaz\/generative-enhance/);
assert.match(service, /\/generate\/enhance\/topaz\/bloom-enhance/);
assert.match(service, /\/generate\/enhance\/krea\/enhance/);
assert.match(service, /Upscale High Fidelity V3/);
assert.match(service, /Text Refine/);
assert.match(service, /Low Resolution V2/);
assert.match(service, /Recovery V2/);
assert.match(service, /requestWithRetry/);
assert.match(service, /RETRY_DELAYS_MS/);
assert.match(service, /CMYK đầu vào chưa được hỗ trợ/);
assert.match(service, /normalizedToExactGeometry/);
assert.match(service, /aspectDrift > 0\.005/);
assert.match(service, /rescale_color/);
assert.match(service, /resemblance_strength/);
assert.doesNotMatch(service, /debug\s*:/);
assert.doesNotMatch(service, /apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}/);

assert.match(ipc, /require\('\.\/services\/kreaBetaService'\)/);
assert.match(ipc, /krea-beta:enhance/);
assert.match(preload, /runKreaBetaEnhance/);
assert.match(ui, /Print Faithful · High Fidelity V3/);
assert.match(ui, /Text & Graphic · Text Refine/);
assert.match(ui, /presetId:/);
assert.match(ui, /long:22000/);
assert.match(loader, /loadScript\('krea-beta-ui\.js'\)/);
assert.match(moduleDoc, /Krea-only/);

for (const source of [bootstrap, preload, ui, loader, moduleDoc]) {
  assert.doesNotMatch(source, /kiraai|KiraAI|kiraAi/i);
}
for (const removedPath of removedPaths) {
  await assert.rejects(fs.access(removedPath));
}
assert.match(deliveryRule, /Không được dùng từ “đã xong”/);

console.log('Krea-only cloud provider smoke test passed with preset routing, retry and geometry QA wiring.');
