import assert from 'node:assert/strict';
import test from 'node:test';
import { clearComicVineCoverCache, getComicVineVolumeCovers, isComicVinePlaceholderImageUrl, searchComicVine } from './comicVineSearch.js';

const runtime = { now: () => 0, sleep: async () => {} };
const key = 'test-key';
const blank = 'https://comicvine.gamespot.com/a/uploads/scale_large/11122/111222211/6373148-blank.png';
const response = results => ({ status_code: 1, results });
const volume = (id, name) => ({ id, name, image: { super_url: `https://comicvine.gamespot.com/a/uploads/scale_large/${id}.jpg` }, publisher: { name: 'Publisher' }, count_of_issues: 2 });

test('실제 검색의 공통 빈 이미지는 제외하고 목록 API 한 번으로 각 시리즈의 표지를 가져온다', async () => {
    const calls = [];
    const requestJson = async url => {
        const request = new URL(url);
        calls.push(request);
        if (request.pathname === '/api/search/') return response([
            { id: 167989, name: 'English edition', image: { super_url: blank } },
            { id: 170759, name: 'French edition', image: { super_url: blank } },
        ]);
        assert.equal(request.pathname, '/api/volumes/');
        assert.equal(request.searchParams.get('filter'), 'id:167989|170759');
        assert.equal(request.searchParams.get('limit'), '2');
        assert.equal(request.searchParams.get('api_key'), key);
        for (const field of ['id', 'image', 'publisher', 'count_of_issues']) {
            assert.ok(request.searchParams.get('field_list').split(',').includes(field));
        }
        return response([volume(170759, 'French edition'), volume(167989, 'English edition')]);
    };
    const summaries = await searchComicVine('Gals', key, 1, requestJson, { ...runtime, deferCreators: true });
    assert.equal(calls.length, 1);
    assert.ok(summaries.every(item => !item.CoverUrl && item.CoverUrls.length === 0));
    const covers = await getComicVineVolumeCovers(summaries.map(item => item.ID), key, requestJson, runtime);
    assert.equal(calls.length, 2);
    assert.deepEqual(covers.map(item => item.ID), ['167989', '170759']);
    assert.equal(covers[0].CoverUrl, volume(167989).image.super_url);
    assert.equal(covers[1].CoverUrl, volume(170759).image.super_url);
    assert.equal(covers[0].Publisher, 'Publisher');
    assert.equal(covers[0].Count, '2');
    assert.equal(covers[0].Writer, undefined);
    assert.equal(covers[0].Title, undefined);
});

test('알려진 Comic Vine 빈 표지는 크기·기존 CDN·쿼리와 무관하게 구분하고 다른 표지는 유지한다', () => {
    for (const url of [blank, blank.replace('scale_large', 'original'), `${blank}?version=1`, blank.replace('comicvine.gamespot.com/a', 'comicvine1.cbsistatic.com')]) {
        assert.equal(isComicVinePlaceholderImageUrl(url), true);
    }
    for (const url of ['', 'invalid', 'https://images.test/6373148-blank.png', blank.replace('6373148-blank', '123-cover')]) {
        assert.equal(isComicVinePlaceholderImageUrl(url), false);
    }
});

test('표지 편집기와 자동 매칭의 기존 검색도 빈 표지를 실제 시리즈 표지로 보완한다', async () => {
    const calls = [];
    const requestJson = async url => {
        const pathname = new URL(url).pathname;
        calls.push(pathname);
        return pathname === '/api/search/'
            ? { ...response([{ id: 1, name: 'Volume', image: { super_url: blank } }]), number_of_total_results: 20, offset: 0 }
            : response([volume(1)]);
    };
    const results = await searchComicVine('Volume', key, 1, requestJson, runtime);
    assert.equal(results[0].CoverUrl, volume(1).image.super_url);
    assert.equal(results[0].Publisher, 'Publisher');
    assert.equal(results[0].Count, '2');
    assert.equal(results[0].Title, 'Volume');
    assert.equal(results.hasNext, true);
    assert.deepEqual(calls, ['/api/search/', '/api/volumes/']);
});

test('기존 검색에서 표지 보완만 실패하면 목록을 보존하고 불완전한 캐시를 구분한다', async () => {
    const requestJson = async url => {
        if (new URL(url).pathname === '/api/search/') return response([{ id: 1, name: 'Volume', image: { super_url: blank } }]);
        throw Object.assign(new Error('private API response'), { statusCode: 429 });
    };
    const [item] = await searchComicVine('Volume', key, 1, requestJson, runtime);
    assert.equal(item.Title, 'Volume');
    assert.equal(item.CoverUrl, '');
    assert.equal(item.comicVineCoversError, 'API_RATE_LIMIT');
});

test('같은 표지 묶음은 순서·중복 ID와 무관하게 진행 중 요청과 캐시를 공유한다', async () => {
    let calls = 0;
    const requestJson = async () => { calls += 1; return response([volume(1), volume(2)]); };
    const [first, second] = await Promise.all([
        getComicVineVolumeCovers(['1', '2'], key, requestJson, runtime),
        getComicVineVolumeCovers(['2', '1', '2'], key, requestJson, runtime),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(first.map(item => item.ID), ['1', '2']);
    assert.deepEqual(second.map(item => item.ID), ['2', '1']);
    await getComicVineVolumeCovers(['1', '2'], key, requestJson, runtime);
    assert.equal(calls, 1);
    clearComicVineCoverCache(requestJson);
    await getComicVineVolumeCovers(['1', '2'], key, requestJson, runtime);
    assert.equal(calls, 2);
});

test('표지 보완의 ID 배열과 키는 캐시 조회 전에 검사한다', async () => {
    let calls = 0;
    const requestJson = async () => { calls += 1; return response([volume(1)]); };
    await getComicVineVolumeCovers(['1'], key, requestJson, runtime);
    for (const ids of [undefined, '1', [], [''], ['../1'], ['0'], Array.from({ length: 11 }, () => '1')]) {
        await assert.rejects(getComicVineVolumeCovers(ids, key, requestJson, runtime), { code: 'API_INVALID_RESPONSE' });
    }
    await assert.rejects(getComicVineVolumeCovers(['1'], '', requestJson, runtime), { code: 'API_AUTH_REQUIRED' });
    assert.equal(calls, 1);
});

test('잘못된 표지 응답은 캐시하지 않고 다른 시리즈에 적용하지 않는다', async () => {
    for (const invalid of [null, {}, [null], [volume(2)], [volume(1), volume(1)]]) {
        let calls = 0;
        const requestJson = async () => { calls += 1; return response(calls === 1 ? invalid : [volume(1)]); };
        await assert.rejects(getComicVineVolumeCovers(['1'], key, requestJson, runtime), { code: 'API_INVALID_RESPONSE' });
        assert.equal((await getComicVineVolumeCovers(['1'], key, requestJson, runtime))[0].ID, '1');
        assert.equal(calls, 2);
    }
});

test('표지가 없거나 목록에서 빠진 시리즈를 다른 항목의 표지로 채우지 않는다', async () => {
    const requestJson = async () => response([{ ...volume(1), image: { super_url: blank } }]);
    const results = await getComicVineVolumeCovers(['1', '2'], key, requestJson, runtime);
    assert.equal(results.length, 1);
    assert.equal(results[0].ID, '1');
    assert.equal(results[0].CoverUrl, '');
    assert.deepEqual(results[0].CoverUrls, []);
});

test('표지 보완 실패는 안전한 코드로 전달하고 다음 조회에서 재시도한다', async () => {
    let calls = 0;
    const requestJson = async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('private api_key=secret'), { statusCode: 429 });
        return response([volume(1)]);
    };
    await assert.rejects(getComicVineVolumeCovers(['1'], key, requestJson, runtime), { code: 'API_RATE_LIMIT', message: 'API_RATE_LIMIT' });
    assert.equal((await getComicVineVolumeCovers(['1'], key, requestJson, runtime))[0].ID, '1');
});
