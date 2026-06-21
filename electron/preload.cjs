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
  listSounds: () => ipcRenderer.invoke('sound:list'),
  
  // 파일/폴더 선택
  selectFolder: (title) => ipcRenderer.invoke('dialog:selectFolder', title),
  selectArchives: (title) => ipcRenderer.invoke('dialog:selectArchives', title),
  chooseMetadataDrop: (options) => ipcRenderer.invoke('dialog:metadataDropChoice', options),
  showMessage: (options) => ipcRenderer.invoke('dialog:message', options),
  chooseLibrarySyncMode: (options) => ipcRenderer.invoke('dialog:librarySyncChoice', options),
  selectFile: (title, filters) => ipcRenderer.invoke('dialog:selectFile', title, filters),
  selectFiles: (title, filters) => ipcRenderer.invoke('dialog:selectFiles', title, filters),
  saveFile: (title, filters, defaultPath) => ipcRenderer.invoke('dialog:saveFile', title, filters, defaultPath),
  
  // 파일 시스템
  readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
  getRoots: () => ipcRenderer.invoke('fs:getRoots'),
  getSpecialPaths: () => ipcRenderer.invoke('fs:getSpecialPaths'),
  stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
  multiRenameFiles: (renameMap) => ipcRenderer.invoke('fs:multiRename', renameMap),
  undoRename: () => ipcRenderer.invoke('fs:undoRename'),
  deleteFiles: (filePaths) => ipcRenderer.invoke('fs:delete', filePaths),
  openInExplorer: (folderPath) => ipcRenderer.invoke('fs:openInExplorer', folderPath),
  showInFolder: (filePath) => ipcRenderer.invoke('fs:showInFolder', filePath),
  openWithViewer: (viewerPath, filePath) => ipcRenderer.invoke('fs:openWithViewer', viewerPath, filePath),
  exportCsv: (filePath, headers, rows) => ipcRenderer.invoke('fs:exportCsv', { filePath, headers, rows }),
  getFilePreview: (filePath) => ipcRenderer.invoke('fs:filePreview', filePath),
  expandFolderMove: (sourceRoot, destinationRoot) => ipcRenderer.invoke('fs:expandFolderMove', sourceRoot, destinationRoot),
  removeEmptyTree: (rootPath) => ipcRenderer.invoke('fs:removeEmptyTree', rootPath),
  executeLibraryMove: (movePlans) => ipcRenderer.invoke('fs:executeLibraryMove', movePlans),
  extractCoreTitle: (filename) => ipcRenderer.invoke('parser:extractCoreTitle', filename),
  
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
  extractArchiveImage: (filePath, entryPath) => ipcRenderer.invoke('renamer:extractImage', filePath, entryPath),
  executeRenamer: (items, options) => ipcRenderer.invoke('renamer:execute', items, options),
  analyzeMetadata: (paths, options) => ipcRenderer.invoke('metadata:analyze', paths, options),
  saveMetadata: (items, options) => ipcRenderer.invoke('metadata:save', items, options),
  clearApiCache: () => ipcRenderer.invoke('cache:clearApi'),
  clearDupCache: () => ipcRenderer.invoke('folder:clearDupCache'),
  getLibraryScanStates: (folders) => ipcRenderer.invoke('folder:getLibraryScanStates', folders),
  updateFolderIndex: (folders, options) => ipcRenderer.invoke('folder:updateIndex', folders, options),
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
  onTaskProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('task:progress', handler);
    return () => ipcRenderer.removeListener('task:progress', handler);
  },
  onTaskComplete: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('task:complete', handler);
    return () => ipcRenderer.removeListener('task:complete', handler);
  },
  onTaskError: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('task:error', handler);
    return () => ipcRenderer.removeListener('task:error', handler);
  },
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
  onFolderFileReady: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('folder:fileReady', handler);
    return () => ipcRenderer.removeListener('folder:fileReady', handler);
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
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  setRuntimeState: (state) => ipcRenderer.send('app:setRuntimeState', state),
});
