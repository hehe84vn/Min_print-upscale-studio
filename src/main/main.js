const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { SettingsService } = require('./services/settingsService');
const { SecureSecretsService } = require('./services/secureSecretsService');
const engineService = require('./services/engineService');
const benchmarkService = require('./services/benchmarkService');
const { inspectImage, processImage, suggestedOutput } = require('./services/imageService');
const { testConnection } = require('./services/aiProviderService');

let mainWindow;
let settingsService;
let secureSecretsService;

const AI_PROVIDERS = new Set(['gemini', 'openai']);
const AI_SECRET_NAMES = {
  gemini: 'geminiApiKey',
  openai: 'openAiApiKey'
};

const IMAGE_FILTER = {
  name: 'Images',
  extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp']
};

const OUTPUT_FORMATS = {
  png: { extension: '.png', filter: { name: 'PNG image', extensions: ['png'] } },
  jpeg: { extension: '.jpg', filter: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] } },
  tiff: { extension: '.tiff', filter: { name: 'TIFF image', extensions: ['tif', 'tiff'] } },
  webp: { extension: '.webp', filter: { name: 'WebP image', extensions: ['webp'] } }
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#111317',
    title: 'Print Upscale Studio V2.3 Semantic Guard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.removeMenu();
}

function emitProgress(percent, message = '') {
  if (!mainWindow?.isDestroyed()) {
    mainWindow.webContents.send('job:progress', { percent, message });
  }
}

async function getAiSettingsSummary() {
  const settings = await settingsService.read();
  const provider = AI_PROVIDERS.has(settings.aiProvider) ? settings.aiProvider : 'gemini';

  try {
    const [gemini, openai] = await Promise.all([
      secureSecretsService.status(AI_SECRET_NAMES.gemini),
      secureSecretsService.status(AI_SECRET_NAMES.openai)
    ]);
    return { provider, gemini, openai, secureStorageAvailable: true };
  } catch (error) {
    return {
      provider,
      gemini: { configured: false, suffix: null },
      openai: { configured: false, suffix: null },
      secureStorageAvailable: false,
      error: error.message
    };
  }
}

function registerIpc() {
  ipcMain.handle('file:select-input', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn ảnh nguồn',
      properties: ['openFile'],
      filters: [IMAGE_FILTER]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:select-reference', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn ảnh Photoshop Reference',
      properties: ['openFile'],
      filters: [IMAGE_FILTER]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:select-output', async (_event, { inputPath, operation, format }) => {
    if (operation === 'vector-logo') {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: suggestedOutput(inputPath, operation),
        filters: [{ name: 'SVG vector', extensions: ['svg'] }]
      });
      return result.canceled ? null : result.filePath;
    }

    const outputFormat = OUTPUT_FORMATS[format] || OUTPUT_FORMATS.png;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedOutput(inputPath, operation, outputFormat.extension),
      filters: [outputFormat.filter]
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('benchmark:select-output-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục lưu Model Lab',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('file:url', async (_event, filePath) => pathToFileURL(filePath).href);
  ipcMain.handle('image:metadata', async (_event, filePath) => inspectImage(filePath));

  ipcMain.handle('image:process', async (_event, payload) => {
    if (!payload?.inputPath || !payload?.outputPath) throw new Error('Thiếu đường dẫn đầu vào hoặc đầu ra.');
    emitProgress(1, 'Bắt đầu xử lý');
    const outputPath = await processImage({
      ...payload,
      settingsService,
      secureSecretsService,
      onProgress: (percent, message) => emitProgress(percent, message)
    });
    emitProgress(100, 'Hoàn tất');
    return { outputPath };
  });

  ipcMain.handle('benchmark:presets', () => benchmarkService.listPresets());

  ipcMain.handle('benchmark:run', async (_event, payload = {}) => {
    emitProgress(1, 'Khởi tạo Model Lab');
    return benchmarkService.runBenchmark({
      ...payload,
      settingsService,
      onProgress: (percent, message) => emitProgress(percent, message)
    });
  });

  ipcMain.handle('engine:status', () => engineService.getStatus(settingsService));
  ipcMain.handle('engine:auto-detect', () => engineService.autoDetect(settingsService));

  ipcMain.handle('engine:select-binary', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn bộ xử lý cục bộ',
      properties: ['openFile']
    });
    if (!result.canceled) {
      const engineBinary = result.filePaths[0];
      if (process.platform !== 'win32') {
        try { await fs.chmod(engineBinary, 0o755); } catch { /* best effort */ }
      }
      const modelsDirectory = engineService.inferModelsDirectory(engineBinary);
      await settingsService.write({ engineBinary, modelsDirectory });
    }
    return engineService.getStatus(settingsService);
  });

  ipcMain.handle('engine:select-models', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục model cục bộ',
      properties: ['openDirectory']
    });
    if (!result.canceled) await settingsService.write({ modelsDirectory: result.filePaths[0] });
    return engineService.getStatus(settingsService);
  });

  ipcMain.handle('engine:clear', async () => {
    await settingsService.clearEngine();
    return engineService.getStatus(settingsService);
  });

  ipcMain.handle('ai:settings:get', () => getAiSettingsSummary());

  ipcMain.handle('ai:settings:save', async (_event, payload = {}) => {
    const provider = AI_PROVIDERS.has(payload.provider) ? payload.provider : 'gemini';
    const geminiApiKey = typeof payload.geminiApiKey === 'string' ? payload.geminiApiKey.trim() : '';
    const openAiApiKey = typeof payload.openAiApiKey === 'string' ? payload.openAiApiKey.trim() : '';

    await settingsService.write({ aiProvider: provider });
    if (geminiApiKey) await secureSecretsService.set(AI_SECRET_NAMES.gemini, geminiApiKey);
    if (openAiApiKey) await secureSecretsService.set(AI_SECRET_NAMES.openai, openAiApiKey);
    return getAiSettingsSummary();
  });

  ipcMain.handle('ai:settings:clear-key', async (_event, provider) => {
    if (!AI_PROVIDERS.has(provider)) throw new Error('Nhà cung cấp AI không hợp lệ.');
    await secureSecretsService.remove(AI_SECRET_NAMES[provider]);
    return getAiSettingsSummary();
  });

  ipcMain.handle('ai:settings:test', async (_event, provider) => {
    if (!AI_PROVIDERS.has(provider)) throw new Error('Nhà cung cấp AI không hợp lệ.');
    return testConnection({ secureSecretsService, provider });
  });
}

app.whenReady().then(() => {
  settingsService = new SettingsService(app.getPath('userData'));
  secureSecretsService = new SecureSecretsService(app.getPath('userData'));
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
