const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewerAPI', {
  getCurrentSession: () => ipcRenderer.invoke('viewer:getCurrentSession'),
  openAdjacent: (sessionId, direction) => ipcRenderer.invoke('viewer:openAdjacent', sessionId, direction),
  listComicPages: sessionId => ipcRenderer.invoke('viewer:listComicPages', sessionId),
  getComicPage: (sessionId, entryName) => ipcRenderer.invoke('viewer:getComicPage', sessionId, entryName),
  getDocumentData: sessionId => ipcRenderer.invoke('viewer:getDocumentData', sessionId),
  getText: (sessionId, options) => ipcRenderer.invoke('viewer:getText', sessionId, options),
  getEpubText: sessionId => ipcRenderer.invoke('viewer:getEpubText', sessionId),
  listBundledFonts: () => ipcRenderer.invoke('font:listBundled'),
  listSystemFonts: () => ipcRenderer.invoke('font:listSystem'),
  toggleFullscreen: () => ipcRenderer.invoke('viewer:toggleFullscreen'),
  closeWindow: () => ipcRenderer.send('window:close'),
  onLoadSession: callback => {
    const handler = (_event, session) => callback(session);
    ipcRenderer.on('viewer:load-session', handler);
    return () => ipcRenderer.removeListener('viewer:load-session', handler);
  },
});
