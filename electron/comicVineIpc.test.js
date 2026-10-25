import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { additionalMetadataErrorMessage, createAdditionalMetadataContext } from './additionalMetadataProviders.js';
import { BoundedMemoryCache } from './boundedMemoryCache.js';
import { isMetadataApiSourceEnabled } from './metadataProviderSettings.js';
import { setLanguage, t } from './utils/i18n.js';

setLanguage('ko');
const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const volume = {
    ID: '123',
    Title: 'Sample Comic',
    Series: 'Sample Comic',
    Publisher: 'Sample Press',
    Summary: 'A comic series.',
    CoverUrl: 'https://comicvine.gamespot.com/a/uploads/scale_large/1/123/456-cover.jpg',
    Web: 'https://comicvine.gamespot.com/sample-comic/4050-123/',
    Year: '2024',
    Count: '20',
    Format: 'Comic',
    comicVineVolumeId: '123',
};

function sourceFunction(name) {
    const start = ipcSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const prefix = ipcSource.slice(start - 6, start) === 'async ' ? 'async ' : '';
    return prefix + ipcSource.slice(start, ipcSource.indexOf('\n}', start) + 2);
}

function sourceHandler(channel) {
    const start = ipcSource.indexOf(`ipcMain.handle('${channel}',`);
    assert.ok(start >= 0, channel);
    const following = ipcSource.slice(start + 1).search(/\n[ \t]*ipcMain\.handle\(/);
    assert.ok(following >= 0, `${channel} handler end`);
    return ipcSource.slice(start, start + 1 + following);
}

function createHarness({
    initialConfig = { api_keys: { vine: 'private-vine-key' } },
    search = async () => Object.assign([{ ...volume }], { hasNext: false }),
    detail = async () => ({ ...volume, Writer: 'Sample Writer', Penciller: 'Sample Artist', Characters: 'Sample Hero' }),
    credits = async () => ({
        ID: '123',
        Writer: 'Sample Writer',
        Penciller: 'Sample Artist',
        comicVineCreditsIssueId: '456',
        comicVineCreditsIssueNumber: '1',
    }),
    covers = async () => [{
        ID: '123',
        CoverUrl: volume.CoverUrl,
        CoverUrls: [volume.CoverUrl],
        Publisher: volume.Publisher,
        Count: volume.Count,
    }],
} = {}) {
    const helpers = [
        'normalizeApiSource', 'normalizeSearchBookType', 'isMetadataApiAllowedForBookType',
        'normalizeSearchResult', 'stripTransientApiImageFields', 'stripTransientApiImageFieldsFromResults',
        'metadataFormatForBookType', 'mangaValueForBookType', 'parseDateParts', 'searchVine',
    ].map(sourceFunction).join('\n');
    const harness = {
        config: initialConfig,
        handlers: new Map(),
        cached: new Map(),
        detailCache: new BoundedMemoryCache({ maxEntries: 128, maxBytes: 8 * 1024 * 1024 }),
        cacheQueries: [],
        searchCalls: [],
        detailCalls: [],
        creditsCalls: [],
        coversCalls: [],
        imageCalls: [],
        logs: [],
        opened: 0,
        closed: 0,
    };
    const requestJson = async () => { throw new Error('Unexpected direct JSON request'); };
    harness.requestJson = requestJson;
    vm.runInNewContext(`${helpers}\n${sourceHandler('api:fetch')}\n${sourceHandler('api:comicVineDetail')}\n${sourceHandler('api:comicVineCredits')}\n${sourceHandler('api:comicVineCovers')}`, {
        ipcMain: { handle(name, callback) { harness.handlers.set(name, callback); } },
        configManager: { getConfig: () => harness.config },
        isMetadataApiSourceEnabled,
        createAdditionalMetadataContext,
        additionalMetadataErrorMessage,
        searchComicVine: async (...args) => { harness.searchCalls.push(args); return search(...args); },
        getComicVineVolume: async (...args) => { harness.detailCalls.push(args); return detail(...args); },
        getComicVineCreators: async (...args) => { harness.creditsCalls.push(args); return credits(...args); },
        getComicVineVolumeCovers: async (...args) => { harness.coversCalls.push(args); return covers(...args); },
        comicVineDetailCache: harness.detailCache,
        searchGoogleBooks: async () => [{ id: 'google-1', title: 'Sample Book' }],
        requestJsonGeneric: requestJson,
        i18nT: t,
        metadataSearchLog: (...args) => harness.logs.push(args),
        openApiCacheDbSafe: () => { harness.opened += 1; return { close() { harness.closed += 1; } }; },
        getCachedApiResults: (_db, api, query) => {
            harness.cacheQueries.push({ api, query });
            return harness.cached.get(`${api}:${query}`);
        },
        setCachedApiResults: async (_db, api, query, results) => {
            harness.cached.set(`${api}:${query}`, JSON.parse(JSON.stringify(results)));
        },
        apiCoverCacheDir: () => 'cover-cache',
        enrichResultImages: async (results, directory) => {
            harness.imageCalls.push({ results, directory });
            return results.map(item => ({ ...item, coverCacheUrl: 'transient-cover' }));
        },
    });
    harness.fetch = options => harness.handlers.get('api:fetch')({}, options);
    harness.detail = (id, options) => harness.handlers.get('api:comicVineDetail')({}, id, options);
    harness.credits = (id, firstIssueId) => harness.handlers.get('api:comicVineCredits')({}, id, firstIssueId);
    harness.covers = ids => harness.handlers.get('api:comicVineCovers')({}, ids);
    return harness;
}

test('Comic Vine aliases use the adapter and preserve normalized volume metadata and cover URLs', async () => {
    const harness = createHarness();
    const result = await harness.fetch({ apiSource: 'comicvine', query: ' Sample ', bookType: 'comic', page: 2 });
    assert.equal(result.success, true, result.error);
    assert.equal(result.api, 'Vine');
    assert.equal(result.actualQuery, 'Sample');
    assert.equal(result.cached, false);
    assert.equal(harness.searchCalls.length, 1);
    assert.deepEqual(harness.searchCalls[0].slice(0, 3), ['Sample', 'private-vine-key', 2]);
    assert.equal(harness.searchCalls[0][3], harness.requestJson);
    const item = result.results[0];
    assert.equal(item.id, '123');
    assert.equal(item.title, 'Sample Comic');
    assert.equal(item.publisher, 'Sample Press');
    assert.equal(item.coverUrl, volume.CoverUrl);
    assert.equal(item.coverCacheUrl, 'transient-cover');
    assert.equal(item.metadata.Summary, volume.Summary);
    assert.equal(item.metadata.Year, '2024');
    assert.equal(item.metadata.Count, '20');
    assert.equal(item.metadata.Format, 'Comic');
    assert.equal(item.comicVineVolumeId, '123');
    assert.equal(item.identifiedSearchQuery, 'Sample');
    assert.equal(harness.opened, harness.closed);
});

test('Comic Vine search returns creators and issue provenance before detail selection and preserves them in cache', async () => {
    const creators = {
        Writer: 'Sample Writer',
        Penciller: 'Sample Artist',
        comicVineCreditsIssueId: '456',
        comicVineCreditsIssueNumber: '1',
        comicVineCreditsIssueWeb: 'https://comicvine.gamespot.com/issue/4000-456/',
    };
    const harness = createHarness({ search: async () => Object.assign([{ ...volume, ...creators }], { hasNext: false }) });
    const options = { api: 'Vine', query: 'Sample', bookType: 'comic' };
    for (const cached of [false, true]) {
        const response = await harness.fetch(options);
        assert.equal(response.success, true, response.error);
        assert.equal(response.cached, cached);
        const result = response.results[0];
        assert.equal(result.author, creators.Writer);
        assert.equal(result.metadata.Writer, creators.Writer);
        assert.equal(result.metadata.Penciller, creators.Penciller);
        assert.equal(result.comicVineCreditsIssueId, creators.comicVineCreditsIssueId);
        assert.equal(result.comicVineCreditsIssueNumber, creators.comicVineCreditsIssueNumber);
        assert.equal(result.comicVineCreditsIssueWeb, creators.comicVineCreditsIssueWeb);
        assert.equal(harness.detailCalls.length, 0);
    }
    assert.equal(harness.searchCalls.length, 1);
    assert.equal(harness.opened, harness.closed);
});

test('Comic Vine hasNext survives full search pages and cached responses without transient cover fields', async () => {
    for (const hasNext of [false, true]) {
        const harness = createHarness({ search: async () => Object.assign(
            Array.from({ length: 20 }, (_, index) => ({ ...volume, ID: String(index + 1) })),
            { hasNext },
        ) });
        const options = { api: 'Vine', query: 'Sample', bookType: 'comic' };
        const first = await harness.fetch(options);
        assert.equal(first.success, true, first.error);
        assert.equal(first.results.length, 20);
        assert.equal(first.hasNext, hasNext);
        assert.ok(first.results.every(item => item.metadataProviderHasNext === hasNext));
        assert.equal(first.cached, false);
        const [cacheKey, saved] = [...harness.cached][0];
        assert.equal(cacheKey, 'Vine:comic::Sample::p1::v17::comicvine-v5');
        assert.ok(saved.every(item => item.metadataProviderHasNext === hasNext));
        assert.ok(saved.every(item => item.coverCacheUrl === undefined));
        assert.ok(!cacheKey.includes('private-vine-key'));
        const cached = await harness.fetch(options);
        assert.equal(cached.success, true, cached.error);
        assert.equal(cached.cached, true);
        assert.equal(cached.hasNext, hasNext);
        assert.equal(cached.results[0].coverCacheUrl, 'transient-cover');
        assert.equal(harness.searchCalls.length, 1);
        assert.equal(harness.opened, harness.closed);
    }
});

test('Comic Vine bypasses stale search entries while other providers retain their cache keys', async () => {
    const harness = createHarness();
    harness.cached.set('Vine:comic::Sample::p1::v17', [{ id: 'stale', title: 'Outdated cover' }]);
    harness.cached.set('Vine:comic::Sample::p1::v17::comicvine-v2', [{ id: 'missing-creators', title: 'Missing creator information' }]);
    harness.cached.set('Vine:comic::Sample::p1::v17::comicvine-v3', [{ id: 'missing-first-issue', title: 'Missing first issue information' }]);
    harness.cached.set('Vine:comic::Sample::p1::v17::comicvine-v4', [{ id: 'placeholder-cover', title: 'Placeholder cover' }]);
    const vine = await harness.fetch({ api: 'Vine', query: 'Sample', bookType: 'comic' });
    assert.equal(vine.success, true, vine.error);
    assert.equal(vine.cached, false);
    assert.equal(vine.results[0].id, '123');
    assert.equal(harness.searchCalls.length, 1);
    const google = await harness.fetch({ api: 'Google Books', query: 'Sample', bookType: 'book' });
    assert.equal(google.success, true, google.error);
    assert.ok(harness.cached.has('Google Books:book::Sample::p1::v17'));
    assert.equal(harness.opened, harness.closed);
});

test('Comic Vine search keeps results when creator enrichment fails and retries instead of caching partial metadata', async () => {
    let attempts = 0;
    const harness = createHarness({ search: async () => {
        attempts += 1;
        return Object.assign([
            { ...volume, ID: '122', Writer: 'Known Writer', Penciller: 'Known Artist' },
            {
                ...volume,
                ...(attempts === 1
                    ? { comicVineCreditsError: 'API_RATE_LIMIT' }
                    : { Writer: 'Sample Writer', Penciller: 'Sample Artist' }),
            },
        ], { hasNext: true });
    } });
    const options = { api: 'Vine', query: 'Sample', bookType: 'comic' };
    const first = await harness.fetch(options);
    assert.equal(first.success, true, first.error);
    assert.equal(first.cached, false);
    assert.equal(first.hasNext, true);
    assert.equal(first.results.length, 2);
    assert.equal(first.results[0].metadata.Writer, 'Known Writer');
    assert.equal(first.results[1].id, '123');
    assert.equal(first.results[1].coverUrl, volume.CoverUrl);
    assert.equal(first.results[1].comicVineCreditsError, 'API_RATE_LIMIT');
    assert.equal(harness.cached.size, 0);
    const retry = await harness.fetch(options);
    assert.equal(retry.success, true, retry.error);
    assert.equal(retry.cached, false);
    assert.equal(retry.results[1].metadata.Writer, 'Sample Writer');
    assert.equal(retry.results[1].metadata.Penciller, 'Sample Artist');
    assert.equal(retry.results[1].comicVineCreditsError, undefined);
    assert.equal(harness.searchCalls.length, 2);
    assert.equal(harness.cached.size, 1);
    assert.equal((await harness.fetch(options)).cached, true);
    assert.equal(harness.searchCalls.length, 2);
    assert.equal(harness.detailCalls.length, 0);
    assert.equal(harness.opened, harness.closed);
});

test('Comic Vine search retries failed cover enrichment instead of persisting incomplete cover results', async () => {
    let attempts = 0;
    const harness = createHarness({ search: async () => {
        attempts += 1;
        return Object.assign([
            { ...volume, ID: '122' },
            {
                ...volume,
                Writer: 'Sample Writer',
                ...(attempts === 1
                    ? { CoverUrl: '', CoverUrls: [], comicVineCoversError: 'API_RATE_LIMIT' }
                    : { CoverUrls: [volume.CoverUrl] }),
            },
        ], { hasNext: false });
    } });
    const options = { api: 'Vine', query: 'Sample', bookType: 'comic' };
    const first = await harness.fetch(options);
    assert.equal(first.success, true, first.error);
    assert.equal(first.cached, false);
    assert.equal(first.results.length, 2);
    assert.equal(first.results[0].coverUrl, volume.CoverUrl);
    assert.equal(first.results[1].metadata.Writer, 'Sample Writer');
    assert.equal(first.results[1].comicVineCoversError, 'API_RATE_LIMIT');
    assert.equal(harness.cached.size, 0);
    const retry = await harness.fetch(options);
    assert.equal(retry.success, true, retry.error);
    assert.equal(retry.cached, false);
    assert.equal(retry.results[1].coverUrl, volume.CoverUrl);
    assert.equal(retry.results[1].comicVineCoversError, undefined);
    assert.equal(harness.searchCalls.length, 2);
    assert.equal(harness.cached.size, 1);
    const cached = await harness.fetch(options);
    assert.equal(cached.success, true, cached.error);
    assert.equal(cached.cached, true);
    assert.equal(cached.results[1].coverUrl, volume.CoverUrl);
    assert.equal(harness.searchCalls.length, 2);
    assert.equal(harness.opened, harness.closed);
});

test('deferred Comic Vine search returns fresh and cached summaries without waiting for creator or image enrichment', async () => {
    const harness = createHarness({ search: async () => Object.assign([
        { ...volume, comicVineFirstIssueId: '456' },
    ], { hasNext: true }) });
    const options = { api: 'Vine', query: 'Sample', bookType: 'comic', deferComicVineEnrichment: true };
    for (const cached of [false, true]) {
        const response = await harness.fetch(options);
        assert.equal(response.success, true, response.error);
        assert.equal(response.cached, cached);
        assert.equal(response.hasNext, true);
        assert.equal(response.results[0].id, '123');
        assert.equal(response.results[0].coverUrl, volume.CoverUrl);
        assert.equal(response.results[0].comicVineFirstIssueId, '456');
        assert.equal(response.results[0].coverCacheUrl, undefined);
        assert.equal(harness.imageCalls.length, 0);
        assert.equal(harness.detailCalls.length, 0);
        assert.equal(harness.creditsCalls.length, 0);
    }
    assert.equal(harness.searchCalls.length, 1);
    assert.equal(harness.searchCalls[0][4]?.deferCreators, true);
    assert.ok(harness.cached.has('Vine:comic::Sample::p1::v17::comicvine-v5::summary'));
    assert.equal(harness.opened, harness.closed);
});

test('deferred Comic Vine summaries cannot satisfy an eager search that needs creators and cached covers', async () => {
    const harness = createHarness();
    const options = { api: 'Vine', query: 'Sample', bookType: 'comic' };
    assert.equal((await harness.fetch({ ...options, deferComicVineEnrichment: true })).cached, false);
    const eager = await harness.fetch(options);
    assert.equal(eager.success, true, eager.error);
    assert.equal(eager.cached, false);
    assert.equal(eager.results[0].coverCacheUrl, 'transient-cover');
    assert.equal(harness.searchCalls.length, 2);
    assert.notEqual(harness.searchCalls[1][4]?.deferCreators, true);
    assert.equal(harness.imageCalls.length, 1);
    assert.equal((await harness.fetch(options)).cached, true);
    assert.equal(harness.imageCalls.length, 2);
    assert.equal(harness.cached.size, 2);
});

test('the Comic Vine defer option leaves other providers image enrichment and cache keys intact', async () => {
    const harness = createHarness();
    const response = await harness.fetch({
        api: 'Google Books', query: 'Sample', bookType: 'book', deferComicVineEnrichment: true,
    });
    assert.equal(response.success, true, response.error);
    assert.equal(response.results[0].coverCacheUrl, 'transient-cover');
    assert.equal(harness.imageCalls.length, 1);
    assert.ok(harness.cached.has('Google Books:book::Sample::p1::v17'));
});

test('missing or blank Comic Vine credentials reject before reading an existing search cache', async () => {
    const harness = createHarness();
    const options = { api: 'Vine', query: 'Sample', bookType: 'comic' };
    assert.equal((await harness.fetch(options)).success, true);
    const cacheReads = harness.cacheQueries.length;
    for (const key of ['', '   ']) {
        const result = await harness.fetch({ ...options, apiKeys: { vine: key } });
        assert.equal(result.success, false);
        assert.equal(result.cached, false);
        assert.equal(result.error, additionalMetadataErrorMessage({ code: 'API_AUTH_REQUIRED' }, 'Comic Vine', t));
        assert.equal(harness.cacheQueries.length, cacheReads);
        assert.equal(harness.searchCalls.length, 1);
    }
    assert.equal(harness.opened, harness.closed);
});

test('Comic Vine search errors are localized and exclude upstream bodies and credentials from results and logs', async () => {
    const secret = 'private-vine-key-do-not-log';
    for (const code of ['API_AUTH_FAILED', 'API_RATE_LIMIT', 'API_INVALID_RESPONSE', 'API_ACCESS_BLOCKED', 'UNEXPECTED']) {
        const harness = createHarness({
            initialConfig: { api_keys: { vine: secret } },
            search: async () => { throw Object.assign(new Error(`Server body api_key=${secret}`), { code, responseBody: secret }); },
        });
        const result = await harness.fetch({ api: 'Vine', query: 'Sample', bookType: 'comic' });
        assert.equal(result.success, false);
        assert.equal(result.cached, false);
        assert.equal(result.error, additionalMetadataErrorMessage({ code }, 'Comic Vine', t));
        assert.ok(!JSON.stringify(result).includes(secret));
        assert.ok(!JSON.stringify(harness.logs).includes(secret));
        assert.equal(harness.cached.size, 0);
        assert.equal(harness.opened, harness.closed);
    }
});

test('Comic Vine detail uses the saved key and returns normalized creators and enriched cover metadata', async () => {
    const harness = createHarness();
    const response = await harness.detail('123');
    assert.equal(response.success, true, response.error);
    assert.equal(harness.detailCalls.length, 1);
    assert.deepEqual(harness.detailCalls[0].slice(0, 2), ['123', 'private-vine-key']);
    assert.equal(harness.detailCalls[0][2], harness.requestJson);
    const result = response.result;
    assert.equal(result.id, '123');
    assert.equal(result.title, 'Sample Comic');
    assert.equal(result.author, 'Sample Writer');
    assert.equal(result.metadata.Writer, 'Sample Writer');
    assert.equal(result.metadata.Penciller, 'Sample Artist');
    assert.equal(result.metadata.Characters, 'Sample Hero');
    assert.equal(result.coverUrl, volume.CoverUrl);
    assert.equal(result.coverCacheUrl, 'transient-cover');
    assert.equal(harness.imageCalls[0].directory, 'cover-cache');
    assert.equal(harness.searchCalls.length, 0);
});

test('Comic Vine details can return fresh and cached metadata before cover downloads', async () => {
    const harness = createHarness();
    for (const cached of [false, true]) {
        const response = await harness.detail('123', { deferImages: true });
        assert.equal(response.success, true, response.error);
        assert.equal(response.cached, cached);
        assert.equal(response.result.metadata.Writer, 'Sample Writer');
        assert.equal(response.result.metadata.Penciller, 'Sample Artist');
        assert.equal(response.result.coverUrl, volume.CoverUrl);
        assert.equal(response.result.coverCacheUrl, undefined);
        assert.equal(harness.imageCalls.length, 0);
    }
    assert.equal(harness.detailCalls.length, 1);
    const withCover = await harness.detail('123');
    assert.equal(withCover.success, true, withCover.error);
    assert.equal(withCover.cached, true);
    assert.equal(withCover.result.coverCacheUrl, 'transient-cover');
    assert.equal(harness.imageCalls.length, 1);
    assert.equal(harness.detailCalls.length, 1);
});

test('Comic Vine creator updates use the saved key without fetching series details or images', async () => {
    const harness = createHarness();
    const response = await harness.credits('123', '456');
    assert.equal(response.success, true, response.error);
    assert.equal(harness.creditsCalls.length, 1);
    assert.deepEqual(harness.creditsCalls[0].slice(0, 3), ['123', '456', 'private-vine-key']);
    assert.equal(harness.creditsCalls[0][3], harness.requestJson);
    assert.equal(response.result.ID, '123');
    assert.equal(response.result.Writer, 'Sample Writer');
    assert.equal(response.result.Penciller, 'Sample Artist');
    assert.equal(response.result.author, 'Sample Writer');
    assert.equal(response.result.metadata.Writer, 'Sample Writer');
    assert.equal(response.result.metadata.Penciller, 'Sample Artist');
    assert.equal(response.result.comicVineCreditsIssueId, '456');
    assert.equal(response.result.comicVineCreditsIssueNumber, '1');
    assert.equal(response.result.Title, undefined);
    assert.equal(response.result.CoverUrl, undefined);
    assert.equal(harness.imageCalls.length, 0);
    assert.equal(harness.detailCalls.length, 0);
    assert.equal(harness.searchCalls.length, 0);
});

test('Comic Vine cover updates use one batch request and preserve IDs when the response order differs', async () => {
    const secondCover = volume.CoverUrl.replace('456-cover.jpg', '789-cover.jpg');
    const harness = createHarness({ covers: async () => [
        { ID: '456', CoverUrl: secondCover, CoverUrls: [secondCover], Publisher: 'Second Press', Count: '12' },
        { ID: '123', CoverUrl: volume.CoverUrl, CoverUrls: [volume.CoverUrl], Publisher: volume.Publisher, Count: volume.Count },
    ] });
    const response = await harness.covers(['123', '456']);
    assert.equal(response.success, true, response.error);
    assert.equal(harness.coversCalls.length, 1);
    assert.deepEqual(Array.from(harness.coversCalls[0][0]), ['123', '456']);
    assert.equal(harness.coversCalls[0][1], 'private-vine-key');
    assert.equal(harness.coversCalls[0][2], harness.requestJson);
    const results = new Map(response.results.map(result => [result.id, result]));
    assert.equal(results.size, 2);
    assert.equal(results.get('123').ID, '123');
    assert.equal(results.get('123').coverUrl, volume.CoverUrl);
    assert.equal(results.get('123').publisher, volume.Publisher);
    assert.equal(results.get('123').metadata.Publisher, volume.Publisher);
    assert.equal(results.get('123').metadata.Count, volume.Count);
    assert.equal(results.get('456').ID, '456');
    assert.equal(results.get('456').coverUrl, secondCover);
    assert.equal(results.get('456').publisher, 'Second Press');
    assert.equal(results.get('456').metadata.Publisher, 'Second Press');
    assert.equal(results.get('456').metadata.Count, '12');
    assert.deepEqual(Array.from(results.get('456').CoverUrls), [secondCover]);
    assert.equal(results.get('456').coverCacheUrl, undefined);
    assert.equal(results.get('456').metadata.Writer, undefined);
    assert.equal(harness.imageCalls.length, 0);
    assert.equal(harness.creditsCalls.length, 0);
    assert.equal(harness.detailCalls.length, 0);
    assert.equal(harness.searchCalls.length, 0);
});

test('Comic Vine cover updates accept a full search page without calling image or creator downloads', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => String(index + 1));
    const harness = createHarness({ covers: async receivedIds => receivedIds.map(ID => ({ ID, CoverUrl: volume.CoverUrl })) });
    const response = await harness.covers(ids);
    assert.equal(response.success, true, response.error);
    assert.equal(response.results.length, 10);
    assert.deepEqual(Array.from(response.results, result => result.id), ids);
    assert.equal(harness.coversCalls.length, 1);
    assert.equal(harness.imageCalls.length, 0);
    assert.equal(harness.creditsCalls.length, 0);
    assert.equal(harness.detailCalls.length, 0);
});

test('Comic Vine cover updates reject missing credentials and disabled sources before requesting the batch', async () => {
    for (const config of [
        { api_keys: { vine: '' } },
        { api_keys: { vine: '   ' } },
        { api_keys: { vine: 'private-vine-key' }, metadata_api_enabled: { Vine: false } },
    ]) {
        const harness = createHarness({ initialConfig: config });
        const response = await harness.covers(['123']);
        assert.equal(response.success, false);
        assert.equal(response.code, config.metadata_api_enabled ? 'API_DISABLED' : 'API_AUTH_REQUIRED');
        assert.equal(harness.coversCalls.length, 0);
        assert.equal(harness.imageCalls.length, 0);
        assert.equal(harness.creditsCalls.length, 0);
        assert.equal(harness.detailCalls.length, 0);
    }
});

test('Comic Vine cover updates reject malformed or oversized identifier batches before fetching', async () => {
    const harness = createHarness();
    const invalid = [
        undefined, null, {}, '123', [], Array.from({ length: 11 }, (_, index) => String(index + 1)),
        [''], ['0'], ['-1'], ['1.5'], ['4050-123'], ['https://example.com/123'], ['123|456'],
        ['123?api_key=other'], ['123', null], ['123', 'invalid'],
    ];
    for (const ids of invalid) {
        const response = await harness.covers(ids);
        assert.equal(response.success, false, JSON.stringify(ids));
        assert.equal(response.code, 'API_INVALID_RESPONSE');
    }
    assert.equal(harness.coversCalls.length, 0);
    assert.equal(harness.imageCalls.length, 0);
    assert.equal(harness.creditsCalls.length, 0);
    assert.equal(harness.detailCalls.length, 0);
});

test('Comic Vine cover errors return safe codes and localized text without leaking upstream content', async () => {
    const secret = 'private-vine-covers-key';
    for (const code of ['API_AUTH_FAILED', 'API_RATE_LIMIT', 'API_INVALID_RESPONSE', 'API_ACCESS_BLOCKED', 'UNEXPECTED']) {
        const harness = createHarness({
            initialConfig: { api_keys: { vine: secret } },
            covers: async () => { throw Object.assign(new Error(`Server body api_key=${secret}`), { code, responseBody: secret }); },
        });
        const response = await harness.covers(['123']);
        assert.equal(response.success, false);
        assert.equal(response.error, additionalMetadataErrorMessage({ code }, 'Comic Vine', t));
        if (code !== 'UNEXPECTED') assert.equal(response.code, code);
        assert.ok(!JSON.stringify(response).includes(secret));
        assert.ok(!JSON.stringify(harness.logs).includes(secret));
        assert.equal(harness.imageCalls.length, 0);
        assert.equal(harness.creditsCalls.length, 0);
        assert.equal(harness.detailCalls.length, 0);
    }
});

test('Comic Vine creator updates preserve an artist when the first issue has no writer', async () => {
    const harness = createHarness({ credits: async () => ({ ID: '123', Writer: '', Penciller: 'Sample Artist' }) });
    const response = await harness.credits('123', '456');
    assert.equal(response.success, true, response.error);
    assert.equal(response.result.author, 'Sample Artist');
    assert.equal(response.result.metadata.Writer, '');
    assert.equal(response.result.metadata.Penciller, 'Sample Artist');
});

test('Comic Vine creator updates reject unavailable credentials and disabled sources before fetching', async () => {
    for (const config of [
        { api_keys: { vine: '' } },
        { api_keys: { vine: '   ' } },
        { api_keys: { vine: 'private-vine-key' }, metadata_api_enabled: { Vine: false } },
    ]) {
        const harness = createHarness({ initialConfig: config });
        const response = await harness.credits('123', '456');
        assert.equal(response.success, false);
        assert.equal(response.code, config.metadata_api_enabled ? 'API_DISABLED' : 'API_AUTH_REQUIRED');
        assert.equal(harness.creditsCalls.length, 0);
        assert.equal(harness.imageCalls.length, 0);
        assert.equal(harness.detailCalls.length, 0);
    }
});

test('Comic Vine creator updates reject malformed volume and issue identifiers before fetching', async () => {
    const harness = createHarness();
    for (const id of ['', '0', '-1', '1.5', '4050-123', '4000-456', 'https://example.com/123', '123?api_key=other']) {
        for (const [volumeId, firstIssueId] of [[id, '456'], ['123', id]]) {
            const response = await harness.credits(volumeId, firstIssueId);
            assert.equal(response.success, false, `${volumeId}, ${firstIssueId}`);
            assert.equal(response.code, 'API_INVALID_RESPONSE');
        }
    }
    assert.equal(harness.creditsCalls.length, 0);
    assert.equal(harness.imageCalls.length, 0);
    assert.equal(harness.detailCalls.length, 0);
});

test('Comic Vine creator errors return safe codes and localized text without exposing upstream content', async () => {
    const secret = 'private-vine-credits-key';
    for (const code of ['API_AUTH_FAILED', 'API_RATE_LIMIT', 'API_INVALID_RESPONSE', 'API_ACCESS_BLOCKED', 'UNEXPECTED']) {
        const harness = createHarness({
            initialConfig: { api_keys: { vine: secret } },
            credits: async () => { throw Object.assign(new Error(`Server body api_key=${secret}`), { code, responseBody: secret }); },
        });
        const response = await harness.credits('123', '456');
        assert.equal(response.success, false);
        assert.equal(response.error, additionalMetadataErrorMessage({ code }, 'Comic Vine', t));
        if (code !== 'UNEXPECTED') assert.equal(response.code, code);
        assert.ok(!JSON.stringify(response).includes(secret));
        assert.ok(!JSON.stringify(harness.logs).includes(secret));
        assert.equal(harness.imageCalls.length, 0);
        assert.equal(harness.detailCalls.length, 0);
    }
});

test('Comic Vine detail errors are localized without exposing the upstream message or API key', async () => {
    const secret = 'private-vine-detail-key';
    for (const code of ['API_AUTH_REQUIRED', 'API_AUTH_FAILED', 'API_RATE_LIMIT', 'API_INVALID_RESPONSE', 'UNEXPECTED']) {
        const harness = createHarness({
            initialConfig: { api_keys: { vine: secret } },
            detail: async () => { throw Object.assign(new Error(`Server body api_key=${secret}`), { code, responseBody: secret }); },
        });
        const result = await harness.detail('123');
        assert.equal(result.success, false);
        assert.equal(result.error, additionalMetadataErrorMessage({ code }, 'Comic Vine', t));
        assert.ok(!JSON.stringify(result).includes(secret));
        assert.ok(!JSON.stringify(harness.logs).includes(secret));
        assert.equal(harness.imageCalls.length, 0);
    }
});

test('Comic Vine incomplete creator details return a localized error without caching and can be retried', async () => {
    let attempts = 0;
    const harness = createHarness({ detail: async () => {
        attempts += 1;
        return attempts === 1
            ? { ...volume, comicVineCreditsError: 'API_RATE_LIMIT' }
            : { ...volume, Writer: 'Sample Writer', Penciller: 'Sample Artist' };
    } });
    const first = await harness.detail('123');
    assert.equal(first.success, false);
    assert.equal(first.error, additionalMetadataErrorMessage({ code: 'API_RATE_LIMIT' }, 'Comic Vine', t));
    assert.equal(harness.detailCache.size, 0);
    assert.equal(harness.imageCalls.length, 0);
    const retry = await harness.detail('123');
    assert.equal(retry.success, true, retry.error);
    assert.equal(retry.cached, false);
    assert.equal(retry.result.metadata.Writer, 'Sample Writer');
    assert.equal(retry.result.metadata.Penciller, 'Sample Artist');
    assert.equal(harness.detailCalls.length, 2);
    assert.equal(harness.detailCache.size, 1);
    const cached = await harness.detail('123');
    assert.equal(cached.success, true, cached.error);
    assert.equal(cached.cached, true);
    assert.equal(harness.detailCalls.length, 2);
});

test('Comic Vine details reuse cached metadata and refresh transient cover URLs', async () => {
    const harness = createHarness();
    const first = await harness.detail('123');
    const second = await harness.detail('123');
    assert.equal(first.success, true, first.error);
    assert.equal(first.cached, false);
    assert.equal(second.success, true, second.error);
    assert.equal(second.cached, true);
    assert.equal(second.result.metadata.Writer, 'Sample Writer');
    assert.equal(second.result.coverCacheUrl, 'transient-cover');
    assert.equal(harness.detailCalls.length, 1);
    assert.equal(harness.imageCalls.length, 2);
    assert.equal(harness.detailCache.size, 1);
    assert.ok(!JSON.stringify([...harness.detailCache.keys()]).includes('private-vine-key'));
});

test('Comic Vine detail cache cannot bypass missing credentials or disabled sources', async () => {
    const harness = createHarness();
    assert.equal((await harness.detail('123')).success, true);
    for (const config of [
        { api_keys: { vine: '' } },
        { api_keys: { vine: '   ' } },
        { api_keys: { vine: 'private-vine-key' }, metadata_api_enabled: { Vine: false } },
    ]) {
        harness.config = config;
        const result = await harness.detail('123');
        assert.equal(result.success, false);
        assert.equal(harness.detailCalls.length, 1);
        assert.equal(harness.imageCalls.length, 1);
    }
});

test('Comic Vine detail rejects malformed volume IDs before calling the adapter', async () => {
    const harness = createHarness();
    for (const id of ['', '0', '-1', '1.5', '4050-123', 'https://example.com/123', '123?api_key=other']) {
        const result = await harness.detail(id);
        assert.equal(result.success, false, id);
        assert.equal(harness.detailCalls.length, 0, id);
        assert.equal(harness.imageCalls.length, 0, id);
    }
});

test('disabled Comic Vine blocks both search and detail before adapter or cache access', async () => {
    const harness = createHarness({ initialConfig: {
        api_keys: { vine: 'private-vine-key' },
        metadata_api_enabled: { Vine: false },
    } });
    const search = await harness.fetch({ api: 'comicvine', query: 'Sample', bookType: 'comic' });
    const detail = await harness.detail('123');
    for (const result of [search, detail]) {
        assert.equal(result.success, false);
        assert.equal(result.code, 'API_DISABLED');
    }
    assert.equal(harness.searchCalls.length, 0);
    assert.equal(harness.detailCalls.length, 0);
    assert.equal(harness.cacheQueries.length, 0);
    assert.equal(harness.opened, 0);
    assert.equal(harness.imageCalls.length, 0);
});
