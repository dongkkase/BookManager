import assert from 'node:assert/strict';
import test from 'node:test';
import { clearComicVineCreditsCache, getComicVineCreators, getComicVineVolume, searchComicVine } from './comicVineSearch.js';

const apiKey = 'test-comic-vine-key';
const runtime = { now: () => 0, sleep: async () => {} };

function volume(overrides = {}) {
    return {
        id: 167989,
        name: 'Gals Can’t Be Kind to Otaku?!',
        resource_type: 'volume',
        deck: 'English translation of the Japanese manga.',
        publisher: { name: 'Yen Press' },
        start_year: '2025',
        count_of_issues: 2,
        image: { super_url: 'https://comicvine.gamespot.com/a/uploads/scale_large/series-cover.jpg' },
        site_detail_url: 'https://comicvine.gamespot.com/gals-cant-be-kind-to-otaku/4050-167989/',
        first_issue: { id: 1140412, issue_number: '1' },
        people: [{ name: 'Unclassified Contributor', count: 2 }],
        ...overrides,
    };
}

function issue(overrides = {}) {
    return {
        id: 1140412,
        issue_number: '1',
        volume: { id: 167989 },
        person_credits: [
            { name: 'Norishiro-chan', role: 'writer' },
            { name: 'Uozumi Sakana', role: 'artist' },
            { name: 'Translator', role: 'translator' },
            { name: 'Letterer', role: 'letterer' },
            { name: 'Cover Contributor', role: 'cover' },
            { name: 'Unclassified Contributor' },
        ],
        ...overrides,
    };
}

function response(results, overrides = {}) {
    return { status_code: 1, error: 'OK', results, ...overrides };
}

function transport({ volumes = [volume()], resolveIssue = () => issue(), resolveVolume = () => volumes[0] } = {}) {
    const calls = [];
    const requestJson = async (requestUrl, headers, timeout) => {
        const url = new URL(requestUrl);
        calls.push({ url, headers, timeout });
        if (url.pathname === '/api/search/') {
            return response(volumes, { offset: 0, number_of_total_results: volumes.length });
        }
        if (url.pathname.startsWith('/api/volume/')) return response(await resolveVolume(url));
        assert.match(url.pathname, /^\/api\/issue\/4000-[1-9]\d*\/$/);
        return response(await resolveIssue(url));
    };
    return {
        requestJson,
        calls,
        issueCalls: () => calls.filter(call => call.url.pathname.startsWith('/api/issue/')),
    };
}

test('지연 검색은 첫 권 참조만 반환하고 작가 조회가 끝나기 전에 완료된다', async () => {
    let resolveCredits;
    const pendingCredits = new Promise(resolve => { resolveCredits = resolve; });
    const h = transport({ resolveIssue: () => pendingCredits });
    const credits = getComicVineCreators('167989', '1140412', apiKey, h.requestJson, runtime);
    const results = await searchComicVine('Otaku', apiKey, 1, h.requestJson, { ...runtime, deferCreators: true });
    assert.equal(results.length, 1);
    assert.equal(results.hasNext, false);
    assert.equal(results[0].comicVineFirstIssueId, '1140412');
    assert.equal(results[0].comicVineFirstIssueNumber, '1');
    assert.equal(results[0].Writer, '');
    assert.equal(results[0].Penciller, '');
    assert.equal(h.issueCalls().length, 1);
    resolveCredits(issue());
    assert.equal((await credits).Writer, 'Norishiro-chan');
});

test('검색 목록의 작가 보완은 별도 시리즈 조회 없이 상세 조회와 진행 중 캐시를 공유한다', async () => {
    let resolveCredits;
    const pendingCredits = new Promise(resolve => { resolveCredits = resolve; });
    const h = transport({ resolveIssue: () => pendingCredits });
    const [summary] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, { ...runtime, deferCreators: true });
    assert.equal(h.calls.length, 1);
    const credits = getComicVineCreators(summary.ID, summary.comicVineFirstIssueId, apiKey, h.requestJson, runtime);
    const detail = getComicVineVolume(summary.ID, apiKey, h.requestJson, runtime);
    resolveCredits(issue());
    const [patch, full] = await Promise.all([credits, detail]);
    assert.equal(patch.ID, summary.ID);
    assert.equal(patch.Writer, full.Writer);
    assert.equal(patch.Penciller, full.Penciller);
    assert.equal(patch.comicVineCreditsIssueId, '1140412');
    assert.equal(patch.Title, undefined);
    assert.equal(patch.CoverUrl, undefined);
    assert.equal(h.issueCalls().length, 1);
    assert.equal(h.calls.filter(call => call.url.pathname.startsWith('/api/volume/')).length, 1);
    await getComicVineCreators(summary.ID, summary.comicVineFirstIssueId, apiKey, h.requestJson, runtime);
    assert.equal(h.issueCalls().length, 1);
});

test('독립 작가 조회는 잘못된 ID와 API 키를 캐시 조회 전에 검증한다', async () => {
    const h = transport();
    await getComicVineCreators('167989', '1140412', apiKey, h.requestJson, runtime);
    for (const [id, firstIssueId] of [['../167989', '1140412'], ['167989', '../1140412'], ['167989', '0'], ['', '1140412']]) {
        await assert.rejects(getComicVineCreators(id, firstIssueId, apiKey, h.requestJson, runtime), { code: 'API_INVALID_RESPONSE' });
    }
    await assert.rejects(getComicVineCreators('167989', '1140412', '', h.requestJson, runtime), { code: 'API_AUTH_REQUIRED' });
    assert.equal(h.issueCalls().length, 1);
});

test('Comic Vine 검색 결과는 선택하기 전에 첫 권의 저자와 그림 작가를 제공한다', async () => {
    const h = transport();
    const results = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
    assert.equal(results.length, 1);
    assert.equal(results.hasNext, false);
    assert.ok(h.calls[0].url.searchParams.get('field_list').split(',').includes('first_issue'));
    assert.equal(h.issueCalls().length, 1);
    const call = h.issueCalls()[0];
    assert.equal(call.url.origin, 'https://comicvine.gamespot.com');
    assert.equal(call.url.pathname, '/api/issue/4000-1140412/');
    assert.equal(call.url.searchParams.get('api_key'), apiKey);
    const fields = call.url.searchParams.get('field_list').split(',');
    for (const field of ['id', 'volume', 'issue_number', 'person_credits']) assert.ok(fields.includes(field), field);
    assert.match(call.headers['User-Agent'], /BookManager/);
    assert.equal(results[0].Writer, 'Norishiro-chan');
    assert.equal(results[0].Penciller, 'Uozumi Sakana');
    assert.equal(results[0].Letterer, '');
    assert.equal(results[0].CoverArtist, '');
    assert.equal(results[0].comicVineCreditsIssueId, '1140412');
    assert.equal(results[0].comicVineCreditsIssueNumber, '1');
    assert.equal(results[0].comicVineCreditsIssueWeb, 'https://comicvine.gamespot.com/issue/4000-1140412/');
    assert.ok(!results[0].comicVineCreditsError);
});

test('첫 권은 비어 있는 작가 필드만 채우고 시리즈 정보와 기존 크레딧을 유지한다', async () => {
    const original = volume({
        person_credits: [
            { name: 'Series Writer', role: 'writer' },
            { name: 'Series Editor', role: 'editor' },
        ],
        characters: [{ name: 'Series Character' }],
    });
    const h = transport({
        volumes: [original],
        resolveIssue: () => issue({
            name: 'First Issue Title',
            issue_number: '0',
            cover_date: '2024-12-31',
            image: { super_url: 'https://comicvine.gamespot.com/a/uploads/issue-cover.jpg' },
            description: 'First issue description',
            character_credits: [{ name: 'Issue Character' }],
            person_credits: [...issue().person_credits, { name: 'Issue Editor', role: 'editor' }],
        }),
    });
    const [result] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
    assert.equal(result.Writer, 'Series Writer');
    assert.equal(result.Penciller, 'Uozumi Sakana');
    assert.equal(result.Editor, 'Series Editor');
    assert.equal(result.Characters, 'Series Character');
    assert.equal(result.ID, String(original.id));
    assert.equal(result.Title, original.name);
    assert.equal(result.Series, original.name);
    assert.equal(result.Summary, original.deck);
    assert.equal(result.Publisher, original.publisher.name);
    assert.equal(result.Count, '2');
    assert.equal(result.Year, '2025');
    assert.equal(result.PubDate, '2025');
    assert.equal(result.Number, undefined);
    assert.equal(result.CoverUrl, original.image.super_url);
    assert.equal(result.Web, original.site_detail_url);
    assert.equal(result.comicVineCreditsIssueNumber, '0');
});

test('작가 역할은 대소문자와 복수 역할을 처리하며 이름을 중복하지 않는다', async () => {
    const h = transport({ resolveIssue: () => issue({ person_credits: [
        { name: 'Writer &amp; Partner', role: 'Story; Editor' },
        { name: 'Writer &amp; Partner', role: 'script' },
        { name: 'Artist', role: 'Penciler, Inker' },
        { name: 'Artist', role: 'penciller' },
        { name: 'Second Artist', role: 'art' },
        { name: 'Cover Only', role: 'cover artist' },
        { name: 'Translator', role: 'translator' },
    ] }) });
    const [result] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
    assert.equal(result.Writer, 'Writer & Partner');
    assert.equal(result.Penciller, 'Artist, Second Artist');
    assert.equal(result.Inker, '');
    assert.equal(result.Editor, '');
    assert.equal(result.CoverArtist, '');
});

test('검색과 선택 상세는 첫 권 크레딧 캐시를 공유하고 비우면 다시 요청한다', async () => {
    const h = transport();
    const [searchResult] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
    const detail = await getComicVineVolume('167989', apiKey, h.requestJson, runtime);
    assert.equal(searchResult.Writer, 'Norishiro-chan');
    assert.equal(detail.Writer, searchResult.Writer);
    assert.equal(detail.Penciller, searchResult.Penciller);
    assert.equal(detail.comicVineDetailResolved, true);
    assert.equal(h.issueCalls().length, 1);
    clearComicVineCreditsCache(h.requestJson);
    const [refreshed] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
    assert.equal(refreshed.Writer, searchResult.Writer);
    assert.equal(h.issueCalls().length, 2);
});

test('동시에 같은 첫 권을 조회하면 진행 중인 크레딧 요청을 공유한다', async () => {
    const h = transport();
    const results = await Promise.all([
        searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime),
        searchComicVine('Gals', apiKey, 1, h.requestJson, runtime),
        getComicVineVolume('167989', apiKey, h.requestJson, runtime),
    ]);
    assert.equal(results[0][0].Writer, 'Norishiro-chan');
    assert.equal(results[1][0].Penciller, 'Uozumi Sakana');
    assert.equal(results[2].Writer, 'Norishiro-chan');
    assert.equal(h.issueCalls().length, 1);
});

test('서로 다른 전송 함수의 크레딧 캐시는 섞이지 않는다', async () => {
    const first = transport();
    const second = transport({ resolveIssue: () => issue({ person_credits: [{ name: 'Changed Writer', role: 'writer' }] }) });
    await searchComicVine('Otaku', apiKey, 1, first.requestJson, runtime);
    const [result] = await searchComicVine('Otaku', apiKey, 1, second.requestJson, runtime);
    assert.equal(result.Writer, 'Changed Writer');
    assert.equal(first.issueCalls().length, 1);
    assert.equal(second.issueCalls().length, 1);
});

test('첫 권 ID가 없거나 잘못되면 임의 주소를 조회하거나 참여자를 작가로 추정하지 않는다', async () => {
    for (const firstIssue of [undefined, null, {}, { id: 0 }, { id: '../1140412' }, { id: '4050-1140412' }, { api_detail_url: 'https://example.test/issue/4000-1140412/' }]) {
        const h = transport({ volumes: [volume({ first_issue: firstIssue })] });
        const [result] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
        assert.equal(result.Writer, '');
        assert.equal(result.Penciller, '');
        assert.equal(h.issueCalls().length, 0);
        assert.equal(h.calls.length, 1);
    }
});

test('첫 권의 빈 크레딧은 정상 결과로 캐시하고 다른 역할을 작가로 사용하지 않는다', async () => {
    for (const credits of [[], [{ name: 'Unknown' }, { name: 'Translator', role: 'translator' }, { name: 'Letterer', role: 'letterer' }]]) {
        const h = transport({ resolveIssue: () => issue({ person_credits: credits }) });
        const [result] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
        assert.equal(result.Writer, '');
        assert.equal(result.Penciller, '');
        assert.ok(!result.comicVineCreditsError);
        await getComicVineVolume('167989', apiKey, h.requestJson, runtime);
        assert.equal(h.issueCalls().length, 1);
    }
});

test('첫 권의 ID나 시리즈가 다르면 적용하지 않고 잘못된 응답을 캐시하지 않는다', async () => {
    for (const invalid of [null, [], issue({ id: 1140413 }), issue({ volume: { id: 167990 } }), issue({ volume: undefined }), issue({ person_credits: undefined })]) {
        const h = transport({ resolveIssue: () => invalid });
        const [result] = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
        assert.equal(result.Writer, '');
        assert.equal(result.Penciller, '');
        assert.equal(result.Title, volume().name);
        assert.equal(result.comicVineCreditsError, 'API_INVALID_RESPONSE');
        assert.ok(!result.comicVineCreditsIssueId);
        await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
        assert.equal(h.issueCalls().length, 2);
    }
});

test('개별 크레딧 조회 실패는 검색 결과와 다른 작가 정보를 유지하고 다음 검색에서 재시도한다', async () => {
    let failFirst = true;
    const volumes = Array.from({ length: 3 }, (_, index) => volume({ id: 100 + index, first_issue: { id: 200 + index } }));
    const h = transport({
        volumes,
        resolveIssue: url => {
            const id = Number(url.pathname.match(/4000-(\d+)/)[1]);
            if (id === 200 && failFirst) throw Object.assign(new Error('private server response'), { statusCode: 500 });
            return issue({ id, volume: { id: id - 100 } });
        },
    });
    const results = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
    assert.equal(results.length, 3);
    assert.equal(results.hasNext, false);
    assert.equal(results[0].comicVineCreditsError, 'API_REQUEST_FAILED');
    assert.equal(results[0].Title, volumes[0].name);
    assert.equal(results[1].Writer, 'Norishiro-chan');
    assert.equal(results[2].Penciller, 'Uozumi Sakana');
    assert.doesNotMatch(JSON.stringify(results), /private server response/);
    assert.equal(h.issueCalls().length, 3);
    failFirst = false;
    const refreshed = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
    assert.equal(refreshed[0].Writer, 'Norishiro-chan');
    assert.ok(!refreshed[0].comicVineCreditsError);
    assert.equal(h.issueCalls().length, 4);
});

test('인증·접근 차단·호출 제한 오류는 두 작업자보다 더 많은 요청을 배정하지 않는다', async () => {
    for (const [statusCode, code] of [[401, 'API_AUTH_FAILED'], [403, 'API_ACCESS_BLOCKED'], [429, 'API_RATE_LIMIT']]) {
        const volumes = Array.from({ length: 10 }, (_, index) => volume({ id: 100 + index, first_issue: { id: 200 + index } }));
        const h = transport({
            volumes,
            resolveIssue: () => { throw Object.assign(new Error('api_key=secret'), { statusCode }); },
        });
        const results = await searchComicVine('Otaku', apiKey, 1, h.requestJson, runtime);
        assert.equal(results.length, 10);
        assert.ok(h.issueCalls().length > 0 && h.issueCalls().length <= 2);
        assert.equal(results[0].comicVineCreditsError, code);
        assert.ok(results.every(result => !result.Writer && !result.Penciller));
        assert.doesNotMatch(JSON.stringify(results), /secret/);
    }
});

test('선택 상세에서 첫 권 조회가 실패해도 시리즈 상세를 반환하고 재시도할 수 있다', async () => {
    let failing = true;
    const h = transport({ resolveIssue: () => {
        if (failing) throw Object.assign(new Error('temporary failure'), { statusCode: 500 });
        return issue();
    } });
    const failed = await getComicVineVolume('167989', apiKey, h.requestJson, runtime);
    assert.equal(failed.Title, volume().name);
    assert.ok(!failed.comicVineDetailResolved);
    assert.equal(failed.comicVineCreditsError, 'API_REQUEST_FAILED');
    failing = false;
    const detail = await getComicVineVolume('167989', apiKey, h.requestJson, runtime);
    assert.equal(detail.Writer, 'Norishiro-chan');
    assert.equal(detail.Penciller, 'Uozumi Sakana');
    assert.ok(!detail.comicVineCreditsError);
    assert.equal(h.issueCalls().length, 2);
});
