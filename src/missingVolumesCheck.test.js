import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createMissingVolumesCheck, missingVolumesLibraryKey, missingVolumesLibraryScope } from './missingVolumesCheck.js';
import { findMissingVolumes } from './missingVolumesPolicy.js';

const emptyResult = { missing: [], fileCount: 12, cancelled: false };
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function harness(stop = async () => {}) {
    const state = { busy: false, results: [], errors: [] };
    const check = createMissingVolumesCheck({
        onBusy: value => { state.busy = value; },
        onResult: result => state.results.push(result),
        onError: error => state.errors.push(error),
        stop,
    });
    return { check, state };
}

test('library scope is stable across ordering, duplicates, separators and unrelated settings', () => {
    assert.equal(missingVolumesLibraryKey(['/b/', '/a', '/b']), missingVolumesLibraryKey(['/a/', '/b']));
    assert.equal(missingVolumesLibraryKey(['C:\\Books\\']), missingVolumesLibraryKey(['C:/Books']));
    assert.equal(missingVolumesLibraryKey(['/']), '["/"]');
});

test('library scope preserves Windows drive roots and the exact filesystem paths sent to the API', () => {
    assert.equal(missingVolumesLibraryKey(['C:\\']), '["C:/"]');
    assert.deepEqual(missingVolumesLibraryScope(['C:\\']).folders, ['C:\\']);
    const original = '/Volumes/도서'.normalize('NFD');
    const scope = missingVolumesLibraryScope([original]);
    assert.equal(scope.key, JSON.stringify([original.normalize('NFC')]));
    assert.equal(scope.folders[0], original);
    assert.notEqual(scope.folders[0], original.normalize('NFC'));
});

test('automatic and manual checks share one request and cache a completed empty result', async () => {
    const { check, state } = harness();
    const pending = deferred();
    let calls = 0;
    const execute = () => { calls += 1; return pending.promise; };
    const first = check.run('library', execute);
    const second = check.run('library', execute);
    assert.equal(first, second);
    await tick();
    assert.equal(calls, 1);
    assert.equal(state.busy, true);
    pending.resolve(emptyResult);
    await first;
    assert.equal(state.busy, false);
    assert.equal(check.hasResult('library'), true);
    assert.equal(await check.run('library', execute), emptyResult);
    assert.equal(calls, 1);
});

test('a rejected scan releases busy and remains retryable', async () => {
    const { check, state } = harness();
    await check.run('library', async () => { throw new Error('Network share unavailable'); });
    assert.equal(state.busy, false);
    assert.equal(check.hasResult('library'), false);
    assert.equal(state.errors[0].message, 'Network share unavailable');
    assert.equal(await check.run('library', async () => emptyResult), emptyResult);
});

test('cancel waits for the dedicated stop before replacement and old finally cannot clear new busy', async () => {
    const stopped = deferred();
    let stopCalls = 0;
    const { check, state } = harness(() => { stopCalls += 1; return stopped.promise; });
    const oldScan = deferred();
    const newScan = deferred();
    const first = check.run('old', () => oldScan.promise);
    await tick();
    check.cancel();
    let newStarted = false;
    const second = check.run('new', () => { newStarted = true; return newScan.promise; });
    await tick();
    assert.equal(stopCalls, 1);
    assert.equal(newStarted, false);
    stopped.resolve();
    await tick();
    assert.equal(newStarted, true);
    oldScan.resolve(emptyResult);
    assert.equal(await first, null);
    assert.equal(state.busy, true);
    assert.equal(state.results.length, 0);
    newScan.resolve(emptyResult);
    await second;
    assert.equal(state.busy, false);
    assert.equal(state.results.length, 1);
});

test('invalidation replaces an in-flight request even when its library scope is unchanged', async () => {
    const { check, state } = harness();
    const oldScan = deferred();
    const freshScan = deferred();
    const first = check.run('library', () => oldScan.promise);
    await tick();
    check.invalidate();
    const second = check.run('library', () => freshScan.promise);
    assert.notEqual(first, second);
    await tick();
    oldScan.resolve({ ...emptyResult, missing: [{ series: 'Stale' }] });
    await first;
    assert.equal(state.busy, true);
    freshScan.resolve(emptyResult);
    await second;
    assert.deepEqual(state.results, [emptyResult]);
});

test('cancelled results and disposal never publish partial results', async () => {
    const { check, state } = harness();
    await check.run('library', async () => ({ ...emptyResult, cancelled: true }));
    assert.equal(state.busy, false);
    assert.equal(check.hasResult('library'), false);
    const pending = deferred();
    const result = check.run('library', () => pending.promise);
    await tick();
    check.dispose();
    pending.resolve(emptyResult);
    await result;
    assert.deepEqual(state.results, []);
});

function rendererHarness(folders = ['/library']) {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('    const getMissingVolumesCheck = useCallback(');
    const end = source.indexOf('    useEffect(() => {', start);
    assert.ok(start >= 0 && end > start);
    const state = { calls: [], messages: [], errors: [], busy: false, missing: [] };
    const context = {
        createMissingVolumesCheck,
        useCallback: callback => callback,
        missingCheckRef: { current: null },
        missingLocalRevisionRef: { current: 0 },
        hasShownMissingToastRef: { current: false },
        missingCheckContextRef: { current: {
            libraryKey: missingVolumesLibraryKey(folders), folders, selectedFolderPath: '/current',
            files: [
                { name: 'Novel 1.txt', series: 'Novel', path: '/current/Novel 1.txt' },
                { name: 'Novel 3.txt', series: 'Novel', path: '/current/Novel 3.txt' },
            ],
            t: key => key, language: 'ko', showToast: message => state.errors.push(message),
        } },
        findMissingVolumes,
        setIsCheckingMissing: value => { state.busy = value; },
        setMissingData: missing => { state.missing = missing; },
        setFolderTaskCancelling() {}, setShowMissingDialog() {},
        window: { electronAPI: {
            async checkMissingVolumes(paths, options) { state.calls.push({ paths, options }); return emptyResult; },
            async showMessage(message) { state.messages.push(message); },
            async stopTask() {},
        } },
    };
    const handlers = vm.runInNewContext(source.slice(start, end)
        + '\n({ runMissingVolumesCheck, invalidateMissingVolumesCheck });', context);
    return { state, context, ...handlers };
}

test('actual renderer uses the index on startup, reuses an empty result, and live-scans only an uncached manual check', async () => {
    const app = rendererHarness();
    await app.runMissingVolumesCheck();
    assert.equal(app.state.calls[0].options.indexOnly, true);
    await app.runMissingVolumesCheck(true);
    assert.equal(app.state.calls.length, 1);
    assert.equal(app.state.messages[0].message, 'msg_no_missing_vols');
    app.invalidateMissingVolumesCheck();
    await app.runMissingVolumesCheck(true);
    assert.equal(app.state.calls.length, 2);
    assert.equal(app.state.calls[1].options.indexOnly, false);
});

test('actual renderer releases busy on IPC errors and uses current files when no libraries exist', async () => {
    const failed = rendererHarness();
    failed.context.window.electronAPI.checkMissingVolumes = async () => { throw new Error('offline'); };
    await failed.runMissingVolumesCheck(true);
    assert.equal(failed.state.busy, false);
    assert.match(failed.state.errors[0], /offline/);
    const local = rendererHarness([]);
    await local.runMissingVolumesCheck(true);
    assert.equal(local.state.calls.length, 0);
    assert.deepEqual(local.state.missing, [{ series: 'Novel', missing: ['2'], folder_path: '/current' }]);
});

test('actual automatic effect does not restart for browsing or cache updates and reruns after explicit invalidation', () => {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('    useEffect(() => {\n        if (!missingConfigReady || missingLibraryKey ===');
    const end = source.indexOf('    useEffect(() => {', start + 10);
    assert.ok(start >= 0 && end > start);
    let previousDependencies;
    let cleanup;
    let scheduled = null;
    let runs = 0;
    const context = {
        missingConfigReady: true, missingLibraryKey: '["/library"]', missingRefreshVersion: 0,
        scanning: false, preparingDuplicates: false, missingAutoAttemptRef: { current: '' },
        getMissingVolumesCheck: () => ({ hasResult: () => false }),
        runMissingVolumesCheck: () => { runs += 1; }, MISSING_BACKGROUND_SCAN_DELAY_MS: 2500,
        useEffect(callback, dependencies) {
            if (previousDependencies && dependencies.every((value, index) => value === previousDependencies[index])) return;
            cleanup?.();
            previousDependencies = dependencies;
            cleanup = callback();
        },
        window: {
            setTimeout(callback) { scheduled = callback; return 1; },
            clearTimeout() { scheduled = null; },
        },
    };
    const render = () => vm.runInNewContext(source.slice(start, end), context);
    render();
    scheduled();
    assert.equal(runs, 1);
    context.config = { unrelatedSetting: true };
    context.getCurrentFileData = () => ['updated thumbnail cache'];
    context.selectedFolderPath = '/another-folder';
    context.scanning = true;
    render();
    context.scanning = false;
    render();
    assert.equal(scheduled, null);
    assert.equal(runs, 1);
    context.missingRefreshVersion += 1;
    render();
    scheduled();
    assert.equal(runs, 2);
});

test('actual missing-check cancellation leaves the ordinary browsing scan alone', async () => {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('  const handleCancelCurrentTask = useCallback(');
    const end = source.indexOf('  const handleAddFolderFromToolbar = ', start);
    assert.ok(start >= 0 && end > start);
    const cancelled = [];
    const handler = vm.runInNewContext(source.slice(start, end) + '\nhandleCancelCurrentTask;', {
        useCallback: callback => callback, preparingDuplicates: false, scanning: true, isCheckingMissing: true,
        setFolderTaskCancelling() {}, setDuplicatePreparationStatus() {}, emitStatusState() {},
        t: key => key, duplicatePreparationProgress: 0, scanProgress: 10,
        libraryPhaseRef: { current: '' }, libraryTaskMode: null,
        backgroundLibraryScanCancelRef: { current: async () => cancelled.push('folder:missingVolumes') },
        cancelScan: async () => cancelled.push('folder:scan'),
        refreshLibraryScanStates() {}, markLibraryScanStatesCancelled() {},
        window: { electronAPI: { stopTask: async task => cancelled.push(task) } },
    });
    await handler();
    assert.deepEqual(cancelled, ['folder:missingVolumes']);
});
