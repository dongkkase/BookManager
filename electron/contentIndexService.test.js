import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ContentIndexService } from './contentIndexService.js';

class ControlledWorker extends EventEmitter {
    static instance = null;

    constructor() {
        super();
        this.messages = [];
        this.terminationCount = 0;
        ControlledWorker.instance = this;
    }

    postMessage(message) {
        this.messages.push(message);
    }

    terminate() {
        this.terminationCount += 1;
        return Promise.resolve(0);
    }
}

class RoleControlledWorker extends EventEmitter {
    static instances = [];

    constructor(_url, options = {}) {
        super();
        this.role = options.workerData?.role || 'index';
        this.messages = [];
        this.terminationCount = 0;
        RoleControlledWorker.instances.push(this);
    }

    postMessage(message) {
        this.messages.push(message);
    }

    terminate() {
        this.terminationCount += 1;
        return Promise.resolve(0);
    }
}

test('content index worker는 파일을 증분 색인하고 NAS offline 상태에서 기존 문서를 보존한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-service-'));
    const libraryPath = path.join(root, 'Library');
    const offlinePath = path.join(root, 'Library.offline');
    const filePath = path.join(libraryPath, 'Book.txt');
    const dbPath = path.join(root, 'content_index', 'content.db');
    fs.mkdirSync(libraryPath, { recursive: true });
    fs.writeFileSync(filePath, 'Magic library keyword keyword', 'utf8');
    const service = new ContentIndexService(dbPath, {
        requestTimeoutMs: 10000,
        indexTimeoutMs: 30000,
    });
    const progressEvents = [];
    const removeProgressListener = service.onProgress(progress => progressEvents.push(progress));

    try {
        const stat = fs.statSync(filePath);
        const result = await service.startIndex([{
            full_path: filePath,
            target_folder: libraryPath,
            size: stat.size,
            mtime: stat.mtimeMs,
        }], [libraryPath], {
            force: false,
            authoritativeLibraries: [libraryPath],
        });
        assert.equal(result.cancelled, false);
        assert.equal(result.running, false);
        assert.equal(result.totalCount, 1);
        assert.equal(result.readyCount, 1);
        assert.equal(progressEvents.some(progress => progress.running === true), true);
        assert.equal(progressEvents.at(-1)?.running, false);

        const matches = await service.search('magic keyword', [libraryPath]);
        assert.deepEqual(matches.map(row => row.path), [path.resolve(filePath)]);

        fs.unlinkSync(filePath);
        const transientFailure = await service.startIndex([{
            full_path: filePath,
            target_folder: libraryPath,
            size: stat.size + 1,
            mtime: stat.mtimeMs + 1000,
        }], [libraryPath], {
            authoritativeLibraries: [libraryPath],
            activeLibraries: [libraryPath],
        });
        assert.equal(transientFailure.progress.failed, 1);
        assert.deepEqual(
            (await service.search('magic', [libraryPath])).map(row => row.path),
            [path.resolve(filePath)],
        );

        fs.renameSync(libraryPath, offlinePath);
        const offlineResult = await service.startIndex([], [libraryPath], {
            authoritativeLibraries: [libraryPath],
            activeLibraries: [libraryPath],
        });
        assert.equal(offlineResult.offlineLibraryCount, 1);
        assert.equal(offlineResult.totalCount, 1);
        assert.deepEqual(
            (await service.search('magic', [libraryPath])).map(row => row.path),
            [path.resolve(filePath)],
        );

        const cleared = await service.clear();
        assert.equal(cleared.totalCount, 0);
    } finally {
        removeProgressListener();
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('부분 라이브러리 재색인은 다른 활성 라이브러리의 posting을 보존한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-partial-'));
    const firstLibrary = path.join(root, 'LibraryA');
    const secondLibrary = path.join(root, 'LibraryB');
    const firstPath = path.join(firstLibrary, 'First.txt');
    const secondPath = path.join(secondLibrary, 'Second.txt');
    const dbPath = path.join(root, 'content_index', 'content.db');
    fs.mkdirSync(firstLibrary, { recursive: true });
    fs.mkdirSync(secondLibrary, { recursive: true });
    fs.writeFileSync(firstPath, 'firsttoken', 'utf8');
    fs.writeFileSync(secondPath, 'secondtoken', 'utf8');
    const service = new ContentIndexService(dbPath, {
        requestTimeoutMs: 10000,
        indexTimeoutMs: 30000,
    });

    const entryFor = (filePath, libraryPath) => {
        const stat = fs.statSync(filePath);
        return {
            full_path: filePath,
            target_folder: libraryPath,
            size: stat.size,
            mtime: stat.mtimeMs,
        };
    };

    try {
        await service.startIndex([
            entryFor(firstPath, firstLibrary),
            entryFor(secondPath, secondLibrary),
        ], [firstLibrary, secondLibrary], {
            activeLibraries: [firstLibrary, secondLibrary],
            authoritativeLibraries: [firstLibrary, secondLibrary],
        });

        await service.startIndex([
            entryFor(firstPath, firstLibrary),
        ], [firstLibrary], {
            force: true,
            activeLibraries: [firstLibrary, secondLibrary],
            authoritativeLibraries: [firstLibrary],
        });

        assert.deepEqual(
            (await service.search('secondtoken', [secondLibrary])).map(row => row.path),
            [path.resolve(secondPath)],
        );
    } finally {
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('진행 중인 내용 인덱싱은 실제 worker에서 중지할 수 있다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-cancel-'));
    const libraryPath = path.join(root, 'Library');
    const filePath = path.join(libraryPath, 'Book.txt');
    const dbPath = path.join(root, 'content_index', 'content.db');
    fs.mkdirSync(libraryPath, { recursive: true });
    fs.writeFileSync(filePath, 'cancel token', 'utf8');
    const stat = fs.statSync(filePath);
    const entry = {
        full_path: filePath,
        target_folder: libraryPath,
        size: stat.size,
        mtime: stat.mtimeMs,
    };
    const service = new ContentIndexService(dbPath, {
        requestTimeoutMs: 10000,
    });
    let cancelPromise = null;
    const removeProgressListener = service.onProgress(progress => {
        if (progress.running && progress.currentPath && !cancelPromise) {
            cancelPromise = service.cancelIndex();
        }
    });

    try {
        const result = await service.startIndex(
            Array.from({ length: 500 }, () => entry),
            [libraryPath],
            { activeLibraries: [libraryPath] },
        );
        await cancelPromise;
        assert.equal(result.cancelled, true);
        assert.equal(result.running, false);
        assert.ok(result.progress.processed < result.progress.total);
    } finally {
        removeProgressListener();
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('상태나 검색 요청 timeout은 진행 중인 인덱스 worker를 종료하지 않는다', async () => {
    const service = new ContentIndexService(path.join(os.tmpdir(), 'content-index-timeout-test.db'), {
        WorkerClass: ControlledWorker,
        requestTimeoutMs: 20,
    });
    const indexPromise = service.startIndex([], [], {});
    const worker = ControlledWorker.instance;
    const searchPromise = service.search('timeout', ['/Library']);

    try {
        await assert.rejects(searchPromise, error => error?.code === 'ERR_CONTENT_INDEX_TIMEOUT');
        assert.equal(worker.terminationCount, 0);

        const indexMessage = worker.messages.find(message => message.type === 'index');
        worker.emit('message', {
            id: indexMessage.id,
            result: { running: false, cancelled: false },
        });
        assert.deepEqual(await indexPromise, { running: false, cancelled: false });
    } finally {
        await service.close();
    }
    assert.equal(worker.terminationCount, 1);
});

test('상태 조회는 인덱싱 worker와 분리되어 긴 인덱싱 중에도 응답한다', async () => {
    RoleControlledWorker.instances = [];
    const service = new ContentIndexService(path.join(os.tmpdir(), 'content-index-worker-role-test.db'), {
        WorkerClass: RoleControlledWorker,
        requestTimeoutMs: 1000,
    });
    const indexPromise = service.startIndex([], [], {});
    const indexWorker = RoleControlledWorker.instances.find(worker => worker.role === 'index');
    indexWorker.emit('message', {
        type: 'progress',
        progress: { running: true, total: 10, processed: 3 },
    });
    const statusPromise = service.getStatus(['/Library']);
    const queryWorker = RoleControlledWorker.instances.find(worker => worker.role === 'query');

    try {
        assert.ok(indexWorker);
        assert.ok(queryWorker);
        assert.notEqual(queryWorker, indexWorker);
        const statusMessage = queryWorker.messages.find(message => message.type === 'status');
        queryWorker.emit('message', {
            id: statusMessage.id,
            result: {
                running: false,
                totalCount: 1,
                progress: { running: false, total: 0, processed: 0 },
            },
        });
        assert.deepEqual(await statusPromise, {
            running: true,
            totalCount: 1,
            progress: { running: true, total: 10, processed: 3 },
        });

        const indexMessage = indexWorker.messages.find(message => message.type === 'index');
        indexWorker.emit('message', {
            id: indexMessage.id,
            result: { running: false, cancelled: false },
        });
        assert.deepEqual(await indexPromise, { running: false, cancelled: false });
    } finally {
        await service.close();
    }
    assert.equal(indexWorker.terminationCount, 1);
    assert.equal(queryWorker.terminationCount, 1);
});

test('조회 worker timeout은 인덱싱 worker를 유지하고 다음 요청에서 복구한다', async () => {
    RoleControlledWorker.instances = [];
    const service = new ContentIndexService(path.join(os.tmpdir(), 'content-index-query-recovery-test.db'), {
        WorkerClass: RoleControlledWorker,
        requestTimeoutMs: 20,
    });
    const indexPromise = service.startIndex([], [], {});
    const indexWorker = RoleControlledWorker.instances.find(worker => worker.role === 'index');

    try {
        await assert.rejects(
            service.getStatus(['/Library']),
            error => error?.code === 'ERR_CONTENT_INDEX_TIMEOUT',
        );
        const firstQueryWorker = RoleControlledWorker.instances.find(worker => worker.role === 'query');
        assert.equal(firstQueryWorker.terminationCount, 1);
        assert.equal(indexWorker.terminationCount, 0);

        const retryPromise = service.getStatus(['/Library']);
        const queryWorkers = RoleControlledWorker.instances.filter(worker => worker.role === 'query');
        const secondQueryWorker = queryWorkers.at(-1);
        assert.notEqual(secondQueryWorker, firstQueryWorker);
        const retryMessage = secondQueryWorker.messages.find(message => message.type === 'status');
        secondQueryWorker.emit('message', {
            id: retryMessage.id,
            result: { totalCount: 0 },
        });
        assert.equal((await retryPromise).totalCount, 0);

        const indexMessage = indexWorker.messages.find(message => message.type === 'index');
        indexWorker.emit('message', {
            id: indexMessage.id,
            result: { running: false, cancelled: false },
        });
        await indexPromise;
    } finally {
        await service.close();
    }
});

test('실제 worker가 동기 작업 중이어도 별도 조회 worker가 상태를 반환한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-worker-split-'));
    const workerPath = path.join(root, 'blockingContentWorker.mjs');
    fs.writeFileSync(workerPath, `
import { parentPort, workerData } from 'node:worker_threads';

const waitState = new Int32Array(new SharedArrayBuffer(4));

parentPort.on('message', message => {
    if (workerData.role === 'index' && message.type === 'index') {
        parentPort.postMessage({
            type: 'progress',
            progress: { running: true, total: 1, processed: 0, currentPath: '/Library/Book.pdf' },
        });
        Atomics.wait(waitState, 0, 0, 1500);
        parentPort.postMessage({
            type: 'progress',
            progress: { running: false, total: 1, processed: 1, currentPath: '' },
        });
        parentPort.postMessage({
            id: message.id,
            result: { running: false, cancelled: false },
        });
        return;
    }
    if (workerData.role === 'query' && message.type === 'status') {
        parentPort.postMessage({
            id: message.id,
            result: { running: false, totalCount: 1, progress: { running: false } },
        });
    }
});
`, 'utf8');
    const service = new ContentIndexService(path.join(root, 'content.db'), {
        workerUrl: workerPath,
        requestTimeoutMs: 1000,
    });
    let resolveIndexStarted;
    const indexStarted = new Promise(resolve => {
        resolveIndexStarted = resolve;
    });
    const removeProgressListener = service.onProgress(progress => {
        if (progress.running && progress.currentPath) resolveIndexStarted();
    });

    try {
        const indexPromise = service.startIndex([], ['/Library'], {});
        await indexStarted;
        const status = await service.getStatus(['/Library']);
        assert.equal(status.running, true);
        assert.equal(status.progress.running, true);
        assert.equal(status.progress.currentPath, '/Library/Book.pdf');
        await indexPromise;
    } finally {
        removeProgressListener();
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('새 content DB를 인덱싱 worker와 조회 worker가 동시에 초기화한다', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-cold-open-'));
        const libraryPath = path.join(root, 'Library');
        const service = new ContentIndexService(path.join(root, 'content_index', 'content.db'), {
            requestTimeoutMs: 5000,
        });
        fs.mkdirSync(libraryPath, { recursive: true });

        try {
            const [indexResult, statusResult] = await Promise.all([
                service.startIndex([], [libraryPath], {
                    activeLibraries: [libraryPath],
                    authoritativeLibraries: [libraryPath],
                }),
                service.getStatus([libraryPath]),
            ]);
            assert.equal(indexResult.cancelled, false);
            assert.equal(statusResult.totalCount, 0);
        } finally {
            await service.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});
