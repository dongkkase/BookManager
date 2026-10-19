import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { hydrateReadingListRows, registerReadingListsIpc } from './readingLists.js';

function deferred() {
    let resolve;
    const promise = new Promise(callback => { resolve = callback; });
    return { promise, resolve };
}

async function fixture(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-recent-list-performance-'));
    const dbPath = path.join(root, 'library.db');
    const folder = path.join(root, 'books');
    const writer = new LibraryDB({ dbPath });
    const handlers = new Map();
    const removedHandlers = [];
    const mainFrame = {};
    const sender = { mainFrame };
    const event = { sender, senderFrame: mainFrame };
    let libraries = [folder];
    let created = 0;
    let closed = 0;
    const controller = registerReadingListsIpc({
        ipcMain: {
            handle: (name, handler) => handlers.set(name, handler),
            removeHandler: name => {
                removedHandlers.push(name);
                handlers.delete(name);
            },
        },
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
        createLibrary: () => {
            created += 1;
            const library = new LibraryDB({ dbPath });
            const close = library.close.bind(library);
            library.close = () => {
                closed += 1;
                return close();
            };
            options.decorateLibrary?.(library);
            return library;
        },
        getLibraryPaths: () => libraries,
        normalizeFile: row => ({ ...row, full_path: row.path, cover: row.thumb_path }),
        broadcast: () => assert.fail('Reading requests must not broadcast changes'),
    });
    const handler = handlers.get('reading:lists');
    t.after(async () => {
        options.release?.();
        await controller.dispose();
        await writer.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return {
        root, folder, writer, controller, handlers, removedHandlers,
        request: value => handler(event, value),
        setLibraries: value => { libraries = value; },
        get created() { return created; },
        get closed() { return closed; },
    };
}

test('최근 1000개 DB 스냅샷은 원본 stat 없이 메타데이터와 캐시 표지를 유지한다', async t => {
    const value = await fixture(t);
    const rows = Array.from({ length: 1000 }, (_, index) => ({
        path: path.join(value.folder, `${index}.epub`),
        title: `Book ${index}`,
        writer: `Writer ${index}`,
        size: index + 100,
        mtime: 1700000000 + index,
        thumb_path: path.join(value.root, 'thumbnails', `${index}.jpg`),
        list_added_at: '2026-10-18T00:00:00.000Z',
    }));
    const stat = t.mock.method(fs, 'stat', () => {
        assert.fail('Recent snapshot hydration must not access original files');
    });
    const files = await hydrateReadingListRows(rows, row => ({
        ...row,
        full_path: row.path,
        cover: `cached:${row.thumb_path}`,
    }), { verifyPresence: false });
    assert.equal(stat.mock.callCount(), 0);
    assert.equal(files.length, 1000);
    for (const [index, file] of files.entries()) {
        assert.deepEqual(file, {
            ...rows[index],
            full_path: rows[index].path,
            cover: `cached:${rows[index].thumb_path}`,
            isDirectory: false,
            is_folder: false,
            readingListAddedAt: rows[index].list_added_at,
        });
        assert.equal(Object.hasOwn(file, 'exists'), false);
    }
});

test('최근 목록 반복 조회는 DB 연결을 재사용하고 다른 연결의 변경과 현재 라이브러리 범위를 반영한다', async t => {
    const value = await fixture(t);
    const inside = Array.from({ length: 1000 }, (_, index) => ({
        path: path.join(value.folder, `${String(index).padStart(4, '0')}.epub`),
        title: `Book ${index}`,
        size: index + 1,
        mtime: 1700000000 + index,
        thumb_path: path.join(value.root, 'thumbnails', `${index}.jpg`),
    }));
    const outside = path.join(value.root, 'outside.epub');
    await value.writer.upsertFileInfoBulk([...inside, { path: outside, title: 'Outside' }]);
    await value.writer.syncReadingFileActivity(inside.map(record => ({ path: record.path, birthtimeMs: Date.now(), mtimeMs: record.mtime * 1000 })));
    const stat = t.mock.method(fs, 'stat', () => {
        assert.fail('Recent IPC requests must not wait for original file access');
    });
    assert.equal(value.created, 0);
    for (const id of ['recent-added', 'recent-updated', 'recent-added']) {
        const result = await value.request({ operation: 'list', id, libraryPaths: [value.root] });
        assert.equal(result.success, true);
        assert.equal(result.files.length, 1000);
        assert.ok(result.files.every(file => file.path !== outside && !Object.hasOwn(file, 'exists')));
        const first = result.files.find(file => file.path === inside[0].path);
        assert.equal(first.title, inside[0].title);
        assert.equal(first.cover, inside[0].thumb_path);
        assert.equal(first.size, inside[0].size);
        assert.equal(first.mtime, inside[0].mtime);
    }
    assert.equal((await value.request({ operation: 'overview' })).recentAddedCount, 1000);
    assert.equal(value.created, 1);
    assert.equal(value.closed, 0);
    await value.writer.upsertFileInfo({ ...inside[0], title: 'Changed from another connection' });
    const changed = await value.request({ operation: 'list', id: 'recent-updated' });
    assert.equal(changed.files.find(file => file.path === inside[0].path).title, 'Changed from another connection');
    value.setLibraries([]);
    assert.deepEqual((await value.request({ operation: 'list', id: 'recent-added' })).files, []);
    assert.equal((await value.request({ operation: 'overview' })).recentUpdatedCount, 0);
    value.setLibraries([value.root]);
    const added = path.join(value.folder, 'latest.epub');
    await value.writer.upsertFileInfo({ path: added, title: 'New external write' });
    assert.ok((await value.request({ operation: 'list', id: 'recent-updated' })).files.some(file => file.path === added));
    assert.equal(stat.mock.callCount(), 0);
    assert.equal(value.created, 1);
    await value.controller.dispose();
    await value.controller.dispose();
    assert.equal(value.closed, 1);
    assert.deepEqual(value.removedHandlers, ['reading:lists']);
});

test('종료는 진행 중인 읽기 요청 완료를 기다려 연결을 닫고 새 요청을 거부한다', async t => {
    const entered = deferred();
    const release = deferred();
    const value = await fixture(t, {
        release: release.resolve,
        decorateLibrary(library) {
            const withLock = library.withLock.bind(library);
            library.withLock = async callback => {
                entered.resolve();
                await release.promise;
                return withLock(callback);
            };
        },
    });
    const filePath = path.join(value.folder, 'pending.epub');
    await value.writer.upsertFileInfo({ path: filePath, title: 'Pending book', mtime: Date.now() / 1000 });
    const response = value.request({ operation: 'list', id: 'recent-added' });
    await entered.promise;
    let disposed = false;
    const disposal = value.controller.dispose();
    assert.equal(value.controller.dispose(), disposal);
    void disposal.then(() => { disposed = true; });
    assert.equal(value.handlers.has('reading:lists'), false);
    assert.deepEqual(value.removedHandlers, ['reading:lists']);
    assert.deepEqual(await value.request({ operation: 'overview' }), {
        success: false,
        error: 'reading_lists_closed',
    });
    assert.equal(disposed, false);
    assert.equal(value.closed, 0);
    release.resolve();
    const result = await response;
    assert.equal(result.success, true);
    assert.equal(result.files[0].title, 'Pending book');
    await disposal;
    assert.equal(disposed, true);
    assert.equal(value.closed, 1);
    assert.equal(value.created, 1);
    assert.deepEqual(await value.request({ operation: 'list', id: 'recent-added' }), {
        success: false,
        error: 'reading_lists_closed',
    });
});
