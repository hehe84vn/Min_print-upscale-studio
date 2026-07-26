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
assert.match(ui, /option\.value = 'krea'/);
assert.match(ui, /Krea hoạt động như một nhà cung cấp độc lập/);
assert.match(ui, /jobProviderSelect/);
assert.match(ui, /aiModelSelect/);
assert.match(ui, /topaz-generative/);
assert.match(ui, /topaz-bloom/);
assert.match(ui, /krea-enhance/);
assert.match(ui, /runKreaAsProvider/);
assert.match(ui, /stopImmediatePropagation/);
assert.match(ui, /runKreaBetaEnhance/);
assert.match(ui, /showComparison/);
assert.match(ui, /Chưa có API key Krea/);
assert.doesNotMatch(ui, /kreaBetaEnabled/);
assert.doesNotMatch(ui, /runKreaBetaBtn/);
assert.match(loader, /loadScript\('krea-beta-ui\.js'\)/);
assert.match(deliveryRule, /Không được dùng từ “đã xong”/);

console.log('Krea beta smoke test passed with Krea as a standalone AI Enhance provider.');