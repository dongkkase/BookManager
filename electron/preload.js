import { contextBridge, ipcRenderer } from 'electron';

// 메인 프로세스로의 IPC 통신 인터페이스
contextBridge.exposeInMainWorld('electronAPI', {
  // 설정 관련
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  
  // 폰트 관련
  getFontPath: (fontFilename) => ipcRenderer.invoke('font:getPath', fontFilename),
  
  // 바이너리 도구 관련
  getBinPath: (toolName) => ipcRenderer.invoke('bin:getPath', toolName),
  
  // 사운드 재생
  playSound: (soundFilename) => ipcRenderer.invoke('sound:play', soundFilename),
  
  // 파일/폴더 선택
  selectFolder: (title) => ipcRenderer.invoke('dialog:selectFolder', title),
  selectFile: (title, filters) => ipcRenderer.invoke('dialog:selectFile', title, filters),
  selectFiles: (title, filters) => ipcRenderer.invoke('dialog:selectFiles', title, filters),
  saveFile: (title, filters) => ipcRenderer.invoke('dialog:saveFile', title, filters),
  
  // 파일 시스템
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  getRoots: () => ipcRenderer.invoke('fs:getRoots'),
  getSpecialPaths: () => ipcRenderer.invoke('fs:getSpecialPaths'),
  stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  
  // 폴더 스캔
  scanFolder: (folderPath, options) => ipcRenderer.invoke('folder:scan', folderPath, options),
  
  // 라이브러리 DB
  initLibrary: (dbPath) => ipcRenderer.invoke('library:init', dbPath),
  queryLibrary: (query, params) => ipcRenderer.invoke('library:query', query, params),
  closeLibrary: () => ipcRenderer.invoke('library:close'),
  
  // 작업 관련
  analyzeOrganizer: (paths, options) => ipcRenderer.invoke('organizer:analyze', paths, options),
  executeOrganizer: (items, options) => ipcRenderer.invoke('organizer:execute', items, options),
  analyzeRenamer: (paths, options) => ipcRenderer.invoke('renamer:analyze', paths, options),
  executeRenamer: (items, options) => ipcRenderer.invoke('renamer:execute', items, options),
  analyzeMetadata: (paths, options) => ipcRenderer.invoke('metadata:analyze', paths, options),
  saveMetadata: (items, options) => ipcRenderer.invoke('metadata:save', items, options),
  clearApiCache: () => ipcRenderer.invoke('cache:clearApi'),
  clearDupCache: () => ipcRenderer.invoke('folder:clearDupCache'),
  updateFolderIndex: (folders) => ipcRenderer.invoke('folder:updateIndex', folders),
  startOrganizeTask: (options) => ipcRenderer.invoke('task:organize:start', options),
  startRenameTask: (options) => ipcRenderer.invoke('task:rename:start', options),
  startExtractTask: (options) => ipcRenderer.invoke('task:extract:start', options),
  stopTask: (taskId) => ipcRenderer.invoke('task:stop', taskId),
  
  // 서버 관련
  startServer: (serverType, options) => ipcRenderer.invoke('server:start', serverType, options),
  stopServer: (serverType) => ipcRenderer.invoke('server:stop', serverType),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
  getReleases: () => ipcRenderer.invoke('releases:list'),
  
  // API 관련
  fetchMetadata: (options) => ipcRenderer.invoke('api:fetch', options),
  translateMetadata: (result, targetLang) => ipcRenderer.invoke('api:translateMetadata', result, targetLang),
  fetchRidiPublishDate: (bookId) => ipcRenderer.invoke('api:ridiPublishDate', bookId),
  fetchImageDataUrl: (url) => ipcRenderer.invoke('api:imageDataUrl', url),
  
  // 파서 관련
  parseFilename: (filename) => ipcRenderer.invoke('parser:parse', filename),
  
  // 이벤트 리스너
  onTaskProgress: (callback) => ipcRenderer.on('task:progress', (_, data) => callback(data)),
  onTaskComplete: (callback) => ipcRenderer.on('task:complete', (_, data) => callback(data)),
  onTaskError: (callback) => ipcRenderer.on('task:error', (_, data) => callback(data)),
  onServerLog: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('server:log', handler);
    return () => ipcRenderer.removeListener('server:log', handler);
  },
  onLog: (callback) => ipcRenderer.on('log', (_, data) => callback(data)),
  
  onScanProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },
  onScanComplete: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scan-complete', handler);
    return () => ipcRenderer.removeListener('scan-complete', handler);
  },
  onScanError: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('scan-error', handler);
    return () => ipcRenderer.removeListener('scan-error', handler);
  },
  
  // 윈도우 관련
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  closeWindow: () => ipcRenderer.send('window:close'),
  
  // 시스템 정보
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getCPUCores: () => ipcRenderer.invoke('system:cpuCores'),
  
  // 앱 정보
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
});
