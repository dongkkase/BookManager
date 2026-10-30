import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelGoogleAuthorSearches, googleAuthorProfile, parseNamuProfile, searchGoogleAuthors, searchNamuAuthors } from './authorWebProfiles.js';
import { normalizeAuthorProfile } from '../src/authorCatalog.js';
import { createAuthorProfileService } from './authorProfiles.js';

const article = (title = '테스트 작가') => `<html><head><title>${title} - 나무위키</title>
<meta property="og:title" content="${title}"><meta property="og:image" content="//i.namu.wiki/i/portrait_123.webp"></head>
<table><tr><td>출생</td><td>1970년 1월 1일 (56세)</td></tr><tr><td>대표작</td><td>첫 소설</td></tr></table>
<h2><span id="개요">개요</span></h2><div class="wiki-paragraph">대한민국의 <b>소설가</b>이다.</div>
<h2>활동</h2><div>소개에 포함하지 않는 내용</div></html>`;

test('편집 화면을 닫으면 아직 시작하지 않은 Google 검색도 취소한다', async () => {
    const window = { isDestroyed: () => false };
    const pending = searchGoogleAuthors('작가', null, { getMainWindow: () => window, photos: true });
    cancelGoogleAuthorSearches(window);
    await assert.rejects(pending, { code: 'AUTHOR_PROFILE_CANCELLED' });
});

test('캐시를 읽는 중 편집 화면을 닫아도 뒤늦게 Google 확인 창을 열지 않는다', async () => {
    const window = { isDestroyed: () => false };
    let releaseCache;
    const service = createAuthorProfileService({ getMainWindow: () => window,
        resultCache: { get: () => new Promise(resolve => { releaseCache = resolve; }), set: async () => {} } });
    const pending = service.search('작가', { source: 'google', photos: true });
    cancelGoogleAuthorSearches(window);
    releaseCache(null);
    await assert.rejects(pending, { code: 'AUTHOR_PROFILE_CANCELLED' });
});

test('나무위키 인물 정보와 대표 사진을 읽고 원본 문서 출처를 보존한다', () => {
    const profile = parseNamuProfile(article(), 'ignored');
    assert.equal(profile.id, 'namuwiki:테스트 작가');
    assert.equal(profile.birthDate, '1970년 1월 1일');
    assert.equal(parseNamuProfile(article().replace('1970년 1월 1일', '1970년 1월 1일 [음력]')).birthDate, '1970년 1월 1일 [음력]');
    assert.equal(profile.topWork, '첫 소설');
    assert.equal(profile.description, '대한민국의 소설가 이다.');
    assert.equal(profile.photoUrl, 'https://i.namu.wiki/i/portrait_123.webp');
    assert.equal(profile.imageSourceUrl, profile.sourceUrl);
    assert.equal(parseNamuProfile('<meta property="og:title" content="책"><p>소개</p>', '책'), null);
    assert.throws(() => parseNamuProfile('<title>Just a moment...</title>'), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' });
});

test('나무위키 검색은 같은 사이트의 문서만 읽고 중복·비인물 결과를 제외한다', async () => {
    const calls = [];
    const profiles = await searchNamuAuthors('테스트', async url => {
        calls.push(url);
        if (new URL(url).pathname === '/Search') return `<title>검색 - 나무위키</title>
            <h4><a href="/w/테스트">테스트</a></h4><h4><a href="/w/테스트%20작가">작가</a></h4>
            <h4><a href="/w/테스트%20작가">중복</a></h4><h4><a href="https://evil.test/w/작가">외부</a></h4>
            <h4><a href="/w/분류:테스트">분류</a></h4>`;
        return decodeURIComponent(new URL(url).pathname).endsWith('작가') ? article() : '<title>테스트 - 나무위키</title>';
    });
    assert.equal(profiles.length, 1);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(url => new URL(url).hostname === 'namu.wiki'));
});

test('새 소스의 저장 프로필과 편집 사진은 출처를 유지하며 임의 원격 썸네일은 거부한다', () => {
    const google = googleAuthorProfile({ title: '작가 소개', description: '소설가의 작품', url: 'https://example.com/author',
        image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:portrait' }, '테스트 작가');
    assert.equal(google.provider, 'google');
    assert.equal(google.name, '테스트 작가');
    assert.equal(google.sourceUrl, 'https://example.com/author');
    assert.equal(googleAuthorProfile({ title: 'bad', url: 'file:///tmp/profile' }, '작가'), null);
    for (const original of [google, parseNamuProfile(article())]) {
        const saved = normalizeAuthorProfile({ ...original, storedPhoto: { id: 'a'.repeat(64), sourceUrl: original.photoUrl } });
        assert.equal(saved.photoUrl, `bookmanager-thumbnail://author-photo/${'a'.repeat(64)}.png`);
        assert.equal(saved.sourceUrl, original.sourceUrl);
        assert.equal(normalizeAuthorProfile({ ...original, photoUrl: 'https://example.com/portrait.png' }).photoUrl, '');
        const edited = normalizeAuthorProfile({ ...original, photoOverride: {
            id: 'b'.repeat(64), source: original.provider, query: '작가', sourceUrl: 'https://example.com/chosen.png',
            imageSourceUrl: original.sourceUrl,
        } });
        assert.equal(edited.photoOverride.source, original.provider);
        assert.equal(edited.imageSourceUrl, original.sourceUrl);
    }
});

test('구글 프로필과 사진 목록의 캐시는 분리하고 자동 프로필 조회에는 새 소스를 호출하지 않는다', async () => {
    const calls = [];
    const service = createAuthorProfileService({ sleep: async () => {}, requestJson: async url => {
        const target = new URL(url);
        return target.hostname === 'openlibrary.org' ? { docs: [] }
            : target.searchParams.get('action') === 'wbsearchentities' ? { search: [] } : { query: { pages: [] } };
    }, webSearchers: { google: async (query, _request, options) => {
        calls.push(options.photos);
        return [googleAuthorProfile({ title: '작가', url: `https://example.com/${options.photos ? 'photo' : 'profile'}` }, query)];
    } } });
    await service.search('작가');
    assert.deepEqual(calls, []);
    await service.search('작가', { source: 'google' });
    await service.search('작가', { source: 'google', photos: true });
    await service.search('작가', { source: 'google', photos: true });
    assert.deepEqual(calls, [false, true]);
});
