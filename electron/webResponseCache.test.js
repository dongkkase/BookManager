import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createWebResponseCache } from './servers/web/webResponseCache.js';
import { WEB_LIBRARY_JS } from './servers/web/webLibraryPage.js';

test('웹 응답 캐시는 최근 사용 순서로 항목 수와 문자열 바이트 예산을 지킨다', () => {
    const cache = createWebResponseCache({ maxEntries: 2, maxBytes: 200 });
    cache.set('a', { title: 'first' });
    cache.set('b', { title: 'second' });
    assert.equal(cache.get('a').title, 'first');
    cache.set('c', { title: 'third' });
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.size, 2);
    cache.set('large', { title: '한'.repeat(60) });
    assert.ok(cache.byteSize <= 200);
    assert.equal(cache.has('a'), false);
    assert.equal(cache.has('large'), true);
    assert.equal(cache.set('huge', { title: '한'.repeat(200) }), false);
    assert.ok(cache.byteSize <= 200);
});

test('웹 응답 캐시는 수정 격리와 TTL 만료를 유지하고 교체 크기를 다시 계산한다', () => {
    let now = 100;
    const cache = createWebResponseCache({ ttlMs: 10, now: () => now });
    const response = { items: [{ title: 'original' }] };
    cache.set('url', response);
    response.items[0].title = 'changed source';
    const first = cache.get('url');
    first.items[0].title = 'changed return';
    assert.equal(cache.get('url').items[0].title, 'original');
    cache.set('url', {});
    assert.equal(cache.byteSize, 2 * ('url'.length + '{}'.length));
    now = 110;
    assert.equal(cache.has('url'), false);
    assert.equal(cache.byteSize, 0);
    cache.set('other', {});
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.byteSize, 0);
});

test('배포 웹 스크립트는 캐시 hit, fresh fetch, useCache false를 그대로 처리한다', async () => {
    new vm.Script(WEB_LIBRARY_JS);
    const cacheStart = WEB_LIBRARY_JS.indexOf('const responseCache = ');
    const cacheEnd = WEB_LIBRARY_JS.indexOf('\nconst elements = ', cacheStart);
    const fetchStart = WEB_LIBRARY_JS.indexOf('async function fetchJson(');
    const fetchEnd = WEB_LIBRARY_JS.indexOf('\nfunction renderedCardCount(', fetchStart);
    let requests = 0;
    const context = vm.createContext({
        fetch: async () => ({
            ok: true,
            json: async () => ({ items: [{ title: `request ${++requests}` }] }),
        }),
    });
    vm.runInContext(WEB_LIBRARY_JS.slice(cacheStart, cacheEnd) + WEB_LIBRARY_JS.slice(fetchStart, fetchEnd), context);
    const first = await vm.runInContext('fetchJson("/api/list")', context);
    first.items[0].title = 'edited';
    const cached = await vm.runInContext('fetchJson("/api/list")', context);
    assert.equal(cached.items[0].title, 'request 1');
    assert.equal(requests, 1);
    const uncached = await vm.runInContext('fetchJson("/api/list", { useCache: false })', context);
    assert.equal(uncached.items[0].title, 'request 2');
    assert.equal((await vm.runInContext('fetchJson("/api/list")', context)).items[0].title, 'request 1');
});
