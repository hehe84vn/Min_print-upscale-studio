'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { SecureSecretsService } = require('./services/secureSecretsService');
const kiraAiService = require('./services/kiraAiBetaService');

let secureSecretsService = null;
function requireSecrets() { if (!secureSecretsService) throw new Error('KiraAI chưa khởi tạo bộ lưu key an toàn.'); return secureSecretsService; }
function emitProgress(payload) { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('kiraai-beta:progress', payload); }

function register() {
  ipcMain.handle('kiraai-beta:status', () => kiraAiService.getStatus(requireSecrets()));
  ipcMain.handle('kiraai-beta:save-key', (_event, apiKey) => kiraAiService.saveApiKey(requireSecrets(), apiKey));
  ipcMain.handle('kiraai-beta:clear-key', () => kiraAiService.clearApiKey(requireSecrets()));
  ipcMain.handle('kiraai-beta:test', () => kiraAiService.testConnection(requireSecrets()));
  ipcMain.handle('kiraai-beta:select-output', async (_event, payload = {}) => {
    const parsed = path.parse(payload.inputPath || '');
    const defaultPath = path.join(parsed.dir || app.getPath('pictures'), `${parsed.name || 'image'}-kiraai.png`);
    const result = await dialog.showSaveDialog({ title: 'Lưu kết quả KiraAI.vn', defaultPath, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('kiraai-beta:enhance', async (_event, payload = {}) => {
    emitProgress({ status: 'preparing', message: 'Đang chuẩn bị gửi ảnh tới KiraAI.vn...' });
    try {
      const result = await kiraAiService.enhance({ secureSecretsService: requireSecrets(), inputPath: payload.inputPath, outputPath: payload.outputPath, options: payload.options || {}, onProgress: emitProgress });
      emitProgress({ status: 'completed', message: 'KiraAI.vn đã hoàn tất.', ...result });
      return result;
    } catch (error) {
      emitProgress({ status: 'failed', message: error.message || String(error) });
      throw error;
    }
  });
}

app.whenReady().then(() => { secureSecretsService = new SecureSecretsService(app.getPath('userData')); register(); });