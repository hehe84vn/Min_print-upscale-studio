'use strict';

const { app, ipcMain, BrowserWindow } = require('electron');
const { SettingsService } = require('./services/settingsService');
const { runPreview } = require('./services/modelStudioPreviewService');

let registered = false;

function emitProgress(percent, message) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('job:progress', { percent, message });
  }
}

function registerModelStudioV15Ipc() {
  if (registered) return;
  registered = true;
  const settingsService = new SettingsService(app.getPath('userData'));
  ipcMain.handle('model-studio:preview', async (_event, payload = {}) => runPreview({
    settingsService,
    inputPath: payload.inputPath,
    crops: payload.crops,
    models: payload.models,
    scale: payload.scale || 2,
    onProgress: emitProgress
  }));
}

app.whenReady().then(registerModelStudioV15Ipc);

module.exports = { registerModelStudioV15Ipc };
