import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { coverResamplingTarget, createCoverImageResampler } from './coverImageResampling.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function image(src = 'cover.jpg', width = 1000, height = 1500) {
    return { src, currentSrc: src, naturalWidth: width, naturalHeight: height };
}

const target = { width: 100, height: 150 };

test('cover targets preserve source ratio at actual device resolution for fill, cover and contain', () => {
    const dimensions = {
        naturalWidth: 1000,
        naturalHeight: 2000,
        displayWidth: 100,
        displayHeight: 100,
        devicePixelRatio: 2,
    };
    assert.deepEqual(coverResamplingTarget(dimensions), { width: 200, height: 400 });
    assert.deepEqual(coverResamplingTarget({ ...dimensions, fitMode: 'cover' }), { width: 200, height: 400 });
    assert.deepEqual(coverResamplingTarget({ ...dimensions, fitMode: 'contain' }), { width: 100, height: 200 });
    assert.deepEqual(coverResamplingTarget({ ...dimensions, devicePixelRatio: 3 }), { width: 300, height: 600 });
});

test('cover targets round fractional layout dimensions up to avoid undersized output', () => {
    assert.deepEqual(coverResamplingTarget({
        naturalWidth: 1000,
        naturalHeight: 2000,
        displayWidth: 100.25,
        displayHeight: 200.5,
        devicePixelRatio: 1.25,
    }), { width: 126, height: 251 });
});

test('cover targets avoid enlargement and excessive source or output allocation', () => {
    const dimensions = {
        naturalWidth: 1000,
        naturalHeight: 1500,
        displayWidth: 500,
        displayHeight: 750,
        devicePixelRatio: 2,
    };
    assert.equal(coverResamplingTarget(dimensions), null);
    assert.equal(coverResamplingTarget({ ...dimensions, displayWidth: 900 }), null);
    assert.equal(coverResamplingTarget({ ...dimensions, naturalWidth: 5000, naturalHeight: 5000 }), null);
    assert.equal(coverResamplingTarget({
        ...dimensions,
        naturalWidth: 3000,
        naturalHeight: 4000,
        displayWidth: 500,
        displayHeight: 700,
    }), null);
    for (const invalid of [0, -1, NaN, Infinity]) {
        assert.equal(coverResamplingTarget({ ...dimensions, displayWidth: invalid }), null);
        assert.equal(coverResamplingTarget({ ...dimensions, devicePixelRatio: invalid }), null);
    }
});

function fixture(options = {}) {
    const calls = [];
    const canvases = [];
    const created = [];
    const revoked = [];
    const service = createCoverImageResampler({
        document: {
            createElement(tag) {
                assert.equal(tag, 'canvas');
                const canvas = {
                    width: 300,
                    height: 150,
                    toBlob(callback, type) {
                        assert.equal(type, 'image/png');
                        callback(new Blob(['cover'], { type }));
                    },
                };
                canvases.push(canvas);
                return canvas;
            },
        },
        url: {
            createObjectURL(blob) {
                const url = `blob:cover-${created.length}`;
                created.push({ blob, url });
                return url;
            },
            revokeObjectURL(url) {
                revoked.push(url);
            },
        },
        async renderer(request) {
            calls.push(request);
            request.canvas.width = request.target.width;
            request.canvas.height = request.target.height;
            return true;
        },
        ...options,
    });
    return { service, calls, canvases, created, revoked };
}

test('coalesces simultaneous covers and returns independent leases for one cached URL', async () => {
    const { service, calls, canvases, revoked } = fixture();
    const first = service.acquire(image(), target);
    const second = service.acquire(image(), target);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls.length, 1);
    assert.equal(a.url, b.url);
    assert.notEqual(a, b);
    assert.deepEqual(canvases.map(canvas => [canvas.width, canvas.height]), [[1, 1]]);
    a.release();
    a.release();
    const cached = await service.acquire(image(), target);
    assert.equal(cached.url, b.url);
    assert.equal(calls.length, 1);
    service.dispose();
    assert.deepEqual(revoked, []);
    b.release();
    assert.deepEqual(revoked, []);
    cached.release();
    assert.deepEqual(revoked, [a.url]);
});

test('runs only one entire resize job at a time', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const starts = [];
    let running = 0;
    let peakRunning = 0;
    const { service } = fixture({
        async renderer(request) {
            const index = starts.length;
            starts.push(request.source.src);
            running += 1;
            peakRunning = Math.max(peakRunning, running);
            await gates[index].promise;
            running -= 1;
            return true;
        },
    });
    const first = service.acquire(image('first'), target);
    const second = service.acquire(image('second'), target);
    const third = service.acquire(image('third'), target);
    assert.deepEqual(starts, ['first']);
    gates[0].resolve();
    const a = await first;
    assert.deepEqual(starts, ['first', 'second']);
    gates[1].resolve();
    const b = await second;
    assert.deepEqual(starts, ['first', 'second', 'third']);
    gates[2].resolve();
    const c = await third;
    assert.equal(peakRunning, 1);
    for (const lease of [a, b, c]) lease.release();
    service.dispose();
});

test('holds the job slot while PNG encoding is still pending', async () => {
    let finishBlob;
    const { service, calls, canvases } = fixture();
    const first = service.acquire(image('first'), target);
    canvases[0].toBlob = callback => { finishBlob = callback; };
    const second = service.acquire(image('second'), target);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    finishBlob(new Blob(['cover']));
    const a = await first;
    const b = await second;
    assert.equal(calls.length, 2);
    a.release();
    b.release();
    service.dispose();
});

test('canceling one subscriber preserves the shared resize for other subscribers', async () => {
    const gate = deferred();
    let canceled = false;
    const { service } = fixture({
        async renderer({ cancelToken }) {
            cancelToken.catch(() => { canceled = true; });
            await gate.promise;
            return true;
        },
    });
    const controller = new AbortController();
    const a = service.acquire(image(), target, { signal: controller.signal });
    const b = service.acquire(image(), target);
    const rejected = assert.rejects(a, { name: 'AbortError' });
    controller.abort();
    await rejected;
    assert.equal(canceled, false);
    gate.resolve();
    const lease = await b;
    lease.release();
    service.dispose();
});

test('removes abandoned queued jobs and cancels active work when its last subscriber aborts', async () => {
    const starts = [];
    const { service, canvases, created } = fixture({
        async renderer({ source, cancelToken }) {
            starts.push(source.src);
            if (source.src === 'active') await cancelToken;
            return true;
        },
    });
    const activeController = new AbortController();
    const queuedController = new AbortController();
    const active = service.acquire(image('active'), target, { signal: activeController.signal });
    const queued = service.acquire(image('queued'), target, { signal: queuedController.signal });
    const survivor = service.acquire(image('survivor'), target);
    const activeRejected = assert.rejects(active, { name: 'AbortError' });
    const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
    queuedController.abort();
    activeController.abort();
    await Promise.all([activeRejected, queuedRejected]);
    const lease = await survivor;
    assert.deepEqual(starts, ['active', 'survivor']);
    assert.equal(created.length, 1);
    assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
    lease.release();
    service.dispose();
});

test('does not cache an abandoned result when cancellation arrives during encoding', async () => {
    let finishBlob;
    const { service, created, canvases } = fixture();
    const controller = new AbortController();
    const pending = service.acquire(image(), target, { signal: controller.signal });
    canvases[0].toBlob = callback => { finishBlob = callback; };
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    finishBlob(new Blob(['cover']));
    await rejected;
    const lease = await service.acquire(image(), target);
    assert.equal(created.length, 1);
    assert.equal(canvases.length, 2);
    assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
    lease.release();
    service.dispose();
});

test('evicts least recently used idle entries and keeps leased images usable', async () => {
    const { service, revoked } = fixture({ maxCacheEntries: 2 });
    const a = await service.acquire(image('a'), target);
    const b = await service.acquire(image('b'), target);
    a.release();
    b.release();
    const cachedA = await service.acquire(image('a'), target);
    cachedA.release();
    const c = await service.acquire(image('c'), target);
    assert.deepEqual(revoked, [b.url]);
    const d = await service.acquire(image('d'), target);
    assert.deepEqual(revoked, [b.url, a.url]);
    const e = await service.acquire(image('e'), target);
    assert.deepEqual(revoked, [b.url, a.url]);
    c.release();
    assert.deepEqual(revoked, [b.url, a.url, c.url]);
    service.dispose();
    assert.deepEqual(revoked, [b.url, a.url, c.url]);
    d.release();
    e.release();
    assert.equal(revoked.length, 5);
});

test('counts decoded RGBA memory plus encoded blob bytes against the cache budget', async () => {
    const { service, revoked } = fixture({ maxCacheBytes: 60_000 });
    const lease = await service.acquire(image(), target);
    assert.deepEqual(revoked, []);
    lease.release();
    assert.deepEqual(revoked, [lease.url]);
    service.dispose();
    assert.equal(revoked.length, 1);
});

test('dispose cancels active and queued subscribers and prevents future requests', async () => {
    let activeCanceled = false;
    const { service, created, canvases } = fixture({
        async renderer({ cancelToken }) {
            try {
                await cancelToken;
            } finally {
                activeCanceled = true;
            }
        },
    });
    const first = service.acquire(image('first'), target);
    const second = service.acquire(image('second'), target);
    const rejections = Promise.all([
        assert.rejects(first, { name: 'AbortError' }),
        assert.rejects(second, { name: 'AbortError' }),
    ]);
    service.dispose();
    service.dispose();
    await rejections;
    await assert.rejects(service.acquire(image(), target), { name: 'AbortError' });
    assert.equal(activeCanceled, true);
    assert.equal(created.length, 0);
    assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('failed rendering releases the canvas and allows retrying the same source', async () => {
    let attempts = 0;
    const { service, canvases } = fixture({
        async renderer() {
            attempts += 1;
            if (attempts === 1) throw new Error('Canvas is tainted.');
            return true;
        },
    });
    await assert.rejects(service.acquire(image(), target), /tainted/);
    assert.deepEqual(canvases.map(canvas => [canvas.width, canvas.height]), [[1, 1]]);
    const lease = await service.acquire(image(), target);
    assert.equal(attempts, 2);
    lease.release();
    service.dispose();
});

test('failed PNG encoding releases the canvas and does not poison the cache', async () => {
    const { service, canvases, created } = fixture();
    const failed = service.acquire(image(), target);
    canvases[0].toBlob = callback => callback(null);
    await assert.rejects(failed, /encoding failed/);
    assert.deepEqual(created, []);
    const lease = await service.acquire(image(), target);
    assert.equal(created.length, 1);
    assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
    lease.release();
    service.dispose();
});

test('rejects blank sources, unloaded images, invalid sizes and excessive memory requests', async () => {
    const { service, calls } = fixture();
    for (const [source, size] of [
        [image(''), target],
        [image('  '), target],
        [image('cover', 0, 1500), target],
        [image('cover', 5000, 5000), target],
        [image(), { width: 0, height: 150 }],
        [image(), { width: 100.5, height: 150 }],
        [image(), { width: NaN, height: 150 }],
        [image(), { width: 1000, height: 1500 }],
        [image('large', 3000, 4000), { width: 1001, height: 1000 }],
    ]) {
        await assert.rejects(service.acquire(source, size), /Invalid cover/);
    }
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(service.acquire(image(), target, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls.length, 0);
    service.dispose();
});

test('does not render a queued DOM image whose source changed before its turn', async () => {
    const gate = deferred();
    const starts = [];
    const { service } = fixture({
        async renderer({ source }) {
            starts.push(source.src);
            await gate.promise;
            return true;
        },
    });
    const first = service.acquire(image('first'), target);
    const changedImage = image('original');
    const second = service.acquire(changedImage, target);
    const rejected = assert.rejects(second, { name: 'AbortError' });
    changedImage.currentSrc = 'replacement';
    gate.resolve();
    const lease = await first;
    await rejected;
    assert.deepEqual(starts, ['first']);
    lease.release();
    service.dispose();
});

test('keys cached images by current source and the complete requested pixel dimensions', async () => {
    const { service, calls } = fixture();
    const source = image('fallback');
    source.currentSrc = 'selected-srcset';
    const first = await service.acquire(source, target);
    const second = await service.acquire(image('selected-srcset'), target);
    const third = await service.acquire(source, { width: 100, height: 151 });
    assert.equal(first.url, second.url);
    assert.notEqual(first.url, third.url);
    assert.equal(calls.length, 2);
    for (const lease of [first, second, third]) lease.release();
    service.dispose();
});

test('removes abort listeners after completion, failure, cancellation and disposal', async () => {
    const { service } = fixture();
    const completedController = new AbortController();
    const completed = service.acquire(image(), target, { signal: completedController.signal });
    assert.equal(getEventListeners(completedController.signal, 'abort').length, 1);
    const lease = await completed;
    assert.equal(getEventListeners(completedController.signal, 'abort').length, 0);
    lease.release();
    service.dispose();

    const failedController = new AbortController();
    const { service: failedService } = fixture({ renderer: async () => { throw new Error('failed'); } });
    await assert.rejects(failedService.acquire(image(), target, { signal: failedController.signal }), /failed/);
    assert.equal(getEventListeners(failedController.signal, 'abort').length, 0);
    failedService.dispose();

    const { service: canceledService } = fixture({ renderer: ({ cancelToken }) => cancelToken });
    const canceledController = new AbortController();
    const disposedController = new AbortController();
    const canceled = canceledService.acquire(image('canceled'), target, { signal: canceledController.signal });
    const disposed = canceledService.acquire(image('disposed'), target, { signal: disposedController.signal });
    const rejected = Promise.all([
        assert.rejects(canceled, { name: 'AbortError' }),
        assert.rejects(disposed, { name: 'AbortError' }),
    ]);
    canceledController.abort();
    canceledService.dispose();
    await rejected;
    assert.equal(getEventListeners(canceledController.signal, 'abort').length, 0);
    assert.equal(getEventListeners(disposedController.signal, 'abort').length, 0);
});

test('does not cache a source that changes while rendering is active', async () => {
    const gate = deferred();
    const { service, created, canvases } = fixture({ renderer: () => gate.promise });
    const changing = image();
    const pending = service.acquire(changing, target);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    changing.currentSrc = 'different.jpg';
    gate.resolve(true);
    await rejected;
    assert.deepEqual(created, []);
    assert.deepEqual(canvases.map(canvas => [canvas.width, canvas.height]), [[1, 1]]);
    service.dispose();
});
