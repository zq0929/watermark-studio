'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('wm', {
  info: () => ipcRenderer.invoke('app:info'),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pickFolder: () => ipcRenderer.invoke('files:folder'),
  pickDir: (defaultPath) => ipcRenderer.invoke('dir:pick', defaultPath),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  writeFile: (p, data) => ipcRenderer.invoke('file:write', p, data),
  exists: (p) => ipcRenderer.invoke('file:exists', p),
  uniquePath: (dir, base, ext) => ipcRenderer.invoke('file:unique', dir, base, ext),
  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  showItem: (p) => ipcRenderer.invoke('shell:show', p),
  showError: (title, message) => ipcRenderer.invoke('dialog:error', title, message),
  selftest: (payload) => ipcRenderer.invoke('selftest:report', payload),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  onMenu: (handler) => {
    ipcRenderer.on('menu:action', (_event, action) => handler(action));
  },
});
