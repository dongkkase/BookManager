import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { folderEntryOperationTargets } from './fileActionPolicy.js';
import { serializeFavorites } from './favoriteState.js';
import { isFavoriteFolder, replaceTreePath } from './folderContextState.js';
import { resolveSelectionAfterDelete } from './folderTreeState.js';
import { syncLibraryConfig } from './settingsPolicy.js';
import { basename } from './utils/folderPath.js';

const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const folderPath = '/Volumes/NAS/Books/Delete';
const remainingPath = '/Volumes/NAS/Books/Keep';

function callbackSource(name, nextName) {
    const start = source.indexOf(`const ${name} = useCallback`);
    const end = source.indexOf(`const ${nextName} = useCallback`, start);
    assert.ok(start >= 0 && end > start, `The ${name} callback must exist`);
    return source.slice(start, end);
}

const callbacks = [
    callbackSource('removeDeletedEntries', 'handleRefresh'),
    callbackSource('deleteSelectedFiles', 'renameSelectedFile'),
    callbackSource('deleteContextFolder', 'moveContextFolderToLibrary'),
].join('\n');

function fixture(result, options = {}) {
    const entries = options.entries || [{ full_path: folderPath, isDirectory: true }];
    const calls = { messages: [], errors: [], deleted: [], refreshed: 0, cleared: 0, treeVersion: 0, configs: [], removedFavorites: [], removedLibraries: [], navigated: [] };
    const state = { selectedPaths: entries.map(entry => entry.full_path), folderPath };
    const selectedFolderPathRef = { current: folderPath };
    const view = viewContext(options.view);
    const context = {
        ...view.context,
        useCallback: callback => callback,
        window: { electronAPI: {
            showMessage: async message => { calls.messages.push(message); return options.confirm ?? 'yes'; },
            deleteFiles: async paths => { calls.deleted.push(paths); return result; },
            exists: async value => options.exists ? options.exists(value) : !result?.deleted?.includes(value),
        } },
        folderEntryOperationTargets,
        selectedEntryObjects: entries,
        config: { language: 'ko', dup_check_folders: [folderPath, remainingPath] },
        t: key => key,
        runInternalFileAction: action => action(),
        favoriteEntries: [folderPath, remainingPath].map(path => ({ path, name: basename(path) })),
        libraryEntries: [folderPath, remainingPath].map(path => ({ path })),
        libraries: [folderPath, remainingPath],
        serializeFavorites,
        syncLibraryConfig,
        replaceTreePath,
        isFavoriteFolder,
        resolveSelectionAfterDelete,
        basename,
        saveConfig: async patch => { calls.configs.push(patch); },
        setTreeRefreshToken: update => { calls.treeVersion = update(calls.treeVersion); },
        clearSelection: () => { calls.cleared += 1; state.selectedPaths = []; },
        handleRefresh: async () => { calls.refreshed += 1; },
        showFolderError: async (title, message) => { calls.errors.push({ title, message }); },
        removeFavorite: async path => { calls.removedFavorites.push(path); },
        removeLibrary: async path => { calls.removedLibraries.push(path); },
        handleFolderChange: async path => { calls.navigated.push(path); state.folderPath = path; selectedFolderPathRef.current = path; },
        folderNavigationRequestRef: { current: 0 },
        selectedFolderPathRef,
        setSelectedFolderPath: path => { state.folderPath = path; },
    };
    const handlers = new Function(...Object.keys(context), `${callbacks}\nreturn { deleteSelectedFiles, deleteContextFolder };`)(...Object.values(context));
    return {
        calls, state, view,
        errors: () => [...calls.errors, ...calls.messages.filter(message => message.type === 'error')],
        run: kind => kind === 'selected' ? handlers.deleteSelectedFiles()
            : handlers.deleteContextFolder({ folderPath, siblingPaths: [folderPath, remainingPath] }),
    };
}

function viewContext(options = {}) {
    const rows = options.rows || [{ path: folderPath }, { path: remainingPath }];
    const state = {
        librarySearchResults: [...rows], folderTagSearchResults: [...rows], recentReadingFiles: [...rows],
        librarySearchLoading: true, folderTagLoading: true, recentReadingLoading: true,
        folderTagFacetScopeKey: 'cached-scopes', searchSubmitToken: 0, missingRefreshVersion: 0,
    };
    const calls = { cacheClears: 0, resets: 0, scans: [], tags: [], recent: 0, stat: 0, missing: 0, explorerRefresh: 0 };
    const context = {
        useCallback: callback => callback,
        runtimePlatform: options.platform || 'darwin',
        librarySearchRequestRef: { current: 10 },
        folderTagRequestRef: { current: 20 },
        recentReadingRequestRef: { current: 30 },
        clearFolderCache: () => { calls.cacheClears += 1; },
        resetCoverPreviewQueue: () => { calls.resets += 1; },
        isRecentReading: options.isRecentReading || false,
        isLibrarySearchActive: options.isLibrarySearchActive || false,
        isFolderTagSearchActive: options.isFolderTagSearchActive || false,
        folderTagSelections: [{ category: 'writer', value: 'Writer' }],
        folderTagMatchMode: 'any',
        folderTagDatabaseScopes: ['/Volumes/NAS/Books'],
        folderTagDatabaseScopeKey: 'scopes',
        selectedFolderPath: options.selectedFolderPath ?? '/Volumes/NAS/Books',
        scanOptions: { includeSubfolders: true, fastInitial: true },
        scanFolder: async (path, scanOptions) => { calls.scans.push({ path, options: scanOptions }); return options.scanRows || []; },
        scheduleLocalMissingToast() {},
        findMissingVolumes: () => [],
        invalidateMissingVolumesCheck: () => { calls.missing += 1; },
        showToast() {},
        t: key => key,
        scanning: false,
        preparingDuplicates: false,
        watchedMtimeRef: { current: 10 },
        isExplorerPanelActive: () => options.explorerActive || false,
        refreshContextFolder: async () => { calls.explorerRefresh += 1; },
        window: { electronAPI: {
            searchLibraryTags: async (...args) => { calls.tags.push(args); return options.tags ? options.tags(...args) : options.freshRows || []; },
            listRecentReading: async () => { calls.recent += 1; return options.recent ? options.recent() : options.freshRows || []; },
            searchLibraryFiles: async () => options.search ? options.search() : options.freshRows || [],
            stat: async () => { calls.stat += 1; return { isDirectory: true, mtime: 10 }; },
        } },
        libraries: ['/Volumes/NAS/Books'],
        normalizedSearchQuery: 'book',
        searchScope: 'metadata',
        searchSubmitToken: 0,
        RECENT_READING_LIMIT: 50,
        LIBRARY_SEARCH_RESULT_LIMIT: 3000,
        CONTENT_SEARCH_RESULT_LIMIT: 3000,
        mergeLibrarySearchResults: (metadata, content) => [...metadata, ...content],
        React: { startTransition: callback => callback() },
    };
    for (const key of [
        'librarySearchResults', 'folderTagSearchResults', 'recentReadingFiles',
        'librarySearchLoading', 'folderTagLoading', 'recentReadingLoading',
        'folderTagFacetScopeKey', 'searchSubmitToken', 'missingRefreshVersion',
        'recentReadingLoaded', 'folderTagSelections', 'folderTagMatchMode',
        'folderTagResultScopeKey', 'showFolderTagSearchDialog', 'showContentIndexSearchHint',
    ]) context[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => {
        state[key] = typeof value === 'function' ? value(state[key]) : value;
    };
    return { context, state, calls };
}

function refreshFixture(options = {}) {
    const view = viewContext(options);
    const recentStart = source.indexOf('const loadRecentReading = useCallback');
    const recentEnd = source.indexOf('\n    useEffect(', recentStart);
    assert.ok(recentStart >= 0 && recentEnd > recentStart);
    const declarations = [
        callbackSource('applyFolderTagSearch', 'resetSearchQuery'),
        source.slice(recentStart, recentEnd),
        callbackSource('removeDeletedEntries', 'handleRefresh'),
        callbackSource('handleRefresh', 'executeCoverEdit'),
        callbackSource('handleSmartRefresh', 'handleIncludeSubfoldersChange'),
        callbackSource('handleRefreshShortcut', 'handleRenameShortcut'),
    ].join('\n');
    const methods = new Function(...Object.keys(view.context), `return (() => { ${declarations}\nreturn { removeDeletedEntries, handleRefresh, handleSmartRefresh, handleRefreshShortcut, applyFolderTagSearch, loadRecentReading }; })();`)(...Object.values(view.context));
    const startSearch = () => {
        const start = source.indexOf('  useEffect(() => {\n    const requestId = librarySearchRequestRef.current');
        const end = source.indexOf('\n  useEffect(', start + 1);
        assert.ok(start >= 0 && end > start);
        const context = { ...view.context, useEffect: callback => callback() };
        new Function(...Object.keys(context), source.slice(start, end))(...Object.values(context));
    };
    return { ...view, ...methods, startSearch };
}

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('휴지통 대체 삭제를 전부 취소하면 오류 없이 선택과 현재 폴더를 유지한다', async () => {
    for (const kind of ['selected', 'context']) {
        const value = fixture({ success: false, deleted: [], errors: [], cancelled: true, cancelledPaths: [folderPath] });
        await value.run(kind);
        assert.deepEqual(value.calls.deleted, [[folderPath]]);
        assert.deepEqual(value.errors(), []);
        assert.deepEqual(value.state.selectedPaths, [folderPath]);
        assert.equal(value.state.folderPath, folderPath);
        assert.equal(value.calls.cleared, 0);
        assert.equal(value.calls.refreshed, 0);
        assert.equal(value.calls.treeVersion, 0);
        assert.deepEqual(value.calls.configs, []);
        assert.deepEqual(value.calls.removedFavorites, []);
        assert.deepEqual(value.calls.removedLibraries, []);
        assert.deepEqual(value.view.state.librarySearchResults.map(file => file.path), [folderPath, remainingPath]);
        assert.equal(value.view.calls.cacheClears, 0);
        assert.equal(value.view.context.librarySearchRequestRef.current, 10);
        assert.equal(value.view.context.folderTagRequestRef.current, 20);
        assert.equal(value.view.context.recentReadingRequestRef.current, 30);
    }
});

test('일부 항목 삭제 후 나머지를 취소하면 오류 없이 실제 삭제 항목을 정리한다', async () => {
    const value = fixture({ success: false, deleted: [folderPath], errors: [], cancelled: true, cancelledPaths: [remainingPath] }, {
        entries: [folderPath, remainingPath].map(full_path => ({ full_path, isDirectory: true })),
        exists: () => false,
    });
    await value.run('selected');
    assert.deepEqual(value.errors(), []);
    assert.equal(value.calls.cleared, 1);
    assert.equal(value.calls.refreshed, 1);
    assert.equal(value.calls.treeVersion, 1);
    assert.deepEqual(value.calls.configs[0].favorites, [remainingPath]);
    assert.deepEqual(value.calls.configs[0].libraries, [remainingPath]);
    assert.deepEqual(value.calls.configs[0].dup_check_folders, [remainingPath]);
});

test('삭제가 취소되어도 앞선 오류가 있으면 오류와 변경 내용을 표시하며 위치는 유지한다', async () => {
    for (const kind of ['selected', 'context']) {
        const value = fixture({ success: false, deleted: [], errors: ['Permission denied'], cancelled: true, cancelledPaths: [folderPath] });
        await value.run(kind);
        assert.equal(value.errors().length, 1);
        assert.equal(value.errors()[0].message, 'Permission denied');
        assert.deepEqual(value.state.selectedPaths, [folderPath]);
        assert.equal(value.state.folderPath, folderPath);
        assert.equal(value.calls.cleared, 0);
        assert.equal(value.calls.refreshed, 1);
        assert.equal(value.calls.treeVersion, 1);
        assert.deepEqual(value.calls.configs, []);
    }
});

test('폴더 중간 삭제 실패는 오류를 보여주고 트리와 목록을 새로고침한다', async () => {
    for (const kind of ['selected', 'context']) {
        const value = fixture({ success: false, deleted: [], errors: ['A child file is locked'], cancelled: false, cancelledPaths: [] });
        await value.run(kind);
        assert.equal(value.errors()[0].message, 'A child file is locked');
        assert.equal(value.calls.refreshed, 1);
        assert.equal(value.calls.treeVersion, 1);
        assert.equal(value.state.folderPath, folderPath);
        assert.deepEqual(value.calls.removedFavorites, []);
        assert.deepEqual(value.calls.removedLibraries, []);
        if (kind === 'context') assert.deepEqual(value.state.selectedPaths, [folderPath]);
    }
});

test('실제 폴더 삭제 뒤 DB 동기화 실패가 있어도 삭제된 폴더에서 벗어나고 등록을 정리한다', async () => {
    const value = fixture({ success: false, deleted: [folderPath], errors: ['Database sync failed'], cancelled: false, cancelledPaths: [] });
    await value.run('context');
    assert.equal(value.errors()[0].message, 'Database sync failed');
    assert.deepEqual(value.calls.removedFavorites, [folderPath]);
    assert.deepEqual(value.calls.removedLibraries, [folderPath]);
    assert.equal(value.calls.treeVersion, 1);
    assert.deepEqual(value.calls.navigated, [remainingPath]);
    assert.equal(value.state.folderPath, remainingPath);
});

test('삭제 성공 시 선택 파일은 새로고침하고 컨텍스트 폴더는 다음 폴더로 이동한다', async () => {
    for (const kind of ['selected', 'context']) {
        const value = fixture({ success: true, deleted: [folderPath], errors: [], cancelled: false, cancelledPaths: [] });
        await value.run(kind);
        assert.deepEqual(value.errors(), []);
        assert.equal(value.calls.treeVersion, 1);
        if (kind === 'selected') {
            assert.equal(value.calls.cleared, 1);
            assert.equal(value.calls.refreshed, 1);
            assert.deepEqual(value.calls.configs[0].favorites, [remainingPath]);
        } else {
            assert.equal(value.state.folderPath, remainingPath);
            assert.deepEqual(value.calls.removedFavorites, [folderPath]);
            assert.deepEqual(value.calls.removedLibraries, [folderPath]);
        }
    }
});

test('라이브러리 검색은 선택 폴더가 없어도 진행 중 요청을 무효화하고 다시 검색한다', async () => {
    const value = refreshFixture({ isLibrarySearchActive: true, selectedFolderPath: '' });
    await value.handleRefresh();
    assert.equal(value.state.searchSubmitToken, 1);
    assert.equal(value.context.librarySearchRequestRef.current, 11);
    assert.equal(value.calls.resets, 1);
    assert.deepEqual(value.calls.scans, []);
    assert.equal(value.calls.recent, 0);
});

test('검색과 태그 필터를 함께 새로고침해도 기존 태그와 AND·OR 조건을 유지한다', async () => {
    const freshRows = [{ path: remainingPath }];
    const value = refreshFixture({ isLibrarySearchActive: true, isFolderTagSearchActive: true, selectedFolderPath: '', freshRows });
    await value.handleRefresh();
    assert.equal(value.state.searchSubmitToken, 1);
    assert.deepEqual(value.calls.tags, [[value.context.folderTagDatabaseScopes, value.context.folderTagSelections, 'any']]);
    assert.deepEqual(value.state.folderTagSearchResults, freshRows);
    assert.deepEqual(value.state.folderTagSelections, value.context.folderTagSelections);
    assert.equal(value.state.folderTagMatchMode, 'any');
    assert.deepEqual(value.calls.scans, []);
});

test('최근 읽음 새로고침은 폴더 스캔 대신 최근 기록을 다시 조회한다', async () => {
    const freshRows = [{ path: remainingPath }];
    const value = refreshFixture({ isRecentReading: true, selectedFolderPath: '', freshRows });
    await value.handleRefresh();
    assert.equal(value.calls.recent, 1);
    assert.deepEqual(value.state.recentReadingFiles, freshRows);
    assert.deepEqual(value.calls.scans, []);
    assert.deepEqual(value.calls.tags, []);
    assert.equal(value.state.searchSubmitToken, 0);
});

test('일반 폴더 새로고침은 기존 옵션을 보존하며 강제 스캔과 누락권 상태 갱신을 유지한다', async () => {
    const value = refreshFixture();
    await value.handleRefresh();
    assert.deepEqual(value.calls.scans, [{ path: '/Volumes/NAS/Books', options: { includeSubfolders: true, fastInitial: true, force: true } }]);
    assert.equal(value.calls.missing, 1);
    assert.equal(value.state.missingRefreshVersion, 1);
    assert.equal(value.calls.recent, 0);
    assert.equal(value.state.searchSubmitToken, 0);
});

test('두 삭제 진입점은 삭제 폴더와 하위 파일을 모든 결과에서 즉시 제거하고 취소·유사 경로를 유지한다', async () => {
    const rows = [{ path: folderPath }, { full_path: `${folderPath}/child.cbz` }, { path: `${folderPath}-other/book.cbz` }, { path: remainingPath }];
    const remaining = rows.slice(2);
    for (const kind of ['selected', 'context']) {
        const value = fixture({ success: false, deleted: [folderPath], errors: [], cancelled: true, cancelledPaths: [remainingPath] }, { view: { rows } });
        await value.run(kind);
        assert.deepEqual(value.view.state.librarySearchResults, remaining);
        assert.deepEqual(value.view.state.folderTagSearchResults, remaining);
        assert.deepEqual(value.view.state.recentReadingFiles, remaining);
        assert.equal(value.view.state.librarySearchLoading, false);
        assert.equal(value.view.state.folderTagLoading, false);
        assert.equal(value.view.state.recentReadingLoading, false);
        assert.equal(value.view.state.folderTagFacetScopeKey, '');
        assert.equal(value.view.calls.cacheClears, 1);
    }
});

test('삭제 결과 경로 비교는 Mac Unicode와 Windows 구분자·대소문자를 처리하며 Linux 파일을 구분한다', () => {
    const cases = [
        { platform: 'darwin', deleted: '/books/한글', rows: [{ path: '/books/한글/a.cbz'.normalize('NFD') }, { path: '/books/한글-other/a.cbz' }], kept: 1 },
        { platform: 'Win32', deleted: 'C:\\Books\\Gone', rows: [{ path: 'c:/books/gone/a.cbz' }, { path: 'C:\\BOOKS\\GONE-extra\\a.cbz' }], kept: 1 },
        { platform: 'linux', deleted: '/books/Gone', rows: [{ path: '/books/Gone/a.cbz' }, { path: '/books/gone/a.cbz' }], kept: 1 },
        { platform: 'linux', deleted: '/books/é', rows: [{ path: '/books/é/a.cbz' }, { path: '/books/é/a.cbz' }], kept: 1 },
    ];
    for (const options of cases) {
        const value = refreshFixture(options);
        value.removeDeletedEntries([options.deleted]);
        assert.equal(value.state.librarySearchResults.length, options.kept, options.platform);
        assert.deepEqual(value.state.librarySearchResults, [options.rows[1]]);
    }
});

test('삭제 이전 검색·태그·최근읽음 응답이 늦게 도착해도 삭제 파일을 복구하지 않는다', async () => {
    const search = deferred();
    const tags = deferred();
    const recent = deferred();
    const rows = [{ path: folderPath }, { path: remainingPath }];
    const value = refreshFixture({ rows, isLibrarySearchActive: true, search: () => search.promise, tags: () => tags.promise, recent: () => recent.promise });
    value.startSearch();
    const tagRequest = value.applyFolderTagSearch({ selections: value.context.folderTagSelections, matchMode: 'any' });
    const recentRequest = value.loadRecentReading();
    value.removeDeletedEntries([folderPath]);
    search.resolve(rows);
    tags.resolve(rows);
    recent.resolve(rows);
    await Promise.all([tagRequest, recentRequest]);
    await tick();
    assert.deepEqual(value.state.librarySearchResults, [rows[1]]);
    assert.deepEqual(value.state.folderTagSearchResults, [rows[1]]);
    assert.deepEqual(value.state.recentReadingFiles, [rows[1]]);
});

test('F5와 스마트 새로고침은 검색 중 폴더 선택·mtime·탐색기 포커스보다 검색 갱신을 우선한다', async () => {
    for (const selectedFolderPath of ['', '/Volumes/NAS/Books']) {
        const value = refreshFixture({ isLibrarySearchActive: true, selectedFolderPath, explorerActive: true });
        await value.handleSmartRefresh();
        assert.equal(value.state.searchSubmitToken, 1);
        assert.equal(value.calls.stat, 0);
        await value.handleRefreshShortcut();
        assert.equal(value.state.searchSubmitToken, 2);
        assert.equal(value.calls.explorerRefresh, 0);
    }
});
