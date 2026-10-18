import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
    additionalMetadataErrorMessage,
    createAdditionalMetadataContext,
    searchAdditionalMetadataProvider,
} from './additionalMetadataProviders.js';
import { setLanguage, t } from './utils/i18n.js';
import { isMetadataApiSourceEnabled } from './metadataProviderSettings.js';

setLanguage('ko');
const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const asin = 'B000000001';
const book = {
    '@type': 'Book', name: 'Sample Book', author: { name: 'Sample Writer' },
    publisher: { name: 'Sample Press' }, isbn: '9780425038918', datePublished: '2024-03-05',
    numberOfPages: 123, aggregateRating: { ratingValue: 4.5, bestRating: 5 },
};
const bookJsonLd = `<script type="application/ld+json">${JSON.stringify(book)}</script>`;
const audibleBook = {
    asin, title: 'Sample Audio', authors: [{ name: 'Sample Writer' }], narrators: [{ name: 'Sample Narrator' }],
    release_date: '2024-03-05', publisher_name: 'Sample Press',
    rating: { overall_distribution: { average_rating: 4.5 } },
};

function sourceFunction(name) {
    const start = ipcSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const prefix = ipcSource.slice(start - 6, start) === 'async ' ? 'async ' : '';
    return prefix + ipcSource.slice(start, ipcSource.indexOf('\n}', start) + 2);
}

function jsonResponse(url) {
    const target = new URL(url);
    if (target.hostname === 'openlibrary.org') return { docs: [{
        key: '/works/OL1W', title: 'Sample Book', author_name: ['Sample Writer'], first_publish_year: 2024,
        ratings_average: 4.5, editions: { docs: [{ key: '/books/OL1M', isbn: ['9780425038918'] }] },
    }] };
    if (target.hostname === 'itunes.apple.com') {
        const common = { artistName: 'Sample Writer', releaseDate: '2024-03-05T00:00:00Z', averageUserRating: 4.5 };
        return { results: target.searchParams.get('media') === 'audiobook'
            ? [{ ...common, wrapperType: 'audiobook', collectionId: 2, collectionName: 'Sample Audio' }]
            : [{ ...common, kind: 'ebook', trackId: 2, trackName: 'Sample Book' }] };
    }
    if (target.hostname === 'ranobedb.org') return {
        releases: [{ id: 3, title: 'Sample Book', release_date: 20240305, isbn13: '9780425038918', pages: 123 }],
        currentPage: Number(target.searchParams.get('page')), totalPages: 1,
    };
    if (target.hostname.startsWith('api.audible.')) return target.pathname.endsWith(`/${asin}`)
        ? { product: audibleBook }
        : { products: [audibleBook], total_results: 1 };
    if (target.hostname === 'api.audnex.us') return {
        asin, title: 'Sample Audio', authors: [{ name: 'Sample Writer' }], narrators: [{ name: 'Sample Narrator' }],
        releaseDate: '2024-03-05', rating: 4.5,
    };
    if (target.hostname === 'libro.fm') return { audiobook_collection: {
        audiobooks: [{ isbn: '9780425038918', title: 'Sample Audio', authors: ['Sample Writer'] }], total_pages: 1,
    } };
    throw new Error(`Unexpected fixture URL: ${url}`);
}

function textResponse(url) {
    const target = new URL(url);
    if (target.hostname === 'www.goodreads.com') return target.pathname === '/search'
        ? '<tr itemtype="http://schema.org/Book"><td><a class="bookTitle" href="/book/show/4.Sample">Sample Book</a><a class="authorName">Sample Writer</a></td></tr>'
        : bookJsonLd;
    if (target.hostname === 'lubimyczytac.pl') return target.pathname === '/szukaj/ksiazki'
        ? '<div class="book-card"><a class="book-card__title" href="/ksiazka/5/sample">Sample Book</a><div class="book-card__author">Sample Writer</div></div>'
        : bookJsonLd;
    if (target.hostname === 'www.kobo.com') return target.pathname.endsWith('/search')
        ? '<a data-testid="title" href="/us/en/ebook/sample-book">Sample Book</a>'
        : '<h1 class="title product-field">Sample Book</h1><span class="visible-contributors"><a>Sample Writer</a></span><div class="bookitem-secondary-metadata"><ul><li>Sample Press</li><li>Release Date:<span>2024-03-05</span></li></ul></div>';
    throw new Error(`Unexpected fixture URL: ${url}`);
}

function createHarness({ initialConfig = {}, requestJson = jsonResponse, requestText = textResponse, requestJsonPost } = {}) {
    const helpers = [
        'normalizeApiSource', 'normalizeSearchBookType', 'isMetadataApiAllowedForBookType',
        'normalizeSearchResult', 'stripTransientApiImageFields', 'stripTransientApiImageFieldsFromResults',
        'metadataFormatForBookType', 'mangaValueForBookType', 'parseDateParts',
    ].map(sourceFunction).join('\n');
    const start = ipcSource.indexOf("  ipcMain.handle('api:fetch',");
    const end = ipcSource.indexOf("  ipcMain.handle('api:ridiBookDetail',", start);
    assert.ok(start >= 0 && end > start);
    const cached = new Map();
    const calls = [];
    const logs = [];
    const harness = { cached, calls, logs, config: initialConfig, opened: 0, closed: 0, cacheReads: 0 };
    let now = 100000;
    vm.runInNewContext(`${helpers}\n${ipcSource.slice(start, end)}`, {
        ipcMain: { handle(_name, callback) { harness.handler = callback; } },
        configManager: { getConfig: () => harness.config },
        isMetadataApiSourceEnabled,
        createAdditionalMetadataContext,
        additionalMetadataErrorMessage,
        searchAdditionalMetadataProvider: (api, options, runtime) => searchAdditionalMetadataProvider(api, options, {
            ...runtime, now: () => now, sleep: async delay => { now += delay; },
        }),
        requestJsonGeneric: async (...args) => { calls.push({ method: 'GET', args }); return requestJson(...args); },
        requestTextGeneric: async (...args) => { calls.push({ method: 'TEXT', args }); return requestText(...args); },
        requestJsonPost: async (...args) => {
            calls.push({ method: 'POST', args });
            if (requestJsonPost) return requestJsonPost(...args);
            return { data: { search: { results: { hits: [{ document: {
                id: '6', title: 'Sample Book', author_names: ['Sample Writer'], release_year: 2024, rating: 4.5,
            } }] } } } };
        },
        i18nT: t,
        metadataSearchLog: (...args) => logs.push(args),
        openApiCacheDbSafe: () => { harness.opened += 1; return { close() { harness.closed += 1; } }; },
        getCachedApiResults: (_db, api, query) => { harness.cacheReads += 1; return cached.get(`${api}:${query}`); },
        setCachedApiResults: async (_db, api, query, results) => cached.set(`${api}:${query}`, JSON.parse(JSON.stringify(results))),
        apiCoverCacheDir: () => '',
        enrichResultImages: async results => results.map(item => ({ ...item, coverCacheUrl: 'transient-cover' })),
    });
    return harness;
}

test('new provider aliases route through IPC and the actual dispatcher to all ten services', async () => {
    for (const [alias, canonical, id, host, bookType] of [
        ['goodreads', 'Goodreads', '4', 'www.goodreads.com', 'book'],
        ['hardcover', 'Hardcover', '6', 'api.hardcover.app', 'book'],
        ['open_library', 'Open Library', 'OL1M', 'openlibrary.org', 'book'],
        ['ITUNES', 'iTunes', '2', 'itunes.apple.com', 'book'],
        ['kobo', 'Kobo', 'sample-book', 'www.kobo.com', 'book'],
        ['lubimy czytac', 'LubimyCzytac', '5', 'lubimyczytac.pl', 'book'],
        ['ranobe-db', 'RanobeDB', '3', 'ranobedb.org', 'book'],
        ['audible', 'Audible', asin, 'api.audible.com', 'audio'],
        ['aud_nexus', 'AudNexus', asin, 'api.audnex.us', 'audiobook'],
        ['libro.fm', 'Libro.fm', '9780425038918', 'libro.fm', 'audio-book'],
    ]) {
        const harness = createHarness({ initialConfig: { api_keys: { hardcover: 'private-token' } } });
        const result = await harness.handler({}, { apiSource: alias, query: ' Sample ', bookType });
        assert.equal(result.success, true, `${canonical}: ${result.error}`);
        assert.equal(result.api, canonical);
        assert.equal(result.actualQuery, 'Sample');
        assert.equal(result.cached, false);
        assert.equal(result.results[0]?.id, id);
        assert.equal(result.results[0]?.metadata.Writer, canonical === 'RanobeDB' ? '' : 'Sample Writer', canonical);
        assert.equal(result.results[0]?.metadata.Format, bookType === 'book' ? 'Novel' : 'Audiobook');
        assert.ok(harness.calls.some(call => new URL(call.args[0]).hostname === host), canonical);
        assert.equal(harness.opened, harness.closed);
    }
});

test('disabled providers reject canonical names and aliases before opening cache or sending requests', async () => {
    for (const [alias, canonical, bookType] of [
        ['리디북스', '리디북스', 'comic'], ['munpia', '문피아', 'book'], ['kmas', '한국웹툰', 'comic'],
        ['yes24', 'YES24', 'book'], ['aladin', '알라딘', 'book'], ['google', 'Google Books', 'book'],
        ['anilist', 'Anilist', 'comic'], ['comicvine', 'Vine', 'comic'], ['amazon', 'Amazon', 'book'],
        ['goodreads', 'Goodreads', 'book'], ['hardcover', 'Hardcover', 'book'], ['open_library', 'Open Library', 'book'],
        ['itunes', 'iTunes', 'book'], ['kobo', 'Kobo', 'book'], ['lubimy czytac', 'LubimyCzytac', 'book'],
        ['ranobe-db', 'RanobeDB', 'book'], ['audible', 'Audible', 'audio'], ['aud_nexus', 'AudNexus', 'audio'],
        ['libro.fm', 'Libro.fm', 'audio'],
    ]) {
        const harness = createHarness({ initialConfig: { metadata_api_enabled: { [canonical]: false } } });
        const result = await harness.handler({}, {
            api: alias, query: 'Sample', bookType,
            metadataApiEnabled: { [canonical]: true }, metadata_api_enabled: { [canonical]: true },
        });
        assert.equal(result.success, false, canonical);
        assert.equal(result.code, 'API_DISABLED', canonical);
        assert.equal(result.api, canonical);
        assert.equal(result.cached, false);
        assert.equal(harness.opened, 0, canonical);
        assert.equal(harness.cacheReads, 0, canonical);
        assert.equal(harness.calls.length, 0, canonical);
    }
});

test('disabling a provider hides its cached response until it is enabled again', async () => {
    const harness = createHarness();
    const options = { api: 'Open Library', query: 'Sample', bookType: 'book' };
    assert.equal((await harness.handler({}, options)).success, true);
    const requestCount = harness.calls.length;
    const reads = harness.cacheReads;
    harness.config = { metadata_api_enabled: { 'Open Library': false } };
    assert.equal((await harness.handler({}, options)).code, 'API_DISABLED');
    assert.equal(harness.cacheReads, reads);
    assert.equal(harness.calls.length, requestCount);
    harness.config = { metadata_api_enabled: { 'Open Library': true } };
    assert.equal((await harness.handler({}, options)).cached, true);
    assert.equal(harness.calls.length, requestCount);
    assert.equal(harness.opened, harness.closed);
});

test('audio-only sources reject non-audio book types before requests or cache access', async () => {
    const harness = createHarness();
    for (const api of ['Audible', 'AudNexus', 'Libro.fm']) {
        for (const bookType of ['comic', 'book', 'pdf', 'epub', 'txt']) {
            const result = await harness.handler({}, { api, query: 'Sample', bookType });
            assert.equal(result.success, false);
            assert.equal(result.api, api);
            assert.ok(result.error.includes(api));
        }
        const empty = await harness.handler({}, { api, query: ' ', bookType: 'audio' });
        assert.equal(empty.success, true);
        assert.equal(empty.results.length, 0);
    }
    assert.equal(harness.calls.length, 0);
    assert.equal(harness.opened, 0);
    assert.equal(harness.cacheReads, 0);
});

test('provider dates, normalized ratings, audiobook album and book formats survive IPC normalization', async () => {
    for (const [api, bookType, expectedFormat, expectedManga] of [
        ['iTunes', 'pdf', 'PDF', ''], ['RanobeDB', 'comic', 'Manga', 'YesAndRightToLeft'],
        ['Audible', 'audio', 'Audiobook', ''], ['AudNexus', 'audio', 'Audiobook', ''],
        ['iTunes', 'audio', 'Audiobook', ''],
    ]) {
        const result = await createHarness().handler({}, { api, query: 'Sample', bookType });
        assert.equal(result.success, true, `${api}: ${result.error}`);
        const metadata = result.results[0].metadata;
        assert.equal(metadata.Year, '2024', api);
        assert.equal(metadata.Month, '3', api);
        assert.equal(metadata.Day, '5', api);
        assert.equal(metadata.Format, expectedFormat, api);
        assert.equal(metadata.Manga, expectedManga, api);
        if (api !== 'RanobeDB') assert.equal(metadata.CommunityRating, '9', api);
        if (bookType === 'audio') assert.equal(metadata.Album, 'Sample Audio', api);
    }
});

test('provider settings partition caches and are passed to the actual request', async () => {
    for (const [api, initial, changed, verify] of [
        ['iTunes', { itunes_country: 'US' }, { itunes_country: 'JP' }, calls => assert.equal(new URL(calls.at(-1).args[0]).searchParams.get('country'), 'JP')],
        ['Kobo', { kobo_country: 'us', kobo_language: 'en' }, { kobo_country: 'ca', kobo_language: 'fr' }, calls => assert.ok(calls.some(call => new URL(call.args[0]).pathname === '/ca/fr/search'))],
        ['Audible', { audible_region: 'us' }, { audible_region: 'uk' }, calls => assert.equal(new URL(calls.at(-1).args[0]).hostname, 'api.audible.co.uk')],
        ['AudNexus', { audible_region: 'us' }, { audible_region: 'jp' }, calls => assert.equal(new URL(calls.at(-1).args[0]).searchParams.get('region'), 'jp')],
    ]) {
        const harness = createHarness({ initialConfig: { metadata_providers: initial } });
        const options = { api, query: 'Sample', bookType: api.startsWith('Aud') ? 'audio' : 'book' };
        const first = await harness.handler({}, options);
        assert.equal(first.success, true, `${api}: ${first.error}`);
        const requestCount = harness.calls.length;
        assert.equal((await harness.handler({}, options)).cached, true, api);
        assert.equal(harness.calls.length, requestCount, api);
        harness.config = { metadata_providers: changed };
        const next = await harness.handler({}, options);
        assert.equal(next.success, true, `${api}: ${next.error}`);
        assert.equal(next.cached, false, api);
        assert.ok(harness.calls.length > requestCount, api);
        verify(harness.calls);
        assert.equal(harness.cached.size, 2, api);
        assert.equal(harness.opened, harness.closed, api);
    }
});

test('iTunes cover resolution gets a distinct cache entry without including credentials', () => {
    const first = createAdditionalMetadataContext('iTunes', { metadata_providers: { itunes_cover_resolution: 'standard' } });
    const second = createAdditionalMetadataContext('iTunes', { metadata_providers: { itunes_cover_resolution: 'high' } });
    assert.notEqual(first.cacheSuffix, second.cacheSuffix);
    const context = createAdditionalMetadataContext('Hardcover', {}, { hardcover: 'private-token' });
    assert.ok(!context.cacheSuffix.includes('private-token'));
});

test('Hardcover requires a token before reading even an existing cached result', async () => {
    const harness = createHarness({ initialConfig: { api_keys: { hardcover: 'Bearer private-token' } } });
    const options = { api: 'Hardcover', query: 'Sample', bookType: 'book' };
    const success = await harness.handler({}, options);
    assert.equal(success.success, true);
    assert.equal(harness.cached.size, 1);
    const reads = harness.cacheReads;
    const requests = harness.calls.length;
    const missing = await harness.handler({}, { ...options, apiKeys: { hardcover: '' } });
    assert.equal(missing.success, false);
    assert.equal(missing.cached, false);
    assert.match(missing.error, /Hardcover/);
    assert.equal(harness.cacheReads, reads);
    assert.equal(harness.calls.length, requests);
    assert.equal(harness.opened, harness.closed);
    assert.ok(!JSON.stringify([...harness.cached]).includes('private-token'));
    assert.ok(!JSON.stringify(harness.logs).includes('private-token'));
});

test('provider errors and metadata search logs never expose a Hardcover token or upstream error body', async () => {
    const secret = 'private-token-that-must-not-be-logged';
    const harness = createHarness({
        initialConfig: { api_keys: { hardcover: secret } },
        requestJsonPost: async () => { throw Object.assign(new Error(`Authorization Bearer ${secret}`), { statusCode: 401, responseBody: secret }); },
    });
    const result = await harness.handler({}, { api: 'Hardcover', query: 'Sample', bookType: 'book' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Hardcover'));
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(harness.logs).includes(secret));
    assert.equal(harness.cached.size, 0);
    assert.equal(harness.calls[0].args[2].Authorization, `Bearer ${secret}`);
    assert.ok(!JSON.stringify(harness.calls[0].args.slice(0, 2)).includes(secret));
    assert.equal(harness.opened, harness.closed);
});

test('iTunes explicit hasNext false survives a full 20-result page and cache restoration', async () => {
    const harness = createHarness({ requestJson: async url => {
        const response = jsonResponse(url);
        return { results: Array.from({ length: 20 }, (_, index) => ({ ...response.results[0], trackId: index + 1 })) };
    } });
    const options = { api: 'iTunes', query: 'Sample', bookType: 'book' };
    const first = await harness.handler({}, options);
    assert.equal(first.success, true);
    assert.equal(first.results.length, 20);
    assert.equal(first.hasNext, false);
    assert.equal(first.cached, false);
    const saved = [...harness.cached.values()][0];
    assert.equal(saved[0].metadataProviderHasNext, false);
    assert.equal(saved[0].coverCacheUrl, undefined);
    const next = await harness.handler({}, options);
    assert.equal(next.cached, true);
    assert.equal(next.hasNext, false);
    assert.equal(next.results[0].coverCacheUrl, 'transient-cover');
    assert.equal(harness.calls.length, 1);
    const beyond = await harness.handler({}, { ...options, page: 2 });
    assert.equal(beyond.success, true);
    assert.equal(beyond.results.length, 0);
    assert.equal(beyond.hasNext, false);
    assert.equal(harness.calls.length, 1);
});

test('AudNexus retains hasNext when all current-page candidates are missing from its catalog', async () => {
    const harness = createHarness({ requestJson: async url => {
        if (new URL(url).hostname === 'api.audnex.us') throw Object.assign(new Error('Not found'), { statusCode: 404 });
        return { products: [audibleBook], total_results: 40 };
    } });
    const result = await harness.handler({}, { api: 'AudNexus', query: 'Sample', bookType: 'audio' });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 0);
    assert.equal(result.hasNext, true);
    assert.equal(result.cached, false);
    assert.equal(harness.cached.size, 0);
    assert.equal(harness.calls.length, 2);
    assert.equal(harness.opened, harness.closed);
});

test('localized rate-limit and malformed-response errors bypass cache writes', async () => {
    for (const fail of [new Error('RATE_LIMIT'), {}]) {
        const harness = createHarness({ requestJson: async () => { if (fail instanceof Error) throw fail; return fail; } });
        const result = await harness.handler({}, { api: 'Open Library', query: 'Sample', bookType: 'book' });
        assert.equal(result.success, false);
        assert.ok(result.error.includes('Open Library'));
        assert.ok(!result.error.includes('RATE_LIMIT'));
        assert.equal(harness.cached.size, 0);
        assert.equal(harness.opened, harness.closed);
    }
});
