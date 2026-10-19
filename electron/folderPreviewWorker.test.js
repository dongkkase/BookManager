import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { LibraryDB } from './database/library_db.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { createFolderPreviewService } from './folderPreviewService.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=', 'base64');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-preview-worker-'));
    const folder = path.join(root, 'books');
    const filePath = path.join(folder, 'Book 2.cbz');
    await fs.mkdir(folder);
    await fs.writeFile(filePath, '');
    await replaceZipEntry(filePath, 'ComicInfo.xml', '<ComicInfo><Title>Worker title</Title><PageCount>123</PageCount></ComicInfo>');
    await replaceZipEntry(filePath, '001.png', PNG);
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, folder, filePath, options: {
        dbPath: path.join(root, 'library.db'), thumbnailDir: path.join(root, 'thumbnails'), sevenZExe: '',
    } };
}

test('preview worker preserves CBZ metadata, folder covers, cached covers and forced encoding', { timeout: 15000 }, async t => {
    const value = await fixture(t);
    const encodings = [];
    let created = 0;
    class TrackingWorker extends Worker {
        constructor(...args) { super(...args); created += 1; }
    }
    const service = createFolderPreviewService({
        WorkerClass: TrackingWorker,
        thumbnailEncoder: async (buffer, options) => {
            encodings.push(options);
            assert.ok(Buffer.isBuffer(buffer));
            assert.deepEqual(buffer, PNG);
            return { buffer, extension: '.png' };
        },
    });
    try {
        const book = await service.preview(value.filePath, value.options);
        assert.equal(book.title, 'Worker title');
        assert.equal(book.page_count, '123');
        assert.match(book.cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.deepEqual(await fs.readFile(book.thumb_path), PNG);
        assert.equal(encodings.length, 1);
        const folder = await service.preview(value.folder, value.options);
        assert.equal(folder.isDirectory, true);
        assert.equal(folder.cover_file_path, value.filePath);
        assert.equal(folder.cover, book.cover);
        assert.equal(encodings.length, 1);
        const cached = await service.preview(value.filePath, value.options);
        assert.equal(cached.cover, book.cover);
        await service.preview(value.filePath, { ...value.options, force: true });
        assert.equal(encodings.length, 2);
        assert.equal(created, 1);
        const details = await service.details(value.folder, value.options);
        assert.equal(details.fileCount, 1);
        assert.equal(details.pageCount, 123);
        await assert.rejects(service.preview(path.join(value.folder, 'missing.cbz'), value.options), { code: 'ENOENT' });
    } finally {
        await service.dispose();
    }
});

test('SQLite lock waits in preview leave main timers and a second folder-details request responsive', { timeout: 15000 }, async t => {
    const value = await fixture(t);
    const seed = new LibraryDB({ dbPath: value.options.dbPath });
    await seed.upsertFileInfo({ path: value.filePath, page_count: 123 });
    await seed.close();
    const lock = new Int32Array(new SharedArrayBuffer(4));
    const lockPath = path.join(value.root, 'lock.mjs');
    await fs.writeFile(lockPath, `
import { parentPort, workerData } from 'node:worker_threads';
import { LibraryDB } from ${JSON.stringify(new URL('./database/library_db.js', import.meta.url).href)};
const library = new LibraryDB({ dbPath: workerData.dbPath });
const db = library.getConnection();
db.exec('BEGIN IMMEDIATE');
parentPort.postMessage('locked');
Atomics.wait(new Int32Array(workerData.lock), 0, 0, 10000);
db.exec('COMMIT');
await library.close();
`);
    const locker = new Worker(pathToFileURL(lockPath), { workerData: { dbPath: value.options.dbPath, lock: lock.buffer } });
    await new Promise((resolve, reject) => { locker.once('message', resolve); locker.once('error', reject); });
    let signalDatabaseOpen;
    const databaseOpening = new Promise(resolve => { signalDatabaseOpen = resolve; });
    const bootstrap = path.join(value.root, 'preview-audit.mjs');
    await fs.writeFile(bootstrap, `
import { parentPort } from 'node:worker_threads';
import { LibraryDB } from ${JSON.stringify(new URL('./database/library_db.js', import.meta.url).href)};
const getConnection = LibraryDB.prototype.getConnection;
LibraryDB.prototype.getConnection = function () {
    if (!this.db && !this.readOnly) parentPort.postMessage({ type: 'test:databaseOpening' });
    return getConnection.call(this);
};
await import(${JSON.stringify(new URL('./folderPreviewWorker.js', import.meta.url).href)});
`);
    class ObservedWorker extends Worker {
        constructor(...args) {
            super(...args);
            this.on('message', message => { if (message.type === 'test:databaseOpening') signalDatabaseOpen(); });
        }
    }
    const service = createFolderPreviewService({ WorkerClass: ObservedWorker, workerUrl: pathToFileURL(bootstrap) });
    let finished = false;
    const preview = service.preview(value.filePath, value.options).then(result => { finished = true; return result; });
    let heartbeats = 0;
    const timer = setInterval(() => { heartbeats += 1; }, 5);
    try {
        await databaseOpening;
        await delay(50);
        assert.ok(heartbeats >= 5);
        assert.equal(finished, false);
        const details = await service.details(value.folder, value.options);
        assert.equal(details.pageCount, 123);
        assert.equal(finished, false);
        Atomics.store(lock, 0, 1);
        Atomics.notify(lock, 0);
        assert.match((await preview).cover, /^bookmanager-thumbnail:/);
    } finally {
        clearInterval(timer);
        Atomics.store(lock, 0, 1);
        Atomics.notify(lock, 0);
        await service.dispose();
        await locker.terminate();
    }
});

test('preview pool bounds simultaneous workers, drains requests and closes idle workers', { timeout: 15000 }, async t => {
    const value = await fixture(t);
    let active = 0;
    let peak = 0;
    let created = 0;
    class TrackingWorker extends Worker {
        constructor(...args) {
            super(...args);
            created += 1;
            active += 1;
            peak = Math.max(peak, active);
            this.once('exit', () => { active -= 1; });
        }
    }
    const service = createFolderPreviewService({ WorkerClass: TrackingWorker, idleTimeoutMs: 30 });
    try {
        const results = await Promise.all(Array.from({ length: 10 }, () => service.preview(value.filePath, value.options)));
        assert.equal(results.length, 10);
        assert.ok(results.every(result => result.cover));
        assert.equal(peak, 2);
        assert.equal(created, 2);
        for (let index = 0; index < 100 && active > 0; index += 1) await delay(10);
        assert.equal(active, 0);
        assert.ok((await service.preview(value.filePath, value.options)).cover);
        assert.equal(created, 3);
    } finally {
        await service.dispose();
    }
    assert.equal(active, 0);
});

test('cancelled active and queued previews do not block replacement requests or leave workers alive', { timeout: 15000 }, async t => {
    const value = await fixture(t);
    const workerPath = path.join(value.root, 'pause.mjs');
    await fs.writeFile(workerPath, `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', message => {
    if (message.type === 'shutdown') { parentPort.close(); return; }
    if (message.type !== 'run') return;
    if (message.filePath === 'slow') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
    parentPort.postMessage({ type: 'result', id: message.id, result: message.filePath });
});
`);
    let active = 0;
    let peak = 0;
    class TrackingWorker extends Worker {
        constructor(...args) {
            super(...args);
            active += 1;
            peak = Math.max(peak, active);
            this.once('exit', () => { active -= 1; });
        }
    }
    const service = createFolderPreviewService({
        WorkerClass: TrackingWorker, workerUrl: pathToFileURL(workerPath), cancelGraceMs: 30,
    });
    let cancelled = false;
    try {
        const tasks = Array.from({ length: 4 }, () => service.preview('slow', { shouldCancel: () => cancelled }));
        const failures = tasks.map(task => assert.rejects(task, { code: 'TASK_CANCELLED' }));
        await delay(30);
        cancelled = true;
        await Promise.all(failures);
        assert.equal(await service.preview('replacement'), 'replacement');
        assert.ok(peak <= 2);
    } finally {
        await service.dispose();
    }
    assert.equal(active, 0);
    await assert.rejects(service.preview('disposed'), { code: 'TASK_CANCELLED' });
});

test('folder details can count a library without creating a database', { timeout: 15000 }, async t => {
    const value = await fixture(t);
    const service = createFolderPreviewService();
    try {
        const details = await service.details(value.folder, value.options);
        assert.equal(details.fileCount, 1);
        assert.equal(details.unknownPageFileCount, 1);
        await assert.rejects(fs.stat(value.options.dbPath), { code: 'ENOENT' });
    } finally {
        await service.dispose();
    }
});
