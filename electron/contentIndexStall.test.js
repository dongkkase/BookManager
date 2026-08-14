import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ContentIndexService } from './contentIndexService.js';

function writeBlockingExtractorWorker(workerPath) {
    fs.writeFileSync(workerPath, `
import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';

const waitState = new Int32Array(new SharedArrayBuffer(4));

parentPort.on('message', message => {
    if (message?.type !== 'extract') return;
    if (message.filePath.endsWith('stuck.txt')) {
        fs.writeFileSync(message.filePath + '.started', 'started', 'utf8');
        Atomics.wait(waitState, 0, 0, 60000);
        return;
    }
    parentPort.postMessage({
        id: message.id,
        result: {
            status: 'ok',
            tokens: ['aftertimeout'],
            tokenCount: 1,
            textBytes: 12,
            warnings: [],
        },
    });
});
`, 'utf8');
}

function contentEntry(filePath, libraryPath) {
    const stat = fs.statSync(filePath);
    return {
        full_path: filePath,
        target_folder: libraryPath,
        size: stat.size,
        mtime: stat.mtimeMs,
    };
}

async function waitForFile(filePath, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fs.existsSync(filePath)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail(`Timed out waiting for ${filePath}`);
}

test('파일 추출 worker가 멈추면 timeout 처리하고 다음 파일을 계속 색인한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-stall-timeout-'));
    const libraryPath = path.join(root, 'Library');
    const stuckPath = path.join(libraryPath, 'stuck.txt');
    const nextPath = path.join(libraryPath, 'next.txt');
    const extractorWorkerPath = path.join(root, 'blockingExtractor.mjs');
    fs.mkdirSync(libraryPath, { recursive: true });
    fs.writeFileSync(stuckPath, 'stuck content', 'utf8');
    fs.writeFileSync(nextPath, 'next content', 'utf8');
    writeBlockingExtractorWorker(extractorWorkerPath);
    const service = new ContentIndexService(path.join(root, 'content_index', 'content.db'), {
        extractorWorkerUrl: pathToFileURL(extractorWorkerPath).href,
        requestTimeoutMs: 5000,
    });

    try {
        const result = await service.startIndex([
            contentEntry(stuckPath, libraryPath),
            contentEntry(nextPath, libraryPath),
        ], [libraryPath], {
            activeLibraries: [libraryPath],
            authoritativeLibraries: [libraryPath],
            fileExtractionTimeoutMs: 1000,
        });

        assert.equal(result.cancelled, false);
        assert.equal(result.progress.processed, 2);
        assert.equal(result.progress.failed, 1);
        assert.equal(result.progress.indexed, 1);
        assert.deepEqual(
            (await service.search('aftertimeout', [libraryPath])).map(row => row.path),
            [path.resolve(nextPath)],
        );
    } finally {
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('파일 추출 worker가 멈춘 상태에서도 인덱싱 중지가 timeout 없이 완료된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-stall-cancel-'));
    const libraryPath = path.join(root, 'Library');
    const stuckPath = path.join(libraryPath, 'stuck.txt');
    const extractorWorkerPath = path.join(root, 'blockingExtractor.mjs');
    fs.mkdirSync(libraryPath, { recursive: true });
    fs.writeFileSync(stuckPath, 'stuck content', 'utf8');
    writeBlockingExtractorWorker(extractorWorkerPath);
    const service = new ContentIndexService(path.join(root, 'content_index', 'content.db'), {
        extractorWorkerUrl: pathToFileURL(extractorWorkerPath).href,
        requestTimeoutMs: 2000,
    });

    try {
        const indexPromise = service.startIndex([
            contentEntry(stuckPath, libraryPath),
        ], [libraryPath], {
            activeLibraries: [libraryPath],
            fileExtractionTimeoutMs: 60000,
        });
        await waitForFile(`${stuckPath}.started`);

        const cancelResult = await service.cancelIndex();
        const indexResult = await indexPromise;

        assert.equal(cancelResult.cancelled, true);
        assert.equal(indexResult.cancelled, true);
        assert.equal(indexResult.running, false);
        assert.equal(indexResult.progress.processed, 0);
    } finally {
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('중지 완료 직후 첫 결과를 기다리지 않고 새 인덱싱을 시작할 수 있다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-cancel-restart-'));
    const libraryPath = path.join(root, 'Library');
    const stuckPath = path.join(libraryPath, 'stuck.txt');
    const nextPath = path.join(libraryPath, 'next.txt');
    const extractorWorkerPath = path.join(root, 'blockingExtractor.mjs');
    fs.mkdirSync(libraryPath, { recursive: true });
    fs.writeFileSync(stuckPath, 'stuck content', 'utf8');
    fs.writeFileSync(nextPath, 'next content', 'utf8');
    writeBlockingExtractorWorker(extractorWorkerPath);
    const service = new ContentIndexService(path.join(root, 'content_index', 'content.db'), {
        extractorWorkerUrl: pathToFileURL(extractorWorkerPath).href,
        requestTimeoutMs: 2000,
    });

    try {
        const firstIndexPromise = service.startIndex([
            contentEntry(stuckPath, libraryPath),
        ], [libraryPath], {
            activeLibraries: [libraryPath],
            fileExtractionTimeoutMs: 60000,
        });
        await waitForFile(`${stuckPath}.started`);

        const cancelResult = await service.cancelIndex();
        const secondIndexPromise = service.startIndex([
            contentEntry(nextPath, libraryPath),
        ], [libraryPath], {
            activeLibraries: [libraryPath],
            authoritativeLibraries: [libraryPath],
            fileExtractionTimeoutMs: 60000,
        });
        const [firstResult, secondResult] = await Promise.all([
            firstIndexPromise,
            secondIndexPromise,
        ]);

        assert.equal(cancelResult.cancelled, true);
        assert.equal(firstResult.cancelled, true);
        assert.equal(secondResult.cancelled, false);
        assert.equal(secondResult.progress.indexed, 1);
        assert.deepEqual(
            (await service.search('aftertimeout', [libraryPath])).map(row => row.path),
            [path.resolve(nextPath)],
        );
        const status = await service.getStatus([libraryPath]);
        assert.equal(status.running, false);
        assert.equal(status.progress.running, false);
    } finally {
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
