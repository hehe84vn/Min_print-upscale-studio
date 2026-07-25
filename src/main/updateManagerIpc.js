'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, ipcMain, shell, BrowserWindow } = require('electron');
const { checkForUpdates, downloadAsset } = require('./services/updateManagerService');

let registered = false;
let pendingCheck = null;
let pendingInstall = null;

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function sendToSender(event, channel, payload) {
  if (!event?.sender?.isDestroyed?.()) event.sender.send(channel, payload);
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

  ipcMain.handle('update:check', async (event) => {
    const currentVersion = app.getVersion();
    if (!pendingCheck) {
      const report = (progress) => sendToSender(event, 'update:check-progress', { currentVersion, ...progress });
      const operation = checkForUpdates({
        currentVersion,
        platform: process.platform,
        arch: process.arch,
        onProgress: report
      });
      pendingCheck = withTimeout(
        operation,
        18000,
        'Không thể kết nối máy chủ cập nhật. Hãy kiểm tra Internet và thử lại.'
      ).catch((error) => {
        report({ phase: 'failed', message: error.message || 'Không thể kiểm tra cập nhật.' });
        throw error;
      }).finally(() => { pendingCheck = null; });
    } else {
      sendToSender(event, 'update:check-progress', {
        phase: 'waiting',
        currentVersion,
        message: 'Đang chờ lần kiểm tra hiện tại hoàn tất...'
      });
    }
    return pendingCheck;
  });

  ipcMain.handle('update:install', async (_event, payload = {}) => {
    assertInstallAllowed(payload);
    if (pendingInstall) return pendingInstall;

    pendingInstall = (async () => {
      const latest = await withTimeout(
        checkForUpdates({ currentVersion: app.getVersion(), platform: process.platform, arch: process.arch }),
        18000,
        'Không thể kết nối máy chủ cập nhật. Hãy kiểm tra Internet và thử lại.'
      );
      if (!latest.updateAvailable) throw new Error('Không có phiên bản mới hơn để tải.');
      if (!latest.asset?.downloadUrl) throw new Error('Chưa có bộ cài phù hợp cho máy này.');
      broadcast('update:progress', { phase: 'downloading', percent: 0, message: 'Đang tải bản cập nhật...' });
      const downloaded = await downloadAsset({
        asset: latest.asset,
        destinationDirectory: path.join(app.getPath('downloads'), 'Print Upscale Studio Updates'),
        onProgress: (progress) => broadcast('update:progress', {
          phase: 'downloading',
          ...progress,
          message: progress.percent == null ? 'Đang tải bản cập nhật...' : `Đang tải bản cập nhật ${progress.percent}%`
        })
      });
      assertInstallAllowed(payload);

      if (process.platform === 'win32') {
        broadcast('update:progress', { phase: 'launching', percent: 100, message: 'Đang mở trình cài đặt và đóng ứng dụng...' });
        await launchWindowsInstaller(downloaded.filePath);
        setTimeout(() => app.quit(), 450);
        return { launched: true, latestVersion: latest.latestVersion, ...downloaded };
      }

      if (process.platform === 'darwin') {
        broadcast('update:progress', { phase: 'downloaded', percent: 100, message: 'Đã tải xong. Đang mở bộ cài...' });
        const openError = await shell.openPath(downloaded.filePath);
        if (openError) throw new Error('Không thể mở bộ cài. Hãy thử lại hoặc kiểm tra thư mục Tải về.');
        return { downloaded: true, opened: true, latestVersion: latest.latestVersion, ...downloaded };
      }

      await shell.showItemInFolder(downloaded.filePath);
      return { downloaded: true, latestVersion: latest.latestVersion, ...downloaded };
    })().finally(() => { pendingInstall = null; });

    return pendingInstall;
  });
}

app.whenReady().then(registerUpdateManagerIpc);

module.exports = { assertInstallAllowed, launchWindowsInstaller, registerUpdateManagerIpc, withTimeout };