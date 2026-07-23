'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { SecureSecretsService } = require('./services/secureSecretsService');
const { LicenseService } = require('./services/licenseService');
const licenseConfig = require('./licenseConfig');

const PROTECTED_CHANNELS = new Set([
  'image:process',
  'production:start',
  'benchmark:run',
  'color:convert'
]);

const originalHandle = ipcMain.handle.bind(ipcMain);
let licenseService = null;

function broadcastStatus(status) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('license:status-changed', status);
  }
}

function requireLicenseService() {
  if (!licenseService) throw new Error('Dịch vụ license chưa sẵn sàng.');
  return licenseService;
}

function registerLicenseIpc() {
  originalHandle('license:status', async () => requireLicenseService().initialize());

  originalHandle('license:login', async (_event, payload = {}) => {
    const status = await requireLicenseService().login(payload.email, payload.password);
    broadcastStatus(status);
    return status;
  });

  originalHandle('license:validate', async () => {
    const status = await requireLicenseService().validateNow();
    broadcastStatus(status);
    return status;
  });

  originalHandle('license:logout', async () => {
    const status = await requireLicenseService().logout({ deactivate: false });
    broadcastStatus(status);
    return status;
  });

  originalHandle('license:deactivate', async () => {
    const status = await requireLicenseService().logout({ deactivate: true });
    broadcastStatus(status);
    return status;
  });
}

ipcMain.handle = (channel, listener) => {
  if (!PROTECTED_CHANNELS.has(channel)) return originalHandle(channel, listener);
  return originalHandle(channel, async (...args) => {
    await requireLicenseService().ensureProcessingAllowed();
    return listener(...args);
  });
};

app.whenReady().then(async () => {
  const secureSecretsService = new SecureSecretsService(app.getPath('userData'));
  licenseService = new LicenseService({
    secureSecretsService,
    config: licenseConfig,
    appVersion: app.getVersion()
  });
  registerLicenseIpc();

  try {
    const status = await licenseService.initialize();
    broadcastStatus(status);
  } catch (error) {
    console.warn(`License initialization failed: ${error.message || error}`);
  }
});

require('./main');
