import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { registerEpubOptimizerIpc } from './epubOptimizer/ipc.js';
import { EpubOptimizerService } from './epubOptimizer/service.js';
import { observeOperation } from './observabilityOperations.js';

const sender = id => Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send() {} });

test('optimizer telemetry counts each execution result while excluding inspection, cancellation requests and rejected input', async t => {
    let handler;
    let time = 0;
    const events = [];
    const reports = [];
    const saved = { status: 'saved', outputPath: '/private/book.epub', backupPath: '/private/bak/book.epub', savedBytes: 100 };
    const unchanged = { status: 'unchanged', outputPath: null, savedBytes: 0 };
    const failure = Object.assign(new Error('Private write failure'), { code: 'EIO', backupPath: '/private/bak/book.epub' });
    const service = {
        run: async (_owner, request) => {
            if (request.action === 'inspect') return { fingerprint: 'private-hash' };
            if (request.operationId === 'failed') throw failure;
            if (request.operationId === 'cancelled') throw Object.assign(new Error('Private cancellation'), { code: 'TASK_CANCELLED' });
            return request.operationId === 'unchanged' ? unchanged : saved;
        },
        cancel: () => ({ canceled: true }),
        dispose: async () => {},
    };
    const controller = registerEpubOptimizerIpc({
        ipcMain: { handle: (_channel, fn) => { handler = fn; } }, createService: () => service,
        observe: (feature, action, options) => observeOperation(feature, action, {
            ...options,
            track: event => { events.push(event); return true; },
            report: (error, context) => reports.push({ error, context }),
            isSessionCurrent: () => true,
            now: () => time += 10,
        }),
    });
    t.after(() => controller.dispose());
    const owner = { sender: sender(1) };
    const request = { action: 'optimize', filePath: '/private/book.epub', operationId: 'saved', expectedFingerprint: 'private-hash', settings: { jpegQuality: 82 } };
    assert.equal((await handler(owner, request)).code, 'EPUB_REINSPECT_REQUIRED');
    assert.equal((await handler(owner, { ...request, filePath: '/private/book.txt' })).code, 'EPUB_FILE_REQUIRED');
    await handler(owner, { ...request, action: 'inspect' });
    await handler(owner, { ...request, action: 'cancel' });
    assert.deepEqual(events, []);
    assert.equal(await handler(owner, request), saved);
    assert.equal(await handler(owner, { ...request, operationId: 'unchanged' }), unchanged);
    assert.deepEqual(await handler(owner, { ...request, operationId: 'failed' }), {
        error: failure.message, code: 'EIO', backupPath: failure.backupPath,
    });
    assert.deepEqual(await handler(owner, { ...request, operationId: 'cancelled' }), {
        error: 'Private cancellation', code: 'TASK_CANCELLED',
    });
    const expected = ['feature_completed', 'feature_completed', 'feature_failed', 'feature_cancelled'].flatMap(event => [
        { event: 'feature_started', feature: 'epub-optimize', format: 'epub' },
        { event, feature: 'epub-optimize', format: 'epub', duration_ms: 10 },
    ]);
    assert.deepEqual(events, expected);
    assert.deepEqual(reports, [{ error: failure, context: { feature: 'epub-optimize', source: 'ipc' } }]);
    assert.doesNotMatch(JSON.stringify(events), /private|Private|settings|jpegQuality|filePath|backupPath|operationId|savedBytes/);
});

test('optimizer completion respects a telemetry consent change without changing the saved result', async t => {
    let handler;
    let finish;
    let current = true;
    const events = [];
    const saved = { status: 'saved', outputPath: '/private/book.epub' };
    const controller = registerEpubOptimizerIpc({
        ipcMain: { handle: (_channel, fn) => { handler = fn; } },
        createService: () => ({
            run: (_owner, request) => request.action === 'inspect' ? { fingerprint: 'hash' } : new Promise(resolve => { finish = resolve; }),
            dispose: async () => {},
        }),
        observe: (feature, action, options) => observeOperation(feature, action, {
            ...options,
            track: event => { events.push(event); return true; },
            report: () => assert.fail('Successful optimization must not report errors'),
            isSessionCurrent: () => current,
        }),
    });
    t.after(() => controller.dispose());
    const owner = { sender: sender(1) };
    const request = { action: 'optimize', filePath: '/private/book.epub', operationId: 'save', expectedFingerprint: 'hash' };
    await handler(owner, { ...request, action: 'inspect' });
    const pending = handler(owner, request);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof finish, 'function');
    current = false;
    finish(saved);
    assert.equal(await pending, saved);
    assert.deepEqual(events, [{ event: 'feature_started', feature: 'epub-optimize', format: 'epub' }]);
});

test('optimizer IPC loads lazily, requires same-owner inspection, and never executes from an inspection', async () => {
    let handler;
    let loaded = 0;
    const calls = [];
    const service = {
        run: async (owner, request) => { calls.push({ owner, ...request }); return request.action === 'inspect' ? { fingerprint: 'hash', size: 10 } : { status: 'unchanged' }; },
        cancel: (owner, operationId) => ({ owner, operationId }),
        dispose: async () => {},
    };
    const controller = registerEpubOptimizerIpc({ ipcMain: { handle: (_channel, fn) => { handler = fn; } }, createService: () => { loaded++; return service; } });
    assert.equal(loaded, 0);
    const first = { sender: sender(1) };
    const request = { filePath: '/books/a.epub', operationId: 'request-1', action: 'optimize', expectedFingerprint: 'hash' };
    assert.equal((await handler(first, request)).code, 'EPUB_REINSPECT_REQUIRED');
    assert.equal(calls.length, 0);
    await handler(first, { ...request, action: 'inspect' });
    assert.equal(calls[0].action, 'inspect');
    assert.equal(calls[0].settings, undefined);
    assert.equal(calls[0].backup, undefined);
    assert.equal(calls[0].overwrite, undefined);
    assert.equal((await handler({ sender: sender(2) }, request)).code, 'EPUB_REINSPECT_REQUIRED');
    assert.equal((await handler(first, request)).status, 'unchanged');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].backup, false);
    assert.equal(calls[1].overwrite, false);
    await handler(first, { ...request, backup: true });
    assert.equal(calls.at(-1).backup, true);
    assert.equal(calls.at(-1).overwrite, false);
    first.sender.emit('did-navigate');
    assert.equal((await handler(first, request)).code, 'EPUB_REINSPECT_REQUIRED');
    for (const patch of [{ operationId: '' }, { filePath: '/books/a.txt' }, { filePath: '../a.epub' }, { action: 'other' }]) {
        assert.ok((await handler(first, { ...request, ...patch })).error);
    }
    assert.equal(loaded, 1);
    await controller.dispose();
});

test('overwriting the same EPUB is exclusive across owners and releases its lock after failure', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-optimizer-ipc-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.epub');
    await fs.writeFile(filePath, 'fixture');
    let handler;
    let release;
    let started;
    const start = new Promise(resolve => { started = resolve; });
    const requests = [];
    const service = {
        run: async (_owner, request) => {
            requests.push(request);
            if (request.action === 'inspect') return { fingerprint: 'hash' };
            if (!release) {
                await new Promise(resolve => { release = resolve; started(); });
                throw Object.assign(new Error('Write failed'), { code: 'EACCES', backupPath: path.join(directory, 'bak', 'book.epub') });
            }
            return { status: 'saved', outputPath: filePath, backupPath: '' };
        },
        dispose: async () => {},
    };
    const controller = registerEpubOptimizerIpc({ ipcMain: { handle: (_channel, fn) => { handler = fn; } }, createService: () => service });
    t.after(() => controller.dispose());
    const first = { sender: sender(1) };
    const second = { sender: sender(2) };
    const request = { filePath, operationId: 'write', action: 'optimize', expectedFingerprint: 'hash', overwrite: true, backup: true };
    await handler(first, { ...request, action: 'inspect' });
    await handler(second, { ...request, action: 'inspect' });
    const pending = handler(first, request);
    await start;
    assert.equal((await handler(second, request)).code, 'OPTIMIZER_BUSY');
    assert.equal((await handler(second, request)).code, 'OPTIMIZER_BUSY');
    assert.equal(requests.filter(item => item.action === 'optimize').length, 1);
    assert.equal(requests.at(-1).backup, true);
    assert.equal(requests.at(-1).overwrite, true);
    release();
    const failed = await pending;
    assert.equal(failed.code, 'EACCES');
    assert.equal(failed.backupPath, path.join(directory, 'bak', 'book.epub'));
    assert.equal((await handler(second, { ...request, backup: false })).status, 'saved');
    assert.equal(requests.at(-1).backup, false);
    assert.equal(requests.at(-1).overwrite, true);
});

test('worker service preserves the backup location when a replacement fails', async () => {
    const worker = new EventEmitter();
    const service = new EpubOptimizerService({ createWorker: () => worker });
    const pending = service.run(1, { operationId: 'save' });
    worker.emit('message', { type: 'error', error: { code: 'EIO', message: 'Save failed', backupPath: '/books/bak/book.epub' } });
    await assert.rejects(pending, { code: 'EIO', backupPath: '/books/bak/book.epub' });
    assert.equal(service.operations.size, 0);
});

test('worker service limits concurrency, routes image transforms and cancels only the owning operation', async () => {
    const worker = new EventEmitter();
    const messages = [];
    worker.postMessage = message => messages.push(message);
    let disposed = 0;
    const service = new EpubOptimizerService({
        createWorker: () => worker,
        createProcessor: () => ({ transform: async () => Buffer.from('image'), dispose: () => { disposed++; } }),
    });
    const pending = service.run(1, { operationId: 'active' });
    assert.throws(() => service.run(1, { operationId: 'other' }), { code: 'OPTIMIZER_BUSY' });
    assert.deepEqual(service.cancel(2, 'active'), { canceled: false });
    assert.deepEqual(service.cancel(1, 'other'), { canceled: false });
    worker.emit('message', { type: 'image', id: 1, data: new Uint8Array([1]), mimeType: 'image/png', settings: {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages[0].type, 'imageResult');
    assert.equal(messages[0].data.toString(), 'image');
    assert.deepEqual(service.cancel(1, 'active'), { canceled: true });
    assert.equal(messages[1].type, 'cancel');
    worker.emit('message', { type: 'error', error: { code: 'TASK_CANCELLED', message: 'Canceled' } });
    await assert.rejects(pending, { code: 'TASK_CANCELLED' });
    assert.equal(disposed, 1);
    assert.equal(service.operations.size, 0);
});

test('worker exit during lazy decoder initialization disposes the late processor', async () => {
    const worker = new EventEmitter();
    worker.postMessage = () => {};
    let release;
    let disposed = 0;
    const service = new EpubOptimizerService({
        createWorker: () => worker,
        createProcessor: () => new Promise(resolve => { release = resolve; }),
    });
    const pending = service.run(1, { operationId: 'active' });
    worker.emit('message', { type: 'image', id: 1 });
    worker.emit('exit', 1);
    await assert.rejects(pending, { code: 'OPTIMIZER_INTERRUPTED' });
    release({ transform: () => assert.fail('A stopped operation must not decode'), dispose: () => { disposed++; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disposed, 1);
});
