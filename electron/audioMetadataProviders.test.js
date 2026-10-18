import assert from 'node:assert/strict';
import test from 'node:test';
import { searchAudioMetadataProvider } from './audioMetadataProviders.js';

const book = {
    asin: 'B08G9PRS1K', title: 'Test &amp; Journey', authors: [{ name: 'A. Writer' }],
    narrators: [{ name: 'A. Reader' }], publisher_name: 'Publisher', release_date: '2021-05-04',
    publisher_summary: '<p>First &amp; second</p><p>Last</p>',
    product_images: { 500: 'https://m.media-amazon.com/cover.jpg', 1024: 'https://m.media-amazon.com/large.jpg' },
    rating: { overall_distribution: { average_rating: 4.5 } }, series: [{ title: 'A Series', sequence: '2' }],
};

function runtimeWith(respond) {
    const calls = [];
    return {
        calls, now: () => 0, sleep: async () => {},
        requestJson: async (url, headers, timeout) => {
            calls.push({ url: new URL(url), headers, timeout });
            return respond(new URL(url), calls.length);
        },
    };
}

test('Audible uses regional catalog search, zero-based pages and consistent metadata', async () => {
    const runtime = runtimeWith(() => ({ products: [book], total_results: 42 }));
    const results = await searchAudioMetadataProvider('audible', {
        query: 'Journey & Writer', page: 2, settings: { audible_region: 'uk' },
    }, runtime);
    const request = runtime.calls[0].url;
    assert.equal(request.origin, 'https://api.audible.co.uk');
    assert.equal(request.searchParams.get('keywords'), 'Journey & Writer');
    assert.equal(request.searchParams.get('page'), '1');
    assert.equal(request.searchParams.get('content_type'), 'Product');
    assert.equal(request.searchParams.get('products_sort_by'), 'Relevance');
    assert.equal(results.hasNext, true);
    assert.equal(results[0].Title, 'Test & Journey');
    assert.equal(results[0].Album, 'Test & Journey');
    assert.equal(results[0].Writer, 'A. Writer');
    assert.equal(results[0].Narrator, 'A. Reader');
    assert.equal(results[0].Summary, 'First & second\nLast');
    assert.equal(results[0].CommunityRating, '9');
    assert.equal(results[0].Volume, '2');
    assert.equal(results[0].PubDate, '2021-05-04');
    assert.equal(results[0].CoverUrl, 'https://m.media-amazon.com/large.jpg');
});

test('ten-letter titles are searched as keywords while ASINs use direct lookup', async () => {
    const runtime = runtimeWith(url => url.pathname.endsWith(book.asin)
        ? { product: book } : { products: [book], total_results: 1 });
    const titleResults = await searchAudioMetadataProvider('audible', { query: 'Foundation' }, runtime);
    assert.equal(runtime.calls[0].url.searchParams.get('keywords'), 'Foundation');
    assert.equal(titleResults.hasNext, false);
    const direct = await searchAudioMetadataProvider('audible', { query: book.asin }, runtime);
    assert.equal(runtime.calls[1].url.pathname, `/1.0/catalog/products/${book.asin}`);
    assert.equal(direct.hasNext, false);
    const later = await searchAudioMetadataProvider('audible', { query: book.asin, page: 2 }, runtime);
    assert.equal(later.length, 0);
    assert.equal(runtime.calls.length, 2);
});

test('AudNexus searches Audible for ASINs then maps its own details and tolerates missing records', async () => {
    const runtime = runtimeWith(url => {
        if (url.hostname.startsWith('api.audible.')) return { products: [book, { asin: 'B000000001' }], total_results: 30 };
        if (url.pathname.endsWith('B000000001')) throw Object.assign(new Error('missing'), { statusCode: 404 });
        return { asin: book.asin, title: 'Nexus title', authors: book.authors, narrators: book.narrators,
            summary: '<p>Nexus summary</p>', publisherName: 'Publisher', image: book.product_images[500],
            isbn: '9781234567897', releaseDate: '2021-05-04T00:00:00Z', rating: '4.5',
            genres: [{ name: 'Fiction', type: 'genre' }, { name: 'Space', type: 'tag' }],
        };
    });
    const results = await searchAudioMetadataProvider('audnexus', { query: 'Foundation', settings: { audible_region: 'de' } }, runtime);
    assert.equal(results.length, 1);
    assert.equal(results.hasNext, true);
    assert.equal(results[0].Title, 'Nexus title');
    assert.equal(results[0].Genre, 'Fiction');
    assert.equal(results[0].Tags, 'Space');
    assert.equal(results[0].CommunityRating, '9');
    assert.equal(runtime.calls[0].url.searchParams.get('keywords'), 'Foundation');
    assert.equal(runtime.calls[1].url.searchParams.get('region'), 'de');
});

test('AudNexus direct ASIN lookup avoids an extra catalog request and stops after one page', async () => {
    const runtime = runtimeWith(() => ({ asin: book.asin, title: 'Direct' }));
    assert.equal((await searchAudioMetadataProvider('audnexus', { query: book.asin }, runtime))[0].Title, 'Direct');
    assert.equal(runtime.calls[0].url.hostname, 'api.audnex.us');
    assert.equal((await searchAudioMetadataProvider('audnexus', { query: book.asin, page: 2 }, runtime)).hasNext, false);
    assert.equal(runtime.calls.length, 1);
});

test('AudNexus stops scheduling details when an upstream request fails', async () => {
    const runtime = runtimeWith(url => {
        if (url.hostname.startsWith('api.audible.')) return { products: Array.from({ length: 20 }, (_, index) => ({ asin: `B0${String(index).padStart(8, '0')}` })) };
        throw Object.assign(new Error('rate limit'), { statusCode: 429 });
    });
    await assert.rejects(searchAudioMetadataProvider('audnexus', { query: 'Some book' }, runtime), { code: 'API_RATE_LIMIT' });
    assert.ok(runtime.calls.length <= 4);
});

test('Libro.fm preserves all 24 native page results and exposes the actual last page', async () => {
    const entries = Array.from({ length: 24 }, (_, index) => ({
        isbn: 9781234567800 + index, title: `Audio ${index}`, authors: ['Writer'],
        cover_url: '//covers.libro.fm/cover.jpg', audiobook_info: { narrators: ['Reader'] },
    }));
    const runtime = runtimeWith(() => ({ audiobook_collection: { audiobooks: entries, total_pages: 2 } }));
    const results = await searchAudioMetadataProvider('librofm', { query: 'Audio & story', page: 2 }, runtime);
    assert.equal(results.length, 24);
    assert.equal(results.hasNext, false);
    assert.equal(runtime.calls.length, 1);
    assert.equal(runtime.calls[0].url.searchParams.get('q'), 'Audio & story');
    assert.equal(runtime.calls[0].url.searchParams.get('page'), '2');
    assert.equal(results[0].CoverUrl, 'https://covers.libro.fm/cover.jpg');
    assert.equal(results[0].Writer, 'Writer');
    assert.equal(results[0].Narrator, 'Reader');
});

test('invalid records and unsafe artwork URLs are not sent to cover downloads', async () => {
    const runtime = runtimeWith(() => ({ audiobook_collection: { audiobooks: [
        null, { isbn: '../bad', title: 'Bad' },
        { isbn: 9781234567897, title: 'Good', cover_url: 'http://localhost/private' },
        { isbn: 9781234567897, title: 'Duplicate' },
    ], total_pages: 1 } }));
    const results = await searchAudioMetadataProvider('librofm', { query: 'Good' }, runtime);
    assert.equal(results.length, 1);
    assert.equal(results[0].CoverUrl, '');
});

test('malformed, blocked and rate-limited responses are distinct without leaking upstream details', async () => {
    const malformed = runtimeWith(() => ({}));
    await assert.rejects(searchAudioMetadataProvider('audible', { query: 'Book' }, malformed), { code: 'API_INVALID_RESPONSE' });
    for (const [error, code] of [
        [Object.assign(new Error('sensitive upstream detail'), { statusCode: 403 }), 'API_ACCESS_BLOCKED'],
        [new Error('RATE_LIMIT'), 'API_RATE_LIMIT'],
        [new Error('sensitive upstream detail'), 'API_REQUEST_FAILED'],
    ]) {
        await assert.rejects(searchAudioMetadataProvider('librofm', { query: 'Book' }, runtimeWith(() => { throw error; })), value => {
            assert.equal(value.code, code);
            assert.doesNotMatch(value.message, /sensitive/);
            return true;
        });
    }
});
