import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { isLibraryReadingStorageAllowed, pruneLibraryReadingStorage } from './libraryReadingStorage.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const audioSource = fs.readFileSync(new URL('./components/viewer/AudiobookViewer.jsx', import.meta.url), 'utf8');

function sourceFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} function must exist`);
    const end = source.indexOf('\n}', start);
    assert.notEqual(end, -1, `${name} function must end`);
    return source.slice(start, end + 2);
}

function createStorage() {
    const values = new Map();
    return {
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] ?? null; },
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { values.set(key, value); },
        removeItem(key) { values.delete(key); },
    };
}

function viewerStorage(storage = createStorage()) {
    const context = vm.createContext({
        window: { localStorage: storage },
        localStorage: storage,
        isLibraryReadingStorageAllowed,
    });
    vm.runInContext([
        ...['storageKey', 'readJson', 'saveJson'].map(name => sourceFunction(viewerSource, name)),
        ...['audioStateKey', 'readStoredJson', 'saveStoredJson'].map(name => sourceFunction(audioSource, name)),
    ].join('\n'), context);
    return { ...context, storage };
}

test('직접 연 외부 도서의 페이지와 EPUB 위치는 라이브러리 정리 후 다시 열어도 복원한다', () => {
    const app = viewerStorage();
    const paths = ['/Downloads/book.cbz', '/Downloads/book.pdf', '/Downloads/book.epub', '/Downloads/book.txt'];
    const expected = { pageIndex: 12, scrollPercent: 46, epubPosition: { sectionHref: 'chapter2.xhtml', sourceOffset: 52 } };
    for (const filePath of paths) {
        const session = { filePath, retainOutsideLibrary: true };
        app.saveJson(app.storageKey(session, 'state'), expected, ['/Library']);
    }
    assert.equal(pruneLibraryReadingStorage(app.storage, ['/Library']), 0);
    assert.equal(pruneLibraryReadingStorage(app.storage, []), 0);
    const reopened = viewerStorage(app.storage);
    for (const filePath of paths) {
        const session = { filePath, retainOutsideLibrary: true };
        const state = reopened.readJson(reopened.storageKey(session, 'state'), null, []);
        assert.deepEqual(JSON.parse(JSON.stringify(state)), expected);
    }
});

test('직접 연 외부 오디오북의 재생 위치와 속도도 정리 후 복원한다', () => {
    const app = viewerStorage();
    const session = { filePath: '/Downloads/book.m4b', retainOutsideLibrary: true };
    const expected = { positionSeconds: 127, durationSeconds: 300, playbackRate: 1.5 };
    app.saveStoredJson(app.audioStateKey(session), expected, []);
    assert.equal(pruneLibraryReadingStorage(app.storage, []), 0);
    const reopened = viewerStorage(app.storage);
    const state = reopened.readStoredJson(reopened.audioStateKey({ ...session, id: 'reopened' }), null, []);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), expected);
});

test('등록 도서와 미리보기는 기존 저장 범위를 유지하고 표식 없는 외부 상태는 저장하지 않는다', () => {
    const app = viewerStorage();
    const inside = { filePath: '/Library/book.epub', retainOutsideLibrary: false };
    const outside = { filePath: '/Downloads/book.epub' };
    const preview = { ...outside, retainOutsideLibrary: true, preview: true };
    assert.equal(app.storageKey(inside, 'state'), `bookmanager-viewer-state:${inside.filePath}`);
    app.saveJson(app.storageKey(inside, 'state'), { pageIndex: 8 }, ['/Library']);
    for (const session of [outside, preview]) {
        const key = app.storageKey(session, 'state');
        assert.equal(key, `bookmanager-viewer-state:${session.filePath}`);
        assert.equal(app.audioStateKey(session), key);
        app.saveJson(key, { pageIndex: 9 }, ['/Library']);
        app.saveStoredJson(key, { positionSeconds: 90 }, ['/Library']);
        assert.equal(app.storage.getItem(key), null);
    }
    assert.equal(pruneLibraryReadingStorage(app.storage, []), 1);
    assert.equal(app.storage.length, 0);
});

test('외부 도서의 책갈피와 하이라이트 키는 기존 저장 데이터와 호환된다', () => {
    const app = viewerStorage();
    const session = { filePath: '/Downloads/book.epub', retainOutsideLibrary: true };
    for (const suffix of ['bookmarks', 'highlights', 'comic-flow']) {
        assert.equal(app.storageKey(session, suffix), `bookmanager-viewer-${suffix}:${session.filePath}`);
    }
    assert.equal(app.storageKey(null, 'state'), '');
    assert.equal(app.storageKey({ retainOutsideLibrary: true }, 'state'), '');
});
