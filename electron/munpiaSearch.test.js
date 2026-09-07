import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { detectImageMimeType } from './imageMagic.js';
import { searchMunpia } from './munpiaSearch.js';
import { setLanguage, t } from './utils/i18n.js';

setLanguage('ko');
const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const sampleNovel = {
    title: '환생 수선전',
    author: '안경쓴팬더',
    mainGenre: '무협',
    subGenre: '퓨전',
    novelId: 482756,
    coverUrl: 'https://cdn1.munpia.com/v2/files/cover/2025/0725/10/E2cdd-wkMAA',
    viewCount: 1201692,
    entryCount: 202,
    updateAt: '2025-12-26',
    finished: true,
    story: "'이 세상에 신선이 있다고?'\r\n\r\n환생한 서진은 그저 궁금했을 뿐이었다.",
    tag: ['선협', '천재', '환생', '동양판타지', '상태창'],
    groupCode: 'pl.serial',
    groupName: '유료',
    adult: false,
    illustrator: '',
};

function successResponse(items = []) {
    return {
        code: 'M000_00000',
        message: 'OK',
        result: { searchNovelTabDtos: items, hasNext: false },
    };
}

function sourceFunction(name) {
    const start = ipcSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return ipcSource.slice(start, ipcSource.indexOf('\n}', start) + 2);
}

function createIpcHarness(requestJson) {
    const helpers = [
        'normalizeApiSource', 'normalizeSearchBookType', 'isMetadataApiAllowedForBookType',
        'metadataFormatForBookType', 'mangaValueForBookType', 'parseDateParts', 'normalizeSearchResult',
    ].map(sourceFunction).join('\n');
    const handlerStart = ipcSource.indexOf("  ipcMain.handle('api:fetch',");
    const handlerEnd = ipcSource.indexOf("  ipcMain.handle('api:ridiBookDetail',", handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
    let handler;
    let closeCount = 0;
    const cached = new Map();
    vm.runInNewContext(`${helpers}\n${ipcSource.slice(handlerStart, handlerEnd)}`, {
        ipcMain: { handle(_name, callback) { handler = callback; } },
        configManager: { getConfig: () => ({}) },
        searchMunpia,
        requestJsonGeneric: requestJson,
        i18nT: t,
        metadataSearchLog: () => {},
        openApiCacheDbSafe: () => ({ close() { closeCount += 1; } }),
        getCachedApiResults: (_db, api, query) => cached.get(`${api}:${query}`),
        setCachedApiResults: async (_db, api, query, results) => cached.set(`${api}:${query}`, results),
        stripTransientApiImageFieldsFromResults: results => results,
        apiCoverCacheDir: () => '',
        enrichResultImages: async results => results,
    });
    return { handler, cached, get closeCount() { return closeCount; } };
}

test('문피아 검색은 공개 API에 검색 조건과 0부터 시작하는 페이지를 전달한다', async () => {
    const calls = [];
    await searchMunpia('  수선전 & 환생  ', 2, async (...args) => {
        calls.push(args);
        return successResponse([sampleNovel]);
    });
    assert.equal(calls.length, 1);
    const requestUrl = new URL(calls[0][0]);
    assert.equal(requestUrl.origin, 'https://www.munpia.com');
    assert.equal(requestUrl.pathname, '/api/v1/main/search');
    assert.deepEqual(Object.fromEntries(requestUrl.searchParams), {
        query: '수선전 & 환생',
        tab: 'ALL',
        sort: 'SIMILARITY',
        novelType: 'ALL',
        finishedOnly: 'false',
        adultMode: 'true',
        page: '1',
        size: '20',
    });
});

test('문피아의 실제 검색 응답을 기존 메타데이터 필드로 변환한다', async () => {
    const [item] = await searchMunpia('수선전', 1, async () => successResponse([sampleNovel]));
    assert.equal(item.ID, '482756');
    assert.equal(item.Title, '환생 수선전');
    assert.equal(item.Series, item.Title);
    assert.equal(item.LocalizedSeries, item.Title);
    assert.equal(item.Writer, '안경쓴팬더');
    assert.equal(item.Summary, "'이 세상에 신선이 있다고?'\n\n환생한 서진은 그저 궁금했을 뿐이었다.");
    assert.equal(item.Genre, '무협, 퓨전');
    assert.equal(item.Tags, '선협, 천재, 환생, 동양판타지, 상태창');
    assert.equal(item.Count, '202');
    assert.equal(item.Web, 'https://www.munpia.com/novel/detail/482756');
    assert.equal(item.CoverUrl, sampleNovel.coverUrl);
    for (const field of ['Publisher', 'ISBN', 'PubDate', 'CommunityRating']) {
        assert.equal(item[field] || '', '', field);
    }
    assert.ok(['', '-'].includes(item.Rating || ''));
    assert.notEqual(item.AgeRating, '19세 이상');
});

test('문피아 텍스트의 HTML과 엔티티를 정리하고 장르와 태그 중복을 제거한다', async () => {
    const [item] = await searchMunpia('제목', 1, async () => successResponse([{
        ...sampleNovel,
        title: '  제목 &amp; 부제  ',
        author: '글 &amp; 저자',
        illustrator: '그림 &amp; 작가',
        story: '<p>첫 문단 &amp; 설명</p><p>둘째 문단<br>다음 줄 &#39;인용&#39;</p>',
        mainGenre: ' 판타지 ',
        subGenre: '판타지',
        tag: ['환생', ' 환생 ', '', '성장 &amp; 모험', null],
        adult: true,
    }]));
    assert.equal(item.Title, '제목 & 부제');
    assert.equal(item.Writer, '글 & 저자');
    assert.equal(item.Penciller, '그림 & 작가');
    assert.equal(item.Summary, "첫 문단 & 설명\n둘째 문단\n다음 줄 '인용'");
    assert.equal(item.Genre, '판타지');
    assert.equal(item.Tags, '환생, 성장 & 모험');
    assert.equal(item.AgeRating, '19세 이상');
});

test('문피아 표지 주소의 HTTP와 프로토콜 생략 형식을 HTTPS로 정규화한다', async () => {
    for (const coverUrl of ['http://cdn1.munpia.com/cover.jpg', '//cdn1.munpia.com/cover.jpg']) {
        const [item] = await searchMunpia('제목', 1, async () => successResponse([{
            ...sampleNovel, coverUrl,
        }]));
        assert.equal(item.CoverUrl, 'https://cdn1.munpia.com/cover.jpg');
    }
});

test('문피아처럼 확장자가 없는 PNG 표지는 응답 MIME과 무관하게 원본 PNG로 보존한다', () => {
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ZkAAAAASUVORK5CYII=', 'base64');
    let conversionCount = 0;
    const normalizeCover = vm.runInNewContext(`${sourceFunction('normalizeApiCoverImageBuffer')}\nnormalizeApiCoverImageBuffer`, {
        Buffer,
        detectImageMimeType,
        nativeImage: {
            createFromBuffer() {
                conversionCount += 1;
                return { isEmpty: () => true };
            },
        },
    });
    for (const mimeType of ['image/jpeg', 'application/octet-stream', '']) {
        const result = normalizeCover(pngBuffer, mimeType);
        assert.equal(result.mimeType, 'image/png');
        assert.strictEqual(result.buffer, pngBuffer);
    }
    assert.equal(conversionCount, 0);
});

test('문피아 표지를 직접 불러올 때도 PNG 데이터 URL과 원본 바이트를 유지한다', async () => {
    const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ZkAAAAASUVORK5CYII=', 'base64');
    const requestedUrls = [];
    const cacheKeys = [];
    const fetchImageDataUrl = vm.runInNewContext(`async ${sourceFunction('fetchImageDataUrlFromUrl')}\nfetchImageDataUrlFromUrl`, {
        URL,
        detectImageMimeType,
        imageDataUrlCache: {
            getOrLoad(key, loader) {
                cacheKeys.push(key);
                return loader();
            },
        },
        requestBufferGeneric: async url => {
            requestedUrls.push(url);
            return { buffer: pngBuffer, contentType: 'application/octet-stream' };
        },
        mimeFromUrl: () => 'image/jpeg',
    });
    const result = await fetchImageDataUrl(sampleNovel.coverUrl);
    assert.ok(result.startsWith('data:image/png;base64,'));
    assert.deepEqual(Buffer.from(result.split(',')[1], 'base64'), pngBuffer);
    assert.deepEqual(requestedUrls, [sampleNovel.coverUrl]);
    assert.deepEqual(cacheKeys, [sampleNovel.coverUrl]);
});

test('문피아의 선택 필드가 없는 항목도 제목과 상세 링크를 유지한다', async () => {
    const [item] = await searchMunpia('제목', 1, async () => successResponse([{
        novelId: '1234', title: '제목',
    }]));
    assert.equal(item.ID, '1234');
    assert.equal(item.Title, '제목');
    assert.equal(item.Web, 'https://www.munpia.com/novel/detail/1234');
    for (const field of ['Writer', 'Penciller', 'Summary', 'Genre', 'Tags', 'Count', 'CoverUrl']) {
        assert.equal(item[field] || '', '', field);
    }
});

test('문피아 회차 수는 0 이상의 정수만 사용한다', async () => {
    for (const [entryCount, expected] of [[0, '0'], ['202', '202'], [-1, ''], [1.5, ''], [null, ''], [undefined, ''], ['잘못된 수', '']]) {
        const [item] = await searchMunpia('제목', 1, async () => successResponse([{
            ...sampleNovel, entryCount,
        }]));
        assert.equal(item.Count || '', expected, String(entryCount));
    }
});

test('문피아 검색은 제목이나 작품 ID가 없는 항목을 제외한다', async () => {
    const results = await searchMunpia('제목', 1, async () => successResponse([
        null, false, '잘못된 항목', {},
        { novelId: 2, title: '' },
        { novelId: 3, title: '   ' },
        { novelId: '', title: 'ID 없음' },
        { novelId: null, title: 'ID 없음' },
        { novelId: '../detail', title: '잘못된 ID' },
        { novelId: 0, title: '잘못된 ID' },
        sampleNovel,
    ]));
    assert.equal(results.length, 1);
    assert.equal(results[0].ID, '482756');
});

test('문피아 검색은 한글 검색어를 NFC로 정규화하고 빈 검색어는 요청하지 않는다', async () => {
    const query = '환생 수선전';
    for (const input of [query, query.normalize('NFD')]) {
        await searchMunpia(`  ${input}  `, 1, async url => {
            assert.equal(new URL(url).searchParams.get('query'), query);
            return successResponse();
        });
    }
    assert.deepEqual(await searchMunpia('  ', 1, () => assert.fail('unexpected request')), []);
});

test('문피아의 첫 페이지와 잘못된 페이지 값은 API의 0페이지를 요청한다', async () => {
    for (const page of [undefined, 1, 0, -1, 1.5, NaN, Infinity, '잘못된 페이지']) {
        await searchMunpia('제목', page, async url => {
            assert.equal(new URL(url).searchParams.get('page'), '0', String(page));
            return successResponse();
        });
    }
});

test('문피아의 빈 검색 결과와 잘못된 API 응답을 구분한다', async () => {
    assert.deepEqual(await searchMunpia('없음', 1, async () => successResponse()), []);
    for (const payload of [
        null, {},
        { code: 'M000_00000', result: {} },
        { code: 'M000_00000', result: { searchNovelTabDtos: {} } },
        { code: 'M000_00000', result: { searchNovelTabDtos: null } },
        { code: 'M999_99999', result: { searchNovelTabDtos: [] } },
        { result: { searchNovelTabDtos: [] } },
    ]) {
        await assert.rejects(searchMunpia('제목', 1, async () => payload));
    }
});

test('문피아의 HTTP 오류와 시간 초과를 검색 결과 없음으로 숨기지 않는다', async () => {
    for (const message of ['HTTP 403', 'HTTP 429', 'HTTP 500', 'Timed out']) {
        await assert.rejects(searchMunpia('제목', 1, async () => {
            throw new Error(message);
        }), { message });
    }
    await assert.rejects(searchMunpia('제목', 1, async () => {
        throw new SyntaxError('Invalid JSON');
    }));
});

test('문피아 IPC는 키 없이 모든 책 타입을 검색하고 별칭과 정규화된 검색어의 캐시를 공유한다', async () => {
    let requestCount = 0;
    const harness = createIpcHarness(async url => {
        requestCount += 1;
        assert.equal(new URL(url).searchParams.get('page'), '1');
        assert.equal(new URL(url).searchParams.get('query'), '환생 수선전');
        return successResponse([sampleNovel]);
    });
    for (const [bookType, format] of [
        ['comic', 'Manga'], ['book', 'Novel'], ['pdf', 'PDF'], ['audio', 'Audiobook'],
    ]) {
        const options = { apiSource: 'munpia', query: '환생 수선전'.normalize('NFD'), page: 2, bookType };
        const result = await harness.handler({}, options);
        assert.equal(result.success, true, result.error);
        assert.equal(result.api, '문피아');
        assert.equal(result.actualQuery, '환생 수선전');
        assert.equal(result.cached, false);
        assert.equal(result.results[0].id, '482756');
        assert.equal(result.results[0].coverUrl, sampleNovel.coverUrl);
        assert.equal(result.results[0].link, 'https://www.munpia.com/novel/detail/482756');
        assert.equal(result.results[0].metadata.Format, format);
        assert.equal(result.results[0].metadata.Manga, bookType === 'comic' ? 'YesAndRightToLeft' : '');
        assert.equal(result.results[0].metadata.Count, '202');
        for (const field of ['Publisher', 'ISBN', 'CommunityRating', 'Year', 'Month', 'Day']) {
            assert.equal(result.results[0].metadata[field], '', field);
        }
        const fromCache = await harness.handler({}, { ...options, apiSource: '문피아', query: '환생 수선전' });
        assert.equal(fromCache.success, true);
        assert.equal(fromCache.cached, true);
    }
    const textResult = await harness.handler({}, { apiSource: 'MUNPIA', query: '환생 수선전', page: 2, bookType: 'TXT' });
    assert.equal(textResult.success, true, textResult.error);
    assert.equal(textResult.cached, true);
    assert.equal(textResult.results[0].metadata.Format, 'Novel');
    assert.equal(requestCount, 4);
    assert.equal(harness.cached.size, 4);
    assert.equal(harness.closeCount, 13);
});

test('문피아 IPC의 검색 오류는 실패 결과로 반환되고 캐시에 저장되지 않는다', async () => {
    const harness = createIpcHarness(async () => {
        throw new Error('HTTP 503');
    });
    const result = await harness.handler({}, { apiSource: '문피아', query: '수선전', bookType: 'book' });
    assert.equal(result.success, false);
    assert.equal(result.api, '문피아');
    assert.equal(result.cached, false);
    assert.equal(result.error, 'HTTP 503');
    assert.equal(result.results.length, 0);
    assert.equal(harness.cached.size, 0);
    assert.equal(harness.closeCount, 1);
});
