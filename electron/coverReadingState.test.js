import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { applyCoverEditor, inspectCoverEditor, loadCoverEditorImage } from './coverEditor.js';
import { inspectComicCover, readComicCoverImage } from './comicCoverEditor.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { applyCoverReadingAdjustment, remapCoverReadingState } from './coverReadingState.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
    put(key, value) { this.setItem(key, JSON.stringify(value)); }
    get(key) { return JSON.parse(this.getItem(key)); }
}

async function fixture(t, extension = '.cbz') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-reading-'));
    const filePath = path.join(directory, `book${extension}`);
    const imagePath = path.join(directory, 'new.png');
    const libraryDb = new LibraryDB({ dbPath: path.join(directory, 'library.db') });
    const originalPage = Buffer.concat([PNG, Buffer.from('page two')]);
    await fs.writeFile(filePath, Buffer.alloc(0));
    await replaceZipEntry(filePath, 'part/1.png', PNG);
    await replaceZipEntry(filePath, 'part/2.png', originalPage);
    await fs.writeFile(imagePath, PNG);
    await libraryDb.upsertFileInfo({ path: filePath, thumb_path: 'original.png', title: 'Original title' });
    const oldReading = await libraryDb.upsertReadingState(filePath, {
        format: 'comic', pageIndex: 1, pageCount: 2, scrollPercent: 60,
        locator: { kind: 'page', pageIndex: 1, pageCount: 2 },
        lastReadAt: '2026-09-01T00:00:00.000Z', status: 'completed',
    });
    t.after(async () => {
        await libraryDb.close();
        await fs.rm(directory, { recursive: true, force: true });
    });
    const descriptor = await inspectCoverEditor(filePath);
    const image = await loadCoverEditorImage(imagePath);
    const request = { ...descriptor, imagePath, imageVersion: image.imageVersion, mode: 'add', renumber: true };
    return { directory, filePath, imagePath, libraryDb, oldReading, request, originalPage };
}

test('표지 추가 후 DB와 로컬 책갈피는 동일한 기존 이미지 내용을 가리킨다', async t => {
    const f = await fixture(t);
    const storage = new MemoryStorage();
    storage.put(`bookmanager-viewer-state:${f.filePath}`, { pageIndex: 1, pageCount: 2, scrollPercent: 60 });
    storage.put(`bookmanager-viewer-bookmarks:${f.filePath}`, [{ id: 'mark', pageIndex: 1, label: '2p - 2.png', flowMode: 'scroll', scrollPercent: 60 }]);
    storage.put(`bookmanager-viewer-comic-flow:${f.filePath}`, ['part/2.png']);
    storage.put('bookmanager-viewer-prefs:comic', { flowMode: 'scroll', zoom: 120 });
    const result = await applyCoverEditor(f.request, f);
    assert.deepEqual(result.readingAdjustment.pageIndexMap, [1, 2]);
    applyCoverReadingAdjustment(storage, result.readingAdjustment);
    const reading = (await f.libraryDb.listReadingStatesByPaths([f.filePath]))[0];
    assert.equal(reading.pageIndex, 2);
    assert.equal(reading.pageCount, 3);
    assert.deepEqual(reading.locator, { kind: 'page', pageIndex: 2, pageCount: 3 });
    assert.equal(reading.status, 'completed');
    assert.equal(reading.lastReadAt, f.oldReading.lastReadAt);
    assert.equal(reading.revision, f.oldReading.revision + 1);
    const state = storage.get(`bookmanager-viewer-state:${f.filePath}`);
    assert.equal(state.pageIndex, 2);
    assert.equal(state.coverEditPageIndex, 2);
    const [bookmark] = storage.get(`bookmanager-viewer-bookmarks:${f.filePath}`);
    assert.equal(bookmark.pageIndex, 2);
    assert.equal(bookmark.coverEditPageIndex, 2);
    assert.equal(bookmark.label, '3p - 2.png');
    const comic = await inspectComicCover(f.filePath);
    assert.deepEqual(await readComicCoverImage(f.filePath, comic.pages[bookmark.pageIndex].name), f.originalPage);
    assert.deepEqual(storage.get(`bookmanager-viewer-comic-flow:${f.filePath}`), [comic.pages[2].name]);
    assert.deepEqual(storage.get('bookmanager-viewer-prefs:comic'), { flowMode: 'scroll', zoom: 120 });
    assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.startsWith('.bookmanager-cover-')), []);
});

test('파일명만 재정렬하면 페이지번호를 유지하고 내부 경로 설정만 옮긴다', async t => {
    const f = await fixture(t);
    const result = await applyCoverEditor({ ...f.request, mode: 'replace' }, f);
    assert.deepEqual(result.readingAdjustment.pageIndexMap, [0, 1]);
    const state = remapCoverReadingState({ pageIndex: 1, pageCount: 2 }, result.readingAdjustment);
    assert.equal(state.pageIndex, 1);
    assert.equal(state.pageCount, 2);
    assert.equal(result.readingAdjustment.entryMap['part/2.png'], '0001.png');
});

test('읽기 상태 DB 보정 실패는 표지 파일과 표지 캐시 변경까지 되돌린다', async t => {
    const f = await fixture(t);
    const original = await fs.readFile(f.filePath);
    const originalRecord = await f.libraryDb.getFileInfo(f.filePath);
    f.libraryDb.getConnection().exec("CREATE TRIGGER reject_cover_reading BEFORE UPDATE ON reading_states BEGIN SELECT RAISE(ABORT, 'reading failure'); END;");
    await assert.rejects(applyCoverEditor(f.request, f), /reading failure/);
    assert.deepEqual(await fs.readFile(f.filePath), original);
    assert.deepEqual(await f.libraryDb.getFileInfo(f.filePath), originalRecord);
    assert.deepEqual((await f.libraryDb.listReadingStatesByPaths([f.filePath]))[0], f.oldReading);
    assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.startsWith('.bookmanager-cover-')), []);
});

test('새 CBZ로 변환하면 원본 기록을 유지하면서 새 경로에 보정 기록을 복사한다', async t => {
    const f = await fixture(t, '.cbr');
    const sevenZExe = createRequire(import.meta.url)('7zip-bin').path7za;
    const storage = new MemoryStorage();
    const sourceKey = `bookmanager-viewer-bookmarks:${f.filePath}`;
    storage.put(sourceKey, [{ pageIndex: 1, label: '2p - 2.png' }]);
    const result = await applyCoverEditor(f.request, { ...f, sevenZExe });
    assert.equal(result.converted, true);
    applyCoverReadingAdjustment(storage, result.readingAdjustment);
    assert.deepEqual((await f.libraryDb.listReadingStatesByPaths([f.filePath]))[0], f.oldReading);
    const targetReading = (await f.libraryDb.listReadingStatesByPaths([result.filePath]))[0];
    assert.notEqual(targetReading.itemId, f.oldReading.itemId);
    assert.equal(targetReading.pageIndex, 2);
    assert.equal(storage.get(sourceKey)[0].pageIndex, 1);
    assert.equal(storage.get(`bookmanager-viewer-bookmarks:${result.filePath}`)[0].pageIndex, 2);
});

test('EPUB에서 확인된 한 페이지 삽입은 숫자 위치만 옮기고 구조 locator를 보존한다', () => {
    const adjustment = { format: 'epub', pageOffset: 1 };
    const locator = { kind: 'epub-text', sectionHref: 'OEBPS/chapter.xhtml', sourceOffset: 42, cfi: 'original' };
    const state = remapCoverReadingState({ pageIndex: 12, pageCount: 40, locator }, adjustment);
    assert.equal(state.pageIndex, 13);
    assert.equal(state.pageCount, 41);
    assert.deepEqual(state.locator, locator);
    const normalized = remapCoverReadingState({ pageIndex: 10, pageCount: 21, locator: { kind: 'normalized', normalizedPosition: 0.5 } }, adjustment);
    assert.equal(normalized.locator.normalizedPosition, 11 / 21);
    const storage = new MemoryStorage();
    storage.put('bookmanager-viewer-highlights:/book.epub', [{ id: 'highlight', pageIndex: 12, text: 'Original sentence', color: 'yellow' }]);
    applyCoverReadingAdjustment(storage, { ...adjustment, sourcePath: '/book.epub', filePath: '/book.epub' });
    assert.deepEqual(storage.get('bookmanager-viewer-highlights:/book.epub'), [
        { id: 'highlight', pageIndex: 13, text: 'Original sentence', color: 'yellow', coverEditPageIndex: 13 },
    ]);
});

test('EPUB writer의 확정 표지 한 페이지 추가를 DB 읽던 위치 보정에 연결한다', async t => {
    const f = await fixture(t, '.epub');
    await replaceZipEntry(f.filePath, 'META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
    await replaceZipEntry(f.filePath, 'OEBPS/content.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata></metadata><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="body"/></spine></package>');
    await replaceZipEntry(f.filePath, 'OEBPS/body.xhtml', '<html><body><p>Original book body.</p></body></html>');
    await f.libraryDb.upsertReadingState(f.filePath, { format: 'epub', pageIndex: 10, pageCount: 21, locator: { kind: 'normalized', normalizedPosition: 0.5 } });
    const descriptor = await inspectCoverEditor(f.filePath, f);
    const result = await applyCoverEditor({ ...f.request, ...descriptor }, f);
    assert.equal(result.readingAdjustment.pageOffset, 1);
    const [state] = await f.libraryDb.listReadingStatesByPaths([f.filePath]);
    assert.equal(state.pageIndex, 11);
    assert.equal(state.pageCount, 22);
    assert.equal(state.locator.normalizedPosition, 11 / 21);
});

test('로컬 책갈피 쓰기 실패 시 앞서 변경한 읽기 상태도 함께 복원한다', () => {
    const storage = new MemoryStorage();
    storage.put('bookmanager-viewer-state:/book.cbz', { pageIndex: 1, pageCount: 2 });
    storage.put('bookmanager-viewer-bookmarks:/book.cbz', [{ pageIndex: 1 }]);
    const original = new Map(storage.values);
    let writes = 0;
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
        if (++writes === 2) throw new Error('storage full');
        setItem(key, value);
    };
    assert.throws(() => applyCoverReadingAdjustment(storage, {
        format: 'comic', sourcePath: '/book.cbz', filePath: '/book.cbz', pageCount: 3, pageIndexMap: [1, 2],
    }), /storage full/);
    assert.deepEqual(storage.values, original);
});

test('DB보다 최신인 로컬 위치를 유지하고 다른 책의 저장값은 바꾸지 않는다', () => {
    const storage = new MemoryStorage();
    storage.put('bookmanager-viewer-state:/book.cbz', { pageIndex: 2, pageCount: 4, updatedAt: 2000 });
    storage.put('bookmanager-viewer-state:/other.cbz', { pageIndex: 20 });
    applyCoverReadingAdjustment(storage, {
        format: 'comic', sourcePath: '/book.cbz', filePath: '/book.cbz', pageCount: 5,
        pageIndexMap: [1, 2, 3, 4], previousUpdatedAt: 1000,
        readingState: { pageIndex: 1, pageCount: 5 },
    });
    assert.equal(storage.get('bookmanager-viewer-state:/book.cbz').pageIndex, 3);
    assert.deepEqual(storage.get('bookmanager-viewer-state:/other.cbz'), { pageIndex: 20 });
});
