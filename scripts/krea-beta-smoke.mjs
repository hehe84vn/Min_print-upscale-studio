import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const servicePath = new URL('../src/main/services/kreaBetaOfficialService.js', import.meta.url);
const ipcPath = new URL('../src/main/kreaBetaIpc.js', import.meta.url);
const bootstrapPath = new URL('../src/main/bootstrap.js', import.meta.url);
const preloadPath = new URL('../src/main/preload.js', import.meta.url);
const uiPath = new URL('../src/renderer/krea-beta-ui.js', import.meta.url);
const loaderPath = new URL('../src/renderer/zoom.js', import.meta.url);
const rulePath = new URL('../docs/DELIVERY_STATUS_RULE.md', import.meta.url);

const [service, ipc, bootstrap, preload, ui, loader, deliveryRule] = await Promise.all([
  fs.readFile(servicePath, 'utf8'), fs.readFile(ipcPath, 'utf8'), fs.readFile(bootstrapPath, 'utf8'),
  fs.readFile(preloadPath, 'utf8'), fs.readFile(uiPath, 'utf8'), fs.readFile(loaderPath, 'utf8'), fs.readFile(rulePath, 'utf8')
]);

assert.match(service, /https:\/\/api\.krea\.ai/);
assert.match(service, /\/assets/);
assert.match(service, /\/generate\/enhance\/topaz\/standard-enhance/);
assert.match(service, /\/generate\/enhance\/topaz\/generative-enhance/);
assert.match(service, /\/generate\/enhance\/topaz\/bloom-enhance/);
assert.match(service, /\/generate\/enhance\/krea\/enhance/);
assert.match(service, /image_url/);
assert.match(service, /image_scaling_factor/);
assert.match(service, /Content-Type': 'application\/json'/);
assert.match(service, /TERMINAL_STATUSES/);
assert.doesNotMatch(service, /apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}/);

assert.match(ipc, /kreaBetaOfficialService/);
assert.match(ipc, /krea-beta:status/);
assert.match(ipc, /krea-beta:enhance/);
assert.match(bootstrap, /'krea-beta:enhance'/);
assert.match(preload, /runKreaBetaEnhance/);
assert.match(preload, /onKreaBetaProgress/);

assert.match(ui, /Krea AI Beta/);
assert.match(ui, /kreaBetaApiKeyInput/);
assert.doesNotMatch(ui, /kreaBetaEndpointInput/);
assert.match(ui, /kreaBetaModel/);
assert.match(ui, /topaz-generative/);
assert.match(ui, /topaz-bloom/);
assert.match(ui, /krea-enhance/);
assert.match(ui, /kreaBetaEnabled/);
assert.match(ui, /kreaBetaRunMode/);
assert.match(ui, /runKreaBetaBtn/);
assert.match(ui, /kreaBetaBeforeSelect/);
assert.match(ui, /kreaBetaAfterSelect/);
assert.match(ui, /showComparisonUrls/);
assert.match(ui, /operation: 'upscale'/);
assert.match(ui, /SUPPORTED_TOOLS.*ai-enhance.*restore.*vector-logo/s);
assert.match(loader, /loadScript\('krea-beta-ui\.js'\)/);
assert.match(deliveryRule, /Không được dùng từ “đã xong”/);

console.log('Krea beta smoke test passed with official model endpoints, asset upload and A/B comparison UI.');
