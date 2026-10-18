import assert from 'node:assert/strict';
import test from 'node:test';
import { isLibraryReadingStorageAllowed, pruneLibraryReadingStorage } from './libraryReadingStorage.js';

const stateKey = path => `bookmanager-viewer-state:${path}`;
const allowed = (path, roots) => isLibraryReadingStorageAllowed(stateKey(path), roots);

function createStorage(keys) {
    const values = new Map(keys.map(key => [key, JSON.stringify({ pageIndex: 10 })]));
    return {
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] ?? null; },
        getItem(key) { return values.get(key) ?? null; },
        removeItem(key) { values.delete(key); },
    };
}

test('등록된 부모 경로 경계와 정규화된 하위 경로만 읽기 기록을 허용한다', () => {
    const roots = ['/books/', '/other/collection'];
    assert.equal(allowed('/books/nested/book.epub', roots), true);
    assert.equal(allowed('/books/./nested/../book.epub', roots), true);
    assert.equal(allowed('/other/collection/book.pdf', roots), true);
    assert.equal(allowed('/books-old/book.epub', roots), false);
    assert.equal(allowed('/books/../outside/book.epub', roots), false);
    assert.equal(allowed('/Books/book.epub', roots), false);
    assert.equal(allowed('/books', roots), false);
    assert.equal(allowed('book.epub', roots), false);
    assert.equal(allowed('/books/a\0.epub', roots), false);
    assert.equal(allowed('/books/book.epub', ['/']), true);
});

test('Windows 드라이브와 네트워크 경로는 구분자와 대소문자를 정규화한다', () => {
    const roots = ['C:\\Books\\', '\\\\NAS\\Library'];
    assert.equal(allowed('c:/BOOKS/series/book.epub', roots), true);
    assert.equal(allowed('C:\\Books\\..\\Outside\\book.epub', roots), false);
    assert.equal(allowed('C:\\Books-old\\book.epub', roots), false);
    assert.equal(allowed('D:\\Books\\book.epub', roots), false);
    assert.equal(allowed('//nas/library/Book.epub', roots), true);
    assert.equal(allowed('\\\\NAS\\Library-extra\\Book.epub', roots), false);
    assert.equal(allowed('\\\\?\\C:\\Books\\Book.epub', roots), true);
    assert.equal(allowed('\\\\?\\UNC\\NAS\\Library\\Book.epub', roots), true);
    assert.equal(allowed('C:/Book.epub', ['C:\\']), true);
});

test('Mac 분해형 파일명과 특수문자는 같은 경로로 비교한다', () => {
    const root = '/Volumes/책장 [1]_%?';
    assert.equal(allowed(`${root.normalize('NFD')}/한글.epub`, [root]), true);
    assert.equal(allowed(`${root}/책.epub`, [root.normalize('NFD')]), true);
    assert.equal(allowed('/Volumes/책장 [1]_%?/../다른책/책.epub', [root]), false);
});

test('범위를 모르는 경우 삭제하지 않고 명시적인 빈 목록에서만 모든 읽기 위치를 제거한다', () => {
    const key = stateKey('/outside/book.epub');
    for (const roots of [undefined, null, {}, ['/books', 'relative/path'], [null]]) {
        const storage = createStorage([key]);
        assert.equal(allowed('/outside/book.epub', roots), true);
        assert.equal(pruneLibraryReadingStorage(storage, roots), 0);
        assert.notEqual(storage.getItem(key), null);
    }
    const storage = createStorage([key]);
    assert.equal(allowed('/outside/book.epub', []), false);
    assert.equal(pruneLibraryReadingStorage(storage, []), 1);
    assert.equal(storage.length, 0);
});

test('라이브러리 밖 위치만 삭제하고 책갈피·하이라이트·뷰어 설정은 보존한다', () => {
    const outside = '/outside/book.epub';
    const preserved = [
        stateKey('/books/inside.epub'),
        `bookmanager-viewer-bookmarks:${outside}`,
        `bookmanager-viewer-highlights:${outside}`,
        `bookmanager-viewer-comic-flow:${outside}`,
        'bookmanager-viewer-prefs:epub',
        'bookmanager-viewer-tts-settings',
        'bookmanager-epub-audio',
        'bookmanager-audiobook-preferences',
        'unrelated-key',
    ];
    const removed = [stateKey(outside), stateKey('/outside/audio.m4b'), stateKey('/books-old/old.cbz')];
    const storage = createStorage([...removed, ...preserved]);
    assert.equal(pruneLibraryReadingStorage(storage, ['/books']), removed.length);
    for (const key of preserved) assert.notEqual(storage.getItem(key), null);
    for (const key of removed) assert.equal(storage.getItem(key), null);
    for (const key of preserved.slice(1)) assert.equal(isLibraryReadingStorageAllowed(key, []), true);
    assert.equal(pruneLibraryReadingStorage(storage, ['/books']), 0);
});

test('Storage 접근 실패는 정리 호출을 중단시키지 않는다', () => {
    assert.equal(pruneLibraryReadingStorage(null, []), 0);
    assert.equal(pruneLibraryReadingStorage({ get length() { throw new Error('denied'); } }, []), 0);
    assert.equal(pruneLibraryReadingStorage({
        length: 1,
        key: () => stateKey('/book.epub'),
        removeItem: () => { throw new Error('denied'); },
    }, []), 0);
});
