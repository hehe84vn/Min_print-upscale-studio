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

function register() {
  ipcMain.handle('krea-beta:status', () => kreaBetaService.getStatus(requireSecrets()));

  ipcMain.handle('krea-beta:save-key', async (_event, apiKey) => (
    kreaBetaService.saveApiKey(requireSecrets(), apiKey)
  ));

  ipcMain.handle('krea-beta:clear-key', async () => (
    kreaBetaService.clearApiKey(requireSecrets())
  ));

  ipcMain.handle('krea-beta:test', async () => (
    kreaBetaService.testConnection(requireSecrets())
  ));

  ipcMain.handle('krea-beta:select-output', async (_event, payload = {}) => {
    const inputPath = payload.inputPath || '';
    const parsed = path.parse(inputPath);
    const defaultPath = path.join(parsed.dir || app.getPath('pictures'), `${parsed.name || 'image'}-krea-beta.png`);
    const result = await dialog.showSaveDialog({
      title: 'Lưu kết quả Krea Beta',
      defaultPath,
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('krea-beta:enhance', async (_event, payload = {}) => {
    emitProgress({ status: 'preparing', message: 'Đang chuẩn bị gửi ảnh tới Krea...' });
    try {
      const result = await kreaBetaService.enhance({
        secureSecretsService: requireSecrets(),
        inputPath: payload.inputPath,
        outputPath: payload.outputPath,
        options: payload.options || {},
        onProgress: (progress) => emitProgress(progress)
      });
      emitProgress({ status: 'completed', message: 'Krea Beta đã hoàn tất.', ...result });
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
