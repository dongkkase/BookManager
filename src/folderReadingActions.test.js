import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyReadingActionStates, resolveReadingActionPaths } from './folderReadingActions.js';
import { readViewerFileStatus } from './viewerStatusState.js';
import { resolveReadiveResumePage } from './readiveViewerResume.js';
import { translate } from './utils/i18n.js';

function storageFixture(values) {
    const data = new Map(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
    return {
        get length() { return data.size; },
        key: index => [...data.keys()][index],
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
    };
}

test('목록의 혼합 선택과 사이드바 대상은 각각 올바른 범위에 적용된다', () => {
    const folder = { path: '/books/series', isDirectory: true };
    const child = { path: '/books/series/book.txt' };
    const other = { path: '/books/other.pdf' };
    const selected = [folder, child, other];
    assert.deepEqual(resolveReadingActionPaths({ type: 'file', file: child }, selected), [folder.path, other.path]);
    assert.deepEqual(resolveReadingActionPaths({ type: 'folder', source: 'list', file: folder }, selected), [folder.path, other.path]);
    for (const type of ['folder', 'library']) {
        assert.deepEqual(resolveReadingActionPaths({ type, folderPath: '/other' }, selected), ['/other']);
    }
    assert.deepEqual(resolveReadingActionPaths({ type: 'file', file: { path: '/unselected.txt' } }, selected), ['/unselected.txt']);
});

test('초기화는 예전 EPUB 위치를 제거하고 책갈피와 뷰어 설정을 보존한다', () => {
    const filePath = '/books/소설.epub';
    const key = `bookmanager-viewer-state:${filePath}`;
    const bookmarksKey = `bookmanager-viewer-bookmarks:${filePath}`;
    const bookmarks = [{ pageIndex: 8 }];
    const storage = storageFixture({
        [key]: { pageIndex: 8, pageCount: 20, scrollPercent: 40, epubPosition: { chapter: 3 }, coverEditPageIndex: 8, playbackRate: 1.5 },
        [key.normalize('NFD')]: { pageIndex: 8, epubPosition: { chapter: 3 } },
        [bookmarksKey]: bookmarks,
    });
    const state = { filePath, status: 'unread', pageIndex: 0, pageCount: 20, scrollPercent: 0, positionSeconds: 0,
        locator: { kind: 'normalized', normalizedPosition: 0 }, updatedAt: '2026-09-28T00:00:00Z' };
    applyReadingActionStates(storage, [state], 'darwin');
    for (const target of [key, key.normalize('NFD')]) {
        const saved = JSON.parse(storage.getItem(target));
        assert.equal(saved.epubPosition, undefined);
        assert.equal(saved.coverEditPageIndex, undefined);
        assert.equal(resolveReadiveResumePage(saved, { type: 'epub', pageCount: 20 }), 0);
    }
    assert.equal(JSON.parse(storage.getItem(key)).playbackRate, 1.5);
    assert.deepEqual(JSON.parse(storage.getItem(bookmarksKey)), bookmarks);
    const status = readViewerFileStatus({ path: filePath, readingState: state }, storage);
    assert.equal(status.hasReadingProgress, false);
    assert.equal(status.isCompleted, false);
    assert.equal(status.bookmarkCount, 1);
});

test('읽고 싶은 책의 혼합 선택은 상위 폴더와 별도 선택한 하위 파일을 모두 유지한다', () => {
    const folder = { path: '/books/series', isDirectory: true };
    const child = { path: '/books/series/book.txt' };
    const selected = [folder, child, child];
    const options = { preserveNestedEntries: true };
    assert.deepEqual(resolveReadingActionPaths({ type: 'folder', source: 'list', file: folder }, selected, options), [folder.path, child.path]);
    assert.deepEqual(resolveReadingActionPaths({ type: 'file', file: child }, selected, options), [folder.path, child.path]);
    assert.deepEqual(resolveReadingActionPaths({ type: 'folder', folderPath: folder.path }, selected, options), [folder.path]);
});

test('전체 분량이 없는 파일도 완료로 표시하고 다음 뷰어에서 마지막 페이지로 이동한다', () => {
    for (const extension of ['cbz', 'pdf', 'txt', 'epub']) {
        const filePath = `/books/book.${extension}`;
        const storage = storageFixture({});
        const state = { filePath, status: 'completed', pageIndex: 0, pageCount: 0, scrollPercent: 100,
            locator: { kind: 'normalized', normalizedPosition: 1 } };
        applyReadingActionStates(storage, [state]);
        const status = readViewerFileStatus({ path: filePath, readingState: state }, storage);
        assert.equal(status.isCompleted, true);
        assert.equal(status.percent, 100);
        const saved = JSON.parse(storage.getItem(`bookmanager-viewer-state:${filePath}`));
        assert.equal(resolveReadiveResumePage(saved, { type: extension, pageCount: 50 }), 49);
    }
});

test('오디오 완료는 로컬에만 있던 재생 시간을 유지하고 초기화는 처음부터 재생한다', () => {
    const filePath = '/books/book.m4b';
    const key = `bookmanager-viewer-state:${filePath}`;
    const storage = storageFixture({ [key]: { positionSeconds: 60, durationSeconds: 120, playbackRate: 1.5 } });
    applyReadingActionStates(storage, [{ filePath, format: 'audio', status: 'completed', durationSeconds: 0,
        positionSeconds: 0, locator: { kind: 'audio-time', positionSeconds: 0 } }]);
    assert.equal(JSON.parse(storage.getItem(key)).positionSeconds, 120);
    applyReadingActionStates(storage, [{ filePath, format: 'audio', status: 'unread', positionSeconds: 0,
        locator: { kind: 'audio-time', positionSeconds: 0 } }]);
    const saved = JSON.parse(storage.getItem(key));
    assert.equal(saved.positionSeconds, 0);
    assert.equal(saved.durationSeconds, 120);
    assert.equal(saved.playbackRate, 1.5);
});

test('모든 컨텍스트 메뉴에 두 동작을 제공하고 세 언어 문구가 있다', () => {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    for (const action of ['mark-read', 'reset-progress']) {
        assert.equal(source.split(`handleContextAction('${action}')`).length - 1, 3);
    }
    for (const lang of ['ko', 'en', 'ja']) {
        for (const name of ['mark_read', 'reset_progress', 'updating', 'marked', 'reset_done', 'partial', 'no_files', 'failed', 'viewer_open']) {
            const key = `folder.reading.${name}`;
            assert.notEqual(translate(key, lang), key);
        }
    }
});

test('실제 폴더 액션은 중복 실행을 막고 저장·화면 갱신 및 실패 후 재시도를 처리한다', async () => {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('const changeReadingProgress = useCallback');
    const end = source.indexOf('const handleContextAction = useCallback', start);
    const calls = [];
    const ref = { current: false };
    let rejectRequest = false;
    let release;
    const filePath = '/books/book.txt';
    const state = { filePath, status: 'unread', pageIndex: 0, scrollPercent: 0, locator: { kind: 'normalized', normalizedPosition: 0 } };
    const storage = storageFixture({});
    const context = {
        useCallback: callback => callback,
        readingActionBusyRef: ref,
        resolveReadingActionPaths,
        selectedEntryObjects: [{ path: filePath }],
        setReadingActionBusy: busy => calls.push(['busy', busy]),
        showToast: text => calls.push(['toast', text]),
        t: (key, args = []) => `${key}:${args.join(',')}`,
        window: { localStorage: storage, electronAPI: { updateReadingProgress: async (paths, action) => {
            calls.push(['update', paths, action]);
            if (rejectRequest) throw new Error('failure');
            await new Promise(resolve => { release = resolve; });
            return { states: [state], errors: [] };
        } } },
        applyReadingActionStates,
        runtimePlatform: 'linux',
        setViewerStatusVersion: update => calls.push(['version', update(0)]),
        readingStatesLoaderRef: { current: { refresh: () => calls.push(['refresh']) } },
    };
    const change = new Function(...Object.keys(context), `${source.slice(start, end)}\nreturn changeReadingProgress;`)(...Object.values(context));
    const menu = { type: 'file', file: { path: filePath } };
    const pending = change(menu, 'reset-progress');
    await change(menu, 'mark-read');
    assert.equal(calls.filter(call => call[0] === 'update').length, 1);
    release();
    await pending;
    assert.equal(ref.current, false);
    assert.equal(JSON.parse(storage.getItem(`bookmanager-viewer-state:${filePath}`)).status, 'unread');
    assert.ok(calls.some(call => call[0] === 'refresh'));
    assert.ok(calls.some(call => call[1] === 'folder.reading.reset_done:1'));
    rejectRequest = true;
    await change(menu, 'mark-read');
    assert.equal(ref.current, false);
    assert.ok(calls.some(call => call[1] === 'folder.reading.failed:failure'));
});
