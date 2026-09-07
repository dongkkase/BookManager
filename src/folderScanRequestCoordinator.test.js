import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
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

function createFolderScanHarness() {
    const source = readFileSync(new URL('./hooks/useFolderScan.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace(/^export /gm, '');
    const state = [];
    const refs = [];
    const calls = [];
    let cursor = 0;
    let refCursor = 0;
    const context = vm.createContext({
        AUDIO_EXTENSIONS: [],
        resolveBookType: () => '',
        joinPath: (folder, name) => `${folder}/${name}`,
        useState: initial => {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [state[index], update => { state[index] = typeof update === 'function' ? update(state[index]) : update; }];
        },
        useRef: initial => refs[refCursor++] ||= { current: initial },
        useCallback: fn => fn,
        useEffect: fn => fn(),
        startTransition: fn => fn(),
        console,
        window: {
            electronAPI: {
                scanFolder: (folderPath, options) => {
                    const result = deferred();
                    calls.push({ folderPath, options, ...result });
                    return result.promise;
                },
            },
        },
    });
    vm.runInContext(source, context);
    return {
        calls,
        render: () => {
            cursor = 0;
            refCursor = 0;
            return context.useFolderScan(() => '');
        },
    };
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

test('이전 방문의 일반 스캔과 예약된 강제 스캔은 새 방문의 스캔을 재사용하거나 지우지 않는다', async () => {
    const activeScans = new Map();
    const queuedForceScans = new Map();
    const previousResult = deferred();
    const currentResult = deferred();
    let previousCurrent = true;
    let previousForcedCalls = 0;
    let currentForcedCalls = 0;
    const previousOptions = {
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        isCurrent: () => previousCurrent,
    };
    const previous = coordinateFolderScanRequest({
        ...previousOptions,
        execute: () => previousResult.promise,
    });
    await Promise.resolve();
    const previousForced = coordinateFolderScanRequest({
        ...previousOptions,
        force: true,
        execute: () => { previousForcedCalls += 1; return ['stale']; },
    });

    previousCurrent = false;
    const currentOptions = { activeScans, queuedForceScans, cacheKey: 'library' };
    const current = coordinateFolderScanRequest({
        ...currentOptions,
        execute: () => currentResult.promise,
    });
    const currentForced = coordinateFolderScanRequest({
        ...currentOptions,
        force: true,
        execute: () => { currentForcedCalls += 1; return ['fresh']; },
    });
    const currentEntry = activeScans.get('library');
    previousResult.resolve(['old']);
    await previous;
    assert.deepEqual(await previousForced, []);
    assert.equal(previousForcedCalls, 0);
    assert.equal(activeScans.get('library'), currentEntry);
    assert.equal(queuedForceScans.get('library'), currentForced);

    currentResult.resolve(['current']);
    assert.deepEqual(await current, ['current']);
    assert.deepEqual(await currentForced, ['fresh']);
    assert.equal(currentForcedCalls, 1);
    assert.equal(activeScans.size, 0);
    assert.equal(queuedForceScans.size, 0);
});

test('실행 전 다른 폴더로 이동한 스캔은 시작하지 않는다', async () => {
    const activeScans = new Map();
    const queuedForceScans = new Map();
    let current = true;
    let calls = 0;
    const pending = coordinateFolderScanRequest({
        activeScans,
        queuedForceScans,
        cacheKey: 'library',
        isCurrent: () => current,
        execute: () => { calls += 1; return ['stale']; },
    });
    current = false;

    assert.deepEqual(await pending, []);
    assert.equal(calls, 0);
    assert.equal(activeScans.size, 0);
});

test('A에서 B를 거쳐 A로 돌아오면 취소 대기 중인 첫 A 대신 새 A 스캔을 실행한다', async () => {
    const harness = createFolderScanHarness();
    const { scanFolder } = harness.render();
    const options = { includeSubfolders: true, fastInitial: true, includeDirectories: true };
    const firstA = scanFolder('/A', options);
    await new Promise(resolve => setImmediate(resolve));
    const b = scanFolder('/B', options);
    await new Promise(resolve => setImmediate(resolve));
    const currentA = scanFolder('/A', options);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(harness.calls.map(call => call.folderPath), ['/A', '/B', '/A']);
    assert.ok(harness.calls[2].options.requestId > harness.calls[0].options.requestId);
    harness.calls[0].resolve([{ path: '/A/old', isDirectory: true }]);
    harness.calls[1].resolve([{ path: '/B/other', isDirectory: true }]);
    await Promise.all([firstA, b]);
    const fresh = [{ path: '/A/current', isDirectory: true }];
    harness.calls[2].resolve(fresh);

    assert.deepEqual(await currentA, fresh);
    const hook = harness.render();
    assert.deepEqual(Array.from(hook.getCachedFiles('/A', options)), fresh);
    assert.equal(hook.scanning, false);
});

test('파일 준비 이벤트는 현재 파일보다 오래된 결과만 거부한다', () => {
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 1000 }), false);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 2000 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 3000 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 0 }, { mtime: 1000 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, { mtime: 0 }), true);
    assert.equal(shouldApplyFolderFileUpdate({ mtime: 2000 }, {}), true);
});
