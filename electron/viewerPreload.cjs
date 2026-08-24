const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewerAPI', {
  getCurrentSession: () => ipcRenderer.invoke('viewer:getCurrentSession'),
  openAdjacent: (sessionId, direction) => ipcRenderer.invoke('viewer:openAdjacent', sessionId, direction),
  openAudioQueueItem: (sessionId, fileName) => ipcRenderer.invoke('viewer:openAudioQueueItem', sessionId, fileName),
  listComicPages: sessionId => ipcRenderer.invoke('viewer:listComicPages', sessionId),
  getComicPage: (sessionId, entryName) => ipcRenderer.invoke('viewer:getComicPage', sessionId, entryName),
  getDocumentData: sessionId => ipcRenderer.invoke('viewer:getDocumentData', sessionId),
  getAudioData: sessionId => ipcRenderer.invoke('viewer:getAudioData', sessionId),
  listAudioQueue: sessionId => ipcRenderer.invoke('viewer:listAudioQueue', sessionId),
  getText: (sessionId, options) => ipcRenderer.invoke('viewer:getText', sessionId, options),
  getEpubText: sessionId => ipcRenderer.invoke('viewer:getEpubText', sessionId),
  saveReadingState: (sessionId, state) => ipcRenderer.invoke('viewer:saveReadingState', sessionId, state),
  getConfig: () => ipcRenderer.invoke('viewer:getConfig'),
  getSupertonicModelStatus: () => ipcRenderer.invoke('tts:supertonicStatus'),
  createSupertonicTts: options => ipcRenderer.invoke('api:supertonicTts', options),
  createOpenAiTts: options => ipcRenderer.invoke('api:openaiTts', options),
  createGoogleTts: options => ipcRenderer.invoke('api:googleTts', options),
  listBundledFonts: () => ipcRenderer.invoke('font:listBundled'),
  listSystemFonts: () => ipcRenderer.invoke('font:listSystem'),
  openExternal: url => ipcRenderer.invoke('viewer:openExternal', url),
  toggleFullscreen: () => ipcRenderer.invoke('viewer:toggleFullscreen'),
  getFullscreenState: () => ipcRenderer.invoke('viewer:getFullscreenState'),
  closeWindow: () => ipcRenderer.invoke('viewer:closeWindow'),
  publishAudioMiniTrack: state => ipcRenderer.send('viewer:audio-track-state', state),
  publishAudioMiniPlayback: state => ipcRenderer.send('viewer:audio-playback-state', state),
  publishAudioTrackState: state => ipcRenderer.send('viewer:audio-track-state', state),
  publishAudioPlaybackState: state => ipcRenderer.send('viewer:audio-playback-state', state),
  onAudioMiniPlayerCommand: callback => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('viewer:audio-mini-command', handler);
    return () => ipcRenderer.removeListener('viewer:audio-mini-command', handler);
  },
  onAudioMetadataRefresh: callback => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('viewer:audio-metadata-refresh', handler);
    return () => ipcRenderer.removeListener('viewer:audio-metadata-refresh', handler);
  },
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
  onSupertonicModelStatus: callback => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('tts:supertonic-status', handler);
    return () => ipcRenderer.removeListener('tts:supertonic-status', handler);
  },
  onLoadSession: callback => {
    const handler = (_event, session) => callback(session);
    ipcRenderer.on('viewer:load-session', handler);
    return () => ipcRenderer.removeListener('viewer:load-session', handler);
  },
});
