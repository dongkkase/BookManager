import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createComicPageRequest } from './viewerComicResources.js';
import { readStaticComicPngSize, scheduleComicThumbnail } from './viewerComicThumbnail.js';

const source = fs.readFileSync(new URL('./useComicPngPage.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default function', 'function');
const tick = () => new Promise(resolve => setImmediate(resolve));
const sameDependencies = (left, right) => left && right && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));

function png({ width = 720, height = 125000, animated = false } = {}) {
    const chunk = (name, data) => {
        const buffer = Buffer.alloc(data.length + 12);
        buffer.writeUInt32BE(data.length);
        buffer.write(name, 4);
        data.copy(buffer, 8);
        return buffer;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return new Blob([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []),
        chunk('IDAT', Buffer.alloc(1)),
    ]);
}

function fixture(options = {}) {
    const slots = [];
    const requests = [];
    const cancellations = [];
    const urls = new Set();
    const bitmaps = [];
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let mounted = true;
    let updatesAfterUnmount = 0;
    let output;
    let currentSource = '';
    let currentName = 'page.png';
    let urlSequence = 0;
    const useState = initial => {
        const index = cursor++;
        slots[index] ??= { value: initial };
        return [slots[index].value, value => {
            if (!mounted) updatesAfterUnmount += 1;
            slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
            dirty = true;
        }];
    };
    const useEffect = (effect, dependencies) => {
        const index = cursor++;
        if (!sameDependencies(slots[index]?.dependencies, dependencies)) {
            effects.push({ index, effect, cleanup: slots[index]?.cleanup });
            slots[index] = { dependencies };
        }
    };
    const createBitmap = () => {
        const bitmap = { width: 720, height: 125000, closeCount: 0, close() { this.closeCount += 1; } };
        bitmaps.push(bitmap);
        return bitmap;
    };
    const hook = new Function('useState', 'useEffect', 'createComicPageRequest', 'readStaticComicPngSize',
        'scheduleComicThumbnail', 'fetch', 'createImageBitmap', 'URL', `${source}; return useComicPngPage;`)(
        useState, useEffect,
        url => createComicPageRequest(url, { cancelComicPageRequest: (...args) => cancellations.push(args) }),
        readStaticComicPngSize, scheduleComicThumbnail,
        (url, requestOptions) => {
            requests.push({ url, ...requestOptions });
            return options.fetch ? options.fetch(url, requestOptions) : Promise.resolve({ ok: true, blob: async () => options.blob || png() });
        },
        blob => options.decode ? options.decode(blob, createBitmap) : Promise.resolve(createBitmap()),
        {
            createObjectURL() { const url = `blob:fixture-${++urlSequence}`; urls.add(url); return url; },
            revokeObjectURL(url) { urls.delete(url); },
        },
    );
    const render = (nextSource = currentSource, nextName = currentName) => {
        currentSource = nextSource;
        currentName = nextName;
        let count = 0;
        do {
            assert.ok(count++ < 20, 'Unexpected hook render loop');
            cursor = 0;
            effects = [];
            dirty = false;
            output = hook(currentSource, { name: currentName });
            effects.forEach(effect => effect.cleanup?.());
            effects.forEach(effect => { slots[effect.index].cleanup = effect.effect(); });
        } while (dirty);
        return output;
    };
    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        slots.forEach(slot => slot.cleanup?.());
    };
    render();
    return {
        render, unmount, requests, cancellations, urls, bitmaps,
        get output() { return output; },
        get updatesAfterUnmount() { return updatesAfterUnmount; },
        async until(predicate) {
            for (let index = 0; index < 30; index += 1) {
                await tick();
                if (mounted && dirty) render();
                if (predicate()) return;
            }
            assert.fail('Hook did not reach expected state');
        },
    };
}

test('large static PNG owns one CPU bitmap and closes it on unmount', async t => {
    const f = fixture();
    t.after(f.unmount);
    assert.equal(f.render().status, 'loading');
    await tick();
    assert.equal(f.requests.length, 0);
    f.render('bookmanager-comic://session/book/page.png');
    await f.until(() => f.output.status === 'tiled');
    assert.equal(f.output.width, 720);
    assert.equal(f.output.height, 125000);
    assert.equal(f.output.bitmap, f.bitmaps[0]);
    assert.equal(f.urls.size, 0);
    assert.equal(f.cancellations.length, 1);
    f.unmount();
    assert.equal(f.bitmaps[0].closeCount, 1);
});

test('ordinary PNG and APNG keep the original blob URL and revoke it on source change', async t => {
    for (const blob of [png({ height: 1800 }), png({ animated: true })]) {
        const f = fixture({ blob });
        t.after(f.unmount);
        f.render('data:image/png;base64,ZmFsbGJhY2s=');
        await f.until(() => f.output.status === 'original');
        assert.match(f.output.url, /^blob:/);
        assert.equal(f.bitmaps.length, 0);
        assert.equal(f.urls.size, 1);
        const next = f.render('');
        assert.equal(next.status, 'loading');
        assert.equal(next.url, '');
        assert.equal(f.urls.size, 0);
        f.unmount();
    }
});

test('wide PNG keeps the original path without creating an oversized tile bitmap', async t => {
    const f = fixture({ blob: png({ width: 30000, height: 2000 }) });
    t.after(f.unmount);
    f.render('bookmanager-comic://session/book/wide.png');
    await f.until(() => f.output.status === 'original');
    assert.equal(f.bitmaps.length, 0);
    assert.equal(f.output.width, 30000);
    assert.equal(f.output.height, 2000);
    assert.equal(f.urls.size, 1);
    f.unmount();
    assert.equal(f.urls.size, 0);
});

test('orientation-expanded bitmap is closed before returning the original image URL', async t => {
    const f = fixture({ decode: async (_blob, createBitmap) => {
        const bitmap = createBitmap();
        bitmap.width = 125000;
        bitmap.height = 720;
        return bitmap;
    } });
    t.after(f.unmount);
    f.render('bookmanager-comic://session/book/rotated.png');
    await f.until(() => f.output.status === 'original');
    assert.equal(f.bitmaps[0].closeCount, 1);
    assert.equal(f.output.bitmap, null);
    assert.equal(f.output.width, 125000);
    assert.equal(f.output.height, 720);
    assert.equal(f.urls.size, 1);
    f.unmount();
    assert.equal(f.bitmaps[0].closeCount, 1);
    assert.equal(f.urls.size, 0);
});

test('the supported tile width boundary still uses the tiled image path', async t => {
    const f = fixture({ blob: png({ width: 8192, height: 5000 }), decode: async (_blob, createBitmap) => {
        const bitmap = createBitmap();
        bitmap.width = 8192;
        bitmap.height = 5000;
        return bitmap;
    } });
    t.after(f.unmount);
    f.render('bookmanager-comic://session/book/boundary.png');
    await f.until(() => f.output.status === 'tiled');
    assert.equal(f.output.width, 8192);
    assert.equal(f.urls.size, 0);
});

test('source change masks a previous bitmap and closes it before loading another page', async t => {
    const f = fixture();
    t.after(f.unmount);
    f.render('bookmanager-comic://session/book/first.png');
    await f.until(() => f.output.status === 'tiled');
    const next = f.render('bookmanager-comic://session/book/second.png', 'second.png');
    assert.equal(next.status, 'loading');
    assert.equal(next.bitmap, null);
    assert.equal(f.bitmaps[0].closeCount, 1);
    await f.until(() => f.output.status === 'tiled');
    assert.equal(f.output.bitmap, f.bitmaps[1]);
});

test('cancelling a pending decode waits for completion, closes the late bitmap and never publishes it', async t => {
    let finish;
    const f = fixture({ decode: (_blob, createBitmap) => new Promise(resolve => { finish = () => resolve(createBitmap()); }) });
    t.after(() => { f.unmount(); finish?.(); });
    f.render('bookmanager-comic://session/book/page.png');
    await f.until(() => Boolean(finish));
    f.unmount();
    assert.equal(f.requests[0].signal.aborted, true);
    assert.equal(f.cancellations.length, 1);
    let nextStarted = false;
    const next = new Promise(resolve => scheduleComicThumbnail(() => { nextStarted = true; resolve(); }));
    await tick();
    assert.equal(nextStarted, false);
    finish();
    await next;
    assert.equal(f.bitmaps[0].closeCount, 1);
    assert.equal(f.updatesAfterUnmount, 0);
});

test('fetch abort releases the explicit protocol consumer without stale state updates', async t => {
    const f = fixture({ fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }) });
    t.after(f.unmount);
    f.render('bookmanager-comic://session/book/page.png');
    await f.until(() => f.requests.length === 1);
    f.unmount();
    await tick();
    assert.equal(f.requests[0].signal.aborted, true);
    assert.equal(f.cancellations.length, 1);
    assert.equal(f.updatesAfterUnmount, 0);
    assert.equal(f.bitmaps.length, 0);
});

test('decode errors become an explicit error without an original image fallback', async t => {
    const failure = new Error('Invalid PNG');
    const f = fixture({ decode: async () => { throw failure; } });
    t.after(f.unmount);
    f.render('bookmanager-comic://session/book/page.png');
    await f.until(() => f.output.status === 'error');
    assert.equal(f.output.error, failure);
    assert.equal(f.output.bitmap, null);
    assert.equal(f.output.url, '');
    assert.equal(f.urls.size, 0);
    assert.equal(f.cancellations.length, 1);
});
