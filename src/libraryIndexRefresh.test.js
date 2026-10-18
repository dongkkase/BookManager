import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { basename } from './utils/folderPath.js';

function callbackSource(file, name, nextName) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf(`const ${name} =`);
    const end = source.indexOf(`const ${nextName} =`, start);
    assert.ok(start >= 0 && end > start);
    return `${source.slice(start, end)}\nreturn ${name};`;
}

test('설정의 인덱스 색인 갱신은 변경사항 확인 모드로 요청한다', async () => {
    const calls = [];
    const context = {
        localConfig: { dup_check_folders: ['/Library'], language: 'ko' },
        window: { electronAPI: { updateFolderIndex: async (...args) => { calls.push(args); return { total: 12 }; } } },
        setMaintenanceBusy() {},
        setMaintenanceMessage() {},
        label: (_key, fallback) => fallback,
        showToast() {},
    };
    const handler = new Function(...Object.keys(context), callbackSource('./components/SettingsModal.jsx', 'handleUpdateIndex', 'handleClearApiCache'))(...Object.values(context));
    await handler();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][0], ['/Library']);
    assert.equal(calls[0][1].mode, 'smart');
});

function folderFixture(choice, result = { success: true }) {
    const calls = { index: [], scans: [], errors: [] };
    const context = {
        useCallback: callback => callback,
        window: { electronAPI: {
            chooseLibrarySyncMode: async () => choice,
            updateFolderIndex: async (...args) => { calls.index.push(args); return result; },
            showMessage: async message => { calls.errors.push(message); },
        } },
        preparingDuplicates: false,
        scanning: false,
        backgroundLibraryScanCancelRef: { current: null },
        config: { language: 'ko' },
        saveConfig: async () => {},
        basename,
        normalizeLibraryKey: value => value,
        folderStatusItemRef: { current: {} },
        activeLibraryScanKeyRef: { current: '' },
        libraryScanUiHeartbeatRef: { current: 0 },
        preparingDuplicatesRef: { current: false },
        libraryPhaseRef: { current: '' },
        selectedFolderPath: '/Library/Subfolder',
        includeSubfolders: false,
        scanOptions: { includeSubfolders: false, force: true },
        folderNavigationRequestRef: { current: 0 },
        selectedFolderPathRef: { current: '/Library/Subfolder' },
        folderNavigationRef: { current: {} },
        pushFolderNavigation: previous => previous,
        prepareFolderLocationRestore: () => ({}),
        scanFolder: async (...args) => { calls.scans.push(args); },
        isCheckingMissing: false,
        t: key => key,
    };
    for (const name of [
        'setLibraryScanStateMap', 'setPreparingDuplicates', 'setLibraryTaskMode',
        'setDuplicatePreparationStatus', 'setDuplicatePreparationProgress',
        'setFolderTaskCancelling', 'refreshLibraryScanStates', 'invalidateMissingVolumesCheck',
        'setMissingRefreshVersion', 'markLibraryScanStatesCancelled', 'emitStatusState',
        'setIncludeSubfolders', 'setSelectedFolderPath', 'setFolderSource',
        'setFolderNavigation', 'setGotoPathDraft', 'setShowGotoPathHistory',
        'clearSelection', 'resetSearchQuery', 'completeFolderLocationScan', 'showToast',
    ]) context[name] = () => {};
    const run = new Function(...Object.keys(context), callbackSource('./tabs/FolderTab.jsx', 'runLibraryIndexAction', 'handleCancelCurrentTask'))(...Object.values(context));
    return { calls, run };
}

for (const choice of ['smart', 'force']) {
    test(`${choice} 인덱싱 이후 목록은 새로 읽고 갱신된 메타데이터 캐시는 재사용한다`, async () => {
        const value = folderFixture(choice);
        await value.run('/Library', true);
        assert.deepEqual(value.calls.errors, []);
        assert.equal(value.calls.index.length, 1);
        assert.equal(value.calls.index[0][1].mode, choice);
        assert.equal(value.calls.index[0][1].forceMetadata, choice === 'force');
        assert.equal(value.calls.scans.length, 1);
        assert.equal(value.calls.scans[0][1].refresh, true);
        assert.equal(value.calls.scans[0][1].force, false);
    });
}

test('취소된 인덱스 갱신 뒤에는 후속 목록 스캔을 실행하지 않는다', async () => {
    const value = folderFixture('smart', { success: true, cancelled: true });
    await value.run('/Library');
    assert.equal(value.calls.index.length, 1);
    assert.equal(value.calls.scans.length, 0);
});
