import assert from 'node:assert/strict';
import test from 'node:test';
import { getComicVineVolume, searchComicVine } from './comicVineSearch.js';

const apiKey = 'test-key+with&query=characters';
const runtime = { now: () => 0, sleep: async () => {} };

function volume(overrides = {}) {
    return {
        id: 123,
        name: 'Batman &amp; Robin',
        resource_type: 'volume',
        publisher: { name: 'DC Comics' },
        start_year: '2009',
        count_of_issues: 26,
        ...overrides,
    };
}

function response(results, overrides = {}) {
    return { status_code: 1, error: 'OK', results, ...overrides };
}

test('Comic Vine 검색은 볼륨 검색 필드와 페이지 위치를 전달하고 API 키를 안전하게 인코딩한다', async () => {
    const calls = [];
    const requestJson = async (...args) => {
        calls.push(args);
        return response([volume()], { offset: 10, number_of_page_results: 1, number_of_total_results: 11 });
    };
    const results = await searchComicVine('  Batman & Robin  ', apiKey, 2, requestJson, { ...runtime, deferCreators: true });
    assert.equal(calls.length, 1);
    const [requestUrl, headers, timeout] = calls[0];
    const url = new URL(requestUrl);
    assert.equal(url.origin, 'https://comicvine.gamespot.com');
    assert.equal(url.pathname, '/api/search/');
    assert.equal(url.searchParams.get('api_key'), apiKey);
    assert.equal(url.searchParams.get('query'), 'Batman & Robin');
    assert.equal(url.searchParams.get('resources'), 'volume');
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(url.searchParams.get('limit'), '10');
    assert.equal(url.searchParams.get('offset'), '10');
    const fields = url.searchParams.get('field_list').split(',');
    for (const field of ['id', 'name', 'description', 'deck', 'image', 'publisher', 'start_year', 'count_of_issues', 'resource_type']) {
        assert.ok(fields.includes(field), field);
    }
    assert.match(headers['User-Agent'], /BookManager/);
    assert.equal(headers.Accept, 'application/json');
    assert.ok(timeout > 0);
    assert.equal(results.length, 1);
    assert.equal(results.hasNext, false);
});

test('Comic Vine 다음 페이지 여부는 API 전체 개수와 반환 위치를 반영한다', async () => {
    const cases = [
        { count: 10, page: 1, metadata: { offset: 0, number_of_total_results: 10 }, hasNext: false },
        { count: 10, page: 1, metadata: { offset: 0, number_of_total_results: 11 }, hasNext: true },
        { count: 1, page: 2, metadata: { offset: 10, number_of_total_results: 12 }, hasNext: true },
        { count: 2, page: 2, metadata: { number_of_total_results: 12 }, hasNext: false },
        { count: 2, page: 2, metadata: { offset: null, number_of_total_results: 12 }, hasNext: false },
        { count: 10, page: 1, metadata: {}, hasNext: true },
        { count: 9, page: 1, metadata: {}, hasNext: false },
        { count: 0, page: 1, metadata: { number_of_total_results: 0 }, hasNext: false },
    ];
    for (const item of cases) {
        const requestJson = async () => response(Array.from({ length: item.count }, (_, index) => volume({ id: index + 1 })), item.metadata);
        const results = await searchComicVine('Batman', apiKey, item.page, requestJson, runtime);
        assert.equal(results.hasNext, item.hasNext, JSON.stringify(item));
    }
});

test('Comic Vine 빈 검색은 요청하지 않고 잘못된 페이지는 첫 페이지로 처리한다', async () => {
    let calls = 0;
    const requestJson = async url => {
        calls += 1;
        assert.equal(new URL(url).searchParams.get('offset'), '0');
        return response([]);
    };
    assert.deepEqual(await searchComicVine('  ', apiKey, 1, requestJson, runtime), []);
    assert.equal(calls, 0);
    for (const page of [0, -1, 1.5, 'invalid']) {
        await searchComicVine('Batman', apiKey, page, requestJson, runtime);
    }
    assert.equal(calls, 4);
    await assert.rejects(searchComicVine('Batman', ' ', 1, requestJson, runtime), { code: 'API_AUTH_REQUIRED' });
    assert.equal(calls, 4);
});

test('Comic Vine HTTP 성공 응답 안의 인증 및 호출 제한 오류를 검색 결과로 숨기지 않는다', async () => {
    const cases = [
        { data: { status_code: 100, error: 'Invalid API Key' }, code: 'API_AUTH_FAILED' },
        { data: { status_code: 107, error: 'Rate limit exceeded' }, code: 'API_RATE_LIMIT' },
        { data: { status_code: 107, error: 'Unknown service error' }, code: 'API_INVALID_RESPONSE' },
        { data: { status_code: 104, error: 'Too many requests' }, code: 'API_RATE_LIMIT' },
        { data: { status_code: 101, error: 'Object Not Found' }, code: 'API_INVALID_RESPONSE' },
        { data: { status_code: 102, error: 'Error in URL Format' }, code: 'API_INVALID_RESPONSE' },
        { data: { status_code: 104, error: 'Filter Error' }, code: 'API_INVALID_RESPONSE' },
        { data: { results: [] }, code: 'API_INVALID_RESPONSE' },
    ];
    for (const item of cases) {
        const requestJson = async () => ({ results: [], ...item.data });
        await assert.rejects(searchComicVine('Batman', apiKey, 1, requestJson, runtime), { code: item.code, message: item.code });
    }
});

test('Comic Vine 전송 오류는 종류를 구분하고 API 키가 포함된 원래 오류를 노출하지 않는다', async () => {
    const cases = [
        { statusCode: 401, code: 'API_AUTH_FAILED' },
        { statusCode: 403, code: 'API_ACCESS_BLOCKED' },
        { statusCode: 429, code: 'API_RATE_LIMIT' },
        { statusCode: 500, code: 'API_REQUEST_FAILED' },
        { error: new SyntaxError('Invalid JSON containing test-key'), code: 'API_INVALID_RESPONSE' },
        { error: new Error('RATE_LIMIT'), code: 'API_RATE_LIMIT' },
    ];
    for (const item of cases) {
        const requestJson = async url => {
            throw item.error || Object.assign(new Error(`Failed request ${url}`), { statusCode: item.statusCode });
        };
        await assert.rejects(searchComicVine('Batman', apiKey, 1, requestJson, runtime), error => {
            assert.equal(error.code, item.code);
            assert.equal(error.message, item.code);
            assert.doesNotMatch(error.stack, /test-key|api_key=/);
            return true;
        });
    }
});

test('Comic Vine 잘못된 응답 구조를 거부하고 다른 리소스 및 불완전한 볼륨은 제외한다', async () => {
    for (const results of [null, {}, 'invalid']) {
        await assert.rejects(searchComicVine('Batman', apiKey, 1, async () => response(results), runtime), { code: 'API_INVALID_RESPONSE' });
    }
    const results = await searchComicVine('Batman', apiKey, 1, async () => response([
        null,
        volume({ id: 'not-an-id' }),
        volume({ id: -1 }),
        volume({ id: 0 }),
        volume({ id: 1.5 }),
        volume({ name: null }),
        volume({ name: '   ' }),
        volume({ resource_type: 'issue' }),
        volume({ id: 123 }),
    ]), runtime);
    assert.equal(results.length, 1);
    assert.equal(results[0].ID, '123');
});

test('Comic Vine 표지는 이전 CDN 주소를 변환하고 사용 가능한 이미지 후보를 보존한다', async () => {
    const results = await searchComicVine('Batman', apiKey, 1, async () => response([
        volume({ image: {
            super_url: 'http://comicvine1.cbsistatic.com/uploads/scale_large/1/2/cover.jpg',
            original_url: 'https://comicvine.gamespot.com/a/uploads/original/1/2/cover.jpg',
            small_url: 'https://comicvine.gamespot.com/a/uploads/scale_small/1/2/cover.jpg',
            thumb_url: 'https://comicvine.gamespot.com/a/uploads/scale_small/1/2/cover.jpg',
            icon_url: 'javascript:alert(1)',
        } }),
        volume({ id: 124, image: { small_url: 'http://comicvine.cbsistatic.com/uploads/scale_small/cover.jpg' } }),
        volume({ id: 125, image: { thumb_url: 'https://comicvine.gamespot.com/a/uploads/scale_avatar/cover.jpg' } }),
        volume({ id: 126, image: { super_url: 'data:image/png;base64,example', small_url: 'https://user:password@example.com/image.jpg' } }),
    ]), runtime);
    assert.deepEqual(results[0].CoverUrls, [
        'https://comicvine.gamespot.com/a/uploads/scale_large/1/2/cover.jpg',
        'https://comicvine.gamespot.com/a/uploads/original/1/2/cover.jpg',
        'https://comicvine.gamespot.com/a/uploads/scale_small/1/2/cover.jpg',
    ]);
    assert.equal(results[0].CoverUrl, results[0].CoverUrls[0]);
    assert.equal(results[1].CoverUrl, 'https://comicvine.gamespot.com/a/uploads/scale_small/cover.jpg');
    assert.equal(results[2].CoverUrl, 'https://comicvine.gamespot.com/a/uploads/scale_avatar/cover.jpg');
    assert.equal(results[3].CoverUrl, '');
    assert.deepEqual(results[3].CoverUrls, []);
});

test('Comic Vine HTML 엔터티와 줄거리를 정리하고 빈 상세 설명은 요약으로 보완한다', async () => {
    const results = await searchComicVine('Batman', apiKey, 1, async () => response([
        volume({
            name: 'Batman &amp; Robin: &#35;1 &lt;Special&gt;',
            description: '<p>&quot;Batman&quot; &amp; Robin&#39;s story</p><p>Second<br>line</p>',
            deck: 'Unused short summary',
            publisher: { name: 'DC &amp; Friends' },
            aliases: 'Batman\r\nRobin',
        }),
        volume({ id: 124, description: '<p> </p>', deck: 'Short &amp; clear' }),
        volume({ id: 125, start_year: 'unknown', count_of_issues: -1 }),
    ]), runtime);
    assert.equal(results[0].Title, 'Batman & Robin: #1 <Special>');
    assert.equal(results[0].Series, results[0].Title);
    assert.equal(results[0].Summary, '"Batman" & Robin\'s story\nSecond\nline');
    assert.equal(results[0].Publisher, 'DC & Friends');
    assert.deepEqual(results[0].aliases, ['Batman', 'Robin']);
    assert.equal(results[0].Year, '2009');
    assert.equal(results[0].Count, '26');
    assert.equal(results[1].Summary, 'Short & clear');
    assert.equal(results[2].Year, '');
    assert.equal(results[2].Count, '');
    assert.equal(results[0].Number, undefined);
    assert.equal(results[0].Month, undefined);
    assert.equal(results[0].Day, undefined);
});

test('Comic Vine 상세는 정확한 볼륨 리소스를 요청하고 역할이 있는 크레딧만 직책에 넣는다', async () => {
    const requestJson = async (requestUrl, headers) => {
        const url = new URL(requestUrl);
        assert.equal(url.pathname, '/api/volume/4050-123/');
        assert.equal(url.searchParams.get('api_key'), apiKey);
        assert.match(headers['User-Agent'], /BookManager/);
        const fields = url.searchParams.get('field_list').split(',');
        assert.ok(fields.includes('person_credits'));
        assert.ok(fields.includes('character_credits'));
        return response(volume({
            person_credits: [
                { name: 'Unknown Contributor' },
                { name: 'Grant &amp; Friends', role: 'Writer, Editor' },
                { name: 'Grant &amp; Friends', role: 'writer' },
                { name: 'Andy', role: 'Penciler; Inker' },
                { name: 'Color Artist', role: 'colourist' },
                { name: 'Letter Artist', role: 'letterer' },
                { name: 'Cover Artist', role: 'cover artist' },
            ],
            character_credits: [{ name: 'Batman' }, { name: 'Robin &amp; Friends' }, { name: 'Batman' }],
            first_issue: { id: 99, issue_number: '1' },
            last_issue: { id: 199, issue_number: '26' },
        }));
    };
    const result = await getComicVineVolume('4050-123', apiKey, requestJson, runtime);
    assert.equal(result.ID, '123');
    assert.equal(result.Writer, 'Grant & Friends');
    assert.equal(result.Editor, 'Grant & Friends');
    assert.equal(result.Penciller, 'Andy');
    assert.equal(result.Inker, 'Andy');
    assert.equal(result.Colorist, 'Color Artist');
    assert.equal(result.Letterer, 'Letter Artist');
    assert.equal(result.CoverArtist, 'Cover Artist');
    assert.equal(result.Characters, 'Batman, Robin & Friends');
    assert.equal(result.Number, undefined);
    assert.equal(result.comicVineDetailResolved, true);
    assert.equal(result.Web, 'https://comicvine.gamespot.com/volume/4050-123/');
});

test('Comic Vine 실제 시리즈 응답의 people과 characters를 지원하고 참여 횟수를 역할로 오인하지 않는다', async () => {
    const result = await getComicVineVolume('796', apiKey, async requestUrl => {
        const fields = new URL(requestUrl).searchParams.get('field_list').split(',');
        assert.ok(fields.includes('people'));
        assert.ok(fields.includes('characters'));
        return response(volume({
            id: 796,
            people: [{ id: 1, name: 'Contributor', count: 500 }],
            characters: [{ id: 2, name: 'Batman', count: 800 }, { id: 3, name: 'Robin', count: 400 }],
            image: { tiny_url: 'https://comicvine.gamespot.com/a/uploads/scale_tiny/cover.jpg' },
        }));
    }, runtime);
    assert.equal(result.Characters, 'Batman, Robin');
    assert.equal(result.Writer, '');
    assert.equal(result.Penciller, '');
    assert.equal(result.CoverUrl, 'https://comicvine.gamespot.com/a/uploads/scale_tiny/cover.jpg');
});

test('Comic Vine 상세는 잘못된 ID와 다른 볼륨의 응답을 적용하지 않는다', async () => {
    let calls = 0;
    const requestJson = async () => {
        calls += 1;
        return response(volume());
    };
    for (const id of ['', null, '4000-123', '../123', '123?api_key=x', 0, -1, 1.5]) {
        await assert.rejects(getComicVineVolume(id, apiKey, requestJson, runtime), { code: 'API_INVALID_RESPONSE' });
    }
    assert.equal(calls, 0);
    for (const results of [null, [], volume({ id: 124 }), volume({ name: '' })]) {
        await assert.rejects(getComicVineVolume('123', apiKey, async () => response(results), runtime), { code: 'API_INVALID_RESPONSE' });
    }
    const result = await getComicVineVolume(123, apiKey, requestJson, runtime);
    assert.equal(result.Writer, '');
    assert.equal(result.Penciller, '');
});

test('Comic Vine 동일 리소스의 연속 요청은 간격을 두고 검색과 상세는 따로 계산한다', async () => {
    let now = 1000;
    const sleeps = [];
    const calls = [];
    const clock = {
        now: () => now,
        sleep: async ms => {
            sleeps.push(ms);
            now += ms;
        },
    };
    const requestJson = async requestUrl => {
        const resource = new URL(requestUrl).pathname.split('/')[2];
        calls.push({ resource, now });
        return response(resource === 'volume' ? volume() : []);
    };
    await searchComicVine('Batman', apiKey, 1, requestJson, clock);
    await searchComicVine('Robin', apiKey, 1, requestJson, clock);
    await getComicVineVolume(123, apiKey, requestJson, clock);
    await getComicVineVolume(123, apiKey, requestJson, clock);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps.every(ms => ms >= 1000));
    assert.ok(calls[1].now - calls[0].now >= 1000);
    assert.equal(calls[2].now, calls[1].now);
    assert.ok(calls[3].now - calls[2].now >= 1000);
});
