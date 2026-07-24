'use strict';

const { app, ipcMain, shell } = require('electron');
const { checkForUpdates, RELEASES_URL } = require('./services/updateManagerService');

let registered = false;
let pendingCheck = null;

function registerUpdateManagerIpc() {
  if (registered) return;
  registered = true;

  ipcMain.handle('update:check', async () => {
    if (!pendingCheck) {
      pendingCheck = checkForUpdates({
        currentVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      }).finally(() => { pendingCheck = null; });
    }
    return pendingCheck;
  });

  ipcMain.handle('update:open-release', async (_event, url) => {
    const target = typeof url === 'string' && /^https:\/\/github\.com\//i.test(url) ? url : RELEASES_URL;
    await shell.openExternal(target);
    return { opened: true, url: target };
  });
}

app.whenReady().then(registerUpdateManagerIpc);

module.exports = { registerUpdateManagerIpc };
