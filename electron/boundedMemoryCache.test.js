import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedMemoryCache } from './boundedMemoryCache.js';

test('cache limits entries and bytes while preserving recently read values', () => {
    const cache = new BoundedMemoryCache({ maxEntries: 2, maxBytes: 20 });
    cache.set('a', 'one').set('b', 'two');
    assert.equal(cache.byteSize, 16);
    assert.equal(cache.get('a'), 'one');
    cache.set('c', 'three');
    assert.equal(cache.has('b'), false);
    assert.equal(cache.get('a'), 'one');
    assert.equal(cache.get('c'), 'three');
    assert.equal(cache.byteSize, 20);
    cache.set('c', 'x');
    assert.equal(cache.byteSize, 12);
    cache.clear();
    assert.equal(cache.byteSize, 0);
    assert.equal(cache.size, 0);
});

test('cache keeps empty values until their expiry and accounts for binary data', () => {
    let now = 100;
    const cache = new BoundedMemoryCache({ maxEntries: 4, maxBytes: 16, now: () => now });
    cache.set('a', '', { ttlMs: 10 });
    assert.equal(cache.has('a'), true);
    now = 110;
    assert.equal(cache.has('a'), false);
    assert.equal(cache.byteSize, 0);
    const buffer = Buffer.from([0, 255, 128]);
    cache.set('b', buffer);
    assert.equal(cache.byteSize, 5);
    assert.equal(cache.get('b'), buffer);
});

test('cache shares in-flight loads without retaining oversized results or failed loads', async () => {
    const cache = new BoundedMemoryCache({ maxEntries: 2, maxBytes: 10 });
    let calls = 0;
    const loader = () => { calls += 1; return 'larger than cache'; };
    const first = cache.getOrLoad('a', loader);
    const second = cache.getOrLoad('a', loader);
    assert.equal(first, second);
    assert.deepEqual(await Promise.all([first, second]), ['larger than cache', 'larger than cache']);
    assert.equal(calls, 1);
    assert.equal(cache.size, 0);
    assert.equal(cache.pending.size, 0);
    await assert.rejects(cache.getOrLoad('b', () => { throw new Error('offline'); }), /offline/);
    assert.equal(cache.pending.size, 0);
    assert.equal(await cache.getOrLoad('b', () => 'ok'), 'ok');
    assert.equal(cache.get('b'), 'ok');
});

test('clearing cache during a load prevents old results from repopulating it', async () => {
    const cache = new BoundedMemoryCache({ maxEntries: 2, maxBytes: 100 });
    let finishOld;
    let finishNew;
    const oldRequest = cache.getOrLoad('a', () => new Promise(resolve => { finishOld = resolve; }));
    await Promise.resolve();
    cache.clear();
    const newRequest = cache.getOrLoad('a', () => new Promise(resolve => { finishNew = resolve; }));
    await Promise.resolve();
    finishOld('old');
    assert.equal(await oldRequest, 'old');
    assert.equal(cache.has('a'), false);
    assert.equal(cache.pending.size, 1);
    finishNew('new');
    assert.equal(await newRequest, 'new');
    assert.equal(cache.get('a'), 'new');
    assert.equal(cache.pending.size, 0);
});
