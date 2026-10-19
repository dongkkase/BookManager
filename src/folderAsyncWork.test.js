import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createCoverPreviewQueue, createFolderPoller } from './folderAsyncWork.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
}

function coverHarness(options = {}) {
    const jobs = [];
    const results = [];
    let active = 0;
    let maximumActive = 0;
    const queue = createCoverPreviewQueue({
        concurrency: 2,
        keyForFile: file => file.path,
        load: (file, context) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            const pending = deferred();
            jobs.push({
                file,
                context,
                finish() { active -= 1; pending.resolve(file.path); },
                fail() { active -= 1; pending.reject(new Error('unavailable')); },
            });
            return pending.promise;
        },
        onResult: (result, file, context) => results.push({ result, file, context }),
        ...options,
    });
    return { queue, jobs, results, maximumActive: () => maximumActive };
}

test('folder changes retain the concurrency limit and old completions resume the current cover queue', async () => {
    const h = coverHarness();
    h.queue.setScope('A');
    h.queue.enqueue([{ path: 'A1' }, { path: 'A2' }], 'A');
    await tick();
    h.queue.setScope('B');
    h.queue.enqueue([{ path: 'B1' }, { path: 'B2' }, { path: 'B3' }], 'B');
    await tick();
    assert.deepEqual(h.jobs.map(job => job.file.path), ['A1', 'A2']);
    h.jobs[0].finish();
    await tick();
    h.jobs[1].finish();
    await tick();
    assert.deepEqual(h.jobs.map(job => job.file.path), ['A1', 'A2', 'B1', 'B2']);
    assert.equal(h.results.length, 0);
    h.jobs[2].finish();
    await tick();
    h.jobs[3].finish();
    h.jobs[4].finish();
    await tick();
    assert.equal(h.maximumActive(), 2);
    assert.deepEqual(h.results.map(result => [result.file.path, result.context]), [['B1', 'B'], ['B2', 'B'], ['B3', 'B']]);
});

test('refreshing the same folder cannot publish old covers or clear the replacement request', async () => {
    const h = coverHarness({ concurrency: 1 });
    h.queue.setScope('A');
    h.queue.enqueue([{ path: 'same' }], 'old');
    await tick();
    h.queue.reset();
    h.queue.enqueue([{ path: 'same' }], 'new');
    h.jobs[0].finish();
    await tick();
    h.queue.setScope('A');
    h.queue.enqueue([{ path: 'same' }], 'duplicate');
    h.jobs[1].finish();
    await tick();
    assert.equal(h.jobs.length, 2);
    assert.deepEqual(h.results.map(result => result.context), ['new']);
});

test('visible cover priority, queue bounds, duplicate suppression and failed loads remain intact', async () => {
    const h = coverHarness({ concurrency: 1, queueLimit: 3, requestLimit: 3 });
    h.queue.enqueue([{ path: 'A1' }, { path: 'A2' }, { path: 'A3' }]);
    await tick();
    h.queue.enqueue([{ path: 'B1' }, { path: 'B1' }, { path: 'covered', cover: 'yes' }, { path: 'B2' }, { path: 'B3' }, { path: 'B4' }]);
    h.jobs[0].fail();
    await tick();
    for (let index = 1; index <= 4; index += 1) {
        h.jobs[index].finish();
        await tick();
    }
    assert.deepEqual(h.jobs.map(job => job.file.path), ['A1', 'B1', 'B2', 'B3', 'B4']);
    h.queue.enqueue([{ path: 'A1' }]);
    await tick();
    assert.equal(h.jobs.length, 5);
});

test('visible covers beyond the first request batch continue after all earlier previews fail', async () => {
    const requested = [];
    const results = [];
    let active = 0;
    let maximumActive = 0;
    const queue = createCoverPreviewQueue({
        keyForFile: file => file.path,
        load: async file => {
            requested.push(file.path);
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await Promise.resolve();
            active -= 1;
            if (file.index < 32) throw new Error('unavailable');
            return file.path;
        },
        onResult: result => results.push(result),
    });
    const files = Array.from({ length: 40 }, (_, index) => ({ path: `/books/${index}`, index }));
    queue.enqueue(files);
    await tick();
    assert.deepEqual(requested, files.map(file => file.path));
    assert.deepEqual(results, files.slice(32).map(file => file.path));
    assert.equal(maximumActive, 2);
});

test('evicting a cached preview allows that file to load again when visible', async () => {
    const h = coverHarness({ concurrency: 1 });
    h.queue.enqueue([{ path: 'book' }]);
    await tick();
    h.jobs[0].finish();
    await tick();
    h.queue.enqueue([{ path: 'book' }]);
    await tick();
    assert.equal(h.jobs.length, 1);
    h.queue.forgetKey('book');
    h.queue.enqueue([{ path: 'book' }]);
    await tick();
    assert.equal(h.jobs.length, 2);
    h.jobs[1].finish();
    await tick();
});

test('an empty visible snapshot removes pending previews without releasing active requests early', async () => {
    const h = coverHarness({ concurrency: 1, requestLimit: 1 });
    h.queue.enqueue([{ path: 'A1' }, { path: 'A2' }]);
    await tick();
    h.queue.enqueue([]);
    h.jobs[0].finish();
    await tick();
    assert.deepEqual(h.jobs.map(job => job.file.path), ['A1']);
    h.queue.enqueue([{ path: 'B1' }, { path: 'B2' }]);
    await tick();
    h.jobs[1].finish();
    await tick();
    h.jobs[2].finish();
    await tick();
    assert.deepEqual(h.jobs.map(job => job.file.path), ['A1', 'B1', 'B2']);
    assert.equal(h.maximumActive(), 1);
});

test('preview results are batched without delaying the next preview requests', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const batches = [];
    const h = coverHarness({ resultFlushDelay: 120, onResults: entries => batches.push(entries) });
    const context = { folderPath: '/books' };
    h.queue.enqueue(['A1', 'A2', 'A3', 'A4'].map(path => ({ path })), context);
    await tick();
    h.jobs[0].finish();
    h.jobs[1].finish();
    await tick();
    assert.equal(h.jobs.length, 4);
    h.jobs[2].finish();
    h.jobs[3].finish();
    await tick();
    t.mock.timers.tick(119);
    assert.equal(batches.length, 0);
    t.mock.timers.tick(1);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].map(entry => entry.result), ['A1', 'A2', 'A3', 'A4']);
    assert.ok(batches[0].every(entry => entry.context === context && entry.file.path === entry.result));
    assert.equal(h.results.length, 0);
    assert.equal(h.maximumActive(), 2);
});

for (const changeScope of [false, true]) {
    test(`${changeScope ? 'scope changes' : 'reset'} discard buffered results and ignore old in-flight completions`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const batches = [];
        const h = coverHarness({ resultFlushDelay: 120, onResults: entries => batches.push(entries) });
        h.queue.setScope('A');
        h.queue.enqueue([{ path: 'A1' }, { path: 'A2' }]);
        await tick();
        h.jobs[0].finish();
        await tick();
        if (changeScope) h.queue.setScope('B');
        else h.queue.reset();
        t.mock.timers.tick(120);
        assert.equal(batches.length, 0);
        h.queue.enqueue([{ path: 'B1' }]);
        await tick();
        h.jobs[1].finish();
        h.jobs[2].finish();
        await tick();
        t.mock.timers.tick(120);
        assert.deepEqual(batches.map(entries => entries.map(entry => entry.result)), [['B1']]);
        assert.equal(h.maximumActive(), 2);
    });
}

test('batched result delivery defaults to immediate and remains usable after an update fails', async () => {
    const batches = [];
    const h = coverHarness({ concurrency: 1, onResults: entries => {
        batches.push(entries);
        if (batches.length === 1) throw new Error('update failed');
    } });
    h.queue.enqueue([{ path: 'A1' }, { path: 'A2' }]);
    await tick();
    h.jobs[0].finish();
    await tick();
    assert.equal(batches.length, 1);
    h.jobs[1].finish();
    await tick();
    assert.deepEqual(batches.map(entries => entries.map(entry => entry.result)), [['A1'], ['A2']]);
});

test('reset on unmount discards pending covers and never starts the abandoned queue', async () => {
    const h = coverHarness({ concurrency: 1 });
    h.queue.enqueue([{ path: 'A1' }, { path: 'A2' }]);
    await tick();
    h.queue.reset();
    h.jobs[0].finish();
    await tick();
    assert.equal(h.jobs.length, 1);
    assert.equal(h.results.length, 0);
});

test('reset before a queued cover starts avoids invoking the discarded load', async () => {
    const h = coverHarness({ concurrency: 1 });
    h.queue.enqueue([{ path: 'old' }]);
    h.queue.reset();
    h.queue.enqueue([{ path: 'new' }]);
    await tick();
    assert.deepEqual(h.jobs.map(job => job.file.path), ['new']);
    h.jobs[0].finish();
    await tick();
    assert.deepEqual(h.results.map(result => result.file.path), ['new']);
});

test('folder polling coalesces delayed requests and ignores responses after disposal', async () => {
    const pending = deferred();
    let calls = 0;
    let changes = 0;
    const mtimeRef = { current: 1 };
    const poller = createFolderPoller({
        readStat: () => { calls += 1; return pending.promise; },
        canPoll: () => true,
        mtimeRef,
        onChange: () => { changes += 1; },
    });
    const first = poller.poll();
    await poller.poll();
    await poller.poll();
    assert.equal(calls, 1);
    poller.dispose();
    pending.resolve({ isDirectory: true, mtime: 2 });
    await first;
    assert.equal(mtimeRef.current, 1);
    assert.equal(changes, 0);
});

test('hidden or busy folders resume automatic checks without losing changes', async () => {
    let allowed = false;
    let calls = 0;
    let changes = 0;
    const mtimeRef = { current: 1 };
    const poller = createFolderPoller({
        readStat: async () => { calls += 1; return { isDirectory: true, mtime: 2 }; },
        canPoll: () => allowed,
        mtimeRef,
        onChange: () => { changes += 1; },
    });
    await poller.poll();
    assert.equal(calls, 0);
    allowed = true;
    await poller.poll();
    await poller.poll();
    assert.equal(changes, 1);
    assert.equal(mtimeRef.current, 2);
});

test('hiding a folder during stat defers its changed timestamp until the next visible check', async () => {
    const pending = deferred();
    let allowed = true;
    let changes = 0;
    const mtimeRef = { current: 1 };
    const poller = createFolderPoller({
        readStat: () => pending.promise,
        canPoll: () => allowed,
        mtimeRef,
        onChange: () => { changes += 1; },
    });
    const first = poller.poll();
    allowed = false;
    pending.resolve({ isDirectory: true, mtime: 2 });
    await first;
    assert.equal(mtimeRef.current, 1);
    allowed = true;
    await poller.poll();
    assert.equal(changes, 1);
});

test('failed stats are retryable and a disposed in-flight scan cannot publish follow-up changes', async () => {
    const scan = deferred();
    let calls = 0;
    let published = false;
    const poller = createFolderPoller({
        readStat: async () => {
            calls += 1;
            if (calls === 1) throw new Error('disconnected');
            return { isDirectory: true, mtime: 2 };
        },
        canPoll: () => true,
        mtimeRef: { current: 1 },
        onChange: async isCurrent => { await scan.promise; published = isCurrent(); },
    });
    await poller.poll();
    const second = poller.poll();
    await tick();
    await poller.poll();
    assert.equal(calls, 2);
    poller.dispose();
    scan.resolve();
    await second;
    assert.equal(published, false);
});

test('FolderTab resumes polling on activation, uses current busy state, and cleans up its listener', async () => {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('    useEffect(() => {\n        watchedMtimeRef.current = null;');
    const ending = '    }, [resetCoverPreviewQueue, selectedFolderPath]);';
    const end = source.indexOf(ending, start);
    assert.ok(start >= 0 && end > start);
    const effect = source.slice(start, end + ending.length);
    let hidden = true;
    let calls = 0;
    let cleanup;
    const listeners = new Map();
    const context = vm.createContext({
        createFolderPoller,
        useEffect: fn => { cleanup = fn(); },
        watchedMtimeRef: { current: null },
        selectedFolderPath: '/books',
        internalFileActionRef: { current: false },
        mainAreaRef: { current: { closest: () => hidden ? {} : null } },
        folderPollContextRef: { current: { folderPath: '/books', scanning: false, preparingDuplicates: false } },
        setTreeRefreshToken() {}, resetCoverPreviewQueue() {}, setMissingRefreshVersion() {},
        window: {
            electronAPI: { stat: async () => { calls += 1; return { isDirectory: true, mtime: 1 }; } },
            setInterval: () => 1,
            clearInterval() {},
            addEventListener: (name, fn) => listeners.set(name, fn),
            removeEventListener: name => listeners.delete(name),
        },
    });
    vm.runInContext(effect, context);
    await tick();
    assert.equal(calls, 0);
    hidden = false;
    listeners.get('bookmanager:active-tab-changed')({ detail: { activeTab: 'folder' } });
    await tick();
    assert.equal(calls, 1);
    context.folderPollContextRef.current.scanning = true;
    listeners.get('bookmanager:active-tab-changed')({ detail: { activeTab: 'folder' } });
    await tick();
    assert.equal(calls, 1);
    cleanup();
    assert.equal(listeners.size, 0);
});

test('an internal action from the previous folder cannot replace the current polling timestamp', async () => {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('  const runInternalFileAction =');
    const action = source.slice(start, source.indexOf('    folderPollContextRef.current =', start));
    const stat = deferred();
    let timer;
    const context = vm.createContext({
        useCallback: fn => fn,
        selectedFolderPath: '/old',
        selectedFolderPathRef: { current: '/old' },
        internalFileActionRef: { current: false },
        watchedMtimeRef: { current: 1 },
        window: {
            setTimeout: fn => { timer = fn; },
            electronAPI: { stat: () => stat.promise },
        },
    });
    vm.runInContext(action + '\nglobalThis.run = runInternalFileAction;', context);
    await context.run(async () => {});
    const pending = timer();
    context.selectedFolderPathRef.current = '/new';
    context.watchedMtimeRef.current = 9;
    stat.resolve({ isDirectory: true, mtime: 2 });
    await pending;
    assert.equal(context.watchedMtimeRef.current, 9);
    assert.equal(context.internalFileActionRef.current, false);
});
