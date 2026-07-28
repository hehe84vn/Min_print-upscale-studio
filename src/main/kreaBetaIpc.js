'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { SecureSecretsService } = require('./services/secureSecretsService');
const kreaBetaService = require('./services/kreaBetaService');

let secureSecretsService = null;

function requireSecrets() {
  if (!secureSecretsService) throw new Error('Krea Beta chưa khởi tạo bộ lưu token an toàn.');
  return secureSecretsService;
}

function emitProgress(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('krea-beta:progress', payload);
  }
}

function outputExtension(value) {
  if (value === 'jpg' || value === 'jpeg') return 'jpg';
  if (value === 'tiff') return 'tif';
  if (value === 'webp') return 'webp';
  return 'png';
}

function outputFilter(extension) {
  const labels = { png: 'PNG image', jpg: 'JPEG image', tif: 'TIFF image', webp: 'WebP image' };
  return { name: labels[extension] || 'Image', extensions: [extension] };
}

function register() {
  ipcMain.handle('krea-beta:status', () => kreaBetaService.getStatus(requireSecrets()));
  ipcMain.handle('krea-beta:save-key', async (_event, apiKey) => kreaBetaService.saveApiKey(requireSecrets(), apiKey));
  ipcMain.handle('krea-beta:clear-key', async () => kreaBetaService.clearApiKey(requireSecrets()));
  ipcMain.handle('krea-beta:test', async () => kreaBetaService.testConnection(requireSecrets()));
  ipcMain.handle('krea-beta:select-output', async (_event, payload = {}) => {
    const inputPath = payload.inputPath || '';
    const parsed = path.parse(inputPath);
    const extension = outputExtension(payload.outputFormat);
    const defaultPath = path.join(parsed.dir || app.getPath('pictures'), `${parsed.name || 'image'}-krea.${extension}`);
    const result = await dialog.showSaveDialog({
      title: 'Lưu kết quả Krea',
      defaultPath,
      filters: [outputFilter(extension)]
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('krea-beta:enhance', async (_event, payload = {}) => {
    emitProgress({ status: 'preparing', message: 'Đang kiểm tra ảnh đầu vào...' });
    try {
      const result = await kreaBetaService.enhance({
        secureSecretsService: requireSecrets(),
        inputPath: payload.inputPath,
        outputPath: payload.outputPath,
        options: payload.options || {},
        onProgress: (progress) => emitProgress(progress)
      });
      emitProgress({ status: 'completed', message: 'Krea đã hoàn tất và hậu kiểm đầu ra.' });
      return result;
    } catch (error) {
      emitProgress({ status: 'failed', message: error.message || String(error) });
      throw error;
    }
  });
}

app.whenReady().then(() => {
  secureSecretsService = new SecureSecretsService(app.getPath('userData'));
  register();
});
