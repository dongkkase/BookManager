import assert from 'node:assert/strict';
import test from 'node:test';
import { searchCatalogMetadataProvider } from './catalogMetadataProviders.js';

function runtimeFor(response) {
    const calls = [];
    const runtime = {
        calls,
        requestJson: async (...args) => { calls.push(args); return response; },
        requestJsonPost: async (...args) => { calls.push(args); return response; },
    };
    return runtime;
}

test('Open Library preserves the matching edition ISBN, publisher and language in one paginated request', async () => {
    const runtime = runtimeFor({ docs: [{
        key: '/works/OL893414W', title: 'Dune', author_name: ['Frank Herbert'], cover_i: 11481354,
        first_publish_year: 1965, isbn: ['9999999999999'], publisher: ['An unrelated edition'], ratings_average: 4.25,
        editions: { docs: [{ key: '/books/OL7500941M', title: 'Dune', language: ['eng'], publisher: ['Berkley'], isbn: ['0425038912', '9780425038918'] }] },
    }] });
    const result = await searchCatalogMetadataProvider('openlibrary', { query: 'Dune & Messiah', page: 2 }, runtime);
    assert.equal(runtime.calls.length, 1);
    const url = new URL(runtime.calls[0][0]);
    assert.equal(url.origin, 'https://openlibrary.org');
    assert.equal(url.searchParams.get('q'), 'Dune & Messiah');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.match(runtime.calls[0][1]['User-Agent'], /BookManager/);
    assert.equal(result[0].ISBN, '9780425038918');
    assert.equal(result[0].Publisher, 'Berkley');
    assert.equal(result[0].LanguageISO, 'en');
    assert.equal(result[0].Web, 'https://openlibrary.org/books/OL7500941M');
    assert.equal(result[0].CoverUrl, 'https://covers.openlibrary.org/b/id/11481354-L.jpg');
    assert.equal(result[0].Year, '1965');
    assert.equal(result[0].CommunityRating, '8.5');
    assert.equal(result[0].RatingScore, '4.25');
    assert.equal(result[0].Rating, '4.25 / 5.0');
});

test('Open Library skips invalid records and does not mix arbitrary edition identifiers into work results', async () => {
    const runtime = runtimeFor({ docs: [null, { title: 'Unsafe', key: '//evil.invalid' }, {
        title: 'Work only', key: 'OL1W', isbn: ['9780425038918'], publisher: ['Other edition'], cover_i: '../private',
    }] });
    const result = await searchCatalogMetadataProvider('openlibrary', { query: 'work' }, runtime);
    assert.equal(result.length, 1);
    assert.equal(result[0].ISBN, '');
    assert.equal(result[0].Publisher, '');
    assert.equal(result[0].CoverUrl, '');
    assert.equal(result[0].Web, 'https://openlibrary.org/works/OL1W');
});

const ebook = {
    kind: 'ebook', trackId: 597944491, trackName: 'Dune', artistName: 'Frank Herbert',
    description: '<p>Desert &amp; stars</p><br>Second line', releaseDate: '1975-09-01T07:00:00Z',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/book/100x100bb.jpg',
    trackViewUrl: 'https://books.apple.com/us/book/dune/id597944491?uo=4',
    genres: ['Books', 'Science Fiction'], averageUserRating: 4.5,
};

test('iTunes uses the chosen storefront and high resolution artwork while removing description markup', async () => {
    const runtime = runtimeFor({ results: [ebook] });
    const [result] = await searchCatalogMetadataProvider('itunes', {
        query: 'Dune', settings: { itunes_country: 'jp', itunes_cover_resolution: 'high' },
    }, runtime);
    const url = new URL(runtime.calls[0][0]);
    assert.equal(url.searchParams.get('country'), 'JP');
    assert.equal(url.searchParams.get('media'), 'ebook');
    assert.equal(url.searchParams.get('entity'), 'ebook');
    assert.equal(result.CoverUrl, 'https://is1-ssl.mzstatic.com/image/thumb/book/1200x1200bb.jpg');
    assert.equal(result.Summary, 'Desert & stars\n\nSecond line');
    assert.equal(result.Genre, 'Science Fiction');
    assert.equal(result.PubDate, '1975-09-01');
    assert.equal(result.Month, '9');
    assert.equal(result.RatingScore, '4.5');
    assert.equal(result.CommunityRating, '9');
});

test('iTunes audiobook responses use collection metadata and standard artwork', async () => {
    const runtime = runtimeFor({ results: [{
        wrapperType: 'audiobook', collectionId: 1442046673, collectionName: 'Dune Audio', artistName: 'Frank Herbert',
        collectionViewUrl: 'https://books.apple.com/us/audiobook/dune/id1442046673', artworkUrl100: ebook.artworkUrl100,
    }] });
    const [result] = await searchCatalogMetadataProvider('itunes', {
        query: 'Dune', bookType: 'audio', settings: { itunes_country: '../../', itunes_cover_resolution: 'standard' },
    }, runtime);
    const url = new URL(runtime.calls[0][0]);
    assert.equal(url.searchParams.get('country'), 'US');
    assert.equal(url.searchParams.get('media'), 'audiobook');
    assert.equal(url.searchParams.get('entity'), 'audiobook');
    assert.equal(result.Title, 'Dune Audio');
    assert.equal(result.ID, '1442046673');
    assert.equal(result.CoverUrl, ebook.artworkUrl100);
    assert.equal(result.Web, 'https://books.apple.com/us/audiobook/dune/id1442046673');
});

test('iTunes does not repeat the first page for unsupported pagination or return unrelated media', async () => {
    const runtime = runtimeFor({ results: [{ ...ebook, kind: 'song' }] });
    assert.deepEqual(await searchCatalogMetadataProvider('itunes', { query: 'Dune', page: 2 }, runtime), []);
    assert.equal(runtime.calls.length, 0);
    assert.deepEqual(await searchCatalogMetadataProvider('itunes', { query: 'Dune' }, runtime), []);
});

test('iTunes rejects executable, private and lookalike cover or product URLs', async () => {
    for (const url of ['javascript:alert(1)', 'file:///tmp/test', 'http://127.0.0.1/image.jpg', 'https://mzstatic.com.evil.invalid/100x100bb.jpg', 'https://user:password@books.apple.com/private', 'https://books.apple.com:3000/private']) {
        const runtime = runtimeFor({ results: [{ ...ebook, artworkUrl100: url, trackViewUrl: url }] });
        const [result] = await searchCatalogMetadataProvider('itunes', { query: 'Dune' }, runtime);
        assert.equal(result.CoverUrl, '');
        assert.equal(result.Web, '');
    }
});

test('Hardcover sends the token only in Authorization and keeps search input in GraphQL variables', async () => {
    const runtime = runtimeFor({ data: { search: { results: { hits: [{ document: {
        id: '12', title: 'Dune', author_names: ['Frank Herbert'], series_names: ['Dune'],
        slug: 'dune', image: { url: 'https://assets.hardcover.app/books/dune.jpg' },
        description: '<p>Arrakis</p>', genres: ['Science Fiction'], tags: ['Space'],
        isbns: ['0425038912', '9780425038918'], pages: 412, release_year: 1965, rating: 4.5, featured_series_position: 1,
    } }] } } } });
    const query = 'Dune ")} mutation { nope }';
    const [result] = await searchCatalogMetadataProvider('hardcover', { query, page: 3, apiKeys: { hardcover: ' Bearer secret-token ' } }, runtime);
    const [url, payload, headers] = runtime.calls[0];
    assert.equal(url, 'https://api.hardcover.app/v1/graphql');
    assert.equal(headers.Authorization, 'Bearer secret-token');
    assert.equal(payload.variables.query, query);
    assert.equal(payload.variables.page, 3);
    assert.ok(!JSON.stringify(payload).includes('secret-token'));
    assert.ok(!payload.query.includes(query));
    assert.equal(result.Series, 'Dune');
    assert.equal(result.ISBN, '9780425038918');
    assert.equal(result.Volume, '1');
    assert.equal(result.PageCount, '412');
    assert.equal(result.CommunityRating, '9');
    assert.equal(result.RatingScore, '4.5');
    assert.equal(result.Web, 'https://hardcover.app/books/dune');
});

test('Hardcover handles a serialized JSON scalar and safely handles missing artwork', async () => {
    const runtime = runtimeFor({ data: { search: { results: JSON.stringify({ hits: [{ document: { id: '1', title: 'Book', image: { url: 'https://127.0.0.1/private' } } }] }) } } });
    const [result] = await searchCatalogMetadataProvider('hardcover', { query: 'book', apiKeys: { hardcover: 'token' } }, runtime);
    assert.equal(result.CoverUrl, '');
    assert.equal(result.Web, 'https://hardcover.app/books/1');
});

test('Hardcover missing keys, invalid headers and server authentication errors never expose credentials', async () => {
    for (const [token, response, code] of [
        ['', {}, 'API_AUTH_REQUIRED'],
        ['Bearer', {}, 'API_AUTH_REQUIRED'],
        ['secret-token\r\nBad: value', {}, 'API_AUTH_FAILED'],
        ['secret-token', { errors: [{ message: 'Unable to verify token secret-token' }] }, 'API_AUTH_FAILED'],
        ['secret-token', { data: { search: { error: 'Throttled secret-token' } } }, 'API_RATE_LIMIT'],
    ]) {
        const runtime = runtimeFor(response);
        await assert.rejects(searchCatalogMetadataProvider('hardcover', { query: 'book', apiKeys: { hardcover: token } }, runtime), error => {
            assert.equal(error.code, code);
            assert.ok(!error.message.includes('secret-token'));
            return true;
        });
        if (!token || token === 'Bearer' || token.includes('\r')) assert.equal(runtime.calls.length, 0);
    }
});

test('RanobeDB uses its verified release search response without extra requests or invented author data', async () => {
    const runtime = runtimeFor({ releases: [{
        id: 6570, title: '骸骨ナイフでジャンプ(3)', lang: 'ja', release_date: 20070125,
        pages: 262, format: 'print', isbn13: '9784840236867', description: 'A light novel.',
        image: { filename: 'svJaRHpNYEZ0FOwZ.jpg' },
    }], currentPage: 2, totalPages: 7 });
    const [result] = await searchCatalogMetadataProvider('ranobedb', { query: 'Spice', page: 2 }, runtime);
    assert.equal(runtime.calls.length, 1);
    const url = new URL(runtime.calls[0][0]);
    assert.equal(url.pathname, '/api/v0/releases');
    assert.equal(url.searchParams.get('q'), 'Spice');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(result.CoverUrl, 'https://images.ranobedb.org/svJaRHpNYEZ0FOwZ.jpg');
    assert.equal(result.Web, 'https://ranobedb.org/release/6570');
    assert.equal(result.ISBN, '9784840236867');
    assert.equal(result.PageCount, '262');
    assert.equal(result.PubDate, '2007-01-25');
    assert.equal(result.Writer, '');
    assert.equal(result.Series, '');
    assert.equal(result.CommunityRating, undefined);
});

test('RanobeDB filters audio releases and tolerates unknown date parts without inventing a date', async () => {
    const runtime = runtimeFor({ releases: [
        { id: 1, title: 'Month known', release_date: 20250199, image: { filename: '../private.jpg' } },
        { id: 2, title: 'Year known', release_date: 20259999 },
        { id: 3, title: 'Unknown date', release_date: 99999999 },
        { id: 4, title: 'Invalid day', release_date: 20250231 },
        { id: 5, title: 'Hidden', hidden: true },
    ] });
    const results = await searchCatalogMetadataProvider('ranobedb', { query: 'book', bookType: 'audio' }, runtime);
    assert.equal(new URL(runtime.calls[0][0]).searchParams.get('rf'), 'audio');
    assert.equal(results.length, 4);
    assert.deepEqual(results.map(item => item.PubDate), ['2025-01', '2025', undefined, '2025-02']);
    assert.equal(results[0].CoverUrl, '');
    assert.equal(results[0].Day, undefined);
});

test('RanobeDB does not duplicate a server-clamped last page', async () => {
    for (const pagination of [{ currentPage: 2, totalPages: 2 }, { currentPage: 2 }]) {
        const runtime = runtimeFor({ releases: [{ id: 1, title: 'Book' }], ...pagination });
        assert.deepEqual(await searchCatalogMetadataProvider('ranobedb', { query: 'book', page: 3 }, runtime), []);
    }
});

test('providers distinguish malformed response data from a valid empty search', async () => {
    for (const [provider, empty] of [
        ['openlibrary', { docs: [] }], ['itunes', { results: [] }],
        ['hardcover', { data: { search: { results: { hits: [] } } } }], ['ranobedb', { releases: [] }],
    ]) {
        const options = { query: 'book', apiKeys: { hardcover: 'private-token' } };
        assert.deepEqual(await searchCatalogMetadataProvider(provider, options, runtimeFor(empty)), []);
        await assert.rejects(searchCatalogMetadataProvider(provider, options, runtimeFor({})), { code: 'API_INVALID_RESPONSE' });
    }
});

test('providers reject invalid pages and cap responses at 20 records', async () => {
    const runtime = runtimeFor({ results: Array.from({ length: 25 }, (_, i) => ({ ...ebook, trackId: i + 1 })) });
    for (const page of [0, -1, 1.5, Infinity, 10001, 'not a page']) {
        assert.deepEqual(await searchCatalogMetadataProvider('itunes', { query: 'Dune', page }, runtime), []);
    }
    assert.deepEqual(await searchCatalogMetadataProvider('itunes', { query: '  ' }, runtime), []);
    assert.equal(runtime.calls.length, 0);
    assert.equal((await searchCatalogMetadataProvider('itunes', { query: 'Dune' }, runtime)).length, 20);
    await assert.rejects(searchCatalogMetadataProvider('toString', { query: 'book' }, runtime), { code: 'API_REQUEST_FAILED' });
});

test('network and HTTP failures are sanitized without leaking tokens or request data', async () => {
    for (const [status, code] of [[401, 'API_AUTH_FAILED'], [403, 'API_AUTH_FAILED'], [429, 'API_RATE_LIMIT'], [500, 'API_REQUEST_FAILED']]) {
        const runtime = { requestJsonPost: async () => { throw Object.assign(new Error('secret-token request headers'), { status }); } };
        await assert.rejects(searchCatalogMetadataProvider('hardcover', { query: 'book', apiKeys: { hardcover: 'secret-token' } }, runtime), error => {
            assert.equal(error.code, code);
            assert.ok(!String(error).includes('secret-token'));
            assert.equal(error.cause, undefined);
            return true;
        });
    }
});

test('the generic runtime rate-limit error is mapped without requiring an HTTP status', async () => {
    const runtime = { requestJson: async () => { throw new Error('RATE_LIMIT'); } };
    await assert.rejects(searchCatalogMetadataProvider('itunes', { query: 'Dune' }, runtime), { code: 'API_RATE_LIMIT' });
});

test('repeated requests respect each provider request interval', async () => {
    for (const [provider, response, interval] of [
        ['openlibrary', { docs: [] }, 1050], ['itunes', { results: [] }, 3050],
        ['hardcover', { data: { search: { results: { hits: [] } } } }, 1050], ['ranobedb', { releases: [] }, 1050],
    ]) {
        const runtime = runtimeFor(response);
        let now = 1000;
        const delays = [];
        runtime.now = () => now;
        runtime.sleep = async delay => { delays.push(delay); now += delay; };
        const options = { query: 'book', apiKeys: { hardcover: 'token' } };
        await searchCatalogMetadataProvider(provider, options, runtime);
        await searchCatalogMetadataProvider(provider, options, runtime);
        assert.deepEqual(delays, [interval]);
        assert.equal(runtime.calls.length, 2);
    }
});
