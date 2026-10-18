import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { LibraryDB } from './database/library_db.js';
import { createLibraryDataMaintenance } from './libraryDataMaintenance.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-maintenance-performance-'));
    const dbPath = path.join(root, 'library.db');
    const thumbnailDir = path.join(root, 'thumbnails');
    const library = new LibraryDB({ dbPath });
    const db = library.getConnection();
    const resources = [];
    t.after(async () => {
        for (const close of resources.reverse()) await close();
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, dbPath, thumbnailDir, library, db, resources };
}

test('10만 권 정리 중 메인 이벤트와 DB 쓰기가 진행되고 변경 없는 재검사는 전체 순회를 생략한다', { timeout: 30000 }, async t => {
    const value = await fixture(t);
    const roots = Array.from({ length: 10 }, (_, index) => path.join(value.root, `books-${index}`));
    const insert = value.db.prepare('INSERT INTO files(path, title, ext) VALUES (?, ?, ?)');
    value.db.transaction(() => {
        for (let index = 0; index < 100000; index += 1) {
            insert.run(path.join(roots[index % roots.length], `book-${index}.epub`), `Book ${index}`, '.epub');
        }
    })();

    const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const bootstrapPath = path.join(value.root, 'maintenance-probe.mjs');
    await fs.writeFile(bootstrapPath, `
import { parentPort, workerData } from 'node:worker_threads';
import { LibraryDB } from ${JSON.stringify(new URL('./database/library_db.js', import.meta.url).href)};
const normalize = LibraryDB.prototype.normalizeFilePath;
let paused = false;
LibraryDB.prototype.normalizeFilePath = function (filePath) {
    if (!paused && this.db?.inTransaction && String(filePath).includes('/book-')) {
        paused = true;
        parentPort.postMessage({ stage: 'scanning' });
        Atomics.wait(new Int32Array(workerData.signal), 0, 0, 1500);
    }
    return normalize.call(this, filePath);
};
await import(${JSON.stringify(new URL('./libraryDataMaintenanceWorker.js', import.meta.url).href)});
`);
    const worker = new Worker(pathToFileURL(bootstrapPath), {
        workerData: { dbPath: value.dbPath, thumbnailDir: value.thumbnailDir, signal: signal.buffer },
    });
    value.resources.push(() => worker.terminate());
    let markScanning;
    const scanning = new Promise(resolve => { markScanning = resolve; });
    let response;
    worker.on('message', message => {
        if (message.stage === 'scanning') markScanning();
        else if (response) { const done = response; response = null; done.resolve(message); }
    });
    worker.on('error', error => response?.reject(error));
    const request = message => new Promise((resolve, reject) => {
        response = { resolve, reject };
        worker.postMessage(message);
    });

    let beats = 0;
    let finished = false;
    const heartbeat = setInterval(() => { beats += 1; }, 5);
    t.after(() => clearInterval(heartbeat));
    const started = performance.now();
    const first = request({ type: 'prune', libraries: roots }).then(result => { finished = true; return result; });
    await scanning;
    const beatsAtScan = beats;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.ok(beats > beatsAtScan + 2, 'main event loop must run while the worker is reading the database');
    assert.equal(finished, false, 'the concurrent write must start during the cleanup scan');
    const writeStarted = performance.now();
    insert.run(path.join(roots[0], 'concurrent.epub'), 'Concurrent menu operation', '.epub');
    const writeMs = performance.now() - writeStarted;
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
    assert.ok(writeMs < 500, `main database write waited for cleanup: ${writeMs.toFixed(1)}ms`);
    assert.equal(finished, false);

    const firstResult = await first;
    clearInterval(heartbeat);
    assert.deepEqual(firstResult.errors, []);
    assert.equal(firstResult.changed, false);
    assert.equal(value.db.prepare('SELECT COUNT(*) AS count FROM files').get().count, 100001);
    assert.ok(beats > 5);
    t.diagnostic(`100000 rows / 10 roots: ${(performance.now() - started).toFixed(0)}ms, ${beats} main heartbeats, concurrent write ${writeMs.toFixed(1)}ms`);

    const changedDuringScan = await request({ type: 'prune', libraries: roots });
    assert.deepEqual(changedDuringScan.errors, []);
    assert.notEqual(changedDuringScan.skipped, true, 'a concurrent write requires another check');
    const unchanged = await request({ type: 'prune', libraries: roots });
    assert.deepEqual(unchanged.errors, []);
    assert.equal(unchanged.skipped, true, 'an unchanged database and scope must skip the full scan');

    const outsidePath = path.join(value.root, 'outside.epub');
    insert.run(outsidePath, 'Outside library', '.epub');
    const addedOutside = await request({ type: 'prune', libraries: roots });
    assert.deepEqual(addedOutside.errors, []);
    assert.equal(addedOutside.result.deletedFileCount, 1);
    assert.equal(value.db.prepare('SELECT path FROM files WHERE path = ?').get(outsidePath), undefined);
    const exit = once(worker, 'exit');
    assert.deepEqual(await request({ type: 'close' }), { closed: true });
    assert.deepEqual(await exit, [0]);
});

test('정리 Worker가 중단되어도 다음 요청에서 복구하고 종료 뒤에는 다시 실행하지 않는다', { timeout: 15000 }, async t => {
    const value = await fixture(t);
    const libraryPath = path.join(value.root, 'books');
    const outsidePath = path.join(value.root, 'outside.epub');
    await value.library.upsertFileInfo({ path: outsidePath, title: 'Outside library' });
    const markerPath = path.join(value.root, 'worker-started');
    const bootstrapPath = path.join(value.root, 'maintenance-restart.mjs');
    await fs.writeFile(bootstrapPath, `
import fs from 'node:fs';
if (!fs.existsSync(${JSON.stringify(markerPath)})) {
    fs.writeFileSync(${JSON.stringify(markerPath)}, 'started');
    process.exit(3);
}
await import(${JSON.stringify(new URL('./libraryDataMaintenanceWorker.js', import.meta.url).href)});
`);
    const errors = [];
    const changes = [];
    const maintenance = createLibraryDataMaintenance({
        dbPath: value.dbPath,
        thumbnailDir: value.thumbnailDir,
        getLibraryPaths: () => [libraryPath],
        workerUrl: pathToFileURL(bootstrapPath),
        onError: error => errors.push(error),
        onChanged: result => changes.push(result),
    });
    value.resources.push(() => maintenance.dispose());
    await maintenance.run();
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /exited \(3\)/);
    assert.notEqual(await value.library.getFileInfo(outsidePath), null);
    await maintenance.run();
    assert.equal(await value.library.getFileInfo(outsidePath), null);
    assert.equal(changes.length, 1);
    await Promise.all([maintenance.dispose(), maintenance.dispose()]);
    await value.library.upsertFileInfo({ path: outsidePath, title: 'After disposal' });
    await maintenance.run();
    assert.equal((await value.library.getFileInfo(outsidePath)).title, 'After disposal');
    assert.equal(errors.length, 1);
});
