import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import { LibraryDB } from './database/library_db.js';
import { runMissingVolumesInWorker } from './missingVolumesService.js';
import { checkMissingVolumes } from './tasks/missingVolumesTask.js';
import { TaskCancellationRegistry } from './taskCancellation.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-missing-worker-'));
    const dbPath = path.join(root, 'library.db');
    const folder = path.join(root, 'books');
    const library = new LibraryDB({ dbPath });
    await fs.mkdir(folder);
    const db = library.getConnection();
    t.after(async () => {
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, dbPath, folder, library, db };
}

async function ipcHandler(dbPath, run = runMissingVolumesInWorker) {
    const source = await fs.readFile(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
    const start = source.indexOf("    ipcMain.handle('folder:missingVolumes'");
    const end = source.indexOf("  ipcMain.handle('folder:scan'", start);
    assert.ok(start >= 0 && end > start);
    const registry = new TaskCancellationRegistry();
    let handle;
    vm.runInNewContext(source.slice(start, end), {
        ipcMain: { handle: (_name, callback) => { handle = callback; } },
        cancellationRegistry: registry,
        libraryDbPath: () => dbPath,
        runMissingVolumesInWorker: run,
    });
    return { handle, registry };
}

test('자동·수동 누락 검사는 작업 스레드에서도 같은 시리즈·숨김 경로·중첩 폴더 규칙을 따른다', async t => {
    const value = await fixture(t);
    const nested = path.join(value.folder, 'nested');
    const hidden = path.join(value.folder, '.hidden');
    await fs.mkdir(nested);
    await fs.mkdir(hidden);
    const first = path.join(nested, '다른 제목 1.cbz');
    const third = path.join(nested, '서로 다른 제목 3.txt');
    await fs.writeFile(first, 'one');
    await fs.writeFile(third, 'three');
    await fs.writeFile(path.join(hidden, 'Saved Series 2.cbz'), 'hidden');
    await value.library.upsertFileInfo({ path: first, series: 'Saved Series' });
    await value.library.upsertFileInfo({ path: third, series: 'Saved Series' });
    const { handle, registry } = await ipcHandler(value.dbPath);
    const event = { sender: { id: 1, isDestroyed: () => false } };
    for (const indexOnly of [true, false]) {
        const roots = [nested, value.folder, value.folder];
        const expected = await checkMissingVolumes(roots, { libraryDb: value.library, indexOnly });
        const actual = await handle(event, roots, { indexOnly });
        assert.deepEqual(actual, expected);
        assert.deepEqual(actual.missing[0].missing, ['2']);
        assert.equal(registry.hasActive(1), false);
    }
});

test('10만 권 자동 누락 검사 중에도 메인 이벤트 루프가 계속 실행된다', { timeout: 30000 }, async t => {
    const value = await fixture(t);
    const insert = value.db.prepare('INSERT INTO dup_target_index(full_path, target_folder, name) VALUES (?, ?, ?)');
    value.db.transaction(() => {
        for (let index = 0; index < 100000; index += 1) {
            const series = `Series ${Math.floor(index / 20)}`;
            const name = `${series} ${index % 20 + 1}권.cbz`;
            insert.run(path.join(value.folder, series, name), value.folder, name);
        }
    })();
    const { handle } = await ipcHandler(value.dbPath);
    let heartbeats = 0;
    let previous = performance.now();
    let maxGap = 0;
    const timer = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - previous);
        previous = now;
        heartbeats += 1;
    }, 5);
    const started = performance.now();
    try {
        const result = await handle({ sender: { id: 2, isDestroyed: () => false } }, [value.folder], { indexOnly: true });
        assert.equal(result.fileCount, 100000);
        assert.deepEqual(result.missing, []);
        assert.equal(result.indexOnly, true);
        assert.ok(heartbeats > 5, 'The automatic check blocked the main event loop');
        t.diagnostic(`100000 files: ${Math.round(performance.now() - started)}ms, ${heartbeats} main heartbeats, maximum gap ${Math.round(maxGap)}ms`);
    } finally {
        clearInterval(timer);
    }
});

for (const reason of ['cancel', 'closed']) {
    test(`검사 ${reason} 시 공유 취소 신호를 전달하고 작업 스레드 종료까지 기다린다`, { timeout: 10000 }, async t => {
        const value = await fixture(t);
        const bootstrap = path.join(value.root, 'cancel.mjs');
        await fs.writeFile(bootstrap, `
import { parentPort, workerData } from 'node:worker_threads';
const signal = new Int32Array(workerData.cancellation);
parentPort.postMessage({ type: 'ready' });
while (!Atomics.load(signal, 0)) Atomics.wait(signal, 0, 0, 10);
parentPort.postMessage({ type: 'result', result: { missing: ['stale'] } });
parentPort.close();
`);
        let cancelled = false;
        let exited = false;
        class ObservedWorker extends Worker {
            constructor(...args) {
                super(...args);
                this.on('message', message => { if (message.type === 'ready') cancelled = true; });
                this.once('exit', () => { exited = true; });
            }
        }
        await assert.rejects(runMissingVolumesInWorker([value.folder], {
            shouldCancel: () => reason === 'cancel' && cancelled,
        }, { sender: { isDestroyed: () => reason === 'closed' && cancelled } }, {
            WorkerClass: ObservedWorker, workerUrl: pathToFileURL(bootstrap),
        }), { code: 'TASK_CANCELLED' });
        assert.equal(exited, true);
    });
}

test('취소 신호를 처리하지 못하는 검사도 종료하고 IPC 취소 결과와 작업 상태를 정리한다', { timeout: 10000 }, async t => {
    const value = await fixture(t);
    const bootstrap = path.join(value.root, 'blocked.mjs');
    await fs.writeFile(bootstrap, `
import { parentPort } from 'node:worker_threads';
parentPort.postMessage({ type: 'ready' });
setInterval(() => {}, 1000);
`);
    let registry;
    let exited = false;
    class BlockedWorker extends Worker {
        constructor(...args) {
            super(...args);
            this.on('message', () => registry.cancel(3, 'folder:missingVolumes'));
            this.once('exit', () => { exited = true; });
        }
    }
    const handlers = await ipcHandler(value.dbPath, (folders, options, event) => runMissingVolumesInWorker(folders, options, event, {
        WorkerClass: BlockedWorker, workerUrl: pathToFileURL(bootstrap), cancelGraceMs: 20,
    }));
    registry = handlers.registry;
    const result = await handlers.handle({ sender: { id: 3, isDestroyed: () => false } }, [value.folder]);
    assert.equal(result.cancelled, true);
    assert.equal(result.fileCount, 0);
    assert.equal(exited, true);
    assert.equal(registry.hasActive(3), false);
});

test('시작 실패·비정상 종료·검사 오류를 정상 결과로 숨기지 않는다', async t => {
    class FailedWorker {
        constructor() { throw new Error('Cannot start worker'); }
    }
    await assert.rejects(runMissingVolumesInWorker([], {}, undefined, { WorkerClass: FailedWorker }), /Cannot start worker/);
    await assert.rejects(runMissingVolumesInWorker([], { shouldCancel: () => true }, undefined, { WorkerClass: FailedWorker }), { code: 'TASK_CANCELLED' });
    class ExitedWorker extends EventEmitter {
        constructor() {
            super();
            setImmediate(() => this.emit('exit', 1));
        }
    }
    await assert.rejects(runMissingVolumesInWorker([], {}, undefined, { WorkerClass: ExitedWorker }), /without a result/);
    const value = await fixture(t);
    await assert.rejects(runMissingVolumesInWorker([path.join(value.root, 'missing')], { dbPath: value.dbPath }), { code: 'ENOENT' });
});

test('연속 재검사는 이전 스레드 종료 후 시작하고 취소된 대기 요청은 건너뛴다', async () => {
    let active = 0;
    let peak = 0;
    let cancelled = false;
    const started = [];
    class DelayedWorker extends EventEmitter {
        constructor(_url, { workerData }) {
            super();
            started.push(workerData.libraryFolders[0]);
            peak = Math.max(peak, ++active);
            setTimeout(() => {
                this.emit('message', { type: 'result', result: { missing: [], fileCount: 0 } });
                active -= 1;
                this.emit('exit', 0);
            }, 40);
        }
    }
    const event = { sender: { isDestroyed: () => false } };
    const dependencies = { WorkerClass: DelayedWorker };
    const first = runMissingVolumesInWorker(['/first'], { shouldCancel: () => cancelled }, event, dependencies);
    cancelled = true;
    const firstCancelled = assert.rejects(first, { code: 'TASK_CANCELLED' });
    const skipped = runMissingVolumesInWorker(['/skipped'], { shouldCancel: () => true }, event, dependencies);
    const skippedCancelled = assert.rejects(skipped, { code: 'TASK_CANCELLED' });
    const current = runMissingVolumesInWorker(['/current'], {}, event, dependencies);
    await Promise.all([firstCancelled, skippedCancelled, current]);
    assert.deepEqual(started, ['/first', '/current']);
    assert.equal(peak, 1);
    assert.equal(active, 0);
});
