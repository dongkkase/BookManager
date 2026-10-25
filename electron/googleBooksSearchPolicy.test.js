import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../src/utils/i18nData.js', import.meta.url), 'utf8');

function sourceFunction(name) {
    const start = ipcSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const prefix = ipcSource.slice(start - 6, start) === 'async ' ? 'async ' : '';
    return prefix + ipcSource.slice(start, ipcSource.indexOf('\n}', start) + 2);
}

function providerContext(functions, globals = {}) {
    const context = vm.createContext({ URL, URLSearchParams, ...globals });
    vm.runInContext(functions.map(sourceFunction).join('\n'), context);
    return context;
}

test('Google Books API ratings use the known five-point source scale when creating app metadata', async () => {
    const context = providerContext([
        'normalizeSearchResult', 'pickBookIsbn', 'parseDateParts', 'stripHtml',
        'metadataFormatForBookType', 'mangaValueForBookType', 'searchGoogleBooks',
    ], {
        requestJsonGeneric: async () => ({ items: [{ id: 'example', volumeInfo: { title: 'Example', averageRating: 2.25 } }] }),
        enrichGoogleBooksRatings: async results => results,
    });
    const [result] = await context.searchGoogleBooks('Example', 'key');
    assert.equal(result.metadata.CommunityRating, '4.5');
    assert.equal(result.Rating, '2.25 / 5.0');
    assert.equal(result.metadata.Manga, '');
});

test('Google Books page enrichment also converts five-point ratings and leaves existing app ratings alone', async () => {
    const context = providerContext(['enrichGoogleBooksRatings'], {
        fetchGoogleBooksStarRating: async () => '4.25',
    });
    const results = await context.enrichGoogleBooksRatings([
        { link: 'https://books.google.com/books?id=example', metadata: {} },
        { link: 'https://books.google.com/books?id=existing', metadata: { CommunityRating: '4.5' } },
    ]);
    assert.equal(results[0].CommunityRating, '8.5');
    assert.equal(results[0].metadata.CommunityRating, '8.5');
    assert.equal(results[0].Rating, '4.25 / 5.0');
    assert.equal(results[1].metadata.CommunityRating, '4.5');
});

test('Amazon search ratings use the declared five-point source scale', () => {
    const context = providerContext([
        'stripHtml', 'escapeRegExp', 'cleanAmazonText', 'amazonUrlFromPath', 'amazonImageUrl',
        'parseAmazonRating', 'extractAmazonSearchAuthor', 'metadataFormatForBookType',
        'mangaValueForBookType', 'parseAmazonSearchHtml',
    ], { decodeHtmlEntities: value => String(value || '') });
    const [result] = context.parseAmazonSearchHtml(
        '<div data-component-type="s-search-result"><a href="/dp/B000000001"></a><h2><span>Example</span></h2><span>4.5 out of 5 stars</span>',
    );
    assert.equal(result.CommunityRating, '9');
    assert.equal(result.Rating, '4.5 / 5.0');
});

test('Google Books HTTP 오류는 API 응답 메시지를 유지하고 키 문자열을 숨긴다', () => {
    assert.match(ipcSource, /apiMessage = parsed\?\.error\?\.message \|\| parsed\?\.message/);
    assert.match(ipcSource, /replace\(\/\\bAIza/);
    assert.match(ipcSource, /new Error\(`HTTP \$\{res\.statusCode\}\$\{apiMessage/);
});

test('만료된 Google Books API 키는 환경설정 안내로 변환한다', () => {
    assert.match(ipcSource, /api key expired[\s\S]*api_google_books_key_expired/i);
    assert.match(i18nSource, /"api_google_books_key_expired"/);
});
