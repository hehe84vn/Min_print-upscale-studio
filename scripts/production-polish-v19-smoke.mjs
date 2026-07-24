import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../src/renderer/production-polish-v19-ui.js', import.meta.url), 'utf8');
const updateUi = fs.readFileSync(new URL('../src/renderer/update-manager-v19-extension.js', import.meta.url), 'utf8');
const updateIpc = fs.readFileSync(new URL('../src/main/updateManagerIpc.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../src/renderer/zoom.js', import.meta.url), 'utf8');

assert.match(ui, /Workspace|Preset công việc|PRESETS/);
assert.match(ui, /Packaging/);
assert.match(ui, /Photo/);
assert.match(ui, /Document/);
assert.match(ui, /Logo/);
assert.match(ui, /Thiết lập nâng cao/);
assert.match(ui, /Queue & Batch Manager/);
assert.match(ui, /selectBatchInputs/);
assert.match(ui, /Lịch sử gần đây/);
assert.match(ui, /HISTORY_KEY/);
assert.match(ui, /wheel/);
assert.match(ui, /dblclick/);
assert.match(ui, /pointermove/);
assert.match(updateUi, /Tải DMG/);
assert.match(updateIpc, /app\.getPath\('downloads'\)/);
assert.match(updateIpc, /shell\.openPath/);
assert.match(updateIpc, /process\.platform === 'win32'/);
assert.match(updateIpc, /process\.platform === 'darwin'/);
assert.match(loader, /production-polish-v19-ui\.js/);
assert.match(loader, /update-manager-v19-extension\.js/);

console.log('V19.1–V19.6 production polish and update validation smoke test passed.');