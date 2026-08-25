const { contextBridge, ipcRenderer } = require('electron');

// 메인 프로세스로의 IPC 통신 인터페이스
contextBridge.exposeInMainWorld('electronAPI', {
  // 설정 관련
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getFileAssociationStatus: () => ipcRenderer.invoke('fileAssociations:getStatus'),
  applyFileAssociations: (extensions) => ipcRenderer.invoke('fileAssociations:apply', extensions),
  openFileAssociationSettings: () => ipcRenderer.invoke('fileAssociations:openSettings'),
  getSupertonicModelStatus: () => ipcRenderer.invoke('tts:supertonicStatus'),
  installSupertonicModel: () => ipcRenderer.invoke('tts:supertonicInstall'),
  onSupertonicModelProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('tts:supertonic-progress', handler);
    return () => ipcRenderer.removeListener('tts:supertonic-progress', handler);
  },
  onSupertonicModelStatus: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('tts:supertonic-status', handler);
    return () => ipcRenderer.removeListener('tts:supertonic-status', handler);
  },
  
  // 폰트 관련
  getFontPath: (fontFilename) => ipcRenderer.invoke('font:getPath', fontFilename),
  listBundledFonts: () => ipcRenderer.invoke('font:listBundled'),
  listSystemFonts: () => ipcRenderer.invoke('font:listSystem'),
  
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
  openInternalViewer: (filePath) => ipcRenderer.invoke('viewer:open', filePath),
  listRecentReading: (limit) => ipcRenderer.invoke('reading:listRecent', limit),
  removeRecentReading: (filePath) => ipcRenderer.invoke('reading:remove', filePath),
  clearRecentReading: () => ipcRenderer.invoke('reading:clear'),
  onRecentReadingChanged: (callback) => {
    const handler = (_, state) => callback(state);
    ipcRenderer.on('reading:changed', handler);
    return () => ipcRenderer.removeListener('reading:changed', handler);
  },
  getAudioMiniPlayerState: () => ipcRenderer.invoke('viewer:getAudioMiniPlayerState'),
  controlAudioMiniPlayer: (command) => ipcRenderer.invoke('viewer:controlAudioMiniPlayer', command),
  onAudioMiniPlayerState: (callback) => {
    const handler = (_, state) => callback(state);
    ipcRenderer.on('viewer:audio-mini-state', handler);
    return () => ipcRenderer.removeListener('viewer:audio-mini-state', handler);
  },
  exportCsv: (filePath, headers, rows) => ipcRenderer.invoke('fs:exportCsv', { filePath, headers, rows }),
  getFilePreview: (filePath, options) => ipcRenderer.invoke('fs:filePreview', filePath, options),
  expandFolderMove: (sourceRoot, destinationRoot) => ipcRenderer.invoke('fs:expandFolderMove', sourceRoot, destinationRoot),
  removeEmptyTree: (rootPath) => ipcRenderer.invoke('fs:removeEmptyTree', rootPath),
  findLibraryMoveConflicts: (movePlans) => ipcRenderer.invoke('fs:findLibraryMoveConflicts', movePlans),
  executeLibraryMove: (movePlans) => ipcRenderer.invoke('fs:executeLibraryMove', movePlans),
  extractCoreTitle: (filename) => ipcRenderer.invoke('parser:extractCoreTitle', filename),
  
  // 폴더 스캔
  scanFolder: (folderPath, options) => ipcRenderer.invoke('folder:scan', folderPath, options),
  searchLibraryFiles: (query, libraries, options) => ipcRenderer.invoke('folder:searchLibraryFiles', { query, libraries, options }),
  getLibraryTagFacets: (libraries) => ipcRenderer.invoke('folder:getLibraryTagFacets', { libraries }),
  searchLibraryTags: (libraries, selections, matchMode) => ipcRenderer.invoke('folder:searchLibraryTags', { libraries, selections, matchMode }),
  searchLibraryContent: (query, libraries, options) => ipcRenderer.invoke('folder:searchLibraryContent', { query, libraries, options }),
  getContentIndexStatus: (libraries) => ipcRenderer.invoke('folder:getContentIndexStatus', { libraries }),
  startContentIndex: (libraries, options) => ipcRenderer.invoke('folder:startContentIndex', { libraries, options }),
  stopContentIndex: () => ipcRenderer.invoke('folder:stopContentIndex'),
  clearContentIndex: () => ipcRenderer.invoke('folder:clearContentIndex'),
  getLibraryFolderChildren: (libraryPath, parentPath) => ipcRenderer.invoke('folder:getLibraryFolderChildren', libraryPath, parentPath),
  
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
  loadLatestSeriesMetadata: (criteria) => ipcRenderer.invoke('metadata:latest', criteria),
  loadMetadataCover: (filePath, options) => ipcRenderer.invoke('metadata:cover', filePath, options),
  listMetadataEpubImages: (filePath) => ipcRenderer.invoke('metadata:epubImages', filePath),
  loadMetadataEpubImage: (filePath, entryName) => ipcRenderer.invoke('metadata:epubImage', filePath, entryName),
  loadMetadataImageFile: (filePath) => ipcRenderer.invoke('metadata:imageFile', filePath),
  exportMetadataCover: (options) => ipcRenderer.invoke('metadata:exportCover', options),
  cacheMetadataRemoteCover: (imageUrl) => ipcRenderer.invoke('metadata:cacheRemoteCover', imageUrl),
  saveMetadata: (items, options) => ipcRenderer.invoke('metadata:save', items, options),
  clearApiCache: () => ipcRenderer.invoke('cache:clearApi'),
  clearDupCache: () => ipcRenderer.invoke('folder:clearDupCache'),
  getLibraryScanStates: (folders) => ipcRenderer.invoke('folder:getLibraryScanStates', folders),
  updateFolderIndex: (folders, options) => ipcRenderer.invoke('folder:updateIndex', folders, options),
  applyLibraryMoveIndex: (payload) => ipcRenderer.invoke('folder:applyLibraryMoveIndex', payload),
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
  identifyMetadataCoverTitles: (options) => ipcRenderer.invoke('api:identifyCoverTitles', options),
  translateMetadata: (result) => ipcRenderer.invoke('api:translateMetadata', result),
  fetchRidiBookDetail: (bookId) => ipcRenderer.invoke('api:ridiBookDetail', bookId),
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
  onContentIndexProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('folder:contentIndexProgress', handler);
    return () => ipcRenderer.removeListener('folder:contentIndexProgress', handler);
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
  installUpdate: (options) => ipcRenderer.invoke('app:installUpdate', options),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  setRuntimeState: (state) => ipcRenderer.send('app:setRuntimeState', state),
});
