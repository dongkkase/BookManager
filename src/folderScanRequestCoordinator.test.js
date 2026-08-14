import assert from 'node:assert/strict';
import test from 'node:test';
import {
    coordinateFolderScanRequest,
    shouldApplyFolderFileUpdate,
} from './hooks/useFolderScan.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

test('진행 중인 일반 스캔 뒤의 강제 스캔은 별도로 한 번 실행된다', async () => {
    const activeScans = new Map();
    const queuedForceScans = new Map();
    const normalResult = deferred();
    const forcedResult = deferred();
    let normalCalls = 0;
    let forcedCalls = 0;
    let duplicateCalls = 0;

    const normalPromise = coordinateFolderScanRequest({
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        execute: () => {
            normalCalls += 1;
            return normalResult.promise;
        },
    });
    await Promise.resolve();

    const forcedPromise = coordinateFolderScanRequest({
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        force: true,
        execute: () => {
            forcedCalls += 1;
            return forcedResult.promise;
        },
    });
    const duplicateForcedPromise = coordinateFolderScanRequest({
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        force: true,
        execute: () => {
            duplicateCalls += 1;
            return [];
        },
    });

    assert.equal(forcedPromise, duplicateForcedPromise);
    assert.equal(normalCalls, 1);
    assert.equal(forcedCalls, 0);
    assert.equal(queuedForceScans.size, 1);

    normalResult.resolve(['cached']);
    assert.deepEqual(await normalPromise, ['cached']);
    await Promise.resolve();

    assert.equal(forcedCalls, 1);
    assert.equal(duplicateCalls, 0);
    assert.equal(activeScans.get('library')?.force, true);

    const forcedWhileActive = coordinateFolderScanRequest({
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        force: true,
        execute: () => {
            duplicateCalls += 1;
            return [];
        },
    });
    forcedResult.resolve(['fresh']);

    assert.deepEqual(await forcedPromise, ['fresh']);
    assert.deepEqual(await forcedWhileActive, ['fresh']);
    assert.equal(forcedCalls, 1);
    assert.equal(duplicateCalls, 0);
    assert.equal(activeScans.size, 0);
    assert.equal(queuedForceScans.size, 0);
});

test('일반 스캔이 실패해도 예약된 강제 스캔을 실행한다', async () => {
    const activeScans = new Map();
    const queuedForceScans = new Map();
    const normalResult = deferred();
    let forcedCalls = 0;

    const normalPromise = coordinateFolderScanRequest({
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        execute: () => normalResult.promise,
    });
    const forcedPromise = coordinateFolderScanRequest({
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        force: true,
        execute: async () => {
            forcedCalls += 1;
            return ['fresh'];
        },
    });

    normalResult.reject(new Error('scan failed'));
    await assert.rejects(normalPromise, /scan failed/);
    assert.deepEqual(await forcedPromise, ['fresh']);
    assert.equal(forcedCalls, 1);
    assert.equal(activeScans.size, 0);
    assert.equal(queuedForceScans.size, 0);
});

test('파일 준비 이벤트는 현재 파일보다 오래된 결과만 거부한다', () => {
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 1000 }), false);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 2000 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 3000 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 0 }, { mtime: 1000 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 0 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, {}), true);
});
