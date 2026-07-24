import fs from 'node:fs';
import assert from 'node:assert/strict';

const service = fs.readFileSync(new URL('../src/main/services/updateManagerService.js', import.meta.url), 'utf8');
const ipc = fs.readFileSync(new URL('../src/main/updateManagerIpc.js', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../src/main/preload.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/main/bootstrap.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/renderer/update-manager-v16-ui.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');

assert.match(service, /api\.github\.com\/repos/);
assert.match(service, /compareVersions/);
assert.match(service, /assetForPlatform/);
assert.match(service, /draft \|\| release\.prerelease/);
assert.match(ipc, /update:check/);
assert.match(ipc, /update:open-release/);
assert.match(preload, /checkForUpdates/);
assert.match(preload, /openUpdateRelease/);
assert.match(bootstrap, /updateManagerIpc/);
assert.match(ui, /Kiểm tra cập nhật/);
assert.match(ui, /GitHub Releases/);
assert.match(ui, /setTimeout\(\(\) => checkForUpdates/);
assert.match(loader, /update-manager-v16-ui\.js/);

console.log('Update Manager V16 smoke test passed.');
