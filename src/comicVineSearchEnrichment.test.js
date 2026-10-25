import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { comicVineSearchThumbnail, createComicVineSearchEnricher, isComicVinePlaceholderCover, mergeComicVineSearchEnrichment } from './comicVineSearchEnrichment.js';
import { apiSourceHasRequiredKey } from './metadataApiPolicy.js';
import { metadataSearchResultKey, searchMetadata } from './metadataSearch.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function result(id, overrides = {}) {
    return { id, apiSource: 'Vine', title: `Volume ${id}`, comicVineFirstIssueId: String(100 + id),
        coverUrl: `https://images.test/${id}.jpg`, comicVineEnrichmentDeferred: true, ...overrides };
}

function harness(initialResults) {
    let results = initialResults;
    let cancelled = false;
    const credits = [];
    const covers = [];
    const sources = [];
    const patches = [];
    const worker = createComicVineSearchEnricher({
        fetchCredits: (id, issueId) => { const request = { ...deferred(), id, issueId }; credits.push(request); return request.promise; },
        fetchCovers: ids => { const request = { ...deferred(), ids }; sources.push(request); return request.promise; },
        cacheCover: url => { const request = { ...deferred(), url }; covers.push(request); return request.promise; },
        isCancelled: () => cancelled,
        onUpdate: (key, update) => {
            patches.push(update);
            results = results.map(item => metadataSearchResultKey(item) === key ? mergeComicVineSearchEnrichment(item, update) : item);
            worker.enqueue(results);
        },
    });
    return { worker, credits, covers, sources, patches, results: () => results,
        cancel: () => { cancelled = true; },
        replace: items => { results = items; worker.enqueue(items); },
    };
}

test('a ready cover or creator updates independently while the other requests stay blocked', async () => {
    const h = harness([result(1), result(2), result(3), result(4)]);
    h.worker.enqueue(h.results());
    await tick();
    assert.equal(h.credits.length, 2);
    assert.equal(h.covers.length, 3);
    h.covers[1].resolve({ coverCacheUrl: 'bookmanager-thumbnail://api-cover/2.jpg' });
    await tick();
    assert.equal(h.results()[1].coverCacheUrl, 'bookmanager-thumbnail://api-cover/2.jpg');
    assert.equal(h.results()[1].Writer, undefined);
    assert.equal(h.covers.length, 4);
    h.credits[0].resolve({ success: true, result: { Writer: 'Writer', Penciller: 'Artist', comicVineCreditsIssueId: '101' } });
    await tick();
    assert.equal(h.results()[0].metadata.Writer, 'Writer');
    assert.equal(h.results()[0].metadata.Penciller, 'Artist');
    assert.equal(h.results()[0].coverCacheUrl, undefined);
    assert.equal(h.results()[0].comicVineDetailResolved, undefined);
    assert.deepEqual(h.results().map(item => item.id), [1, 2, 3, 4]);
    assert.equal(h.credits.length, 3);
    h.worker.cancel();
});

test('cancellation ignores late requests and stops queued requests and image fallbacks', async () => {
    for (const cancel of ['cancel', 'worker']) {
        const h = harness(Array.from({ length: 8 }, (_, index) => result(index + 1, { CoverUrls: ['https://images.test/fallback.jpg'] })));
        h.worker.enqueue(h.results());
        await tick();
        if (cancel === 'cancel') h.cancel();
        else h.worker.cancel();
        h.credits[0].resolve({ success: true, result: { Writer: 'Late writer' } });
        h.credits[1].reject(new Error('Late failure'));
        h.covers[0].resolve({ coverCacheUrl: 'bookmanager-thumbnail://late' });
        h.covers[1].reject(new Error('No image'));
        h.covers[2].resolve(null);
        await tick();
        assert.equal(h.patches.length, 0);
        assert.equal(h.credits.length, 2);
        assert.equal(h.covers.length, 3);
    }
});

test('fatal credit errors stop later credits but covers continue', async () => {
    const h = harness(Array.from({ length: 5 }, (_, index) => result(index + 1)));
    h.worker.enqueue(h.results());
    await tick();
    h.credits[0].resolve({ success: false, code: 'API_RATE_LIMIT' });
    h.credits[1].resolve({ success: true, result: { Writer: 'In-flight writer' } });
    h.covers[0].resolve({ coverCacheUrl: 'bookmanager-thumbnail://1' });
    await tick();
    assert.equal(h.credits.length, 2);
    assert.equal(h.covers.length, 4);
    assert.equal(h.results()[1].Writer, 'In-flight writer');
    h.worker.cancel();
});

test('image failures try at most three unique candidates and keep the successful URL for cover application', async () => {
    const h = harness([result(1, { CoverUrls: ['https://images.test/1.jpg', 'https://images.test/2.jpg', 'https://images.test/3.jpg', 'https://images.test/4.jpg'] })]);
    h.worker.enqueue(h.results());
    await tick();
    h.covers[0].reject(new Error('Invalid image'));
    await tick();
    h.covers[1].resolve(null);
    await tick();
    h.covers[2].resolve({ coverCacheUrl: 'bookmanager-thumbnail://3' });
    await tick();
    assert.deepEqual(h.covers.map(item => item.url), ['https://images.test/1.jpg', 'https://images.test/2.jpg', 'https://images.test/3.jpg']);
    assert.equal(h.results()[0].coverUrl, 'https://images.test/3.jpg');
    assert.equal(h.results()[0].metadata.CoverUrl, 'https://images.test/3.jpg');
    h.worker.cancel();
});

test('late credits fill only empty fields and a late search cover cannot replace a changed detail cover', async () => {
    const h = harness([result(1)]);
    h.worker.enqueue(h.results());
    await tick();
    h.replace([result(1, { coverUrl: 'https://images.test/detail.jpg', Writer: 'Detail writer',
        metadata: { Writer: 'Detail writer', Summary: 'Full detail' }, comicVineDetailResolved: true })]);
    await tick();
    h.covers[0].resolve({ coverCacheUrl: 'bookmanager-thumbnail://old' });
    h.credits[0].resolve({ success: true, result: { Writer: 'First-issue writer', Penciller: 'First-issue artist', Title: 'Wrong title' } });
    await tick();
    assert.equal(h.results()[0].coverCacheUrl, undefined);
    assert.equal(h.results()[0].coverUrl, 'https://images.test/detail.jpg');
    assert.equal(h.results()[0].metadata.Writer, 'Detail writer');
    assert.equal(h.results()[0].metadata.Penciller, 'First-issue artist');
    assert.equal(h.results()[0].metadata.Summary, 'Full detail');
    assert.equal(h.results()[0].title, 'Volume 1');
    assert.equal(h.results()[0].comicVineDetailResolved, true);
    h.covers[1].resolve({ coverCacheUrl: 'bookmanager-thumbnail://detail' });
    await tick();
    assert.equal(h.results()[0].coverCacheUrl, 'bookmanager-thumbnail://detail');
});

test('deferred thumbnails use placeholders until local images are ready without triggering separate remote loads', () => {
    assert.equal(comicVineSearchThumbnail(result(1)), '');
    assert.equal(comicVineSearchThumbnail(result(1, { coverCacheUrl: 'bookmanager-thumbnail://1' })), 'bookmanager-thumbnail://1');
    assert.equal(comicVineSearchThumbnail(result(1, { coverUrl: 'data:image/png;base64,image' })), 'data:image/png;base64,image');
    assert.equal(comicVineSearchThumbnail({ coverUrl: 'https://images.test/other.jpg' }), 'https://images.test/other.jpg');
});

test('a newly found writer replaces the artist fallback in the common author alias', () => {
    const updated = mergeComicVineSearchEnrichment(result(1, { author: 'Known artist', metadata: { Penciller: 'Known artist' } }), {
        kind: 'credits', result: { Writer: 'New writer', Penciller: 'Different artist' },
    });
    assert.equal(updated.Writer, 'New writer');
    assert.equal(updated.Penciller, 'Known artist');
    assert.equal(updated.author, 'New writer');
});

test('a cached first-issue response cannot fill a result whose fresh detail identifies a different first issue', async () => {
    const h = harness([result(1)]);
    h.worker.enqueue(h.results());
    await tick();
    h.replace([result(1, { comicVineFirstIssueId: '201' })]);
    await tick();
    assert.deepEqual(h.credits.map(request => request.issueId), ['101', '201']);
    h.credits[0].resolve({ success: true, result: { Writer: 'Old issue writer', comicVineCreditsIssueId: '101' } });
    await tick();
    assert.equal(h.results()[0].Writer, undefined);
    assert.equal(h.results()[0].comicVineCreditsResolved, undefined);
    h.credits[1].resolve({ success: true, result: { Writer: 'Current issue writer', comicVineCreditsIssueId: '201' } });
    await tick();
    assert.equal(h.results()[0].Writer, 'Current issue writer');
    assert.equal(h.results()[0].comicVineCreditsIssueId, '201');
    h.worker.cancel();
});

test('search callback completes and exposes summary rows before any background promise settles', async () => {
    const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('const fetchMetadataResults = useCallback(');
    const callback = source.slice(start, source.indexOf('const handleSearchApi =', start));
    let state;
    let requestedOptions;
    const context = vm.createContext({
        apiSource: 'Vine', searchQuery: '', apiSearchRequestRef: { current: 0 }, activeBookType: 'comic',
        config: { api_keys: { vine: 'configured' } }, selectApiSource() {}, useCallback: value => value,
        apiSourceHasRequiredKey, searchMetadata, text: (_, fallback) => fallback,
        setApiSearch: value => { state = value; },
        window: { electronAPI: { fetchMetadata: async options => { requestedOptions = options; return { success: true, results: [result(1)] }; } } },
    });
    vm.runInContext(`${callback}\nglobalThis.search = fetchMetadataResults;`, context);
    await context.search({ source: 'Vine', query: 'Volume' });
    assert.equal(requestedOptions.deferComicVineEnrichment, true);
    assert.equal(state.loading, false);
    assert.equal(state.results.length, 1);
    assert.equal(state.results[0].comicVineEnrichmentDeferred, true);
    const h = harness(state.results);
    h.worker.enqueue(h.results());
    await tick();
    assert.equal(h.credits.length, 1);
    assert.equal(h.covers.length, 1);
    assert.equal(state.loading, false);
    assert.equal(state.results[0].title, 'Volume 1');
    h.worker.cancel();
});

test('the dialog lifecycle cancels background updates after a new search, close, or unmount', async () => {
    const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
    const marker = source.indexOf('if (!apiSearch.open || apiSearch.loading)');
    const effects = source.slice(source.lastIndexOf('useEffect(() => {', marker), source.indexOf('const fetchMetadataResults =', marker));
    for (const transition of ['search', 'close', 'unmount']) {
        let state = { open: true, loading: false, requestId: 1, apiSource: 'Vine', results: [result(1), result(2), result(3), result(4)] };
        let cleanup;
        const requests = [];
        const requestRef = { current: 1 };
        const context = vm.createContext({
            apiSearchRequestRef: requestRef, comicVineEnrichmentRef: { current: null },
            createComicVineSearchEnricher, mergeComicVineSearchEnrichment, metadataSearchResultKey,
            setApiSearch: update => { state = update(state); },
            useEffect: callback => { const result = callback(); if (typeof result === 'function') cleanup = result; },
            window: { electronAPI: {
                fetchComicVineCredits: () => { const request = { ...deferred(), kind: 'credits' }; requests.push(request); return request.promise; },
                cacheMetadataRemoteCover: () => { const request = { ...deferred(), kind: 'cover' }; requests.push(request); return request.promise; },
            } },
        });
        vm.runInContext(`globalThis.render = function(apiSearch) { ${effects} };`, context);
        context.render(state);
        await tick();
        assert.equal(requests.length, 5);
        if (transition === 'unmount') cleanup();
        else {
            requestRef.current += 1;
            state = { ...state, open: transition !== 'close', requestId: 2,
                results: transition === 'search' ? [result(1, { title: 'Replacement', comicVineFirstIssueId: '', coverUrl: '' })] : state.results };
            context.render(state);
        }
        const before = state;
        for (const request of requests) request.resolve(request.kind === 'credits'
            ? { success: true, result: { Writer: 'Late writer' } }
            : { coverCacheUrl: 'bookmanager-thumbnail://late' });
        await tick();
        assert.equal(state, before);
        assert.equal(requests.length, 5);
    }
});

test('completed creators and shared cached images do not cause duplicate background requests', async () => {
    const original = result(1, { metadata: { Writer: 'Known writer', Penciller: 'Known artist' } });
    const h = harness([original, result(2, { comicVineFirstIssueId: '', coverUrl: original.coverUrl })]);
    h.worker.enqueue(h.results());
    await tick();
    assert.equal(h.credits.length, 0);
    assert.equal(h.covers.length, 1);
    h.covers[0].resolve({ coverCacheUrl: 'bookmanager-thumbnail://shared' });
    await tick();
    assert.ok(h.results().every(item => item.coverCacheUrl === 'bookmanager-thumbnail://shared'));
    h.worker.enqueue(h.results());
    await tick();
    assert.equal(h.covers.length, 1);
});

const blankCover = 'https://comicvine.gamespot.com/a/uploads/scale_large/11111/11111/6373148-blank.png';

test('known Comic Vine blank covers are hidden even when an older search cached the image', () => {
    for (const url of [blankCover, `${blankCover}?download=1#image`, blankCover.replace('comicvine.gamespot.com/a', 'comicvine1.cbsistatic.com')]) {
        assert.equal(isComicVinePlaceholderCover(url), true);
        assert.equal(comicVineSearchThumbnail(result(1, { coverUrl: url, coverCacheUrl: 'bookmanager-thumbnail://cached-blank' })), '');
    }
    assert.equal(isComicVinePlaceholderCover('https://images.test/6373148-blank.png'), false);
    assert.equal(isComicVinePlaceholderCover('not a URL'), false);
    assert.equal(isComicVinePlaceholderCover(blankCover.replace('6373148-blank.png', '6373148-cover.png')), false);
});

test('a single independent batch repairs all missing and old cached placeholder covers before downloading them', async () => {
    const h = harness(Array.from({ length: 10 }, (_, index) => result(index + 1, index % 2
        ? { coverUrl: '', CoverUrls: [] }
        : { coverUrl: blankCover, CoverUrls: [blankCover], coverCacheUrl: 'bookmanager-thumbnail://cached-blank' })));
    h.worker.enqueue(h.results());
    await tick();
    assert.equal(h.sources.length, 1);
    assert.deepEqual(h.sources[0].ids, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    assert.equal(h.credits.length, 2);
    assert.equal(h.covers.length, 0);
    h.sources[0].resolve({ success: true, results: h.results().map(item => ({ ID: String(item.id),
        coverUrl: `https://images.test/real-${item.id}.jpg`, CoverUrls: [`https://images.test/real-${item.id}.jpg`],
        metadata: { Publisher: 'Publisher', Count: 2 } })) });
    await tick();
    assert.equal(h.sources.length, 1);
    assert.equal(h.covers.length, 3);
    assert.equal(h.credits.length, 2);
    assert.ok(h.results().every(item => item.coverUrl === `https://images.test/real-${item.id}.jpg` && item.coverCacheUrl === ''));
    assert.ok(h.results().every(item => item.publisher === 'Publisher' && item.metadata.Count === 2));
    h.covers[0].resolve({ coverCacheUrl: 'bookmanager-thumbnail://real-1' });
    await tick();
    assert.equal(h.results()[0].coverCacheUrl, 'bookmanager-thumbnail://real-1');
    assert.equal(h.covers.length, 4);
    h.worker.cancel();
});

test('credits arrive while cover addresses are pending and late addresses preserve selected detail data', async () => {
    const h = harness([result(1, { coverUrl: blankCover }), result(2, { coverUrl: '' })]);
    h.worker.enqueue(h.results());
    await tick();
    h.credits[1].resolve({ success: true, result: { Writer: 'Independent writer' } });
    await tick();
    assert.equal(h.results()[1].Writer, 'Independent writer');
    h.replace([result(1, { coverUrl: 'https://images.test/selected-detail.jpg', coverCacheUrl: 'bookmanager-thumbnail://selected-detail',
        publisher: 'Detail publisher', Publisher: 'Detail publisher', Count: 9,
        metadata: { Publisher: 'Detail publisher', Count: 9 }, comicVineDetailResolved: true }), h.results()[1]]);
    h.sources[0].resolve({ success: true, results: [{ ID: '1', coverUrl: 'https://images.test/batch.jpg', metadata: { Publisher: 'Batch publisher', Count: 1 } },
        { ID: '2', coverUrl: 'https://images.test/other.jpg' }, { ID: '999', coverUrl: 'https://images.test/unrequested.jpg' }] });
    await tick();
    assert.equal(h.results()[0].coverUrl, 'https://images.test/selected-detail.jpg');
    assert.equal(h.results()[0].coverCacheUrl, 'bookmanager-thumbnail://selected-detail');
    assert.equal(h.results()[0].metadata.Publisher, 'Detail publisher');
    assert.equal(h.results()[0].metadata.Count, 9);
    assert.equal(h.results()[0].comicVineDetailResolved, true);
    assert.equal(h.results()[1].coverUrl, 'https://images.test/other.jpg');
    assert.equal(h.results()[1].Writer, 'Independent writer');
    assert.equal(h.results()[1].comicVineDetailResolved, undefined);
    assert.deepEqual(h.covers.map(item => item.url), ['https://images.test/other.jpg']);
    h.worker.cancel();
});

test('cover address lookup batches ten items, deduplicates failures, and retries only on a new search', async () => {
    const entries = Array.from({ length: 12 }, (_, index) => result(index + 1, { coverUrl: '', comicVineFirstIssueId: '' }));
    const h = harness(entries);
    h.worker.enqueue(h.results());
    assert.equal(h.sources.length, 1);
    assert.equal(h.sources[0].ids.length, 10);
    h.sources[0].reject(new Error('Unavailable'));
    await tick();
    assert.equal(h.sources.length, 2);
    assert.deepEqual(h.sources[1].ids, ['11', '12']);
    h.sources[1].resolve({ success: false, code: 'API_REQUEST_FAILED' });
    await tick();
    h.worker.enqueue(h.results());
    await tick();
    assert.equal(h.sources.length, 2);
    const next = harness(entries);
    next.worker.enqueue(next.results());
    assert.equal(next.sources.length, 1);
    h.worker.cancel();
    next.worker.cancel();
});

test('closing or replacing a search stops queued cover batches and ignores their late updates', async () => {
    for (const cancel of ['cancel', 'worker']) {
        const h = harness(Array.from({ length: 12 }, (_, index) => result(index + 1, { coverUrl: '', comicVineFirstIssueId: '' })));
        h.worker.enqueue(h.results());
        if (cancel === 'cancel') h.cancel();
        else h.worker.cancel();
        h.sources[0].resolve({ success: true, results: [{ ID: '1', coverUrl: 'https://images.test/late.jpg' }] });
        await tick();
        assert.equal(h.sources.length, 1);
        assert.equal(h.covers.length, 0);
        assert.equal(h.patches.length, 0);
    }
});
