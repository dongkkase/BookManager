import assert from 'node:assert/strict';
import test from 'node:test';
import { searchAladinAuthors, searchKyoboAuthors } from './bookstoreAuthorProfiles.js';

const ALADIN_PHOTO = 'https://image.aladin.co.kr/Author/Photo/49154/49154_2.jpg';
const KYOBO_PHOTO = 'https://contents.kyobobook.co.kr/sih/fit-in/300x0/dtl/author/1000646901.jpg?t=2988445';

function aladinEntry(id, name, photo = '', title = '소년이 온다') {
    return `<div class="newbg_authorbox"><table><tr><td><a href='/author/wauthor_overview.aspx?AuthorSearch=@${id}'>
        <img src='${photo}' /></a></td><td><a href='/author/wauthor_overview.aspx?AuthorSearch=@${id}'><strong>${name}</strong></a>
        <a href='/shop/wproduct.aspx?ItemId=40869703' class='au_book'>&lt;${title}&gt;</a></td></tr></table></div>`;
}

function aladinSearch(entries) {
    return `<!--검색결과 시작-->${entries.join('')}<!--검색결과 끝-->`;
}

function aladinDetail(id = '49154', photo = ALADIN_PHOTO) {
    return `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        mainEntity: {
            '@type': 'Person',
            name: '한강',
            url: `https://www.aladin.co.kr/author/wauthor_overview.aspx?AuthorSearch=@${id}`,
            birthDate: '1970-11-27',
            description: '1970년 겨울 광주에서 태어났다.',
            image: photo,
            owns: [{ '@type': 'Book', name: '소년이 온다' }, { '@type': 'Book', name: '작별하지 않는다' }],
        },
    })}</script>`;
}

function kyoboEntry(id = '1000646901', name = '한강') {
    return {
        writerInfo: { chrcCode: id, chrcName: name, chrcEnsnName: 'Han Kang', chrcIntcCntt: '소설가', phtgYsno: null },
        representativeBook: [{ cmdtName: '소년이 온다' }, { cmdtName: '작별하지 않는다' }],
    };
}

function kyoboSearch(entries) {
    return JSON.stringify({ data: { writerList: entries, total: entries.length }, statusCode: 200, resultCode: '000000' });
}

function kyoboDetail({ id = '1000646901', photo = KYOBO_PHOTO, hasPhoto = 'Y' } = {}) {
    const record = `12:${JSON.stringify(['$', '$L2b', null, { data: {
        chrcCode: id,
        chrcName: '한강',
        chrcEnsnName: 'Han Kang',
        chrcBrdy: '1970년11월27일',
        chrcIntcCntt: '1970년 겨울에 태어났다.\n대표 작품은 소년이 온다이다.',
        phtgYsno: hasPhoto,
    } }])}\n`;
    const middle = Math.floor(record.length / 2);
    return `<img src="${photo}" /><script>self.__next_f.push(${JSON.stringify([1, record.slice(0, middle)])})</script>
        <script>self.__next_f.push(${JSON.stringify([1, record.slice(middle)])})</script>`;
}

test('Aladin uses the observed name search route and enriches author profiles from Person JSON-LD', async () => {
    const calls = [];
    const profiles = await searchAladinAuthors('한강', async url => {
        calls.push(new URL(url));
        return url.includes('/search/') ? aladinSearch([aladinEntry('49154', '한강', ALADIN_PHOTO)]) : aladinDetail();
    });
    assert.equal(calls[0].pathname, '/author/search/wauthor_search_name.aspx');
    assert.equal(calls[0].searchParams.get('SearchWord'), '한강');
    assert.deepEqual(profiles[0], {
        provider: 'aladin', id: 'aladin:49154', name: '한강', alternateNames: [], birthDate: '1970-11-27',
        description: '1970년 겨울 광주에서 태어났다.', topWork: '소년이 온다', works: ['소년이 온다', '작별하지 않는다'],
        photoUrl: ALADIN_PHOTO,
        sourceUrl: 'https://www.aladin.co.kr/author/wauthor_overview.aspx?AuthorSearch=@49154',
        imageSourceUrl: 'https://www.aladin.co.kr/author/wauthor_overview.aspx?AuthorSearch=@49154',
        authorVerified: true,
    });
});

test('Aladin excludes book cover fallbacks and portraits from a different author', async () => {
    for (const photo of ['https://image.aladin.co.kr/product/38888/61/cover150/k392137406_1.jpg', 'https://image.aladin.co.kr/Author/Photo/999/999_2.jpg']) {
        const profiles = await searchAladinAuthors('한강', async url => url.includes('/search/')
            ? aladinSearch([aladinEntry('49154', '한강', photo)]) : aladinDetail('49154', photo));
        assert.equal(profiles[0].photoUrl, '');
    }
});

test('bookstore sources prioritize exact names, deduplicate IDs and limit detail requests to eight', async () => {
    let details = 0;
    const entries = Array.from({ length: 12 }, (_, index) => aladinEntry(String(index + 1), `작가 ${index}`));
    entries.push(aladinEntry('49154', '한강', ALADIN_PHOTO), aladinEntry('49154', '한강', ALADIN_PHOTO));
    const profiles = await searchAladinAuthors('한강', async url => {
        if (url.includes('/search/')) return aladinSearch(entries);
        details += 1;
        return aladinDetail();
    });
    assert.equal(profiles.length, 8);
    assert.equal(details, 8);
    assert.equal(profiles[0].id, 'aladin:49154');
    assert.equal(new Set(profiles.map(profile => profile.id)).size, profiles.length);
});

test('Kyobo searches its public author API and safely reads split React server data', async () => {
    const calls = [];
    const profiles = await searchKyoboAuthors('한강', async url => {
        calls.push(new URL(url));
        return url.includes('/api/') ? kyoboSearch([kyoboEntry()]) : kyoboDetail();
    });
    assert.equal(calls[0].pathname, '/api/gw/store/author/search');
    assert.equal(calls[0].searchParams.get('searchCode'), '001');
    assert.equal(calls[0].searchParams.get('searchText'), '한강');
    assert.equal(profiles[0].sourceUrl, 'https://store.kyobobook.co.kr/person/detail/1000646901');
    assert.equal(profiles[0].birthDate, '1970-11-27');
    assert.deepEqual(profiles[0].alternateNames, ['Han Kang']);
    assert.equal(profiles[0].photoUrl, KYOBO_PHOTO);
    assert.equal(profiles[0].description, '1970년 겨울에 태어났다. 대표 작품은 소년이 온다이다.');
});

test('Kyobo never substitutes book covers, another author, or an unconfirmed portrait', async () => {
    for (const detail of [
        kyoboDetail({ photo: 'https://contents.kyobobook.co.kr/pdt/9788936434120.jpg' }),
        kyoboDetail({ photo: 'https://contents.kyobobook.co.kr/dtl/author/2000009201.jpg' }),
        kyoboDetail({ hasPhoto: 'N' }),
    ]) {
        const profiles = await searchKyoboAuthors('한강', async url => url.includes('/api/') ? kyoboSearch([kyoboEntry()]) : detail);
        assert.equal(profiles[0].photoUrl, '');
    }
});

test('bookstore sources expose failed searches and keep partial search results if details fail', async () => {
    await assert.rejects(searchAladinAuthors('한강', async () => '<html>Access denied</html>'), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    await assert.rejects(searchKyoboAuthors('한강', async () => JSON.stringify({ statusCode: 403 })), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    const profiles = await searchKyoboAuthors('한강', async url => {
        if (url.includes('/api/')) return kyoboSearch([kyoboEntry()]);
        throw Object.assign(new Error('Blocked'), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' });
    });
    assert.equal(profiles.partial, true);
    assert.equal(profiles[0].name, '한강');
    assert.equal(profiles[0].topWork, '소년이 온다');
});

test('bookstore sources distinguish empty searches from invalid responses', async () => {
    assert.deepEqual(await searchAladinAuthors('없는 이름', async () => aladinSearch([])), []);
    assert.deepEqual(await searchKyoboAuthors('없는 이름', async () => kyoboSearch([])), []);
    assert.deepEqual(await searchAladinAuthors(' ', async () => { throw new Error('Must not request'); }), []);
    assert.deepEqual(await searchKyoboAuthors(' ', async () => { throw new Error('Must not request'); }), []);
});

test('changed or blocked detail pages preserve profiles while marking results partial', async () => {
    for (const detail of ['<html><title>Access denied</title></html>', '<html><h1>New layout</h1></html>']) {
        const aladin = await searchAladinAuthors('한강', async url => url.includes('/search/')
            ? aladinSearch([aladinEntry('49154', '한강', ALADIN_PHOTO)]) : detail);
        const kyobo = await searchKyoboAuthors('한강', async url => url.includes('/api/') ? kyoboSearch([kyoboEntry()]) : detail);
        assert.equal(aladin.partial, true);
        assert.equal(kyobo.partial, true);
        assert.equal(aladin[0].photoUrl, ALADIN_PHOTO);
        assert.equal(kyobo[0].topWork, '소년이 온다');
    }
    for (const search of [searchAladinAuthors, searchKyoboAuthors]) {
        await assert.rejects(search('한강', async () => '<title>Just a moment...</title>'), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' });
    }
});

test('bookstore sources stop new detail requests after access blocks and rate limits', async () => {
    const sources = [
        [searchAladinAuthors, aladinSearch(Array.from({ length: 8 }, (_, index) => aladinEntry(String(index + 1), `작가 ${index}`)))],
        [searchKyoboAuthors, kyoboSearch(Array.from({ length: 8 }, (_, index) => kyoboEntry(String(1000000000 + index), `작가 ${index}`)))],
    ];
    for (const [search, list] of sources) {
        for (const code of ['AUTHOR_PROFILE_ACCESS_BLOCKED', 'AUTHOR_PROFILE_RATE_LIMIT', 'challenge-html']) {
            let details = 0;
            const profiles = await search('작가', async url => {
                if (url.includes('/search/') || url.includes('/api/')) return list;
                details += 1;
                if (code === 'challenge-html') return '<title>Access denied</title>';
                throw Object.assign(new Error('Unavailable'), { code });
            });
            assert.equal(profiles.length, 8);
            assert.equal(profiles.partial, true);
            assert.equal(details, 2);
        }
    }
});

test('an individual detail failure still allows the remaining candidates to load', async () => {
    let details = 0;
    const profiles = await searchAladinAuthors('한강', async url => {
        if (url.includes('/search/')) return aladinSearch([
            aladinEntry('1', '한강'), aladinEntry('2', '한강'), aladinEntry('49154', '한강'),
        ]);
        details += 1;
        if (!url.endsWith('@49154')) throw Object.assign(new Error('Temporary failure'), { code: 'AUTHOR_PROFILE_REQUEST_FAILED' });
        return aladinDetail();
    });
    assert.equal(details, 3);
    assert.equal(profiles.partial, true);
    assert.equal(profiles.find(profile => profile.id === 'aladin:49154').birthDate, '1970-11-27');
});
