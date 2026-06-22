export const IMPLEMENTATION_AUDIT_TARGETS = Object.freeze([
    {
        file: 'src/App.jsx',
        scope: '공통 툴바, 탭, 상태, 설정, Toast',
        fragments: ['TABS', 'SettingsModal', 'Toast', 'bookmanager:toolbar-state', 'setRuntimeState'],
    },
    {
        file: 'src/components/SettingsModal.jsx',
        scope: '환경설정 전체',
        fragments: ['LANGUAGE_OPTIONS', 'FONT_SCALES', 'renderSecretInput', 'handleClearApiCache', 'handleUpdateIndex'],
    },
    {
        file: 'src/components/Toast.jsx',
        scope: 'Toast 수명/위치/중복',
        fragments: ['resolveToastMessage', 'window.setTimeout', 'toast.duration', 'onClose'],
    },
    {
        file: 'src/tabs/FolderTab.jsx',
        scope: '폴더 탭 조합과 컨텍스트 메뉴',
        fragments: ['FolderSidebar', 'FolderToolbar', 'searchQuery', 'FileTableView', 'contextMenu', 'handlePathNavigation'],
    },
    {
        file: 'src/components/folder/FolderSidebar.jsx',
        scope: '라이브러리/즐겨찾기/트리',
        fragments: ['libraries', 'favorites', 'renderTreeNode', 'getRoots', 'getSpecialPaths'],
    },
    {
        file: 'src/components/folder/FolderToolbar.jsx',
        scope: '그룹/필터/정렬/레이아웃',
        fragments: ['groupLabels', 'sortLabels', 'metadataMissingOnly', 'FOLDER_SORT_KEYS', 'onApplyLayout'],
    },
    {
        file: 'src/components/folder/FileTableView.jsx',
        scope: '상세 보기',
        fragments: ['forwardRef', 'normalizeColumnLayout', 'groupFolderFiles', 'handleRowClick', 'renderCell'],
    },
    {
        file: 'src/components/folder/ThumbnailView.jsx',
        scope: '썸네일 보기',
        fragments: ['ThumbnailView', 'groupFolderFiles', 'thumbnail-grid', 'CoverImage', 'handleItemClick'],
    },
    {
        file: 'src/components/folder/TileView.jsx',
        scope: '타일 보기',
        fragments: ['TileView', 'groupFolderFiles', 'tile-grid', 'CoverImage', 'handleItemClick'],
    },
    {
        file: 'src/components/folder/DetailPanel.jsx',
        scope: '상세 정보',
        fragments: ['DetailPanel', 'duplicateDetailRows', 'splitMetadataValues', 'formatSize', 'formatDate'],
    },
    {
        file: 'src/components/folder/MissingVolumesDialog.jsx',
        scope: '누락 권수',
        fragments: ['MissingVolumesDialog', 'useModalAccessibility', 'missingData', 'onGoToFolder'],
    },
    {
        file: 'src/tabs/OrganizerTab.jsx',
        scope: '구조 정리 UI',
        fragments: ['OrganizerTab', 'analyzeOrganizer', 'executeOrganizer', 'handleContinueToRenamer', 'MultiRenameDialog'],
    },
    {
        file: 'src/tabs/RenamerTab.jsx',
        scope: '내부 파일명 UI',
        fragments: ['RenamerTab', 'analyzeRenamer', 'executeRenamer', 'extractArchiveImage', 'handleContinueToMetadata'],
    },
    {
        file: 'src/tabs/MetadataTab.jsx',
        scope: '메타 입력/API 검색/저장',
        fragments: ['MetadataTab', 'META_FIELDS', 'fetchMetadata', 'saveMetadata', 'renderFieldInput'],
    },
    {
        file: 'src/tabs/SharingTab.jsx',
        scope: 'OPDS/WebDAV UI',
        fragments: ['SharingTab', 'opds', 'webdav', 'startServer', 'stopServer'],
    },
    {
        file: 'src/tabs/ReleaseTab.jsx',
        scope: '릴리즈 노트',
        fragments: ['ReleaseTab', 'getReleases', 'MarkdownBody', 'parseReleaseMarkdown', 'openExternal'],
    },
    {
        file: 'electron/ipcHandlers.js',
        scope: 'renderer/main 경계의 모든 입력 검증',
        fragments: ["ipcMain.handle('folder:scan'", "ipcMain.handle('metadata:save'", "ipcMain.handle('fs:rename'", 'normalizeExternalUrl'],
    },
    {
        file: 'electron/configManager.js',
        scope: '설정 호환과 원자적 저장',
        fragments: ['class ConfigManager', 'normalizeConfig', 'saveConfig', 'writeFile', 'corrupt'],
    },
    {
        file: 'electron/tasks/folderScanTask.js',
        scope: '폴더/메타/커버 스캔',
        fragments: ['scanFolder', 'inspectFolderFile', 'parseComicInfo', 'extractArchiveMetadata', 'cover'],
    },
    {
        file: 'electron/tasks/organizerTask.js',
        scope: '구조 분석',
        fragments: ['analyzeOrganizerInputs', 'getLeafGroups', 'formatLeafName', 'listArchiveEntries'],
    },
    {
        file: 'electron/tasks/organizeTask.js',
        scope: '구조 정리 실행',
        fragments: ['class OrganizeTask', 'FileLoadTask', '_groupIntoVolumes', '_sortChapters'],
    },
    {
        file: 'electron/tasks/renamerTask.js',
        scope: '내부 이름 분석/실행',
        fragments: ['analyzeRenamerInputs', 'executeRenamer', 'generateRenamedEntryName', 'extractRenamerImage'],
    },
    {
        file: 'electron/tasks/metadataTask.js',
        scope: '메타 분석/API 처리',
        fragments: ['analyzeMetadataInputs', 'saveMetadataItems', 'metadataWriteSupport', 'ComicInfo.xml'],
    },
    {
        file: 'electron/tasks/saveTask.js',
        scope: 'ComicInfo 저장',
        fragments: ['class SaveWorker', '_createComicInfoXML', '_injectXMLToArchive', '_injectZIP_Native'],
    },
    {
        file: 'electron/servers/sharingServers.js',
        scope: 'OPDS/WebDAV 호환성',
        fragments: ['buildOpdsApp', 'buildWebdavApp', 'resolveWebdavPath', 'Basic'],
    },
    {
        file: 'electron/database/library_db.js',
        scope: '인덱스/중복/시리즈 그룹',
        fragments: ['class LibraryDB', 'dup_cache', 'dup_target_index', 'migrateLegacyTables'],
    },
]);

export function implementationAuditTargetCount(targets = IMPLEMENTATION_AUDIT_TARGETS) {
    return targets.length;
}
