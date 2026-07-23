const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  selectInput: () => ipcRenderer.invoke('file:select-input'),
  selectBatchInputs: () => ipcRenderer.invoke('file:select-batch-inputs'),
  selectReference: () => ipcRenderer.invoke('file:select-reference'),
  selectOutput: (payload) => ipcRenderer.invoke('file:select-output', payload),
  selectBenchmarkOutputDirectory: () => ipcRenderer.invoke('benchmark:select-output-directory'),
  selectProductionOutputDirectory: () => ipcRenderer.invoke('production:select-output-directory'),
  fileUrl: (filePath) => ipcRenderer.invoke('file:url', filePath),
  inspectImage: (filePath) => ipcRenderer.invoke('image:metadata', filePath),
  analyzeImage: (payload) => ipcRenderer.invoke('smart:analyze', payload),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  process: (payload) => ipcRenderer.invoke('image:process', payload),
  startProduction: (payload) => ipcRenderer.invoke('production:start', payload),
  pauseProduction: () => ipcRenderer.invoke('production:pause'),
  resumeProduction: () => ipcRenderer.invoke('production:resume'),
  retryFailedProduction: () => ipcRenderer.invoke('production:retry-failed'),
  getProductionStatus: () => ipcRenderer.invoke('production:status'),
  getBenchmarkPresets: () => ipcRenderer.invoke('benchmark:presets'),
  runBenchmark: (payload) => ipcRenderer.invoke('benchmark:run', payload),
  getColorSettings: () => ipcRenderer.invoke('color:settings:get'),
  saveColorSettings: (payload) => ipcRenderer.invoke('color:settings:save', payload),
  selectIccProfile: () => ipcRenderer.invoke('color:select-profile'),
  convertToCmyk: (payload) => ipcRenderer.invoke('color:convert', payload),
  getStorageSettings: () => ipcRenderer.invoke('storage:settings:get'),
  saveStorageSettings: (payload) => ipcRenderer.invoke('storage:settings:save', payload),
  getStorageStatus: () => ipcRenderer.invoke('storage:status'),
  cleanupTemp: (payload) => ipcRenderer.invoke('storage:cleanup-temp', payload),
  clearAppCache: () => ipcRenderer.invoke('storage:clear-cache'),
  getEngineStatus: () => ipcRenderer.invoke('engine:status'),
  autoDetectEngine: () => ipcRenderer.invoke('engine:auto-detect'),
  selectEngineBinary: () => ipcRenderer.invoke('engine:select-binary'),
  selectModelsDirectory: () => ipcRenderer.invoke('engine:select-models'),
  clearEngine: () => ipcRenderer.invoke('engine:clear'),
  getAiSettings: () => ipcRenderer.invoke('ai:settings:get'),
  saveAiSettings: (payload) => ipcRenderer.invoke('ai:settings:save', payload),
  clearAiKey: (provider) => ipcRenderer.invoke('ai:settings:clear-key', provider),
  testAiConnection: (provider) => ipcRenderer.invoke('ai:settings:test', provider),
  getLicenseStatus: (force = false) => ipcRenderer.invoke('license:status', { force: force === true }),
  loginLicense: (payload) => ipcRenderer.invoke('license:login', payload),
  validateLicense: () => ipcRenderer.invoke('license:validate'),
  logoutLicense: () => ipcRenderer.invoke('license:logout'),
  deactivateLicense: () => ipcRenderer.invoke('license:deactivate'),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  },
  onProductionStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('production:status', listener);
    return () => ipcRenderer.removeListener('production:status', listener);
  },
  onLicenseStatus: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('license:status-changed', listener);
    return () => ipcRenderer.removeListener('license:status-changed', listener);
  }
});
