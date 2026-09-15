import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function fixture(tab, options = {}) {
    const filename = { organizer: 'OrganizerTab', renamer: 'RenamerTab', metadata: 'MetadataTab' }[tab];
    const source = readFileSync(new URL(`./tabs/${filename}.jsx`, import.meta.url), 'utf8');
    const analyzeStart = source.indexOf('const analyzePaths =');
    const analyzeEnd = source.indexOf('const handleSelectFiles =', analyzeStart);
    const clearStart = source.indexOf('const handleClear =');
    const clearEnd = source.indexOf('\n  useEffect(', clearStart);
    const actionStart = source.indexOf('const handleAppAction =');
    const actionEnd = source.indexOf("window.addEventListener('bookmanager:action'", actionStart);
    assert.ok(analyzeStart >= 0 && analyzeEnd > analyzeStart && clearEnd > clearStart && actionEnd > actionStart);
    const callbacks = source.slice(analyzeStart, analyzeEnd) + source.slice(clearStart, clearEnd) + source.slice(actionStart, actionEnd);
    const oldItem = { id: 'old', filepath: '/books/old.cbz', metadata: { Title: 'Edited title' } };
    const state = {
        fileList: [oldItem], expandedItems: new Set(['old']), selectedItemId: 'old', selectedItemIds: ['old'],
        selectedArchiveId: 'old', selectedEntryId: 'old-entry', coverPreview: 'old-cover', innerPreview: 'old-preview',
        selectedFileId: 'old', selectedGroup: 'old-group', collapsedGroups: new Set(['old-group']),
        batchMetadataByFileId: { old: {} }, epubImagesByFilePath: { '/books/old.cbz': [] },
        publisherOptions: ['Old publisher'], skippedFiles: ['old-skip'],
    };
    let finish;
    let fail;
    const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
    let settled;
    const done = new Promise(resolve => { settled = resolve; });
    const calls = { analyze: [], selectionsCleared: 0, errors: [] };
    const dependencies = {
        useCallback: callback => callback,
        window: { electronAPI: new Proxy({}, { get: () => async paths => { calls.analyze.push(paths); return pending; } }) },
        config: {}, language: 'ko', runtimePlatform: '', renameOptions: {}, renamerBatchOptions: {},
        defaultLanguageISO: 'ko', isWorking: Boolean(options.isWorking), t: key => key,
        hydrateOrganizerItem: item => item,
        assignOrganizerSeriesOutputPaths: items => items,
        groupOrganizerItems: items => items,
        refreshRenamerItem: item => item,
        isTxtMetadataItem: () => false,
        uniqueSelectOptions: items => [...new Set(items)],
        rememberSeriesGroupOptions: () => {},
        showToast: message => calls.errors.push(message),
        clearVolumeSelection: () => { calls.selectionsCleared += 1; },
        previewRequestRef: { current: { cover: 1, inner: 1 } },
        coverLoadRequestsRef: { current: new Map([['old', true]]) },
    };
    for (const setter of new Set(callbacks.match(/\bset[A-Z]\w+/g))) {
        const key = setter[3].toLowerCase() + setter.slice(4);
        dependencies[setter] = update => {
            state[key] = typeof update === 'function' ? update(state[key]) : update;
            if (setter === 'setIsWorking' && update === false) settled();
        };
    }
    const handlers = new Function(...Object.keys(dependencies), `${callbacks}\nreturn { handleAppAction };`)(...Object.values(dependencies));
    return {
        state, calls, oldItem, dependencies,
        action: detail => handlers.handleAppAction({ detail: { action: 'drop-paths', activeTab: tab, paths: ['/books/new.cbz'], ...detail } }),
        finish: async (items = [{ id: 'new', filepath: '/books/new.cbz' }]) => { finish({ items }); await done; },
        fail: async () => { fail(new Error('Analysis failed')); await done; },
    };
}

for (const tab of ['organizer', 'renamer', 'metadata']) {
    test(`${tab}: 위쪽 드롭은 분석 전에 전체 비우기를 실행하고 새 목록을 추가한다`, async () => {
        const value = fixture(tab);
        value.action({ dropMode: 'replace' });
        assert.deepEqual(value.state.fileList, []);
        assert.deepEqual(value.calls.analyze, [['/books/new.cbz']]);
        if (tab === 'organizer') {
            assert.equal(value.state.expandedItems.size, 0);
            assert.deepEqual(value.state.selectedItemIds, []);
            assert.equal(value.calls.selectionsCleared, 1);
        } else if (tab === 'renamer') {
            assert.equal(value.state.selectedArchiveId, null);
            assert.equal(value.state.coverPreview, '');
            assert.equal(value.state.innerPreview, '');
            assert.equal(value.dependencies.previewRequestRef.current.cover, 2);
        } else {
            assert.equal(value.state.selectedFileId, null);
            assert.deepEqual(value.state.batchMetadataByFileId, {});
            assert.deepEqual(value.state.epubImagesByFilePath, {});
            assert.equal(value.state.collapsedGroups.size, 0);
            assert.equal(value.dependencies.coverLoadRequestsRef.current.size, 0);
        }
        await value.finish();
        assert.deepEqual(value.state.fileList.map(item => item.filepath), ['/books/new.cbz']);
        assert.deepEqual(value.calls.errors, []);
    });

    test(`${tab}: 아래쪽 드롭과 기존 목록 전달은 이전 파일과 편집 내용을 유지한다`, async () => {
        for (const detail of [{ dropMode: 'append' }, {}, { action: 'load-paths', dropMode: 'replace' }]) {
            const value = fixture(tab);
            value.action(detail);
            assert.equal(value.state.fileList[0], value.oldItem);
            await value.finish();
            assert.deepEqual(value.state.fileList.map(item => item.filepath), ['/books/old.cbz', '/books/new.cbz']);
            assert.equal(value.state.fileList[0].metadata.Title, 'Edited title');
            assert.deepEqual(value.calls.errors, []);
        }
    });

    test(`${tab}: 작업 중이거나 빈 경로·다른 탭 요청이면 기존 목록을 비우지 않는다`, () => {
        for (const detail of [{ paths: [] }, { paths: undefined }, { activeTab: 'other' }]) {
            const value = fixture(tab);
            value.action({ dropMode: 'replace', ...detail });
            assert.deepEqual(value.state.fileList, [value.oldItem]);
            assert.deepEqual(value.calls.analyze, []);
        }
        const busy = fixture(tab, { isWorking: true });
        busy.action({ dropMode: 'replace' });
        assert.deepEqual(busy.state.fileList, [busy.oldItem]);
        assert.deepEqual(busy.calls.analyze, []);
    });

    test(`${tab}: 교체 분석 결과가 비거나 실패해도 이전 목록을 되살리지 않는다`, async () => {
        for (const fail of [false, true]) {
            const value = fixture(tab);
            value.action({ dropMode: 'replace' });
            if (fail) await value.fail();
            else await value.finish([]);
            assert.deepEqual(value.state.fileList, []);
            assert.equal(value.state.isWorking, false);
            assert.equal(value.calls.errors.length, fail ? 1 : 0);
        }
    });
}
