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
assert.match(service, /\/generate\/enhance\/topaz\/standard-enhance/);
assert.match(service, /buildTopazFaithfulPayload/);
assert.match(service, /buildTopazGenerativePayload/);
assert.match(service, /buildTopazBloomPayload/);
assert.match(service, /buildKreaEnhancePayload/);
assert.match(service, /withMetadata\(\{ density: dpi \}\)/);
assert.match(service, /Krea trả về sai kích thước/);
assert.doesNotMatch(service, /apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}/);
assert.match(ipc, /krea-beta:enhance/);
assert.match(preload, /runKreaBetaEnhance/);
assert.match(ui, /runKreaAsProvider/);
assert.match(ui, /long:22000/);
assert.match(loader, /loadScript\('krea-beta-ui\.js'\)/);

assert.match(kiraService, /https:\/\/kiraai\.vn\/api\/v1/);
assert.match(kiraService, /\/images\/generations/);
assert.match(kiraService, /\/chat\/completions/);
assert.match(kiraService, /\/models/);
assert.match(kiraService, /listAllModels/);
assert.match(kiraService, /listImageModels/);
assert.match(kiraService, /assertDirectorModelAvailable/);
assert.match(kiraService, /buildReconstructionPrompt/);
assert.match(kiraService, /parseDirectorJson/);
assert.match(kiraService, /DIRECTOR_MODEL/);
assert.match(kiraService, /gpt-5\.4/);
assert.match(kiraService, /recommended_pipeline/);
assert.match(kiraService, /faithful_upscale_only/);
assert.match(kiraService, /generation_prompt/);
assert.match(kiraService, /image_url/);
assert.match(kiraService, /b64_json/);
assert.match(kiraService, /sourceAnalyzedByVision: true/);
assert.doesNotMatch(kiraService, /apiKey\s*=\s*['"][A-Za-z0-9_-]{20,}/);
assert.match(kiraIpc, /kiraai-beta:enhance/);
assert.match(bootstrap, /'kiraai-beta:enhance'/);
assert.match(preload, /runKiraAiBetaEnhance/);
assert.match(preload, /onKiraAiBetaProgress/);
assert.match(kiraUi, /option\.value = 'kiraai'/);
assert.match(kiraUi, /GPT-5\.4 AI Director/);
assert.match(kiraUi, /Creative Rebuild/);
assert.match(kiraUi, /providerState\.models/);
assert.match(kiraUi, /rebuildMode/);
assert.match(kiraUi, /forceCreativeRebuild/);
assert.match(kiraUi, /GPT-5\.4/);
assert.match(kiraUi, /stopImmediatePropagation/);
assert.match(loader, /loadScript\('kiraai-beta-ui\.js'\)/);
assert.match(deliveryRule, /Không được dùng từ “đã xong”/);

console.log('Cloud provider smoke test passed for Krea and Kira GPT-5.4 Director wiring.');
