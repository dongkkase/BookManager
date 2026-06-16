const { contextBridge, ipcRenderer } = require('electron');

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
  stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  
  // 폴더 스캔
  scanFolder: (folderPath, options) => ipcRenderer.invoke('folder:scan', folderPath, options),
  
  // 라이브러리 DB
  initLibrary: (dbPath) => ipcRenderer.invoke('library:init', dbPath),
  queryLibrary: (query, params) => ipcRenderer.invoke('library:query', query, params),
  closeLibrary: () => ipcRenderer.invoke('library:close'),
  
  // 작업 관련
  startOrganizeTask: (options) => ipcRenderer.invoke('task:organize:start', options),
  startRenameTask: (options) => ipcRenderer.invoke('task:rename:start', options),
  startExtractTask: (options) => ipcRenderer.invoke('task:extract:start', options),
  stopTask: (taskId) => ipcRenderer.invoke('task:stop', taskId),
  
  // 서버 관련
  startServer: (serverType, options) => ipcRenderer.invoke('server:start', serverType, options),
  stopServer: (serverType) => ipcRenderer.invoke('server:stop', serverType),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
  
  // API 관련
  fetchMetadata: (options) => ipcRenderer.invoke('api:fetch', options),
  
  // 파서 관련
  parseFilename: (filename) => ipcRenderer.invoke('parser:parse', filename),
  
  // 이벤트 리스너
  onTaskProgress: (callback) => ipcRenderer.on('task:progress', (_, data) => callback(data)),
  onTaskComplete: (callback) => ipcRenderer.on('task:complete', (_, data) => callback(data)),
  onTaskError: (callback) => ipcRenderer.on('task:error', (_, data) => callback(data)),
  onServerLog: (callback) => ipcRenderer.on('server:log', (_, data) => callback(data)),
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
});
