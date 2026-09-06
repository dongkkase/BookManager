import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { searchYes24 } from './yes24Search.js';
import { setLanguage, t } from './utils/i18n.js';

setLanguage('ko');
const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const sampleItem = {
    itemId: 1234,
    title: '테스트 &amp; 도서 2',
    author: '테스트 저자',
    publisher: '테스트 출판사',
    isbn13: '978-89-1234-567-8',
    isbn10: '8912345678',
    publishDate: '2026-09-06',
    pages: 240,
    starScore: 9.4,
    adultYn: 'Y',
    cover: 'https://image.yes24.com/goods/1234/L',
    link: 'https://www.yes24.com/product/goods/1234',
    contentDetail: {
        bookIntroduction: '<p>책 소개 &amp; 설명</p><p>다음 문단</p>',
        bookSummary: '줄거리<br>둘째 줄',
    },
    series: [{ seriesId: 12, seriesName: '테스트 시리즈' }],
};

function successResponse(items = []) {
    return { success: true, errorCode: null, data: { items, currentPage: 2, pageSize: 20, totalCount: 21 } };
}

function sourceFunction(name) {
    const start = ipcSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return ipcSource.slice(start, ipcSource.indexOf('\n}', start) + 2);
}

function requestWithResponse(statusCode, payload) {
    const transport = {
        get(_url, _options, callback) {
            const response = new EventEmitter();
            response.statusCode = statusCode;
            response.setEncoding = () => {};
            callback(response);
            queueMicrotask(() => {
                response.emit('data', typeof payload === 'string' ? payload : JSON.stringify(payload));
                response.emit('end');
            });
            return new EventEmitter();
        },
    };
    return vm.runInNewContext(`${sourceFunction('requestJsonGeneric')}\nrequestJsonGeneric`, {
        URL,
        http: transport,
        https: transport,
        i18nT: t,
    });
}

test('YES24 검색은 키를 헤더로 전달하고 상세 정보와 페이지를 요청한다', async () => {
    const calls = [];
    const results = await searchYes24('  테스트 & 도서  ', '  yk_live_test  ', 2, async (...args) => {
        calls.push(args);
        return successResponse([sampleItem]);
    });
    assert.equal(calls.length, 1);
    const [url, headers, timeout] = calls[0];
    const requestUrl = new URL(url);
    assert.equal(requestUrl.origin, 'https://apis.yes24.com');
    assert.equal(requestUrl.pathname, '/v1/goods/itemList');
    assert.deepEqual(Object.fromEntries(requestUrl.searchParams), {
        query: '테스트 & 도서', category: 'BOOK', sort: 'RELATION', page: '2', pageSize: '20', detail: 'Y',
    });
    assert.deepEqual(headers, { 'X-Api-Key': 'yk_live_test' });
    assert.ok(timeout > 0);
    assert.ok(!url.includes('yk_live_test'));
    assert.equal(results[0].Title, '테스트 & 도서 2');
    assert.equal(results[0].Series, '테스트 시리즈');
    assert.equal(results[0].ISBN, '9788912345678');
    assert.equal(results[0].Writer, '테스트 저자');
    assert.equal(results[0].Publisher, '테스트 출판사');
    assert.equal(results[0].PubDate, '2026-09-06');
    assert.equal(results[0].PageCount, '240');
    assert.equal(results[0].CommunityRating, '9.4');
    assert.equal(results[0].Summary, '책 소개 & 설명\n다음 문단\n\n줄거리\n둘째 줄');
    assert.equal(results[0].CoverUrl, sampleItem.cover);
    assert.equal(results[0].Web, sampleItem.link);
});

test('YES24 요청은 자모가 분리된 한글 검색어를 NFC로 정규화한다', async () => {
    const query = '왕좌의 게임';
    for (const input of [query, query.normalize('NFD')]) {
        await searchYes24(`  ${input}  `, 'key', 1, async url => {
            assert.equal(new URL(url).searchParams.get('query'), query);
            return successResponse();
        });
    }
});

test('YES24 응답의 선택 필드 누락과 빈 결과를 처리한다', async () => {
    const [item] = await searchYes24('제목', 'key', 1, async () => successResponse([{
        itemId: 1, title: '제목', isbn10: '891234567X', series: null, pages: null, starScore: null,
    }]));
    assert.equal(item.Series, '제목');
    assert.equal(item.ISBN, '891234567X');
    assert.equal(item.PageCount, '');
    assert.equal(item.CommunityRating, '');
    assert.equal(item.Summary, '');
    assert.equal(item.Writer, '');
    assert.deepEqual(await searchYes24('없음', 'key', 1, async () => successResponse()), []);
});

test('YES24 검색의 키 누락과 빈 검색어는 네트워크 요청을 보내지 않는다', async () => {
    const unexpectedRequest = () => assert.fail('unexpected request');
    await assert.rejects(searchYes24('제목', '  ', 1, unexpectedRequest), { message: t('api_key_missing') });
    assert.deepEqual(await searchYes24('  ', 'key', 1, unexpectedRequest), []);
});

test('YES24 페이지 값이 유효하지 않으면 첫 페이지를 요청한다', async () => {
    for (const page of [0, -1, 1.5, NaN, Infinity]) {
        await searchYes24('제목', 'key', page, async url => {
            assert.equal(new URL(url).searchParams.get('page'), '1');
            return successResponse();
        });
    }
});

test('YES24 검색 결과 없음은 404 응답에서도 빈 목록으로 처리한다', async () => {
    const payload = { success: false, errorCode: 'SEARCH_001', message: '검색 결과가 없습니다.', data: null };
    assert.deepEqual(await searchYes24('없음', 'key', 1, requestWithResponse(404, payload)), []);
    assert.deepEqual(await searchYes24('없음', 'key', 1, async () => payload), []);
    await assert.rejects(searchYes24('제목', 'key', 1, requestWithResponse(404, { message: 'Unknown route' })), /HTTP 404/);
});

test('YES24 인증 실패와 호출 한도 초과를 구분해 안내한다', async () => {
    for (const [status, errorCode, messageKey] of [
        [401, 'AUTH_001', 'api_yes24_invalid_key'],
        [401, 'AUTH_002', 'api_yes24_invalid_key'],
        [429, 'RATE_001', 'api_yes24_rate_limit'],
        [429, 'RATE_002', 'api_yes24_rate_limit'],
    ]) {
        const payload = { success: false, errorCode, data: null };
        await assert.rejects(searchYes24('제목', 'key', 1, requestWithResponse(status, payload)), { message: t(messageKey) });
        await assert.rejects(searchYes24('제목', 'key', 1, async () => payload), { message: t(messageKey) });
    }
});

test('YES24의 잘못된 응답을 검색 결과 없음으로 처리하지 않고 오류에서 키를 가린다', async () => {
    for (const payload of [null, {}, { success: true, data: {} }, { success: true, data: { items: {} } }]) {
        await assert.rejects(searchYes24('제목', 'key', 1, async () => payload), { message: t('api_response_unhandled') });
    }
    await assert.rejects(searchYes24('제목', 'key', 1, async () => {
        throw new SyntaxError('Invalid JSON');
    }), { message: t('api_response_unhandled') });
    await assert.rejects(searchYes24('제목', 'yk_live_secret', 1, requestWithResponse(500, {
        message: 'Failed for yk_live_secret',
    })), error => {
        assert.ok(error.message.includes('[REDACTED]'));
        assert.ok(!error.message.includes('yk_live_secret'));
        return true;
    });
    await assert.rejects(searchYes24('제목', 'key', 1, async () => {
        throw new Error('Timed out');
    }), /Timed out/);
});

test('YES24 IPC 검색은 저장된 키, 페이지와 책 타입을 결과 및 캐시에 반영한다', async () => {
    const helpers = [
        'normalizeApiSource', 'normalizeSearchBookType', 'isMetadataApiAllowedForBookType',
        'metadataFormatForBookType', 'mangaValueForBookType', 'parseDateParts', 'normalizeSearchResult',
    ].map(sourceFunction).join('\n');
    const handlerStart = ipcSource.indexOf("  ipcMain.handle('api:fetch',");
    const handlerEnd = ipcSource.indexOf("  ipcMain.handle('api:ridiBookDetail',", handlerStart);
    let handler;
    let requestCount = 0;
    const cached = new Map();
    vm.runInNewContext(`${helpers}\n${ipcSource.slice(handlerStart, handlerEnd)}`, {
        ipcMain: { handle(_name, callback) { handler = callback; } },
        configManager: { getConfig: () => ({ api_keys: { yes24: 'yk_live_saved' } }) },
        searchYes24,
        requestJsonGeneric: async (url, headers) => {
            requestCount += 1;
            assert.equal(new URL(url).searchParams.get('page'), '2');
            assert.equal(new URL(url).searchParams.get('query'), '왕좌의 게임');
            assert.equal(headers['X-Api-Key'], 'yk_live_saved');
            return successResponse([sampleItem]);
        },
        i18nT: t,
        metadataSearchLog: () => {},
        openApiCacheDbSafe: () => ({ close() {} }),
        getCachedApiResults: (_db, api, query) => cached.get(`${api}:${query}`),
        setCachedApiResults: async (_db, api, query, results) => cached.set(`${api}:${query}`, results),
        stripTransientApiImageFieldsFromResults: results => results,
        apiCoverCacheDir: () => '',
        enrichResultImages: async results => results,
    });
    for (const [bookType, format] of [['comic', 'Manga'], ['book', 'Novel'], ['pdf', 'PDF'], ['audio', 'Audiobook']]) {
        const options = { apiSource: 'yes24', query: '왕좌의 게임'.normalize('NFD'), page: 2, bookType };
        const result = await handler({}, options);
        assert.equal(result.success, true);
        assert.equal(result.api, 'YES24');
        assert.equal(result.actualQuery, '왕좌의 게임');
        assert.equal(result.cached, false);
        assert.equal(result.results[0].id, '1234');
        assert.equal(result.results[0].coverUrl, sampleItem.cover);
        assert.equal(result.results[0].metadata.Format, format);
        assert.equal(result.results[0].metadata.Year, '2026');
        assert.equal(result.results[0].metadata.Month, '9');
        assert.equal(result.results[0].metadata.Day, '6');
        assert.equal(result.results[0].metadata.Manga, bookType === 'comic' ? 'YesAndRightToLeft' : '');
        const fromCache = await handler({}, { ...options, apiSource: '예스24', query: '왕좌의 게임' });
        assert.equal(fromCache.cached, true);
    }
    assert.equal(requestCount, 4);
    assert.equal(cached.size, 4);
});
