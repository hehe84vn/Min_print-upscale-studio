const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  selectInput: () => ipcRenderer.invoke('file:select-input'),
  selectOutput: (payload) => ipcRenderer.invoke('file:select-output', payload),
  fileUrl: (filePath) => ipcRenderer.invoke('file:url', filePath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  process: (payload) => ipcRenderer.invoke('image:process', payload),
  getEngineStatus: () => ipcRenderer.invoke('engine:status'),
  autoDetectEngine: () => ipcRenderer.invoke('engine:auto-detect'),
  selectEngineBinary: () => ipcRenderer.invoke('engine:select-binary'),
  selectModelsDirectory: () => ipcRenderer.invoke('engine:select-models'),
  clearEngine: () => ipcRenderer.invoke('engine:clear'),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  }
});
