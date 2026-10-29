import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createAuthorProfileService, registerAuthorProfilesIpc, requestAuthorProfilesJson } from './authorProfiles.js';

function networkFixture({ body = '{"docs":[]}', statusCode = 200, headers = {}, stalled = false } = {}) {
    const calls = [];
    const requests = [];
    const get = (url, options, callback) => {
        calls.push({ url, options });
        const request = new EventEmitter();
        request.destroy = error => {
            request.destroyed = true;
            if (error) request.emit('error', error);
        };
        requests.push(request);
        if (!stalled) queueMicrotask(() => {
            const response = new PassThrough();
            response.statusCode = statusCode;
            response.headers = headers;
            callback(response);
            response.end(body);
        });
        return request;
    };
    return { get, calls, requests };
}

function emptyResponse(url) {
    if (url.hostname === 'openlibrary.org') return { docs: [] };
    if (url.searchParams.get('action') === 'wbsearchentities') return { search: [] };
    if (url.searchParams.get('action') === 'wbgetentities') return { entities: {} };
    return { batchcomplete: true };
}

function serviceFixture(load) {
    let clock = 0;
    const calls = [];
    const service = createAuthorProfileService({
        webSearchers: {},
        now: () => clock,
        sleep: async delay => { clock += delay; },
        requestJson: async value => {
            const url = new URL(value);
            calls.push(url);
            return await load?.(url) ?? emptyResponse(url);
        },
    });
    return { service, calls };
}

function claim(value) {
    return { rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } };
}

function authorEntity(id, name = 'Author', extra = {}) {
    return {
        id, labels: { en: { value: name } }, descriptions: { en: { value: 'writer' } },
        claims: { P31: [claim({ id: 'Q5' })], P106: [claim({ id: 'Q36180' })] },
        ...extra,
    };
}

function imagePage(title = 'File:Author.jpg', extra = {}) {
    return {
        title,
        imageinfo: [{
            thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Author.jpg/320px-Author.jpg',
            thumbwidth: 320, thumbheight: 400, thumbmime: 'image/jpeg', mime: 'image/jpeg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Author.jpg',
            extmetadata: { Artist: { value: '<a href="https://example.com">Jane &amp; John</a>' }, LicenseShortName: { value: '<span>CC BY-SA 4.0</span>' } },
            ...extra,
        }],
    };
}

test('author search returns distinct bounded candidates and constructs URLs only from valid author IDs', async () => {
    const { service, calls } = serviceFixture(url => {
        if (url.hostname !== 'openlibrary.org') return undefined;
        return { docs: [
            { key: '/authors/OL23919A', name: ' J. K. Rowling ', alternate_names: ['Joanne Rowling', '', 'Joanne Rowling', null], birth_date: '31 July 1965', top_work: 'Harry Potter', photoUrl: 'https://attacker.test/photo' },
            { key: 'OL23919A', name: 'Duplicate' },
            { key: 'OL1W', name: 'Work instead of author' },
            { key: 'OL1A/../../secret', name: 'Invalid path' },
            { key: 'https://attacker.test/OL2A', name: 'Invalid URL' },
            { key: 'OL3A', name: '' },
            { key: 'OL4A', name: 'Jane Doe', death_date: '2020' },
            { key: 'OL5A', name: 'Other author' },
            { key: 'OL6A', name: 'Beyond the limit' },
        ] };
    });
    const profiles = await service.search('  Rowling & friends  ');
    const openLibraryCall = calls.find(url => url.hostname === 'openlibrary.org');
    assert.equal(openLibraryCall.origin, 'https://openlibrary.org');
    assert.equal(openLibraryCall.pathname, '/search/authors.json');
    assert.equal(openLibraryCall.searchParams.get('q'), 'Rowling & friends');
    assert.equal(openLibraryCall.searchParams.get('limit'), '8');
    assert.deepEqual(profiles.map(profile => profile.id), ['OL23919A', 'OL4A', 'OL5A']);
    assert.deepEqual(profiles[0], {
        id: 'OL23919A', provider: 'openlibrary', name: 'J. K. Rowling', alternateNames: ['Joanne Rowling'], birthDate: '31 July 1965', deathDate: '', topWork: 'Harry Potter', works: ['Harry Potter'],
        photoUrl: 'https://covers.openlibrary.org/a/olid/OL23919A-M.jpg?default=false', sourceUrl: 'https://openlibrary.org/authors/OL23919A',
    });
    assert.equal(profiles[1].deathDate, '2020');
});

test('blank, invalid and overlong queries never contact the provider', async () => {
    const service = createAuthorProfileService({ requestJson: () => assert.fail('must not make a request') });
    for (const query of ['', ' \n\t ', null, {}, ['author'], 'x'.repeat(201)]) {
        await assert.rejects(service.search(query), { code: 'AUTHOR_PROFILE_INVALID_QUERY' });
    }
});

test('concurrent searches are spaced per provider, cached, and share identical pending lookups', async () => {
    let clock = 0;
    const active = new Set();
    const starts = [];
    const service = createAuthorProfileService({
        now: () => clock,
        sleep: async delay => { clock += delay; },
        requestJson: async value => {
            const url = new URL(value);
            assert.equal(active.has(url.host), false);
            active.add(url.host);
            starts.push({ time: clock, host: url.host, query: url.searchParams.get('q') || url.searchParams.get('search') || url.searchParams.get('gsrsearch') });
            await Promise.resolve();
            active.delete(url.host);
            return emptyResponse(url);
        },
    });
    await Promise.all([service.search('First'), service.search('first'), service.search('Second'), service.search('Third')]);
    assert.equal(starts.length, 9);
    for (const host of ['www.wikidata.org', 'en.wikipedia.org', 'openlibrary.org']) {
        const providerStarts = starts.filter(start => start.host === host);
        assert.deepEqual(providerStarts.map(start => start.query), ['First', 'Second', 'Third']);
        for (let index = 1; index < providerStarts.length; index += 1) assert.ok(providerStarts[index].time - providerStarts[index - 1].time >= 1050);
    }
    await service.search(' First ');
    assert.equal(starts.length, 9);
    clock += 24 * 60 * 60 * 1000 + 1;
    await service.search('First');
    assert.equal(starts.length, 12);
});

test('failed responses are not cached and do not block later searches', async () => {
    let attempts = 0;
    const { service, calls } = serviceFixture(url => {
        if (url.hostname === 'www.wikidata.org') return ++attempts === 1 ? { notSearch: [] } : { search: [] };
    });
    await assert.rejects(service.search('Author'), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    assert.deepEqual(await service.search('Author'), []);
    assert.equal(attempts, 2);
    assert.equal(calls.length, 4);
});

test('Wikidata returns human profiles, multilingual works, and bounded portraits with plain-text attribution', async () => {
    const entity = authorEntity('Q1', 'Jane Author', {
        labels: { ko: { value: '제인 작가' }, en: { value: 'Jane Author' } },
        aliases: { en: [{ value: 'J. Author' }], ja: [{ value: 'ジェイン' }] },
        claims: {
            P31: [claim({ id: 'Q5' })], P106: [claim({ id: 'Q36180' })], P18: [claim('Author.jpg')],
            P569: [claim({ time: '+1901-02-03T00:00:00Z', precision: 11 })],
            P570: [claim({ time: '+1980-00-00T00:00:00Z', precision: 9 })], P800: [claim({ id: 'Q100' })],
        },
    });
    const { service, calls } = serviceFixture(url => {
        const action = url.searchParams.get('action');
        if (action === 'wbsearchentities') return { search: [{ id: 'Q1' }, { id: 'Q2' }, { id: '../unsafe' }] };
        if (action === 'wbgetentities') {
            if (url.searchParams.get('props') === 'labels|aliases') return { entities: { Q100: { labels: { en: { value: 'The Book' }, ko: { value: '그 책' } } } } };
            return { entities: { Q1: entity, Q2: { id: 'Q2', labels: { en: { value: 'A novel' } }, claims: { P31: [claim({ id: 'Q8261' })] } } } };
        }
        if (url.searchParams.get('prop') === 'imageinfo') return { query: { pages: [imagePage('File:Author.jpg', {
            thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Author.jpg/320px-Author.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail',
        })] } };
        assert.fail(`Unexpected fallback: ${url}`);
    });
    const profiles = await service.search('Jane Author');
    assert.equal(calls.length, 4);
    assert.equal(profiles.length, 1);
    assert.deepEqual(profiles[0], {
        id: 'Q1', entityId: 'Q1', provider: 'wikidata', authorVerified: true, name: 'Jane Author',
        alternateNames: ['제인 작가', 'J. Author', 'ジェイン'], birthDate: '1901-02-03', deathDate: '1980',
        topWork: 'The Book', works: ['The Book', '그 책'], description: 'writer',
        photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Author.jpg/320px-Author.jpg',
        sourceUrl: 'https://www.wikidata.org/wiki/Q1', imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Author.jpg',
        imageLicense: 'CC BY-SA 4.0', imageArtist: 'Jane & John',
    });
    assert.equal(calls.find(url => url.searchParams.get('prop') === 'imageinfo').searchParams.get('iiurlheight'), '400');
});

test('manual all-sources searches reuse automatic requests while adding Wikipedia and Open Library', async () => {
    const entity = authorEntity('Q1', 'Author');
    entity.claims.P18 = [claim('Author.jpg')];
    const { service, calls } = serviceFixture(url => {
        if (url.searchParams.get('action') === 'wbsearchentities') return { search: [{ id: 'Q1' }] };
        if (url.searchParams.get('action') === 'wbgetentities') return { entities: { Q1: entity } };
        if (url.searchParams.get('prop') === 'imageinfo') return { query: { pages: [imagePage()] } };
        if (url.searchParams.get('generator') === 'search') return { query: { pages: [{ pageid: 42, ns: 0, title: 'Author', pageimage: 'Author.jpg', pageprops: { wikibase_item: 'Q1' } }] } };
        if (url.hostname === 'openlibrary.org') return { docs: [{ key: 'OL1A', name: 'Author' }] };
    });
    assert.deepEqual((await service.search('Author')).map(profile => profile.id), ['Q1']);
    const firstCalls = calls.length;
    const manual = await service.search('Author', { allSources: true });
    assert.deepEqual(manual.map(profile => profile.id), ['Q1', 'wikipedia:en:42', 'OL1A']);
    assert.equal(calls.length - firstCalls, 3);
    const afterManual = calls.length;
    await service.search('Author', { allSources: true });
    await service.search('Author');
    assert.equal(calls.length, afterManual);
});

test('Wikipedia fallback checks linked human entities and normalizes Korean and Japanese file namespaces', async () => {
    for (const [language, name, prefix] of [['ko', '작가', '파일'], ['ja', '作家', 'ファイル']]) {
        const { service, calls } = serviceFixture(url => {
            if (url.searchParams.get('action') === 'wbsearchentities') {
                assert.equal(url.searchParams.get('language'), language);
                return { search: [] };
            }
            if (url.searchParams.get('action') === 'wbgetentities') return { entities: {
                Q1: authorEntity('Q1', name), Q2: { id: 'Q2', claims: { P31: [claim({ id: 'Q8261' })] } },
            } };
            if (url.searchParams.get('generator') === 'search') {
                assert.equal(url.hostname, `${language}.wikipedia.org`);
                return { query: { pages: [
                    { pageid: 42, ns: 0, title: `${name} (writer)`, pageimage: 'Author.jpg', pageprops: { wikibase_item: 'Q1' } },
                    { pageid: 43, ns: 0, title: `${name} book`, pageimage: 'Book.jpg', pageprops: { wikibase_item: 'Q2' } },
                    { pageid: 44, ns: 0, title: name, pageprops: { wikibase_item: 'Q1', disambiguation: '' } },
                ] } };
            }
            if (url.searchParams.get('prop') === 'imageinfo') {
                assert.equal(url.searchParams.get('titles'), 'File:Author.jpg');
                return { query: { pages: [imagePage(`${prefix}:Author.jpg`, { descriptionurl: `https://${language}.wikipedia.org/wiki/${prefix}:Author.jpg` })] } };
            }
            assert.fail(`Unexpected fallback: ${url}`);
        });
        const profiles = await service.search(name);
        assert.equal(profiles.length, 1);
        assert.equal(profiles[0].id, `wikipedia:${language}:42`);
        assert.equal(profiles[0].entityId, 'Q1');
        assert.equal(profiles[0].sourceUrl, `https://${language}.wikipedia.org/?curid=42`);
        assert.equal(profiles[0].imageSourceUrl, `https://${language}.wikipedia.org/wiki/File:Author.jpg`);
        assert.ok(profiles[0].photoUrl);
        assert.equal(calls.length, 4);
    }
});

test('ambiguous same-name authors continue to fallback even when only one has a picture', async () => {
    const first = authorEntity('Q1');
    first.claims.P18 = [claim('Author.jpg')];
    const { service, calls } = serviceFixture(url => {
        if (url.searchParams.get('action') === 'wbsearchentities') return { search: [{ id: 'Q1' }, { id: 'Q2' }] };
        if (url.searchParams.get('action') === 'wbgetentities') return { entities: { Q1: first, Q2: authorEntity('Q2') } };
        if (url.searchParams.get('prop') === 'imageinfo') return { query: { pages: [imagePage()] } };
        if (url.hostname === 'openlibrary.org') return { docs: [{ key: 'OL1A', name: 'Author', top_work: 'Useful disambiguating work' }] };
    });
    const profiles = await service.search('Author');
    assert.equal(profiles.find(profile => profile.id === 'OL1A').topWork, 'Useful disambiguating work');
    assert.equal(profiles.filter(profile => profile.provider === 'wikidata').length, 2);
    assert.ok(calls.some(url => url.hostname === 'en.wikipedia.org'));
});

test('non-writing humans stay available for manual correction but cannot stop automatic fallbacks', async () => {
    const entity = authorEntity('Q1', 'Author', { descriptions: { en: { value: 'football player' } }, claims: { P31: [claim({ id: 'Q5' })], P18: [claim('Author.jpg')] } });
    const { service, calls } = serviceFixture(url => {
        if (url.searchParams.get('action') === 'wbsearchentities') return { search: [{ id: 'Q1' }] };
        if (url.searchParams.get('action') === 'wbgetentities') return { entities: { Q1: entity } };
        if (url.searchParams.get('prop') === 'imageinfo') return { query: { pages: [imagePage()] } };
    });
    const profiles = await service.search('Author');
    assert.equal(profiles[0].authorVerified, false);
    assert.ok(calls.some(url => url.hostname === 'openlibrary.org'));
});

test('untrusted, oversized, and active image formats cannot become profile pictures', async () => {
    for (const extra of [
        { thumburl: 'https://attacker.test/Author.jpg' },
        { thumburl: 'http://upload.wikimedia.org/wikipedia/commons/Author.jpg' },
        { thumburl: 'https://user:pass@upload.wikimedia.org/wikipedia/commons/Author.jpg' },
        { thumburl: 'https://upload.wikimedia.org/wikipedia/commons/Author.svg', thumbmime: 'image/svg+xml' },
        { thumburl: 'https://upload.wikimedia.org/wikipedia/commons/Author.jpg?redirect=https://attacker.test' },
        { thumburl: 'https://upload.wikimedia.org/private/Author.jpg' },
        { thumbwidth: 4000 },
    ]) {
        const entity = authorEntity('Q1');
        entity.claims.P18 = [claim('Author.jpg')];
        const { service } = serviceFixture(url => {
            if (url.searchParams.get('action') === 'wbsearchentities') return { search: [{ id: 'Q1' }] };
            if (url.searchParams.get('action') === 'wbgetentities') return { entities: { Q1: entity } };
            if (url.searchParams.get('prop') === 'imageinfo') return { query: { pages: [imagePage('File:Author.jpg', extra)] } };
        });
        assert.equal((await service.search('Author'))[0].photoUrl, '');
    }
});

test('one provider outage preserves useful profiles and transient empty results are retried', async () => {
    let fail = true;
    const { service, calls } = serviceFixture(url => {
        if (url.hostname === 'www.wikidata.org' && fail) throw new Error('remote host detail');
        if (url.hostname === 'openlibrary.org') return { docs: [{ key: 'OL1A', name: 'Author' }] };
    });
    const first = await service.search('Author');
    assert.equal(first.partial, true);
    assert.deepEqual(first.map(profile => profile.id), ['OL1A']);
    fail = false;
    const second = await service.search('Author');
    assert.equal(second.partial, undefined);
    assert.equal(calls.filter(url => url.hostname === 'www.wikidata.org').length, 2);
    assert.equal(calls.filter(url => url.hostname === 'openlibrary.org').length, 1);
});

test('provider rate limits do not block other sources or immediately retry the rate-limited host', async () => {
    const { service, calls } = serviceFixture(url => {
        if (url.hostname === 'www.wikidata.org') return { error: { code: 'maxlag' } };
        if (url.hostname === 'openlibrary.org') return { docs: [{ key: 'OL1A', name: 'Author' }] };
    });
    assert.equal((await service.search('First')).partial, true);
    assert.equal((await service.search('Second')).partial, true);
    assert.equal(calls.filter(url => url.hostname === 'www.wikidata.org').length, 1);
    assert.equal(calls.filter(url => url.hostname === 'openlibrary.org').length, 2);
});

test('provider cooldown honors longer Retry-After delays and resumes only after they expire', async () => {
    let clock = 0;
    let limitedCalls = 0;
    const service = createAuthorProfileService({
        now: () => clock,
        sleep: async delay => { clock += delay; },
        requestJson: async value => {
            const url = new URL(value);
            if (url.hostname === 'www.wikidata.org') {
                limitedCalls += 1;
                if (limitedCalls === 1) {
                    const error = new Error('Back off');
                    error.code = 'AUTHOR_PROFILE_RATE_LIMIT';
                    error.retryAfterMs = 120000;
                    throw error;
                }
            }
            if (url.hostname === 'openlibrary.org') return { docs: [{ key: 'OL1A', name: 'Author' }] };
            return emptyResponse(url);
        },
    });
    assert.equal((await service.search('First')).partial, true);
    clock = 60001;
    assert.equal((await service.search('Second')).partial, true);
    assert.equal(limitedCalls, 1);
    clock = 120001;
    assert.equal((await service.search('Third')).partial, undefined);
    assert.equal(limitedCalls, 2);
});

test('network rate limits preserve Retry-After seconds and dates without retrying the request', async () => {
    const url = 'https://openlibrary.org/search/authors.json?q=Author&limit=8';
    const now = Date.UTC(2026, 0, 1);
    for (const [statusCode, retryAfter, expectedDelay] of [
        [429, '120', 120000],
        [429, new Date(now + 180000).toUTCString(), 180000],
        [503, '240', 240000],
        [429, 'not a date', undefined],
        [429, '0', undefined],
    ]) {
        const fixture = networkFixture({ statusCode, headers: { 'retry-after': retryAfter } });
        await assert.rejects(requestAuthorProfilesJson(url, { ...fixture, now: () => now }), error => {
            assert.equal(error.code, 'AUTHOR_PROFILE_RATE_LIMIT');
            assert.equal(error.retryAfterMs, expectedDelay);
            return true;
        });
        assert.equal(fixture.calls.length, 1);
    }
});

test('network requests identify the app, reject redirects and excessive responses, and stop on timeout', async () => {
    const url = 'https://openlibrary.org/search/authors.json?q=Author&limit=8';
    const valid = networkFixture();
    assert.deepEqual(await requestAuthorProfilesJson(url, valid), { docs: [] });
    assert.match(valid.calls[0].options.headers['User-Agent'], /BookManager.*https:\/\/github.com\/dongkkase\/BookManager/);
    assert.equal(valid.calls[0].options.headers.Accept, 'application/json');
    for (const [options, code] of [
        [{ statusCode: 302 }, 'AUTHOR_PROFILE_REQUEST_FAILED'],
        [{ statusCode: 429 }, 'AUTHOR_PROFILE_RATE_LIMIT'],
        [{ statusCode: 500 }, 'AUTHOR_PROFILE_REQUEST_FAILED'],
        [{ body: 'not json' }, 'AUTHOR_PROFILE_INVALID_RESPONSE'],
        [{ body: 'x'.repeat(1024 * 1024 + 1) }, 'AUTHOR_PROFILE_INVALID_RESPONSE'],
    ]) {
        const value = networkFixture(options);
        await assert.rejects(requestAuthorProfilesJson(url, value), { code });
        assert.equal(value.calls.length, 1);
    }
    const stalled = networkFixture({ stalled: true });
    await assert.rejects(requestAuthorProfilesJson(url, { ...stalled, timeoutMs: 10 }), { code: 'AUTHOR_PROFILE_TIMEOUT' });
    assert.equal(stalled.requests[0].destroyed, true);
});

test('network transport accepts only fixed HTTPS provider endpoints', async () => {
    const get = () => assert.fail('unsafe URLs must not make a request');
    for (const url of [
        'http://openlibrary.org/search/authors.json', 'https://openlibrary.org.attacker.test/search/authors.json',
        'https://user:password@openlibrary.org/search/authors.json', 'https://openlibrary.org:444/search/authors.json',
        'https://openlibrary.org/search/authors.json#fragment', 'https://openlibrary.org/other',
        'not a URL', 'https://www.wikidata.org.attacker.test/w/api.php', 'https://www.wikidata.org/wiki/Q1',
        'https://commons.wikimedia.org:444/w/api.php', 'https://fr.wikipedia.org/w/api.php',
        'https://user:password@ko.wikipedia.org/w/api.php', 'https://ja.wikipedia.org/w/api.php#fragment',
    ]) {
        await assert.rejects(requestAuthorProfilesJson(url, { get }), { code: 'AUTHOR_PROFILE_REQUEST_FAILED' });
    }
    for (const host of ['www.wikidata.org', 'commons.wikimedia.org', 'ko.wikipedia.org', 'ja.wikipedia.org', 'en.wikipedia.org']) {
        const fixture = networkFixture({ body: '{"search":[]}' });
        assert.deepEqual(await requestAuthorProfilesJson(`https://${host}/w/api.php?action=query`, fixture), { search: [] });
        assert.equal(fixture.calls.length, 1);
    }
});

test('IPC permits only the main window top frame and returns safe error messages', async () => {
    const handlers = new Map();
    const mainFrame = {};
    const sender = { mainFrame, isDestroyed: () => false };
    let window = { webContents: sender, isDestroyed: () => false };
    let calls = 0;
    registerAuthorProfilesIpc({
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        getMainWindow: () => window,
        service: { search: async (name, options) => {
            calls += 1;
            if (name === 'fail') throw new Error('internal path or remote response must not leak');
            const profiles = [{ id: 'OL1A', name }];
            if (name === 'partial') {
                assert.deepEqual(options, { allSources: true });
                Object.defineProperty(profiles, 'partial', { value: true });
            } else assert.deepEqual(options, { allSources: false });
            return profiles;
        } },
    });
    const invoke = handlers.get('authors:searchProfiles');
    assert.deepEqual(await invoke({ sender, senderFrame: mainFrame }, 'Author'), { success: true, profiles: [{ id: 'OL1A', name: 'Author' }] });
    assert.equal((await invoke({ sender, senderFrame: mainFrame }, 'partial', { allSources: true, arbitraryUrl: 'https://attacker.test' })).partial, true);
    for (const event of [{ sender: {}, senderFrame: mainFrame }, { sender, senderFrame: {} }]) {
        assert.equal((await invoke(event, 'Author')).code, 'AUTHOR_PROFILE_UNTRUSTED_SENDER');
    }
    window = null;
    assert.equal((await invoke({ sender }, 'Author')).code, 'AUTHOR_PROFILE_UNTRUSTED_SENDER');
    assert.equal(calls, 2);
    window = { webContents: sender, isDestroyed: () => false };
    const failure = await invoke({ sender, senderFrame: mainFrame }, 'fail');
    assert.equal(failure.code, 'AUTHOR_PROFILE_REQUEST_FAILED');
    assert.equal(failure.success, false);
    assert.deepEqual(failure.profiles, []);
    assert.doesNotMatch(failure.error, /internal path/);
});

test('수동 검색은 선택한 국내 소스만 호출하며 자동 조회는 기존 소스만 사용한다', async () => {
    const calls = [];
    const jsonCalls = [];
    const service = createAuthorProfileService({
        requestJson: async value => { const url = new URL(value); jsonCalls.push(url); return emptyResponse(url); },
        sleep: async () => {},
        requestText: async url => { calls.push(url); return 'result'; },
        webSearchers: {
            aladin: async (query, request) => {
                await request('https://www.aladin.co.kr/author/search/wauthor_search_name.aspx?SearchWord=' + encodeURIComponent(query));
                return [{ provider: 'aladin', id: 'aladin:49154', name: query, photoUrl: '' }];
            },
            kyobo: async () => assert.fail('Unselected source must not be queried'),
        },
    });
    const selected = await service.search('한강', { allSources: true, source: 'aladin' });
    assert.equal(selected[0].id, 'aladin:49154');
    assert.equal(calls.length, 1);
    assert.equal(jsonCalls.length, 0);
    await service.search('한강', { allSources: true, source: 'aladin' });
    assert.equal(calls.length, 1);
    await service.search('한강');
    assert.equal(calls.length, 1);
    assert.ok(jsonCalls.some(url => url.hostname === 'openlibrary.org'));
    await assert.rejects(service.search('한강', { source: 'https://attacker.test' }), { code: 'AUTHOR_PROFILE_INVALID_SOURCE' });
});

test('전체 수동 검색은 추가 출처를 포함하고 실패한 소스 이름을 결과와 함께 제공한다', async () => {
    let failures = true;
    const service = createAuthorProfileService({
        requestJson: async value => emptyResponse(new URL(value)),
        sleep: async () => {},
        webSearchers: {
            aladin: async () => [{ provider: 'aladin', id: 'aladin:49154', name: '한강' }],
            kyobo: async () => [{ provider: 'kyobo', id: 'kyobo:1000646901', name: '한강' }],
            cartoon: async () => [],
            kmas: async () => { if (failures) throw Object.assign(new Error('private transport error'), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' }); return []; },
        },
    });
    const result = await service.search('한강', { allSources: true, source: 'all' });
    assert.equal(result.length, 2);
    assert.equal(result.partial, true);
    assert.deepEqual(result.failedSources, [{ source: 'kmas', code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' }]);
    failures = false;
    assert.equal((await service.search('한강', { allSources: true, source: 'all' })).partial, undefined);
});

test('국내 상세 보강 일부 실패는 후보를 유지하고 같은 검색을 재시도할 수 있다', async () => {
    let calls = 0;
    const service = createAuthorProfileService({
        webSearchers: { aladin: async () => {
            calls += 1;
            const profiles = [{ provider: 'aladin', id: 'aladin:1', name: '작가' }];
            if (calls === 1) Object.defineProperty(profiles, 'partial', { value: true });
            return profiles;
        } },
    });
    const first = await service.search('작가', { source: 'aladin' });
    assert.equal(first.length, 1);
    assert.equal(first.partial, true);
    assert.deepEqual(first.failedSources.map(item => item.source), ['aladin']);
    assert.equal((await service.search('작가', { source: 'aladin' })).partial, undefined);
    assert.equal(calls, 2);
});

test('HTTP 200 오류 페이지는 원문 캐시에 남지 않아 검색과 상세 조회가 즉시 복구된다', async () => {
    const searchHtml = '<!--검색결과 시작--><div class="newbg_authorbox"><table><a href="/author/wauthor_overview.aspx?AuthorSearch=@49154"><strong>한강</strong></a></table></div><!--검색결과 끝-->';
    const detailHtml = '<script type="application/ld+json">' + JSON.stringify({
        '@type': 'Person', name: '한강', description: '복구된 작가 소개',
    }) + '</script>';
    for (const failedStage of ['search', 'detail']) {
        let blocked = true;
        const calls = { search: 0, detail: 0 };
        const service = createAuthorProfileService({
            sleep: async () => {},
            requestJson: async () => assert.fail('A selected web source must not query other sources'),
            requestText: async url => {
                const stage = url.includes('/search/') ? 'search' : 'detail';
                calls[stage] += 1;
                if (blocked && stage === failedStage) return '<title>Access denied</title>';
                return stage === 'search' ? searchHtml : detailHtml;
            },
        });
        if (failedStage === 'search') {
            await assert.rejects(service.search('한강', { source: 'aladin' }), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' });
        } else {
            assert.equal((await service.search('한강', { source: 'aladin' })).partial, true);
        }
        blocked = false;
        const result = await service.search('한강', { source: 'aladin' });
        assert.equal(result.partial, undefined);
        assert.equal(result[0].description, '복구된 작가 소개');
        assert.equal(calls[failedStage], 2);
        const recoveredCalls = { ...calls };
        await service.search('한강', { source: 'aladin' });
        assert.deepEqual(calls, recoveredCalls, 'Successful recovered responses should be cached');
    }
});

test('IPC는 선택 소스와 실패 출처를 전달하고 임의 요청 주소는 전달하지 않는다', async () => {
    const handlers = new Map();
    const mainFrame = {};
    const sender = { mainFrame, isDestroyed: () => false };
    registerAuthorProfilesIpc({
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
        service: { search: async (_name, options) => {
            assert.deepEqual(options, { allSources: true, source: 'kmas' });
            throw Object.assign(new Error('internal detail'), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED', failedSources: [{ source: 'kmas', code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' }] });
        } },
    });
    const result = await handlers.get('authors:searchProfiles')({ sender, senderFrame: mainFrame }, '작가', { allSources: true, source: 'kmas', url: 'https://attacker.test' });
    assert.equal(result.success, false);
    assert.deepEqual(result.failedSources, [{ source: 'kmas', code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' }]);
    assert.ok(!result.error.includes('internal detail'));
});

function persistentSearchFixture(now) {
    const entries = new Map();
    const writes = [];
    const resultCache = {
        async get(namespace, key) { return structuredClone(entries.get(`${namespace}:${key}`)) || null; },
        async set(namespace, key, value) {
            writes.push({ namespace, key });
            entries.set(`${namespace}:${key}`, { value: structuredClone(value), expiresAt: now() + 7 * 24 * 60 * 60 * 1000 });
        },
    };
    return { resultCache, entries, writes };
}

test('수동 프로필 검색은 서비스 재생성 후 7일간 재사용하고 캐시 조회로 만료 시각을 연장하지 않는다', async () => {
    const ttl = 7 * 24 * 60 * 60 * 1000;
    let clock = 1000;
    let searches = 0;
    const { resultCache, entries, writes } = persistentSearchFixture(() => clock);
    const create = () => createAuthorProfileService({
        resultCache, now: () => clock,
        webSearchers: { aladin: async query => [{ provider: 'aladin', id: 'aladin:49154', name: query, description: `검색 ${++searches}` }] },
    });
    const first = await create().search('  한강  ', { source: 'aladin' });
    clock += ttl - 1;
    const restarted = create();
    assert.deepEqual(await restarted.search('한강', { source: 'aladin' }), first);
    assert.equal(searches, 1);
    assert.equal(writes.length, 1);
    clock += 1;
    assert.equal((await restarted.search('한강', { source: 'aladin' }))[0].description, '검색 2');
    assert.equal(searches, 2);
    entries.clear();
    await restarted.search('한강', { source: 'aladin' });
    assert.equal(searches, 3, 'Clearing the persistent API cache must also invalidate manual search reuse');
});

test('전체 수동 검색은 성공한 소스를 저장하고 재실행 후 실패한 소스만 다시 검색한다', async () => {
    const { resultCache, writes } = persistentSearchFixture(() => 1);
    const calls = { aladin: 0, kyobo: 0, json: 0 };
    let failing = true;
    const create = () => createAuthorProfileService({
        resultCache, now: () => 1, sleep: async () => {},
        requestJson: async url => { calls.json += 1; return emptyResponse(new URL(url)); },
        webSearchers: {
            aladin: async () => { calls.aladin += 1; return [{ provider: 'aladin', id: 'aladin:49154', name: '한강' }]; },
            kyobo: async () => {
                calls.kyobo += 1;
                if (failing) throw Object.assign(new Error('private transport error'), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' });
                return [{ provider: 'kyobo', id: 'kyobo:1000646901', name: '한강' }];
            },
        },
    });
    const first = await create().search('한강', { allSources: true });
    assert.equal(first.partial, true);
    assert.deepEqual(first.failedSources, [{ source: 'kyobo', code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' }]);
    assert.equal(writes.some(entry => entry.key.startsWith('kyobo:')), false);
    const firstJsonCalls = calls.json;
    failing = false;
    const restarted = create();
    const recovered = await restarted.search('한강', { allSources: true });
    assert.equal(recovered.partial, undefined);
    assert.equal(recovered.length, 2);
    assert.deepEqual(calls, { aladin: 1, kyobo: 2, json: firstJsonCalls });
    assert.equal((await restarted.search('한강', { source: 'aladin' })).length, 1);
    assert.equal(calls.aladin, 1, 'All-source and individual-source searches must share successful source results');
});

test('수동 프로필 캐시는 검색어·소스를 구분하고 자동 조회에 적용하지 않는다', async () => {
    const { resultCache, writes } = persistentSearchFixture(() => 1);
    let calls = 0;
    let jsonCalls = 0;
    const create = () => createAuthorProfileService({
        resultCache, now: () => 1, sleep: async () => {},
        requestJson: async url => { jsonCalls += 1; return emptyResponse(new URL(url)); },
        webSearchers: {
            aladin: async name => { calls += 1; return [{ provider: 'aladin', id: 'aladin:1', name }]; },
            kyobo: async name => { calls += 1; return [{ provider: 'kyobo', id: 'kyobo:1000000001', name }]; },
        },
    });
    const service = create();
    await Promise.all([service.search('Author', { source: 'aladin' }), service.search('author', { source: 'aladin' })]);
    assert.equal(calls, 1, 'Identical in-flight manual searches should be shared');
    await service.search('Other', { source: 'aladin' });
    await service.search('Author', { source: 'kyobo' });
    assert.equal(calls, 3);
    const manualWrites = writes.length;
    assert.deepEqual(await create().search('Author'), []);
    assert.ok(jsonCalls > 0, 'Automatic lookup must not reuse a manual result with a different selection policy');
    assert.equal(writes.length, manualWrites, 'Automatic lookup must not create manual search cache entries');
});

test('빈 검색 결과는 저장하지만 일부 상세 실패와 잘못된 저장값은 재시도한다', async () => {
    let clock = 1;
    const { resultCache, entries, writes } = persistentSearchFixture(() => clock);
    let searches = 0;
    let partial = true;
    const create = () => createAuthorProfileService({
        resultCache, now: () => clock,
        webSearchers: { aladin: async query => {
            searches += 1;
            const profiles = query === '없음' ? [] : [{ provider: 'aladin', id: 'aladin:1', name: query }];
            if (query !== '없음' && partial) Object.defineProperty(profiles, 'partial', { value: true });
            return profiles;
        } },
    });
    assert.deepEqual(await create().search('없음', { source: 'aladin' }), []);
    clock += 6 * 24 * 60 * 60 * 1000;
    assert.deepEqual(await create().search('없음', { source: 'aladin' }), []);
    assert.equal(searches, 1);
    assert.equal((await create().search('작가', { source: 'aladin' })).partial, true);
    assert.equal(writes.length, 1);
    partial = false;
    assert.equal((await create().search('작가', { source: 'aladin' })).partial, undefined);
    const lastKey = [...entries.keys()].find(key => key.endsWith(':작가'));
    entries.set(lastKey, { value: [null], expiresAt: clock + 1000 });
    await create().search('작가', { source: 'aladin' });
    assert.equal(searches, 4, 'Malformed persisted results should be replaced by a fresh search');
});

test('영속 검색 캐시를 읽거나 쓰지 못해도 정상 검색 결과를 반환한다', async () => {
    let searches = 0;
    const service = createAuthorProfileService({
        resultCache: { get: async () => { throw new Error('read failed'); }, set: async () => { throw new Error('write failed'); } },
        webSearchers: { aladin: async name => { searches += 1; return [{ provider: 'aladin', id: 'aladin:1', name }]; } },
    });
    for (let index = 0; index < 2; index += 1) assert.equal((await service.search('작가', { source: 'aladin' }))[0].name, '작가');
    assert.equal(searches, 2);
});
