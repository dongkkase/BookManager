const IPC_CHANNELS = new Set([
    'api:cancelTts', 'api:fetch', 'api:googleTts', 'api:identifyCoverTitles', 'api:imageDataUrl',
    'api:openaiTts', 'api:ridiBookDetail', 'api:ridiPublishDate', 'api:supertonicTts', 'api:translateMetadata',
    'app:installUpdate', 'app:openExternal', 'app:relaunch', 'app:version',
    'bin:getPath', 'cache:clearApi', 'config:get', 'config:save',

    'coverEditor:apply', 'coverEditor:archiveImage', 'coverEditor:archiveImages', 'coverEditor:archiveThumbnails',
    'coverEditor:clipboardImage', 'coverEditor:googleImage', 'coverEditor:image', 'coverEditor:importImage',
    'coverEditor:inspect', 'coverEditor:metadataImage', 'coverEditor:releaseImages',
    'dialog:librarySyncChoice', 'dialog:message', 'dialog:metadataDropChoice', 'dialog:saveFile',
    'dialog:selectArchives', 'dialog:selectFile', 'dialog:selectFiles', 'dialog:selectFolder',
    'fileAssociations:apply', 'fileAssociations:getStatus', 'fileAssociations:openSettings',

    'folder:applyLibraryMoveIndex', 'folder:clearContentIndex', 'folder:clearDupCache', 'folder:getContentIndexStatus',
    'folder:getLibraryFolderChildren', 'folder:getLibraryScanStates', 'folder:getLibraryTagFacets', 'folder:missingVolumes',
    'folder:scan', 'folder:searchLibraryContent', 'folder:searchLibraryFiles', 'folder:searchLibraryTags',
    'folder:startContentIndex', 'folder:stopContentIndex', 'folder:updateIndex',
    'font:getPath', 'font:listBundled', 'font:listSystem',
    'fs:cancelFolderDetails', 'fs:delete', 'fs:executeLibraryMove', 'fs:exists', 'fs:expandFolderMove',
    'fs:exportCsv', 'fs:filePreview', 'fs:findLibraryMoveConflicts', 'fs:folderDetails', 'fs:getRoots',
    'fs:getSpecialPaths', 'fs:multiRename', 'fs:openInExplorer', 'fs:openWithViewer', 'fs:readDir',
    'fs:removeEmptyTree', 'fs:rename', 'fs:showInFolder', 'fs:stat', 'fs:undoRename',
    'library:close', 'library:init', 'library:query',

    'metadata:analyze', 'metadata:cacheRemoteCover', 'metadata:cover', 'metadata:epubImage', 'metadata:epubImages',
    'metadata:exportCover', 'metadata:imageFile', 'metadata:latest', 'metadata:save',
    'organizer:analyze', 'organizer:execute', 'parser:extractCoreTitle', 'parser:parse', 'rating:save',
    'reading:clear', 'reading:getStates', 'reading:listRecent', 'reading:lists', 'reading:remove', 'reading:updateProgress',
    'readive:cancel', 'readive:enqueue', 'readive:pairing', 'readive:requestDestinationPage', 'readive:revoke',
    'readive:scan', 'readive:setLibraries', 'readive:start', 'readive:status', 'readive:stop',
    'releases:list', 'renamer:analyze', 'renamer:execute', 'renamer:extractImage',

    'server:addresses', 'server:setAddress', 'server:start', 'server:status', 'server:stop',
    'sound:list', 'sound:play', 'system:cpuCores', 'system:info',
    'task:extract:start', 'task:organize:start', 'task:rename:start', 'task:stop', 'telemetry:status',
    'tools:epubEditor', 'tools:epubOptimizer', 'tools:textCleaner:load', 'tools:textCleaner:save',
    'tts:supertonicInstall', 'tts:supertonicStatus',

    'viewer:closeWindow', 'viewer:controlAudioMiniPlayer', 'viewer:getAudioData', 'viewer:getAudioMiniPlayerState',
    'viewer:getComicPage', 'viewer:getConfig', 'viewer:getCurrentSession', 'viewer:getDocumentData', 'viewer:getEpubText',
    'viewer:getFullscreenState', 'viewer:getReadiveReadingState', 'viewer:getText', 'viewer:listAudioQueue',
    'viewer:listComicPages', 'viewer:open', 'viewer:openAdjacent', 'viewer:openAudioQueueItem', 'viewer:openExternal',
    'viewer:openTtsSettings', 'viewer:saveReadingState', 'viewer:toggleFullscreen', 'window:isMaximized',
]);
const REJECTION_TYPES = new Set(['undefined', 'null', 'string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'function']);
const BROWSER_ERROR_MESSAGES = new Map([
    ['ResizeObserver loop completed with undelivered notifications.', 'resize-observer-loop'],
    ['ResizeObserver loop limit exceeded', 'resize-observer-loop'],
    ['Script error.', 'script-error'],
]);

export function isTelemetryIpcChannelAllowed(value) {
    return IPC_CHANNELS.has(value);
}

export function isTelemetryRejectionTypeAllowed(value) {
    return REJECTION_TYPES.has(value);
}

export function classifyRendererErrorMessage(message, { errorNames, errorCodes, errorKind } = {}) {
    if (typeof message !== 'string') return {};
    if (errorKind === 'uncaught-error') {
        const browserError = BROWSER_ERROR_MESSAGES.get(message);
        if (browserError) return { browser_error: browserError };
        const uncaught = message.slice(0, 1024).match(/^Uncaught ([A-Za-z][A-Za-z0-9]{0,79}):(?: |$)/);
        if (uncaught && errorNames?.has(uncaught[1])) return { name: uncaught[1] };
    }
    const bounded = message.slice(0, 1024);
    const invocation = bounded.match(/^Error invoking remote method '([A-Za-z0-9:_-]{1,80})': /);
    if (!invocation || !isTelemetryIpcChannelAllowed(invocation[1])) return {};

    const diagnostics = { ipc_channel: invocation[1] };
    let details = bounded.slice(invocation[0].length);
    const name = details.match(/^([A-Za-z][A-Za-z0-9]{0,79}):(?: |$)/);
    if (name && errorNames?.has(name[1])) {
        diagnostics.name = name[1];
        details = details.slice(name[0].length);
    }
    const code = details.match(/^([A-Z][A-Z0-9_]{0,79})(?=:|$)/);
    if (code && errorCodes?.has(code[1])) diagnostics.code = code[1];
    return diagnostics;
}
