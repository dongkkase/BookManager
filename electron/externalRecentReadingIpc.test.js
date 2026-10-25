import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { pruneUnregisteredLibraryData } from './libraryDataCleanup.js';

const source = fs.readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');

function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
    return source.slice(from, to);
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-recent-reading-'));
    const dbPath = path.join(root, 'library.db');
    const libraryPath = path.join(root, 'Library');
    fs.mkdirSync(libraryPath);
    const db = new LibraryDB({ dbPath });
    const handlers = new Map();
    const notifications = [];
    const context = vm.createContext({
        fs,
        path,
        LibraryDB,
        libraryDbPath: () => dbPath,
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        broadcastReadingChanged: payload => notifications.push(JSON.parse(JSON.stringify(payload))),
    });
    vm.runInContext(`
        ${section('function thumbnailUrlForSearchResult(', 'function createTaskCancelledError(')}
        ${section("  ipcMain.handle('reading:listRecent'", "    ipcMain.handle('reading:updateProgress'")}
        ${section("  ipcMain.handle('reading:remove'", "  ipcMain.handle('folder:getLibraryTagFacets'")}
    `, context);
    t.after(async () => {
        await db.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    return {
        root,
        db,
        libraryPath,
        notifications,
        list: limit => handlers.get('reading:listRecent')(null, limit),
        remove: filePath => handlers.get('reading:remove')(null, filePath),
        clear: () => handlers.get('reading:clear')(),
    };
}

test('외부 뷰어 도서는 라이브러리 정리 후에도 최근 읽음에 표시되고 등록 없이 다시 열 수 있다', async t => {
    const value = fixture(t);
    const book = path.join(value.root, 'Dropped Book.txt');
    fs.writeFileSync(book, 'First page\nSecond page\n');
    const original = await value.db.upsertReadingState(book, {
        format: 'text',
        pageIndex: 3,
        pageCount: 20,
        retainOutsideLibrary: true,
        lastReadAt: '2026-10-26T10:00:00.000Z',
    });
    await pruneUnregisteredLibraryData(value.db, [value.libraryPath]);
    await pruneUnregisteredLibraryData(value.db, []);
    assert.deepEqual(await value.db.listFilesByPaths([book]), [], 'opening a book must not register it as a library file');

    const listed = await value.list();
    assert.equal(listed.length, 1);
    const item = listed[0];
    assert.equal(item.path, book);
    assert.equal(item.full_path, book);
    assert.equal(item.name, 'Dropped Book.txt');
    assert.equal(item.title, 'Dropped Book');
    assert.equal(item.ext, '.txt');
    assert.equal(item.book_type, 'text');
    assert.equal(item.size, fs.statSync(book).size);
    assert.equal(item.exists, true);
    assert.equal(item.itemId, original.itemId);
    assert.equal(item.lastReadAt, original.lastReadAt);
    assert.equal(item.readingState.pageIndex, 3);
    assert.equal(item.readingState.pageCount, 20);

    assert.equal((await value.remove(book)).success, true);
    assert.equal((await value.list()).length, 0);
    assert.deepEqual(value.notifications, [{ filePath: book, removed: true }]);

    await value.db.upsertReadingState(book, {
        format: 'text', retainOutsideLibrary: true, lastReadAt: '2026-10-26T11:00:00.000Z',
    });
    const reopened = (await value.list())[0];
    assert.equal(reopened.itemId, original.itemId);
    assert.equal(reopened.readingState.pageIndex, 3);
    assert.equal(reopened.lastReadAt, '2026-10-26T11:00:00.000Z');
    assert.deepEqual(await value.db.listFilesByPaths([book]), []);
});

test('보존된 외부 기록도 최근 순서와 개수 제한 및 모두 지우기를 따르며 누락 파일을 구분한다', async t => {
    const value = fixture(t);
    const missing = path.join(value.root, 'Missing.epub');
    const present = path.join(value.root, 'Present.pdf');
    fs.writeFileSync(present, 'PDF fixture');
    await value.db.upsertReadingState(missing, {
        format: 'epub', retainOutsideLibrary: true, lastReadAt: '2026-10-26T10:00:00.000Z',
    });
    await value.db.upsertReadingState(present, {
        format: 'pdf', retainOutsideLibrary: true, lastReadAt: '2026-10-26T11:00:00.000Z',
    });
    await pruneUnregisteredLibraryData(value.db, []);
    assert.deepEqual(Array.from(await value.list(1), row => row.path), [present]);
    const listed = await value.list();
    assert.deepEqual(Array.from(listed, row => [row.path, row.exists]), [[present, true], [missing, false]]);
    assert.equal(listed[1].title, 'Missing');
    assert.equal(listed[1].size, 0);
    assert.equal((await value.clear()).changes, 2);
    assert.equal((await value.list()).length, 0);
    assert.deepEqual(value.notifications, [{ cleared: true }]);
});
