import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
    parseCartoonMembers,
    parseKmasAuthorDetail,
    parseKmasAuthorList,
    searchCartoonAuthors,
    searchKmasAuthors,
} from './comicsAuthorProfiles.js';

const PORTRAIT_ID = 'cd2302ca-686d-42a8-85fd-22b071fb82d8';
const PORTRAIT = `https://www.kmas.or.kr/common/file/atchmnflDownload.ajax?fileImageId=${PORTRAIT_ID}`;
const DETAIL_URL = 'https://www.kmas.or.kr/archive/writrList/detail/0000042604';

function sheet(rows) {
    return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({
        status: 'ok',
        table: {
            cols: [{ label: '번호' }, { label: '이름' }, { label: '대표작' }, { label: '관련 사이트' }],
            rows: rows.map(values => ({ c: values.map(v => ({ v })) })),
        },
    })});`;
}

function card({ id = '0000042604', name = '허영만', work = '각시탈, 미스터 손, 날아라 슈퍼보드, 식객', photo = `/common/file/atchmnflDownload.ajax;jsessionid=ABC123?fileImageId=${PORTRAIT_ID}` } = {}) {
    return `<li><a href="#none" onclick="javascript:fnWritrDetail('${id}')">
        <div class="bd-content writer"><div class="img-area"><div class="bd-basic-thumb">
            <img src="${photo}" alt="${name}" onerror="this.src='/htmlService/Images/Common/writer_noimages.png'">
        </div></div><div class="txt-area"><strong>${name}</strong><span class="exp">${work}</span></div></div>
    </a></li>`;
}

function list(cards = card()) {
    return `<div class="board-grid"><ul>${cards}</ul></div>`;
}

function detail({ name = '허영만', introduction = '작가 &amp; 만화가<br>대표작은 〈식객〉이다.', photo = `/common/file/atchmnflDownload.ajax;jsessionid=ABC123?fileImageId=${PORTRAIT_ID}` } = {}) {
    return `<div class="detail-basic with-img"><div class="vd-image">
        <img src="${photo}" onerror="this.src='/htmlService/Images/Common/writer_noimages.png'">
        </div><div class="vd-basic-con"><h3>${name}</h3><ul>
            <li><span>국가</span><span>대한민국</span></li>
            <li><span>출생</span><span>1947-08-12</span></li>
        </ul></div></div>
        <div class="detail-basic with-fold"><h3 class="on">작가 소개</h3>
            <div class="detail-con add-padd" id="contents">${introduction}</div>
        </div>
        <div class="detail-con"><img src="/common/file/atchmnflDownload.ajax?fileImageId=3000000935">작품 표지</div>`;
}

test('association searches its public directory by author and representative work without following related sites', async () => {
    const calls = [];
    const payload = sheet([
        [1, '허영만', '<식객> 외', 'https://external.example/author'],
        [2, '다른 작가', '<다른 작품>', 'https://external.example/other'],
    ]);
    const request = async url => { calls.push(url); return payload; };
    const [profile] = await searchCartoonAuthors('식객', request);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]).origin, 'https://docs.google.com');
    assert.equal(new URL(calls[0]).pathname, '/spreadsheets/d/10IYjP6cEZlQIHQqQoFWIbwgA2zs9fC2vqvgbUpE1jow/gviz/tq');
    assert.equal(new URL(calls[0]).searchParams.get('sheet'), '전체회원');
    assert.equal(profile.id, `cartoon:${createHash('sha256').update('허영만').digest('hex')}`);
    assert.equal(profile.name, '허영만');
    assert.equal(profile.topWork, '〈식객〉 외');
    assert.deepEqual(profile.works, ['〈식객〉 외']);
    assert.equal(profile.sourceUrl, 'https://www.cartoon.or.kr/all-member');
    assert.equal(profile.photoUrl, '');
    assert.equal(profile.imageSourceUrl, '');
    assert.equal(profile.authorVerified, true);
});

test('association normalizes names, deduplicates, caps results and never evaluates the sheet response', () => {
    const rows = Array.from({ length: 12 }, (_, index) => [index, `작가 ${index}`, '만화', '']);
    rows.splice(1, 0, [100, '작가 0', '다른 만화', '']);
    assert.equal(parseCartoonMembers(sheet(rows), '작가').length, 8);
    assert.deepEqual(parseCartoonMembers(sheet(rows), '없는 사람'), []);
    assert.equal(parseCartoonMembers(sheet([[1, '홍길동'.normalize('NFD'), '웹툰', '']]), '홍길동')[0].name, '홍길동');
    assert.throws(() => parseCartoonMembers('google.visualization.Query.setResponse(globalThis.pwned = true);', '작가'), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    assert.throws(() => parseCartoonMembers('google.visualization.Query.setResponse({"status":"error"});', '작가'), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    assert.throws(() => parseCartoonMembers('google.visualization.Query.setResponse(null);', '작가'), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
});

test('Korean Webtoons list retains author IDs, portraits and representative works', () => {
    const [profile] = parseKmasAuthorList(list());
    assert.equal(profile.id, 'kmas:0000042604');
    assert.equal(profile.name, '허영만');
    assert.equal(profile.photoUrl, PORTRAIT);
    assert.equal(profile.sourceUrl, DETAIL_URL);
    assert.equal(profile.imageSourceUrl, DETAIL_URL);
    assert.deepEqual(profile.works, ['각시탈', '미스터 손', '날아라 슈퍼보드', '식객']);
    assert.equal(profile.authorVerified, true);
    assert.ok(!JSON.stringify(profile).includes('jsessionid'));
});

test('Korean Webtoons discards placeholder, foreign, unsafe and cover images', () => {
    for (const photo of [
        '/htmlService/Images/Common/writer_noimages.png',
        'https://evil.example/common/file/atchmnflDownload.ajax?fileImageId=' + PORTRAIT_ID,
        'https://www.kmas.or.kr@evil.example/common/file/atchmnflDownload.ajax?fileImageId=' + PORTRAIT_ID,
        'http://www.kmas.or.kr/common/file/atchmnflDownload.ajax?fileImageId=' + PORTRAIT_ID,
        '/common/file/atchmnflDownload.ajax?fileImageId=3000000935',
        '/common/file/atchmnflDownload.ajax?fileImageId=../../secret',
    ]) {
        const [profile] = parseKmasAuthorList(list(card({ photo })));
        assert.equal(profile.photoUrl, '', photo);
        assert.equal(profile.imageSourceUrl, '', photo);
    }
});

test('Korean Webtoons distinguishes zero results from broken markup and limits unique authors', () => {
    assert.deepEqual(parseKmasAuthorList(list('<div class="board-nodata"><div class="board-inform"></div></div>')), []);
    assert.throws(() => parseKmasAuthorList('<html>Service unavailable</html>'), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    assert.throws(() => parseKmasAuthorList(list(card({ id: '../../secret' }))), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    const cards = Array.from({ length: 12 }, (_, index) => card({ id: String(index).padStart(10, '0'), name: `작가 ${index}` }));
    cards.splice(1, 0, cards[0]);
    assert.equal(parseKmasAuthorList(list(cards.join(''))).length, 8);
});

test('Korean Webtoons detail selects only matching author biography and portrait', () => {
    const [profile] = parseKmasAuthorList(list());
    const result = parseKmasAuthorDetail(detail(), profile);
    assert.equal(result.birthDate, '1947-08-12');
    assert.equal(result.description, '작가 & 만화가 대표작은 〈식객〉이다.');
    assert.equal(result.photoUrl, PORTRAIT);
    assert.equal(result.name, profile.name);
    assert.throws(() => parseKmasAuthorDetail(detail({ name: '다른 작가' }), profile), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    assert.throws(() => parseKmasAuthorDetail('<h3>작가 목록</h3>', profile), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    const sanitized = parseKmasAuthorDetail(detail({ introduction: '<script>secret()</script>소개<br>' + '가'.repeat(1000) }), profile);
    assert.ok(!sanitized.description.includes('secret'));
    assert.equal(sanitized.description.length, 600);
});

test('Korean Webtoons searches with encoded names and adds detail data', async () => {
    const calls = [];
    const profiles = await searchKmasAuthors('허영만 & 작가', async url => {
        calls.push(url);
        return url === DETAIL_URL ? detail() : list();
    });
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0]).pathname, '/archive/writrList');
    assert.equal(new URL(calls[0]).searchParams.get('searchWritrNm'), '허영만 & 작가');
    assert.equal(new URL(calls[0]).searchParams.size, 1);
    assert.equal(calls[1], DETAIL_URL);
    assert.equal(profiles[0].birthDate, '1947-08-12');
    assert.equal(profiles.partial, undefined);
});

test('Korean Webtoons retains list profiles and marks partial results if a detail fails', async () => {
    const profiles = await searchKmasAuthors('허영만', async url => {
        if (url === DETAIL_URL) throw new Error('Temporary outage');
        return list();
    });
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].name, '허영만');
    assert.equal(profiles[0].photoUrl, PORTRAIT);
    assert.equal(profiles.partial, true);
});

test('Korean Webtoons stops additional detail requests after an access or rate limit response', async () => {
    for (const code of ['AUTHOR_PROFILE_RATE_LIMIT', 'AUTHOR_PROFILE_ACCESS_BLOCKED']) {
        const calls = [];
        const cards = Array.from({ length: 8 }, (_, index) => card({ id: String(index).padStart(10, '0'), name: `작가 ${index}` }));
        const profiles = await searchKmasAuthors('작가', async url => {
            calls.push(url);
            if (url.includes('/detail/')) throw Object.assign(new Error('Unavailable'), { code });
            return list(cards.join(''));
        });
        assert.equal(profiles.length, 8);
        assert.equal(profiles.partial, true);
        assert.equal(calls.length, 3);
    }
});

test('empty author queries do not load full public directories', async () => {
    const request = async () => { throw new Error('Unexpected request'); };
    assert.deepEqual(await searchCartoonAuthors('  ', request), []);
    assert.deepEqual(await searchKmasAuthors('', request), []);
});
