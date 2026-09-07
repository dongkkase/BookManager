import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { apiSourceHasRequiredKey, UNIFIED_METADATA_API_SOURCE } from './metadataApiPolicy.js';
import { metadataSearchResultKey, searchMetadata } from './metadataSearch.js';

const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');

function fragment(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `Missing callback boundaries: ${startMarker}`);
    return source.slice(start, end);
}

const searchCallback = fragment('const fetchMetadataResults = useCallback(', 'const handleSearchApi =');
const closeCallback = fragment('const closeApiSearch = useCallback(', 'const [taskPhase,');
const detailCallback = fragment('const resolveRidiPublishDate = useCallback(', 'const handleLoadLatest =');
const coverFunctions = fragment('function apiResultCoverUrl(', 'function isEpubFilePath(');
const useCoverCallback = fragment('const handleUseApiCoverResult = async (', 'const filenameStem =');
const clearCacheCallback = fragment('const runSearch = (', 'const toggleTranslation =');
const dialogRequestEffectStart = source.lastIndexOf('useEffect(() => {', source.indexOf('return () => { dialogRequestRef.current = null; };'));
const dialogRequestEffect = source.slice(dialogRequestEffectStart, source.indexOf('const resolvingRidiDates =', dialogRequestEffectStart));
const translationCallback = fragment('const toggleTranslation = async () => {', 'const text = (key, fallback, values) => {');
const translationEffectStart = source.lastIndexOf('useEffect(() => {', source.indexOf('translationRequestRef.current += 1;'));
const translationEffect = source.slice(translationEffectStart, source.indexOf('useEffect(() => {', translationEffectStart + 1));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function searchHarness({ initialState = {}, fetchDetail, cacheCover } = {}) {
    let state = { open: false, results: [], ...initialState };
    const requests = [];
    const selectedSources = [];
    const coverChanges = [];
    const context = vm.createContext({
        apiSource: UNIFIED_METADATA_API_SOURCE,
        apiSearch: initialState,
        searchQuery: '',
        activeBookType: 'book',
        activeItem: { filepath: '/novel.txt' },
        activeIsTxt: true,
        activeIsEpub: false,
        config: { api_keys: { yes24: 'enabled', aladin: 'enabled', google: 'enabled', vine: 'enabled' } },
        apiSearchRequestRef: { current: 0 },
        apiSourceHasRequiredKey,
        searchMetadata,
        metadataSearchResultKey,
        useCallback: callback => callback,
        selectApiSource: value => selectedSources.push(value),
        setApiSearch: update => { state = typeof update === 'function' ? update(state) : update; },
        setStatusMessage: () => {},
        updateActiveTxtCoverChange: (...args) => coverChanges.push(args),
        showToast: () => {},
        text: (key, fallback) => fallback,
        window: {
            electronAPI: {
                fetchMetadata: options => {
                    const request = { ...deferred(), options };
                    requests.push(request);
                    return request.promise;
                },
                fetchRidiBookDetail: fetchDetail,
                cacheMetadataRemoteCover: cacheCover,
            },
        },
    });
    vm.runInContext(`${searchCallback}\n${closeCallback}\n${detailCallback}\n${coverFunctions}\n${useCoverCallback}
        globalThis.callbacks = { fetchMetadataResults, closeApiSearch, resolveRidiPublishDate, apiResultCoverUrlForUse, handleUseApiCoverResult };
    `, context);
    return { ...context.callbacks, requests, selectedSources, coverChanges, state: () => state };
}

for (const staleOutcome of ['success', 'failure']) {
    test(`a newer metadata search retains its results after an older ${staleOutcome}`, async () => {
        const h = searchHarness();
        const oldSearch = h.fetchMetadataResults({ source: '리디북스', query: '이전 검색어' });
        const newSearch = h.fetchMetadataResults({ source: '문피아', query: '새 검색어' });
        assert.equal(h.state().loading, true);
        h.requests[1].resolve({ success: true, results: [{ id: 7, title: '새 검색어' }] });
        await newSearch;
        const freshState = h.state();
        if (staleOutcome === 'success') {
            h.requests[0].resolve({ success: true, results: [{ id: 8, title: '이전 검색어' }] });
        } else {
            h.requests[0].reject(new Error('Old search failed'));
        }
        await oldSearch;
        assert.equal(h.state(), freshState);
        assert.equal(h.state().query, '새 검색어');
        assert.equal(h.state().loading, false);
        assert.equal(h.state().results[0].apiSource, '문피아');
        assert.equal(h.state().error, '');
    });
}

test('closing unified search stops queued providers and late responses leave the dialog closed', async () => {
    const h = searchHarness();
    const search = h.fetchMetadataResults({ source: UNIFIED_METADATA_API_SOURCE, query: '수선전' });
    assert.equal(h.requests.length, 3);
    assert.equal(h.state().open, true);
    h.closeApiSearch();
    const closedState = h.state();
    assert.equal(closedState.open, false);
    assert.equal(closedState.loading, false);
    for (const request of h.requests) {
        request.resolve({ success: true, results: [{ id: 7, title: '수선전' }] });
    }
    await search;
    assert.equal(h.requests.length, 3);
    assert.equal(h.state(), closedState);
    assert.equal(h.state().results.length, 0);
});

test('unified results with matching provider ids only receive their own Ridi details', async () => {
    const ridi = { apiSource: '리디북스', id: 42, title: '리디 작품', metadata: { Writer: '리디 작가' } };
    const munpia = { apiSource: '문피아', id: 42, title: '문피아 작품', metadata: { Writer: '문피아 작가' } };
    const requestedIds = [];
    const h = searchHarness({
        initialState: { apiSource: UNIFIED_METADATA_API_SOURCE, results: [ridi, munpia] },
        fetchDetail: async id => {
            requestedIds.push(id);
            return { ISBN: '9781234567890', PubDate: '2025-03-04' };
        },
    });
    await h.resolveRidiPublishDate(ridi);
    assert.deepEqual(requestedIds, [42]);
    const [updatedRidi, unchangedMunpia] = h.state().results;
    assert.equal(updatedRidi.PubDate, '2025-03-04');
    assert.equal(updatedRidi.metadata.ISBN, '9781234567890');
    assert.equal(updatedRidi.metadata.Month, '3');
    assert.equal(updatedRidi.metadata.Day, '4');
    assert.equal(updatedRidi.metadata.Writer, '리디 작가');
    assert.equal(updatedRidi.ridiDetailResolved, true);
    assert.equal(unchangedMunpia, munpia);
});

test('Ridi details finishing after a new search cannot modify that search even when ids match', async () => {
    const detail = deferred();
    const ridi = { apiSource: '리디북스', id: 42, title: '이전 작품' };
    const h = searchHarness({
        initialState: { apiSource: UNIFIED_METADATA_API_SOURCE, results: [ridi] },
        fetchDetail: () => detail.promise,
    });
    const resolving = h.resolveRidiPublishDate(ridi);
    const searching = h.fetchMetadataResults({ source: '리디북스', query: '다른 작품' });
    h.requests[0].resolve({ success: true, results: [{ id: 42, title: '다른 작품' }] });
    await searching;
    const freshState = h.state();
    detail.resolve({ ISBN: '9781234567890', PubDate: '2025-03-04' });
    await resolving;
    assert.equal(h.state(), freshState);
    assert.equal(h.state().results[0].ISBN, undefined);
});

test('unified covers use each result provider to select the Ridi original cover', () => {
    const h = searchHarness();
    const ridi = { apiSource: '리디북스', id: 42, coverUrl: 'https://img.ridicdn.net/cover/42/small' };
    const munpia = { apiSource: '문피아', id: 42, coverUrl: 'https://cdn.munpia.com/cover/42.png' };
    assert.equal(h.apiResultCoverUrlForUse(ridi, UNIFIED_METADATA_API_SOURCE), 'https://img.ridicdn.net/cover/42/xxlarge?dpi=xxhdpi#1');
    assert.equal(h.apiResultCoverUrlForUse(munpia, UNIFIED_METADATA_API_SOURCE), munpia.coverUrl);
    assert.equal(h.apiResultCoverUrlForUse(munpia, '리디북스'), munpia.coverUrl);
    assert.equal(h.apiResultCoverUrlForUse({ id: 42 }, '리디북스'), 'https://img.ridicdn.net/cover/42/xxlarge?dpi=xxhdpi#1');
});

test('an API cover download closes its own search but leaves a newer search open', async () => {
    for (const startNewSearch of [false, true]) {
        const cover = deferred();
        const h = searchHarness({
            initialState: { open: true, apiSource: UNIFIED_METADATA_API_SOURCE },
            cacheCover: () => cover.promise,
        });
        const selectingCover = h.handleUseApiCoverResult({
            apiSource: '문피아',
            id: 42,
            title: '선택한 작품',
            coverUrl: 'https://cdn.munpia.com/cover/42.png',
        });
        if (startNewSearch) {
            const searching = h.fetchMetadataResults({ source: '문피아', query: '새 검색어' });
            h.requests[0].resolve({ success: true, results: [{ id: 77, title: '새 검색어' }] });
            await searching;
        }
        cover.resolve({ filePath: '/cache/42.png', coverCacheUrl: 'book-cover://42' });
        await selectingCover;
        assert.equal(h.coverChanges.length, 1);
        assert.equal(h.coverChanges[0][0].filePath, '/cache/42.png');
        assert.equal(h.state().open, startNewSearch);
        if (startNewSearch) {
            assert.equal(h.state().query, '새 검색어');
            assert.equal(h.state().results[0].id, 77);
        }
    }
});

test('clearing API cache only refreshes the search that initiated it while that dialog remains open', async () => {
    for (const transition of ['unchanged', 'new search', 'closed']) {
        const clearing = deferred();
        const searches = [];
        let cleanup;
        const context = vm.createContext({
            state: { requestId: 1 },
            dialogRequestRef: { current: 1 },
            dialogApi: UNIFIED_METADATA_API_SOURCE,
            dialogQuery: '수선전',
            clearingCache: false,
            setClearingCache: () => {},
            setCacheError: () => {},
            showToast: () => {},
            text: (key, fallback) => fallback,
            onSearch: options => searches.push(options),
            useEffect: effect => { cleanup = effect(); },
            window: { electronAPI: { clearApiCache: () => clearing.promise } },
        });
        vm.runInContext(`${dialogRequestEffect}\n${clearCacheCallback}\nglobalThis.clearCache = clearSearchCache;`, context);
        const clearCache = context.clearCache();
        if (transition === 'closed') {
            cleanup();
        } else if (transition === 'new search') {
            cleanup();
            context.state = { requestId: 2 };
            vm.runInContext(dialogRequestEffect, context);
        }
        clearing.resolve({ success: true });
        await clearCache;
        assert.equal(searches.length, transition === 'unchanged' ? 1 : 0, transition);
        if (searches.length) {
            assert.equal(searches[0].source, UNIFIED_METADATA_API_SOURCE);
            assert.equal(searches[0].query, '수선전');
            assert.equal(searches[0].page, 1);
        }
    }
});

function translationHarness() {
    const values = { translatedResult: null, showTranslated: false, translating: false, translationError: '' };
    const requests = [];
    let dependencies;
    let cleanup;
    const context = vm.createContext({
        translationRequestRef: { current: 0 },
        metadataSearchResultKey,
        text: (key, fallback) => fallback,
        setTranslatedResult: value => { values.translatedResult = value; },
        setShowTranslated: value => { values.showTranslated = value; },
        setTranslating: value => { values.translating = value; },
        setTranslationError: value => { values.translationError = value; },
        useEffect: (effect, nextDependencies) => {
            if (dependencies && nextDependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
            cleanup?.();
            dependencies = nextDependencies;
            cleanup = effect();
        },
        window: {
            electronAPI: {
                translateMetadata: result => {
                    const request = { ...deferred(), result };
                    requests.push(request);
                    return request.promise;
                },
            },
        },
    });
    vm.runInContext(`globalThis.render = function(rawSelected, values, state) {
        const { translatedResult, showTranslated, translating } = values;
        const selectedResultKey = metadataSearchResultKey(rawSelected, state.apiSource);
        ${translationEffect}
        ${translationCallback}
        return toggleTranslation;
    };`, context);
    return {
        requests,
        values,
        render: result => {
            const state = { apiSource: UNIFIED_METADATA_API_SOURCE, query: '작품', page: 1 };
            context.render(result, values, state);
            return context.render(result, values, state);
        },
        dispose: () => cleanup?.(),
    };
}

for (const staleOutcome of ['success', 'failure']) {
    test(`translation ${staleOutcome} for a previous provider cannot alter the newly selected result`, async () => {
        const h = translationHarness();
        const ridi = { apiSource: '리디북스', id: 42, title: 'Ridi title' };
        const munpia = { apiSource: '문피아', id: 42, title: 'Munpia title' };
        const oldTranslation = h.render(ridi)();
        const newTranslation = h.render(munpia)();
        assert.equal(h.requests.length, 2);
        if (staleOutcome === 'success') {
            h.requests[0].resolve({ success: true, result: { id: 'wrong id', title: '이전 번역' } });
        } else {
            h.requests[0].reject(new Error('Previous translation failed'));
        }
        await oldTranslation;
        assert.equal(h.values.translatedResult, null);
        assert.equal(h.values.showTranslated, false);
        assert.equal(h.values.translating, true);
        assert.equal(h.values.translationError, '');
        h.requests[1].resolve({ success: true, result: { id: 'wrong id', apiSource: 'wrong provider', title: '새 번역' } });
        await newTranslation;
        assert.equal(h.values.translatedResult.key, metadataSearchResultKey(munpia));
        assert.equal(h.values.translatedResult.result.title, '새 번역');
        assert.equal(h.values.translatedResult.result.id, 42);
        assert.equal(h.values.translatedResult.result.apiSource, '문피아');
        assert.equal(h.values.showTranslated, true);
        assert.equal(h.values.translating, false);
    });
}

test('closing a search dialog invalidates its pending translation', async () => {
    const h = translationHarness();
    const translating = h.render({ apiSource: '문피아', id: 42, title: 'Novel' })();
    h.dispose();
    h.requests[0].resolve({ success: true, result: { title: '늦은 번역' } });
    await translating;
    assert.equal(h.values.translatedResult, null);
    assert.equal(h.values.showTranslated, false);
    assert.equal(h.values.translationError, '');
});
