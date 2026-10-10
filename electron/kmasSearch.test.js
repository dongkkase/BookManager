import assert from 'node:assert/strict';
import test from 'node:test';
import { kmasSearchParams, parseKmasSearchResponse, searchKmas } from './kmasSearch.js';

const sampleWebtoon = {
    MASTR_ID: '2024020423',
    LIST_SE_CD: '1',
    TITLE: '<em>나</em> <em>혼자</em> <em>부활</em>한다',
    TITLE_N: '나 혼자 부활한다',
    SNTNC_WRITR_NM: '앵무새',
    PICTR_WRITR_NM: '스튜디오 크힛',
    PLTFOM_CD_NM: '카카오페이지',
    PLSCMPN_ID_NM: '',
    OUTLINE: '『고유능력: 부활』 &quot;뭐지?&quot;',
    MAIN_GENRE_CD_NM: '판타지',
    PUSRY_BEGIN_DE: '20240814',
    FILE_IMAGE_ID: 'd326e47c-d06d-42e7-9b07-18bef0d8ecbc',
    AGE_GRAD_NM: '15세 이상',
    FNSH_YN: 'N',
};

function response(items = [sampleWebtoon], total = items.length) {
    return { result: 'success', allDataObj: { dataList: items }, pageInfo: { totalRecordCount: total } };
}

test('한국웹툰은 제공된 검색 조건을 유지하고 keyword1에 검색어를 넣는다', () => {
    assert.deepEqual(Object.fromEntries(kmasSearchParams('  나 혼자 & 부활  '.normalize('NFD'), 2)), {
        index: 'distribution', pageIndex: '2', recordCountPerPage: '10', grpField: '', grpCd: '',
        dtlSearch: 'N', sort: '$relevance desc', before: 'Y', category: '1',
        target1: 'all', target2: 'all', target3: 'all', keyword: '', keyword1: '나 혼자 & 부활',
        kindOpr1: 'AND', keyword2: '', kindOpr2: 'AND', keyword3: '', pusryStartDate: '',
        pusryEndDate: '', pusryStartDateEnd: '', pusryEndDateEnd: '', fnshYn: 'A', ageGradCd: '', pblcateYn: 'A',
    });
    for (const page of [0, -1, NaN, Infinity, 1.5, 'invalid']) {
        assert.equal(kmasSearchParams('제목', page).get('pageIndex'), '1');
    }
});

test('한국웹툰 검색 응답을 작가 역할과 웹툰 형식에 맞게 변환한다', () => {
    const [item] = parseKmasSearchResponse(response());
    assert.equal(item.ID, sampleWebtoon.MASTR_ID);
    assert.equal(item.Title, '나 혼자 부활한다');
    assert.equal(item.Writer, '앵무새');
    assert.equal(item.Penciller, '스튜디오 크힛');
    assert.equal(item.Publisher, '카카오페이지');
    assert.equal(item.Summary, '『고유능력: 부활』 "뭐지?"');
    assert.equal(item.Genre, '판타지');
    assert.equal(item.AgeRating, '15세 이상');
    assert.equal(item.PubDate, '2024-08-14');
    assert.equal(item.Year, '2024');
    assert.equal(item.Month, '8');
    assert.equal(item.Day, '14');
    assert.equal(item.Format, 'Webtoon');
    assert.equal(item.Manga, 'No');
    assert.equal(item.LanguageISO, 'ko');
    assert.equal(item.Web, 'https://www.kmas.or.kr/search/detail/2024020423');
    assert.equal(new URL(item.CoverUrl).searchParams.get('fileImageId'), sampleWebtoon.FILE_IMAGE_ID);
    assert.equal(item.kmasHasNext, false);
    assert.equal(item.ISBN, '');
});

test('한국웹툰은 서로 다른 플랫폼의 동명 작품을 유지하고 중복 ID와 잘못된 항목을 제외한다', () => {
    const items = parseKmasSearchResponse(response([
        sampleWebtoon,
        { ...sampleWebtoon, MASTR_ID: '2024020424', PLTFOM_CD_NM: '카카오웹툰' },
        sampleWebtoon,
        null,
        { ...sampleWebtoon, MASTR_ID: '../invalid' },
        { ...sampleWebtoon, MASTR_ID: '30', LIST_SE_CD: '2' },
        { ...sampleWebtoon, MASTR_ID: '31', TITLE_N: '', TITLE: '' },
    ]));
    assert.deepEqual(items.map(item => item.ID), ['2024020423', '2024020424']);
    assert.deepEqual(items.map(item => item.Publisher), ['카카오페이지', '카카오웹툰']);
});

test('한국웹툰의 다음 페이지는 10개 단위와 전체 결과 수로 결정한다', () => {
    assert.equal(parseKmasSearchResponse(response([sampleWebtoon], 21), 2)[0].kmasHasNext, true);
    assert.equal(parseKmasSearchResponse(response([sampleWebtoon], 20), 2)[0].kmasHasNext, false);
    assert.equal(parseKmasSearchResponse(response([sampleWebtoon], 21), 3)[0].kmasHasNext, false);
});

test('한국웹툰의 정상적인 빈 검색과 오류 응답을 구분한다', () => {
    assert.deepEqual(parseKmasSearchResponse(response([])), []);
    assert.deepEqual(parseKmasSearchResponse({ result: 'fail', resultMsg: '검색하신 조건에 해당하는 정보가 없습니다.' }), []);
    for (const data of [null, {}, { result: 'success' }, { result: 'fail', resultMsg: '서버 오류' }, { vaildErrorMsg: '다시 시도해주세요.' }]) {
        assert.throws(() => parseKmasSearchResponse(data));
    }
});

test('한국웹툰은 검색 화면과 같은 POST 요청 후 상세정보를 병합한다', async () => {
    const calls = [];
    const items = await searchKmas('나 혼자 부활한다', 2, async (url, headers, timeout, options) => {
        calls.push({ url: new URL(url), headers, timeout, options });
        if (url.includes('callDetailApi.ajax')) return JSON.stringify(response([sampleWebtoon], 22));
        if (url.includes('/search/detail/')) return `<div class="detail-basic with-img">
            <h3>나 혼자 부활한다</h3><dl><dt>연재기간</dt><dd>2024-08-14 ~ 연재 중</dd></dl></div>
            <div class="detail-basic with-fold"><h3>작품 줄거리</h3><div class="detail-con">첫 줄<br><br>둘째 줄</div></div>`;
        return '<div id="resultList"></div>';
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url.pathname, '/search/searchDetail');
    assert.equal(calls[0].url.searchParams.get('keyword1'), '나 혼자 부활한다');
    assert.equal(calls[1].url.pathname, '/search/engin/callDetailApi.ajax');
    assert.equal(calls[1].headers.Referer, calls[0].url.href);
    assert.equal(calls[1].headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
    assert.equal(calls[1].options.method, 'POST');
    assert.deepEqual(new URLSearchParams(calls[1].options.body), calls[0].url.searchParams);
    assert.equal(items[0].Summary, '첫 줄\n\n둘째 줄');
    assert.equal(items[0].Writer, '앵무새');
    assert.equal(items[0].AgeRating, '15세 이상');
    assert.equal(items[0].kmasHasNext, true);
    assert.equal(items[0].Notes, '연재기간: 2024-08-14 ~ 연재 중');
});

test('한국웹툰 상세 조회는 최대 3개씩 수행하고 실패한 상세는 검색 정보로 유지한다', async () => {
    const data = response(Array.from({ length: 10 }, (_, index) => ({ ...sampleWebtoon, MASTR_ID: String(2024020423 + index) })));
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const results = await searchKmas('제목', 1, async url => {
        if (url.includes('callDetailApi.ajax')) return JSON.stringify(data);
        if (url.includes('/search/searchDetail')) return '';
        active += 1;
        maxActive = Math.max(active, maxActive);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        completed += 1;
        throw new Error('HTTP 503');
    });
    assert.equal(completed, 10);
    assert.equal(maxActive, 3);
    assert.equal(results.length, 10);
    assert.equal(results[0].Summary, '『고유능력: 부활』 "뭐지?"');
});

test('한국웹툰의 잘못된 JSON과 통신 오류는 빈 검색으로 숨기지 않는다', async () => {
    await assert.rejects(searchKmas('제목', 1, async () => { throw new Error('HTTP 403'); }), { message: 'HTTP 403' });
    await assert.rejects(searchKmas('제목', 1, async () => '<html>서버 오류</html>'));
    let count = 0;
    assert.deepEqual(await searchKmas('  ', 1, async () => { count += 1; }), []);
    assert.equal(count, 0);
});
