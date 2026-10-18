import assert from 'node:assert/strict';
import test from 'node:test';
import { searchWebMetadataProvider } from './webMetadataProviders.js';

// Goodreads and LubimyCzytac fixtures retain the structure of their public HTML.
// Kobo's element names were verified against BookOrbit's public provider tests;
// its live search returned an access challenge, so no successful live test is claimed.
const goodreadsSearch = (id = 123, extra = '') => `<table>
    <tr itemscope itemtype="http://schema.org/Book">
        <td><img class="bookCover" src="https://i.gr-assets.com/books/cover.jpg" /></td>
        <td><a class="bookTitle" href="/book/show/${id}.Sample?from_search=true&amp;rank=1"><span itemprop="name">Sample &amp; Story</span></a>
        <a class="authorName" href="/author/show/1"><span itemprop="name">Writer A</span></a></td>
    </tr>${extra}</table>`;

const goodreadsDetail = (id = 123) => `<html><script type="application/ld+json">${JSON.stringify({
    '@type': 'Book', name: 'Sample & Story', author: [{ name: 'Writer A' }, { name: 'Editor B' }],
    image: 'https://m.media-amazon.com/images/cover.jpg', numberOfPages: 120,
    aggregateRating: { ratingValue: 4.2 }, inLanguage: 'English',
})}</script><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { apolloState: {
        'Book:sample': {
            __typename: 'Book', legacyId: id, title: 'Sample & Story', description: 'Line one.<br />Line two.',
            primaryContributorEdge: { role: 'Author', node: { __ref: 'Contributor:writer' } },
            secondaryContributorEdges: [{ role: 'Editor', node: { __ref: 'Contributor:editor' } }],
            bookSeries: [{ userPosition: '2.5', series: { __ref: 'Series:sample' } }],
            bookGenres: [{ genre: { name: 'Fantasy' } }, { genre: { name: 'Adventure' } }],
            details: { publisher: 'Sample Press', isbn13: '9781234567897', numPages: 120, publicationTime: Date.UTC(2024, 2, 5), language: { name: 'English' } },
        },
        'Contributor:writer': { name: 'Writer A' },
        'Contributor:editor': { name: 'Editor B' },
        'Series:sample': { title: 'Sample Series' },
    } } },
})}</script></html>`;

const lubimySearch = `<div id="searchPaginator"><div class="book-card book-card--l" data-book-id="456">
    <div class="book-card__primary"><img class="book-card__cover-image" src="https://s.lubimyczytac.pl/upload/cover.jpg" />
    <a class="book-card__title" href="/ksiazka/456/przyklad">Przykład</a>
    <div class="book-card__author"><a>Pisarz</a></div></div></div></div>`;

const lubimyDetail = `<script type="application/ld+json">{"@type":"Organization","name":"Site"}</script>
    <script type="application/ld+json">${JSON.stringify({
        '@type': 'Book', name: 'Przykład', isbn: '9781234567897', datePublished: '2023-09-22',
        genre: 'https://lubimyczytac.pl/ksiazki/k/41/fantasy-science-fiction', inLanguage: 'polski',
        numberOfPages: '320', image: 'https://s.lubimyczytac.pl/upload/large.jpg', author: { name: 'Pisarz' },
        aggregateRating: { bestRating: 10, ratingValue: '7,8' },
    })}</script><section id="container-book" data-ga-book-publishers="Wydawnictwo" data-ga-book-category="fantasy, science fiction">
    <div class="book__description text-collapse">Opis.<br />Drugi akapit.</div></section>`;

const koboSearch = `<div data-testid="search-result-widget">
    <a data-testid="title" href="/us/en/ebook/sample-book">Sample Book</a>
    <a data-testid="title" href="/us/en/ebook/sample-book">Duplicate</a></div>`;

const koboDetail = `<html><meta property="og:image" content="https://cdn.kobo.com/book-images/sample/cover.jpg" />
    <h1 class="title product-field">Sample Book</h1><span class="visible-contributors"><a>Writer</a></span>
    <span class="series product-field"><span class="sequenced-name-prefix">Book 5.10 - </span><span class="product-sequence-field"><a>Series</a></span></span>
    <div class="bookitem-secondary-metadata"><ul><li>Example Press</li>
    <li>Release Date:<span>January 14, 2025</span></li><li>Book ID:<span>9781234567897</span></li>
    <li>Language:<span>English</span></li></ul></div>
    <div id="about-this-book-widget"><div class="book-stats"><div class="column"><strong>304</strong><span>Pages</span></div></div></div>
    <ul class="category-rankings"><meta property="genre" content="Fantasy" /></ul>
    <div data-full-synopsis=""><p>A description.</p><p>Next paragraph.</p></div></html>`;

function runtimeFor(search, detail) {
    const calls = [];
    return { calls, requestText: async (...args) => {
        calls.push(args);
        return calls.length === 1 ? search : detail;
    } };
}

test('Goodreads maps public JSON-LD and Apollo book metadata without treating editors as authors', async () => {
    const runtime = runtimeFor(goodreadsSearch(), goodreadsDetail());
    const [result] = await searchWebMetadataProvider('Goodreads', { query: 'Sample & Story', page: 2 }, runtime);
    assert.equal(new URL(runtime.calls[0][0]).searchParams.get('q'), 'Sample & Story');
    assert.equal(new URL(runtime.calls[0][0]).searchParams.get('page'), '2');
    assert.equal(result.ID, '123');
    assert.equal(result.Title, 'Sample & Story');
    assert.equal(result.Writer, 'Writer A');
    assert.equal(result.Editor, 'Editor B');
    assert.equal(result.Series, 'Sample Series');
    assert.equal(result.Volume, '2.5');
    assert.equal(result.ISBN, '9781234567897');
    assert.equal(result.Publisher, 'Sample Press');
    assert.equal(result.PubDate, '2024-03-05');
    assert.equal(result.Month, '3');
    assert.equal(result.PageCount, '120');
    assert.equal(result.LanguageISO, 'en');
    assert.equal(result.CommunityRating, '8.4');
    assert.equal(result.Summary, 'Line one.\nLine two.');
    assert.equal(result.Genre, 'Fantasy, Adventure');
    assert.equal(result.Web, 'https://www.goodreads.com/book/show/123.Sample');
});

test('LubimyCzytac maps Polish schema, decimal comma ratings, and public publisher attributes', async () => {
    const runtime = runtimeFor(lubimySearch, lubimyDetail);
    const [result] = await searchWebMetadataProvider('LubimyCzytac', { query: 'Przykład' }, runtime);
    assert.equal(new URL(runtime.calls[0][0]).searchParams.get('phrase'), 'Przykład');
    assert.equal(result.ID, '456');
    assert.equal(result.Writer, 'Pisarz');
    assert.equal(result.LanguageISO, 'pl');
    assert.equal(result.CommunityRating, '7.8');
    assert.equal(result.PageCount, '320');
    assert.equal(result.Publisher, 'Wydawnictwo');
    assert.equal(result.ISBN, '9781234567897');
    assert.equal(result.PubDate, '2023-09-22');
    assert.equal(result.Genre, 'fantasy, science fiction');
    assert.equal(result.Summary, 'Opis.\nDrugi akapit.');
});

test('LubimyCzytac pagination uses the public form endpoint, not the ignored page query parameter', async () => {
    const runtime = runtimeFor(JSON.stringify({ code: 'OK', data: { count: 30, content: lubimySearch } }), lubimyDetail);
    const results = await searchWebMetadataProvider('LubimyCzytac', { query: 'title & author', page: 3 }, runtime);
    const [url, headers, , options] = runtime.calls[0];
    assert.equal(url, 'https://lubimyczytac.pl/searcher/getNextResults/ksiazki');
    assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(options.method, 'POST');
    const params = new URLSearchParams(options.body);
    assert.equal(params.get('page'), '3');
    assert.equal(params.get('phrase'), 'title & author');
    assert.equal(params.get('paginatorType'), 'Standard');
    assert.equal(results.length, 1);
});

test('Kobo maps current and legacy public layout facts and keeps fractional series positions', async () => {
    for (const search of [koboSearch, '<h2 class="title product-field"><a href="/us/en/ebook/sample-book">Sample Book</a></h2>']) {
        const runtime = runtimeFor(search, koboDetail);
        const [result] = await searchWebMetadataProvider('Kobo', { query: 'Sample', page: 2, settings: { kobo_country: 'au', kobo_language: 'en' } }, runtime);
        const url = new URL(runtime.calls[0][0]);
        assert.equal(url.pathname, '/au/en/search');
        assert.equal(url.searchParams.get('fcmedia'), 'Book');
        assert.equal(url.searchParams.get('fclanguages'), 'en');
        assert.equal(url.searchParams.get('pageNumber'), '2');
        assert.equal(runtime.calls.length, 2);
        assert.equal(result.ID, 'sample-book');
        assert.equal(result.Writer, 'Writer');
        assert.equal(result.PageCount, '304');
        assert.equal(result.Publisher, 'Example Press');
        assert.equal(result.LanguageISO, 'en');
        assert.equal(result.PubDate, '2025-01-14');
        assert.equal(result.ISBN, '9781234567897');
        assert.equal(result.Series, 'Series');
        assert.equal(result.Volume, '5.10');
        assert.equal(result.Summary, 'A description.\nNext paragraph.');
        assert.equal(result.Genre, 'Fantasy');
    }
});

test('Kobo locale settings are allowlisted and all-language search omits a language filter', async () => {
    for (const [settings, pathname, lang] of [
        [{ kobo_country: 'http://localhost', kobo_language: '../secret' }, '/us/en/search', 'en'],
        [{ kobo_country: 'jp', kobo_language: 'all' }, '/jp/search', null],
    ]) {
        const runtime = runtimeFor(koboSearch, koboDetail);
        await searchWebMetadataProvider('Kobo', { query: 'sample', settings }, runtime);
        const url = new URL(runtime.calls[0][0]);
        assert.equal(url.origin, 'https://www.kobo.com');
        assert.equal(url.pathname, pathname);
        assert.equal(url.searchParams.get('fclanguages'), lang);
    }
});

test('Known empty searches return no items and make no detail requests', async () => {
    for (const [provider, html] of [
        ['Goodreads', '<h3 class="searchSubNavContainer">No results.</h3>'],
        ['LubimyCzytac', '<span id="searchPaginator">Przykro nam, niczego nie znaleźliśmy.</span>'],
        ['Kobo', '<div>Showing 0 - 0 of 0 results</div>'],
    ]) {
        const runtime = runtimeFor(html, 'unexpected');
        const results = await searchWebMetadataProvider(provider, { query: 'nonexistent' }, runtime);
        assert.equal(results.length, 0);
        assert.equal(results.hasNext, false);
        assert.equal(runtime.calls.length, 1);
    }
    assert.deepEqual(await searchWebMetadataProvider('Goodreads', { query: ' ' }), []);
});

test('Challenge pages, invalid pages, and HTTP limits remain explicit errors', async () => {
    for (const provider of ['Goodreads', 'Kobo', 'LubimyCzytac']) {
        for (const html of ['<title>Challenged | Kobo.com</title>', '<title>Just a moment...</title>', '<form id="challenge-form"></form>']) {
            await assert.rejects(searchWebMetadataProvider(provider, { query: 'x' }, runtimeFor(html, '')), { code: 'METADATA_ACCESS_BLOCKED' });
        }
        await assert.rejects(searchWebMetadataProvider(provider, { query: 'x' }, runtimeFor('<html>Maintenance</html>', '')), { code: 'METADATA_RESPONSE_INVALID' });
        await assert.rejects(searchWebMetadataProvider(provider, { query: 'x' }, { requestText: async () => { throw new Error('HTTP 429'); } }), { code: 'API_RATE_LIMIT' });
    }
});

test('Malformed details fail explicitly rather than returning a silently incomplete search', async () => {
    await assert.rejects(searchWebMetadataProvider('Goodreads', { query: 'x' }, runtimeFor(goodreadsSearch(), '<html><h1>Sign in</h1></html>')), { code: 'METADATA_RESPONSE_INVALID' });
    await assert.rejects(searchWebMetadataProvider('LubimyCzytac', { query: 'x', page: 2 }, runtimeFor('{"code":"ERROR"}', '')), { code: 'METADATA_RESPONSE_INVALID' });
});

test('Pagination state follows Goodreads links and LubimyCzytac total count', async () => {
    const withNext = await searchWebMetadataProvider('Goodreads', { query: 'sample' }, runtimeFor(`${goodreadsSearch()}<a class="next_page" rel="next" href="/search?page=2">next</a>`, goodreadsDetail()));
    assert.equal(withNext.hasNext, true);
    const lastPage = await searchWebMetadataProvider('Goodreads', { query: 'sample' }, runtimeFor(`${goodreadsSearch()}<span class="next_page disabled">next</span>`, goodreadsDetail()));
    assert.equal(lastPage.hasNext, false);
    for (const [page, expected] of [[2, true], [3, false]]) {
        const results = await searchWebMetadataProvider('LubimyCzytac', { query: 'sample', page }, runtimeFor(JSON.stringify({ code: 'OK', data: { count: 25, content: lubimySearch } }), lubimyDetail));
        assert.equal(results.hasNext, expected);
    }
});

test('The generic transport rate-limit sentinel stays distinguishable from access challenges', async () => {
    await assert.rejects(searchWebMetadataProvider('Goodreads', { query: 'x' }, { requestText: async () => { throw new Error('RATE_LIMIT'); } }), { code: 'API_RATE_LIMIT' });
    await assert.rejects(searchWebMetadataProvider('Kobo', { query: 'x' }, { requestText: async () => { throw new Error('HTTP 403'); } }), { code: 'METADATA_ACCESS_BLOCKED' });
});

test('Detail links cannot leave provider hosts, include credentials, or use unrelated paths', async () => {
    const malicious = ['https://127.0.0.1/book/show/5', '//evil.example/book/show/6', 'https://user:secret@www.goodreads.com/book/show/7', '/user/sign_in', 'http://www.goodreads.com/book/show/8'];
    const rows = malicious.map(url => `<tr itemtype="http://schema.org/Book"><td><a class="bookTitle" href="${url}">Unsafe</a></td></tr>`).join('');
    const runtime = runtimeFor(goodreadsSearch(123, rows), goodreadsDetail());
    const results = await searchWebMetadataProvider('Goodreads', { query: 'sample', apiKeys: { secret: 'never-forward' } }, runtime);
    assert.equal(results.length, 1);
    assert.equal(runtime.calls.length, 2);
    assert.ok(runtime.calls.every(([, headers]) => !headers.Authorization && !headers.Cookie));
});

test('Detail hydration keeps result order, limits results to twenty, and runs at most three requests', async () => {
    const search = Array.from({ length: 25 }, (_, index) => goodreadsSearch(index + 1)).join('');
    let active = 0;
    let maximum = 0;
    let details = 0;
    const runtime = { requestText: async url => {
        if (new URL(url).pathname === '/search') return search;
        active++;
        maximum = Math.max(maximum, active);
        details++;
        await new Promise(resolve => setTimeout(resolve, 2));
        active--;
        return goodreadsDetail(Number(new URL(url).pathname.match(/\d+/)[0]));
    } };
    const results = await searchWebMetadataProvider('Goodreads', { query: 'sample' }, runtime);
    assert.equal(results.length, 20);
    assert.equal(details, 20);
    assert.equal(maximum, 3);
    assert.deepEqual(results.map(result => result.ID), Array.from({ length: 20 }, (_, index) => String(index + 1)));
});

test('A blocked detail stops scheduling additional requests', async () => {
    let details = 0;
    const runtime = { requestText: async url => {
        if (new URL(url).pathname === '/search') return Array.from({ length: 20 }, (_, index) => goodreadsSearch(index + 1)).join('');
        details++;
        return '<title>Access denied</title>';
    } };
    await assert.rejects(searchWebMetadataProvider('Goodreads', { query: 'sample' }, runtime), { code: 'METADATA_ACCESS_BLOCKED' });
    assert.ok(details <= 3);
});
