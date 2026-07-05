const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewerAPI', {
  getCurrentSession: () => ipcRenderer.invoke('viewer:getCurrentSession'),
  openAdjacent: (sessionId, direction) => ipcRenderer.invoke('viewer:openAdjacent', sessionId, direction),
  listComicPages: sessionId => ipcRenderer.invoke('viewer:listComicPages', sessionId),
  getComicPage: (sessionId, entryName) => ipcRenderer.invoke('viewer:getComicPage', sessionId, entryName),
  getDocumentData: sessionId => ipcRenderer.invoke('viewer:getDocumentData', sessionId),
  getText: (sessionId, options) => ipcRenderer.invoke('viewer:getText', sessionId, options),
  getEpubText: sessionId => ipcRenderer.invoke('viewer:getEpubText', sessionId),
  getConfig: () => ipcRenderer.invoke('viewer:getConfig'),
  listBundledFonts: () => ipcRenderer.invoke('font:listBundled'),
  listSystemFonts: () => ipcRenderer.invoke('font:listSystem'),
  openExternal: url => ipcRenderer.invoke('viewer:openExternal', url),
  toggleFullscreen: () => ipcRenderer.invoke('viewer:toggleFullscreen'),
  getFullscreenState: () => ipcRenderer.invoke('viewer:getFullscreenState'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onFullscreenChange: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('viewer:fullscreen-change', handler);
    return () => ipcRenderer.removeListener('viewer:fullscreen-change', handler);
  },
  onConfigChange: callback => {
    const handler = (_event, config) => callback(config);
    ipcRenderer.on('viewer:config-change', handler);
    return () => ipcRenderer.removeListener('viewer:config-change', handler);
  },
  onLoadSession: callback => {
    const handler = (_event, session) => callback(session);
    ipcRenderer.on('viewer:load-session', handler);
    return () => ipcRenderer.removeListener('viewer:load-session', handler);
  },
});
