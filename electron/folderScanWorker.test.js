import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { replaceZipEntry } from './core/zipArchive.js';
import { LibraryDB } from './database/library_db.js';
import { runFolderScanInWorker, shouldRunFolderScanInWorker } from './folderScanService.js';
import { scanFolder } from './tasks/folderScanTask.js';

async function fixture(t, count = 1) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-scan-worker-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const folderPath = path.join(root, 'books');
    await fs.mkdir(path.join(folderPath, 'nested'), { recursive: true });
    const template = path.join(root, 'template.cbz');
    await fs.writeFile(template, '');
    await replaceZipEntry(template, 'ComicInfo.xml', '<ComicInfo><Title>Worker title</Title><Series>Worker series</Series><Number>2</Number><Writer>Writer</Writer><PageCount>123</PageCount></ComicInfo>');
    for (let index = 0; index < count; index += 1) {
        await fs.copyFile(template, path.join(folderPath, index % 2 ? 'nested' : '', `Book ${index}.cbz`));
    }
    return {
        root,
        folderPath,
        options: {
            dbPath: path.join(root, 'library.db'),
            thumbnailDir: path.join(root, 'thumbnails'),
            background: true,
            includeSubfolders: true,
            includeDirectories: true,
            skipCoverExtraction: true,
            suppressEvents: true,
            reportFileReady: true,
            requestId: 31,
        },
    };
}

function captureEvents() {
    const messages = [];
    return { messages, event: { sender: {
        isDestroyed: () => false,
        send: (channel, data) => messages.push({ channel, data }),
    } } };
}

test('only background metadata scans use the worker', () => {
    assert.equal(shouldRunFolderScanInWorker({ background: true, skipCoverExtraction: true }), true);
    for (const options of [undefined, null, {}, { background: true }, { skipCoverExtraction: true }, {
        background: true, skipCoverExtraction: true, quickListOnly: true,
    }]) assert.equal(shouldRunFolderScanInWorker(options), false);
});

test('metadata worker preserves scan results and database writes while batching ordered file events', { timeout: 30000 }, async t => {
    const value = await fixture(t, 260);
    const { messages, event } = captureEvents();
    let workerExited = false;
    class TrackingWorker extends Worker {
        constructor(...args) {
            super(...args);
            this.once('exit', () => { workerExited = true; });
        }
    }
    const files = await runFolderScanInWorker(value.folderPath, {
        ...value.options,
        thumbnailEncoder() { throw new Error('Background scan must not encode covers'); },
        shouldCancel: () => false,
    }, event, { WorkerClass: TrackingWorker });
    assert.equal(workerExited, true);
    assert.equal(files.length, 261);
    assert.equal(files.find(file => !file.isDirectory).title, 'Worker title');
    assert.equal(files.find(file => !file.isDirectory).page_count, '123');
    const batches = messages.filter(message => message.channel === 'folder:fileReady');
    assert.ok(batches.length > 0 && batches.length < files.length / 2);
    assert.ok(batches.every(message => message.data.files.length <= 128));
    assert.ok(batches.every(message => message.data.requestId === value.options.requestId));
    assert.deepEqual(batches.flatMap(message => message.data.files), files);
    const direct = await scanFolder(value.folderPath, { ...value.options, reportFileReady: false });
    assert.deepEqual(files, direct);
    const library = new LibraryDB({ dbPath: value.options.dbPath });
    try {
        const book = files.find(file => !file.isDirectory);
        assert.equal((await library.getFileInfo(book.path)).title, 'Worker title');
    } finally {
        await library.close();
    }
});

test('main event loop and native database stay available during synchronous metadata work in the worker', { timeout: 15000 }, async t => {
    const value = await fixture(t);
    const library = new LibraryDB({ dbPath: value.options.dbPath });
    await library.initDB();
    t.after(() => library.close());
    const pause = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const bootstrapPath = path.join(value.root, 'scan-pause.mjs');
    await fs.writeFile(bootstrapPath, `
import { parentPort, workerData } from 'node:worker_threads';
import { LibraryDB } from ${JSON.stringify(new URL('./database/library_db.js', import.meta.url).href)};
const getFileInfo = LibraryDB.prototype.getFileInfo;
let paused = false;
LibraryDB.prototype.getFileInfo = function (...args) {
    if (!paused) {
        paused = true;
        parentPort.postMessage({ type: 'event', channel: 'test:metadataBusy', data: {} });
        Atomics.wait(new Int32Array(workerData.options.pause), 0, 0, 2000);
    }
    return getFileInfo.apply(this, args);
};
await import(${JSON.stringify(new URL('./folderScanWorker.js', import.meta.url).href)});
`);
    let markBusy;
    const busy = new Promise(resolve => { markBusy = resolve; });
    let finished = false;
    const task = runFolderScanInWorker(value.folderPath, { ...value.options, pause: pause.buffer }, {
        sender: { isDestroyed: () => false, send: channel => { if (channel === 'test:metadataBusy') markBusy(); } },
    }, { workerUrl: pathToFileURL(bootstrapPath) }).then(files => { finished = true; return files; });
    await busy;
    let heartbeats = 0;
    const heartbeat = setInterval(() => { heartbeats += 1; }, 5);
    try {
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.ok(heartbeats > 2);
        assert.equal(finished, false);
        await library.upsertFileInfo({ path: path.join(value.root, 'menu.epub'), title: 'Concurrent menu action' });
        assert.equal((await library.getFileInfo(path.join(value.root, 'menu.epub'))).title, 'Concurrent menu action');
        assert.equal(finished, false);
    } finally {
        clearInterval(heartbeat);
        Atomics.store(pause, 0, 1);
        Atomics.notify(pause, 0);
        await task;
    }
});

test('cancellation suppresses events and waits for worker exit', { timeout: 10000 }, async t => {
    const value = await fixture(t);
    const bootstrapPath = path.join(value.root, 'scan-cancel.mjs');
    await fs.writeFile(bootstrapPath, `
import { parentPort, workerData } from 'node:worker_threads';
const signal = new Int32Array(workerData.cancellation);
parentPort.postMessage({ type: 'event', channel: 'test:started', data: {} });
while (!Atomics.load(signal, 0)) Atomics.wait(signal, 0, 0, 10);
parentPort.postMessage({ type: 'event', channel: 'test:late', data: {} });
parentPort.postMessage({ type: 'error', error: { code: 'TASK_CANCELLED', message: 'Cancelled' } });
parentPort.close();
`);
    let cancelled = false;
    let lateEvents = 0;
    let workerExited = false;
    class TrackingWorker extends Worker {
        constructor(...args) {
            super(...args);
            this.once('exit', () => { workerExited = true; });
        }
    }
    await assert.rejects(runFolderScanInWorker(value.folderPath, {
        ...value.options, shouldCancel: () => cancelled,
    }, { sender: {
        isDestroyed: () => false,
        send: channel => { if (channel === 'test:started') cancelled = true; else lateEvents += 1; },
    } }, { workerUrl: pathToFileURL(bootstrapPath), WorkerClass: TrackingWorker }), { code: 'TASK_CANCELLED' });
    assert.equal(workerExited, true);
    assert.equal(lateEvents, 0);
});

test('a cancelled worker that ignores the shared signal is terminated', { timeout: 10000 }, async t => {
    const value = await fixture(t);
    const bootstrapPath = path.join(value.root, 'scan-stuck.mjs');
    await fs.writeFile(bootstrapPath, `
import { parentPort } from 'node:worker_threads';
parentPort.postMessage({ type: 'event', channel: 'test:started', data: {} });
setInterval(() => {}, 1000);
`);
    let cancelled = false;
    let exited = false;
    class TrackingWorker extends Worker {
        constructor(...args) {
            super(...args);
            this.once('exit', () => { exited = true; });
        }
    }
    await assert.rejects(runFolderScanInWorker(value.folderPath, {
        ...value.options, shouldCancel: () => cancelled,
    }, { sender: { isDestroyed: () => false, send: () => { cancelled = true; } } }, {
        workerUrl: pathToFileURL(bootstrapPath), WorkerClass: TrackingWorker, cancelGraceMs: 20,
    }), { code: 'TASK_CANCELLED' });
    assert.equal(exited, true);
});

test('worker startup failure and premature exit reject without leaving a pending scan', async () => {
    class FailedWorker {
        constructor() { throw new Error('Cannot start worker'); }
    }
    await assert.rejects(runFolderScanInWorker('/books', {}, undefined, { WorkerClass: FailedWorker }), /Cannot start worker/);
    class ExitedWorker extends EventEmitter {
        constructor() {
            super();
            setImmediate(() => this.emit('exit', 1));
        }
    }
    await assert.rejects(runFolderScanInWorker('/books', {}, undefined, { WorkerClass: ExitedWorker }), /without a result/);
});

test('rapid folder changes wait for the old worker to exit and skip cancelled queued scans', async () => {
    let active = 0;
    let peak = 0;
    const started = [];
    let cancelled = false;
    class DelayedWorker extends EventEmitter {
        constructor(_url, { workerData }) {
            super();
            started.push(workerData.folderPath);
            active += 1;
            peak = Math.max(peak, active);
            setTimeout(() => {
                this.emit('message', { type: 'result', files: [] });
                active -= 1;
                this.emit('exit', 0);
            }, 40);
        }
    }
    const { event } = captureEvents();
    const first = runFolderScanInWorker('/first', { shouldCancel: () => cancelled }, event, { WorkerClass: DelayedWorker });
    cancelled = true;
    const firstCancelled = assert.rejects(first, { code: 'TASK_CANCELLED' });
    const skipped = runFolderScanInWorker('/skipped', { shouldCancel: () => true }, event, { WorkerClass: DelayedWorker });
    const skippedCancelled = assert.rejects(skipped, { code: 'TASK_CANCELLED' });
    const current = runFolderScanInWorker('/current', {}, event, { WorkerClass: DelayedWorker });
    await Promise.all([firstCancelled, skippedCancelled, current]);
    assert.deepEqual(started, ['/first', '/current']);
    assert.equal(peak, 1);
    assert.equal(active, 0);
});
