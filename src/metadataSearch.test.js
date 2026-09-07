import test from 'node:test';
import assert from 'node:assert/strict';
import {
    metadataSearchResultKey,
    rankMetadataSearchResults,
    searchMetadata,
} from './metadataSearch.js';
import {
    enabledMetadataApiSourcesForBookType,
    UNIFIED_METADATA_API_SOURCE,
} from './metadataApiPolicy.js';

const unifiedOptions = {
    apiSource: UNIFIED_METADATA_API_SOURCE,
    query: '수선전',
    page: 1,
    bookType: 'book',
    apiKeys: {},
};
const allKeys = { yes24: 'yes24-key', aladin: 'aladin-key', google: 'google-key', vine: 'vine-key' };
const deferred = () => {
    let resolve;
    const promise = new Promise(settle => { resolve = settle; });
    return { promise, resolve };
};

test('integrated search uses only enabled providers compatible with the book type', async () => {
    const calls = [];
    const options = { ...unifiedOptions, page: 3 };
    const result = await searchMetadata(options, async request => {
        calls.push(request);
        return { success: true, results: [{ id: 7, title: '수선전', metadata: { Title: '수선전' } }] };
    });
    assert.deepEqual(calls.map(call => call.apiSource), ['리디북스', '문피아', 'Amazon']);
    assert.ok(calls.every(call => call.page === 3 && call.query === '수선전' && call.bookType === 'book'));
    assert.equal(result.api, UNIFIED_METADATA_API_SOURCE);
    assert.equal(result.actualQuery, '수선전');
    assert.equal(result.results.length, 3);
    assert.equal(new Set(result.results.map(item => metadataSearchResultKey(item))).size, 3);
    assert.ok(result.results.every(item => item.id === 7));
});

test('registered keys enable their providers and comic search includes Anilist instead of Amazon', async () => {
    const calls = [];
    await searchMetadata({ ...unifiedOptions, bookType: 'comic', apiKeys: allKeys }, async request => {
        calls.push(request.apiSource);
        return { success: true, results: [] };
    });
    assert.deepEqual(calls, ['리디북스', '문피아', 'YES24', '알라딘', 'Google Books', 'Anilist', 'Vine']);
});

test('search requests run at most three at a time and collect responses in provider order', async () => {
    const started = [];
    let inFlight = 0;
    let peak = 0;
    const options = { ...unifiedOptions, apiKeys: allKeys };
    const providers = enabledMetadataApiSourcesForBookType(options.bookType, options.apiKeys);
    const gates = new Map(providers.map(source => [source.value, deferred()]));
    const pending = searchMetadata(options, async request => {
        started.push(request.apiSource);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gates.get(request.apiSource).promise;
        inFlight -= 1;
        return { success: true, results: [{ id: 1, title: '수선전' }] };
    });
    assert.equal(started.length, 3);
    gates.get(started[1]).resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.length, 4);
    assert.equal(inFlight, 3);
    for (const gate of gates.values()) gate.resolve();
    const result = await pending;
    assert.equal(peak, 3);
    assert.equal(started.length, providers.length);
    assert.deepEqual(result.results.map(item => item.apiSource), providers.map(source => source.value));
});

test('provider response failures and thrown errors are isolated without discarding successful results', async () => {
    const result = await searchMetadata(unifiedOptions, async request => {
        if (request.apiSource === '리디북스') return { success: false, error: 'Ridi unavailable' };
        if (request.apiSource === '문피아') throw new Error('Munpia timeout');
        return { success: true, results: [{ id: 5, title: '수선전', coverUrl: 'https://example.test/cover.png' }] };
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.failures, [
        { apiSource: '리디북스', error: 'Ridi unavailable' },
        { apiSource: '문피아', error: 'Munpia timeout' },
    ]);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].apiSource, 'Amazon');
    assert.equal(result.results[0].coverUrl, 'https://example.test/cover.png');
});

test('all failed providers produce an explicit failure code while empty successful searches remain successful', async () => {
    const failed = await searchMetadata(unifiedOptions, async () => ({ success: false, error: 'offline' }));
    assert.equal(failed.success, false);
    assert.equal(failed.code, 'ALL_APIS_FAILED');
    assert.equal(failed.failures.length, 3);
    const empty = await searchMetadata(unifiedOptions, async () => ({ success: true, results: [] }));
    assert.equal(empty.success, true);
    assert.deepEqual(empty.results, []);
    assert.equal(empty.hasNext, false);
});

test('malformed provider responses are treated as isolated failures', async () => {
    const result = await searchMetadata(unifiedOptions, async request => (
        request.apiSource === 'Amazon' ? { success: true, results: [] } : null
    ));
    assert.equal(result.success, true);
    assert.equal(result.failures.length, 2);
});

test('cancelled search starts no requests and stops queued providers after active responses settle', async () => {
    let calls = 0;
    const alreadyCancelled = await searchMetadata(unifiedOptions, async () => { calls += 1; }, { isCancelled: () => true });
    assert.equal(calls, 0);
    assert.equal(alreadyCancelled.cancelled, true);
    let cancelled = false;
    const gate = deferred();
    const pending = searchMetadata({ ...unifiedOptions, apiKeys: allKeys }, async () => {
        calls += 1;
        await gate.promise;
        return { success: true, results: [{ id: 1, title: '수선전' }] };
    }, { isCancelled: () => cancelled });
    assert.equal(calls, 3);
    cancelled = true;
    gate.resolve();
    const result = await pending;
    assert.equal(calls, 3);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.results, []);
});

test('the next page is available when any provider returns a full page', async () => {
    const fullPage = Array.from({ length: 20 }, (_, id) => ({ id, title: '수선전' }));
    const result = await searchMetadata(unifiedOptions, async request => ({
        success: true,
        results: request.apiSource === '문피아' ? fullPage : fullPage.slice(0, 1),
    }));
    assert.equal(result.hasNext, true);
    const partialPages = await searchMetadata(unifiedOptions, async () => ({ success: true, results: fullPage.slice(0, 19) }));
    assert.equal(partialPages.results.length, 57);
    assert.equal(partialPages.hasNext, false);
});

test('integrated search reports cache use only if all providers served cached successful responses', async () => {
    const cached = await searchMetadata(unifiedOptions, async () => ({ success: true, results: [], cached: true }));
    assert.equal(cached.cached, true);
    const mixed = await searchMetadata(unifiedOptions, async request => ({
        success: true,
        results: [],
        cached: request.apiSource !== '문피아',
    }));
    assert.equal(mixed.cached, false);
    const failed = await searchMetadata(unifiedOptions, async request => (
        request.apiSource === '문피아'
            ? { success: false, error: 'failed' }
            : { success: true, results: [], cached: true }
    ));
    assert.equal(failed.cached, false);
});

test('single-provider searches preserve request fields, result metadata and actual query', async () => {
    const metadata = { Title: '수선전', Series: '수선전', Writer: '작가' };
    const original = { id: 0, title: '수선전', metadata, coverUrl: 'cover', custom: 'preserved' };
    const options = { ...unifiedOptions, apiSource: '리디북스' };
    const result = await searchMetadata(options, async request => {
        assert.equal(request, options);
        return { success: true, api: 'Ridi', actualQuery: '수선전 1', results: [original], cached: true };
    });
    assert.equal(result.api, 'Ridi');
    assert.equal(result.actualQuery, '수선전 1');
    assert.equal(result.cached, true);
    assert.equal(result.results[0].metadata, metadata);
    assert.equal(result.results[0].id, 0);
    assert.equal(result.results[0].custom, 'preserved');
    assert.equal(result.results[0].apiSource, '리디북스');
    assert.equal(original.apiSource, undefined);
    assert.deepEqual(result.failures, []);
});

test('single-provider failures and late cancelled responses do not become successful searches', async () => {
    const options = { ...unifiedOptions, apiSource: '문피아' };
    const failed = await searchMetadata(options, async () => { throw new Error('timed out'); });
    assert.equal(failed.success, false);
    assert.equal(failed.error, 'timed out');
    let cancelled = false;
    const result = await searchMetadata(options, async () => {
        cancelled = true;
        return { success: true, results: [{ id: 1, title: '수선전' }] };
    }, { isCancelled: () => cancelled });
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.results, []);
});

test('result keys include the provider, preserve zero IDs and fall back to URL or title', () => {
    const ridi = metadataSearchResultKey({ id: 123, apiSource: '리디북스' });
    assert.notEqual(ridi, metadataSearchResultKey({ id: 123, apiSource: '문피아' }));
    assert.equal(ridi, metadataSearchResultKey({ id: 123 }, '리디북스'));
    assert.notEqual(metadataSearchResultKey({ id: 0 }), metadataSearchResultKey({ title: '0' }));
    assert.notEqual(metadataSearchResultKey({ url: 'same', apiSource: '리디북스' }), metadataSearchResultKey({ url: 'same', apiSource: '문피아' }));
    assert.notEqual(metadataSearchResultKey({ title: '수선전', author: '가' }), metadataSearchResultKey({ title: '수선전', author: '나' }));
});

test('ranking prioritizes exact titles, then volumes, substrings, spelling differences and unrelated titles', () => {
    const values = [
        { id: 'unrelated', title: '별에서 온 고양이' },
        { id: 'typo', title: '수선잔' },
        { id: 'partial', title: '수선전 외전' },
        { id: 'volume', title: '[완결] 수선전 01권', metadata: { Series: '수선전' } },
        { id: 'exact', title: '수선전' },
    ];
    const original = [...values];
    assert.deepEqual(rankMetadataSearchResults(values, '수선전').map(item => item.id), ['exact', 'volume', 'partial', 'typo', 'unrelated']);
    assert.deepEqual(values, original);
});

test('ranking normalizes Korean NFD, whitespace, punctuation, letter case and full-width characters', () => {
    assert.equal(rankMetadataSearchResults([
        { id: 'other', title: '수선기' },
        { id: 'exact', title: '수 선 전'.normalize('NFD') },
    ], '수선전')[0].id, 'exact');
    assert.equal(rankMetadataSearchResults([
        { id: 'other', title: 'Dragon Ballz' },
        { id: 'exact', title: 'ＤＲＡＧＯＮ－ＢＡＬＬ' },
    ], 'dragon ball')[0].id, 'exact');
});

test('ranking respects metadata titles, aliases and localized series', () => {
    const results = [
        { id: 'unrelated', title: 'Elsewhere' },
        { id: 'series', title: 'Foreign title 1', metadata: { LocalizedSeries: '수선전' } },
        { id: 'alias', title: 'English title', aliases: ['수선전'] },
        { id: 'metadata', title: '', metadata: { Title: '수선전' } },
    ];
    assert.deepEqual(rankMetadataSearchResults(results, '수선전').map(item => item.id), ['alias', 'metadata', 'series', 'unrelated']);
});

test('ranking preserves titles made of numbers and numbers intrinsic to the title', () => {
    const numeric = [
        { id: 'other', title: '1985' },
        { id: 'volume', title: '1984 1권' },
        { id: 'exact', title: '1984' },
    ];
    assert.deepEqual(rankMetadataSearchResults(numeric, '1984').map(item => item.id), ['exact', 'volume', 'other']);
    assert.equal(rankMetadataSearchResults([
        { id: 'without-number', title: '나의 히어로' },
        { id: 'exact', title: '나의 히어로 2' },
    ], '나의 히어로 2')[0].id, 'exact');
    assert.equal(rankMetadataSearchResults([
        { id: 'wrong', title: '1984' },
        { id: 'exact', title: '86' },
    ], '86')[0].id, 'exact');
});

test('ranking considers character order and preserves provider order when scores tie', () => {
    const results = [
        { id: 'reversed', title: '전선수' },
        { id: 'close', title: '수선잔' },
        { id: 'exact-a', title: '수선전' },
        { id: 'exact-b', title: '수선전' },
    ];
    assert.deepEqual(rankMetadataSearchResults(results, '수선전').map(item => item.id), ['exact-a', 'exact-b', 'close', 'reversed']);
});

test('volume ranges and edition qualifiers remain closer than subtitles', () => {
    const results = [
        { id: 'subtitle', title: '수선전 외전' },
        { id: 'range', title: '수선전 01~05권 (완결)' },
        { id: 'edition', title: '[개정판] 수선전' },
        { id: 'exact', title: '수선전' },
    ];
    assert.deepEqual(rankMetadataSearchResults(results, '수선전').map(item => item.id), ['exact', 'range', 'edition', 'subtitle']);
});

test('integrated ranking uses the user query even when providers return different rewritten queries', async () => {
    const result = await searchMetadata(unifiedOptions, async request => ({
        success: true,
        actualQuery: '다른 검색어',
        results: [{ id: request.apiSource, title: request.apiSource === '문피아' ? '수선전' : '다른 검색어' }],
    }));
    assert.equal(result.actualQuery, '수선전');
    assert.equal(result.results[0].apiSource, '문피아');
});

test('large titles and empty queries return results without unbounded edit comparisons', () => {
    const results = [
        { id: 'long', title: '가'.repeat(100000) },
        { id: 'exact', title: '수선전' },
    ];
    assert.equal(rankMetadataSearchResults(results, '수선전')[0].id, 'exact');
    assert.deepEqual(rankMetadataSearchResults(results, '   '), results);
});
