'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, ipcMain, shell, BrowserWindow } = require('electron');
const { checkForUpdates, downloadAsset, RELEASES_URL } = require('./services/updateManagerService');

let registered = false;
let pendingCheck = null;
let pendingInstall = null;

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function assertInstallAllowed(payload = {}) {
  if (payload.busy === true || payload.productionBusy === true) {
    throw new Error('Đang có job xử lý. Hãy chờ hoàn tất hoặc hủy job trước khi cập nhật.');
  }
}

async function launchWindowsInstaller(filePath) {
  if (process.platform !== 'win32') throw new Error('Tự cài đặt hiện chỉ hỗ trợ Windows.');
  if (path.extname(filePath).toLowerCase() !== '.exe') throw new Error('Bộ cài Windows không hợp lệ.');
  const child = spawn(filePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return { launched: true, filePath };
}

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

  ipcMain.handle('update:install', async (_event, payload = {}) => {
    assertInstallAllowed(payload);
    if (process.platform !== 'win32') {
      const target = payload.releaseUrl || RELEASES_URL;
      await shell.openExternal(target);
      return { openedReleasePage: true, platform: process.platform };
    }
    if (pendingInstall) return pendingInstall;

    pendingInstall = (async () => {
      const latest = await checkForUpdates({ currentVersion: app.getVersion(), platform: process.platform, arch: process.arch });
      if (!latest.updateAvailable) throw new Error('Không có phiên bản mới hơn để cài đặt.');
      if (!latest.asset?.downloadUrl) throw new Error('Release chưa có bộ cài Windows phù hợp.');
      broadcast('update:progress', { phase: 'downloading', percent: 0, message: `Đang tải ${latest.asset.name}` });
      const downloaded = await downloadAsset({
        asset: latest.asset,
        destinationDirectory: path.join(app.getPath('temp'), 'print-upscale-studio-updates'),
        onProgress: (progress) => broadcast('update:progress', {
          phase: 'downloading',
          ...progress,
          message: progress.percent == null ? 'Đang tải bộ cài...' : `Đang tải bộ cài ${progress.percent}%`
        })
      });
      assertInstallAllowed(payload);
      broadcast('update:progress', { phase: 'launching', percent: 100, message: 'Đang mở bộ cài và đóng ứng dụng...' });
      await launchWindowsInstaller(downloaded.filePath);
      setTimeout(() => app.quit(), 450);
      return { launched: true, latestVersion: latest.latestVersion, ...downloaded };
    })().finally(() => { pendingInstall = null; });

    return pendingInstall;
  });

  ipcMain.handle('update:open-release', async (_event, url) => {
    const target = typeof url === 'string' && /^https:\/\/github\.com\//i.test(url) ? url : RELEASES_URL;
    await shell.openExternal(target);
    return { opened: true, url: target };
  });
}

app.whenReady().then(registerUpdateManagerIpc);

module.exports = { assertInstallAllowed, launchWindowsInstaller, registerUpdateManagerIpc };