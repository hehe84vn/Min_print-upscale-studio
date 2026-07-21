const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  selectInput: () => ipcRenderer.invoke('file:select-input'),
  selectReference: () => ipcRenderer.invoke('file:select-reference'),
  selectOutput: (payload) => ipcRenderer.invoke('file:select-output', payload),
  selectBenchmarkOutputDirectory: () => ipcRenderer.invoke('benchmark:select-output-directory'),
  fileUrl: (filePath) => ipcRenderer.invoke('file:url', filePath),
  inspectImage: (filePath) => ipcRenderer.invoke('image:metadata', filePath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  process: (payload) => ipcRenderer.invoke('image:process', payload),
  getBenchmarkPresets: () => ipcRenderer.invoke('benchmark:presets'),
  runBenchmark: (payload) => ipcRenderer.invoke('benchmark:run', payload),
  getEngineStatus: () => ipcRenderer.invoke('engine:status'),
  autoDetectEngine: () => ipcRenderer.invoke('engine:auto-detect'),
  selectEngineBinary: () => ipcRenderer.invoke('engine:select-binary'),
  selectModelsDirectory: () => ipcRenderer.invoke('engine:select-models'),
  clearEngine: () => ipcRenderer.invoke('engine:clear'),
  getAiSettings: () => ipcRenderer.invoke('ai:settings:get'),
  saveAiSettings: (payload) => ipcRenderer.invoke('ai:settings:save', payload),
  clearAiKey: (provider) => ipcRenderer.invoke('ai:settings:clear-key', provider),
  testAiConnection: (provider) => ipcRenderer.invoke('ai:settings:test', provider),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  }
});
