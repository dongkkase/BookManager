import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');

for (const isListDuplicateScope of [false, true]) {
    test(`중복 토글은 현재 화면에 맞는 검사만 시작한다 (목록=${isListDuplicateScope})`, async () => {
        const start = source.indexOf('const handleDupCheckChange = useCallback');
        const end = source.indexOf('\n  ]);', start) + '\n  ]);'.length;
        const calls = [];
        const context = vm.createContext({
            useCallback: callback => callback,
            shouldDisableFolderToggles: () => false,
            scanning: false, preparingDuplicates: false, enableDupCheck: false,
            isListDuplicateScope,
            selectedFolderPath: '/previous-folder',
            config: { dup_check_folders: ['/library'] },
            scanOptions: { includeSubfolders: true },
            setEnableDupCheck: enabled => calls.push(['enabled', enabled]),
            clearSelection: () => {},
            resetCoverPreviewQueue: () => {},
            scanFolder: async (folder, options) => calls.push(['scan', folder, options.enableDupCheck, options.force]),
        });
        await vm.runInContext(`${source.slice(start, end)}\nhandleDupCheckChange();`, context);
        assert.deepEqual(calls, isListDuplicateScope
            ? [['enabled', true]]
            : [['enabled', true], ['scan', '/previous-folder', true, true]]);
    });
}

for (const scope of ['folder', 'collection', 'search', 'tags']) {
    test(`새로고침은 현재 목록의 중복 검사를 갱신한다 (${scope})`, async () => {
        const start = source.indexOf('const handleRefresh = useCallback');
        const end = source.indexOf('\n\n', start);
        const calls = [];
        const context = vm.createContext({
            useCallback: callback => callback,
            isListDuplicateScope: scope !== 'folder', enableDupCheck: true,
            isReadingList: scope === 'collection',
            isLibrarySearchActive: scope === 'search', isFolderTagSearchActive: scope === 'tags',
            folderTagMatchMode: 'any', folderTagSelections: ['tag'],
            resetCoverPreviewQueue: () => {},
            refreshListDuplicates: () => calls.push('duplicates'),
            refreshActiveReadingList: async () => calls.push('reading-list'),
            librarySearchRequestRef: { current: 0 },
            setSearchSubmitToken: () => calls.push('search'),
            applyFolderTagSearch: async () => calls.push('tags'),
            selectedFolderPath: '/previous-folder', scanOptions: { enableDupCheck: true },
            scanFolder: async () => { calls.push('folder'); return []; },
            scheduleLocalMissingToast: () => {}, findMissingVolumes: () => [],
            invalidateMissingVolumesCheck: () => {}, setMissingRefreshVersion: () => {},
        });
        await vm.runInContext(`${source.slice(start, end)}\nhandleRefresh();`, context);
        assert.deepEqual(calls, {
            folder: ['folder'], collection: ['duplicates', 'reading-list'],
            search: ['duplicates', 'search'], tags: ['duplicates', 'tags'],
        }[scope]);
    });
}

test('중복 검사 토글은 라이브러리 재인덱싱을 시작하지 않는다', () => {
    const start = source.indexOf('const handleDupCheckChange = useCallback');
    assert.notEqual(start, -1);
    const end = source.indexOf('const handleRefreshTree', start);
    const block = source.slice(start, end);
    assert.doesNotMatch(block, /updateFolderIndex/);
    assert.doesNotMatch(block, /setPreparingDuplicates\(true\)/);
    assert.match(block, /enableDupCheck:\s*nextValue/);
});

test('라이브러리 이동 완료 후 전체 인덱싱 대신 이동 결과만 증분 반영한다', () => {
    const start = source.indexOf('const moveSelectedToLibrary = useCallback');
    assert.notEqual(start, -1);
    const end = source.indexOf('const openLibraryMoveDialog', start);
    const block = source.slice(start, end);
    assert.match(block, /completedMoves/);
    assert.match(block, /applyLibraryMoveIndex/);
    assert.doesNotMatch(block, /updateFolderIndex/);
});
