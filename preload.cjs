const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('suda', {
  list: () => ipcRenderer.invoke('resources:list'),
  add: fields => ipcRenderer.invoke('resources:add', fields),
  remove: id => ipcRenderer.invoke('resources:remove', id),
  parse: text => ipcRenderer.invoke('link:parse', text),
  open: text => ipcRenderer.invoke('link:open', text),
  inspect: text => ipcRenderer.invoke('download:inspect', text),
  resolve: (item, endpoint) => ipcRenderer.invoke('share:resolve', item, endpoint),
  chooseFolder: () => ipcRenderer.invoke('download:choose-directory'),
  start: (raw, mode, suggestedName, engine, settings, quarkKey, directory) => ipcRenderer.invoke('download:start', { raw, mode, suggestedName, engine, settings, quarkKey, directory }),
  pause: id => ipcRenderer.invoke('download:pause', id),
  showFile: location => ipcRenderer.invoke('file:show', location),
  onProgress: callback => ipcRenderer.on('download:progress', (_event, data) => callback(data)),
  onComplete: callback => ipcRenderer.on('download:complete', (_event, data) => callback(data)),
  onError: callback => ipcRenderer.on('download:error', (_event, data) => callback(data))
});
