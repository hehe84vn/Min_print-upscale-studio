import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const servicePath = new URL('../src/main/services/kreaBetaService.js', import.meta.url);
const ipcPath = new URL('../src/main/kreaBetaIpc.js', import.meta.url);
const bootstrapPath = new URL('../src/main/bootstrap.js', import.meta.url);
const preloadPath = new URL('../src/main/preload.js', import.meta.url);
const uiPath = new URL('../src/renderer/krea-beta-ui.js', import.meta.url);
const loaderPath = new URL('../src/renderer/zoom.js', import.meta.url);
const rulePath = new URL('../docs/DELIVERY_STATUS_RULE.md', import.meta.url);

const [service, ipc, bootstrap, preload, ui, loader, deliveryRule] = await Promise.all([
  fs.readFile(servicePath, 'utf8'),
  fs.readFile(ipcPath, 'utf8'),
  fs.readFile(bootstrapPath, 'utf8'),
  fs.readFile(preloadPath, 'utf8'),
  fs.readFile(uiPath, 'utf8'),
  fs.readFile(loaderPath, 'utf8'),
  fs.readFile(rulePath, 'utf8')
]);

assert.match(service, /https:\/\/api\.krea\.ai/);
assert.match(service, /kreaBetaApiKey/);
assert.match(service, /Authorization: `Bearer \$\{apiKey\}`/);
assert.match(service, /TERMINAL_STATUSES/);
assert.match(service, /downloadResult/);
assert.match(service, /endpoint\.startsWith\('\/'\)/);
assert.doesNotMatch(service, /apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}/);

assert.match(ipc, /krea-beta:status/);
assert.match(ipc, /krea-beta:save-key/);
assert.match(ipc, /krea-beta:test/);
assert.match(ipc, /krea-beta:enhance/);
assert.match(ipc, /krea-beta:progress/);

assert.match(bootstrap, /'krea-beta:enhance'/);
assert.match(bootstrap, /require\('\.\/kreaBetaIpc'\)/);

assert.match(preload, /getKreaBetaStatus/);
assert.match(preload, /saveKreaBetaKey/);
assert.match(preload, /clearKreaBetaKey/);
assert.match(preload, /testKreaBetaConnection/);
assert.match(preload, /runKreaBetaEnhance/);
assert.match(preload, /onKreaBetaProgress/);

assert.match(ui, /Krea AI Beta/);
assert.match(ui, /kreaBetaApiKeyInput/);
assert.match(ui, /saveKreaBetaKeyBtn/);
assert.match(ui, /testKreaBetaKeyBtn/);
assert.match(ui, /clearKreaBetaKeyBtn/);
assert.match(ui, /getKreaBetaStatus/);
assert.match(ui, /saveKreaBetaKey/);
assert.match(ui, /testKreaBetaConnection/);
assert.match(loader, /loadScript\('krea-beta-ui\.js'\)/);

assert.match(deliveryRule, /Không được dùng từ “đã xong”/);
assert.match(deliveryRule, /UI người dùng nhìn thấy/);
assert.match(deliveryRule, /bộ cài\/artifact/);

console.log('Krea beta smoke test passed with visible settings UI and delivery status rule.');