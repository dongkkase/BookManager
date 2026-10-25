import assert from 'node:assert/strict';
import test from 'node:test';
import { authorKey } from './authorCatalog.js';
import { AUTOMATIC_AUTHOR_PROFILES_KEY, AUTHOR_PROFILES_KEY, AUTHOR_PROFILE_CACHE_VERSION, createAuthorProfileStore } from './authorProfileStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const profile = (id = 'OL1A', name = 'Jane Doe', extra = {}) => ({ id, name, ...extra });
const author = (name = 'Jane Doe', books = []) => ({ key: authorKey(name), name, books });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
    return {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        read: key => JSON.parse(values.get(key) || '{}'),
    };
}

test('기존 수동 프로필과 명시적 이니셜을 유지하며 안전한 URL만 사용한다', async () => {
    const storage = memoryStorage({ [AUTHOR_PROFILES_KEY]: {
        ' JANE   DOE ': profile('OL9A', 'Jane Doe', { photoUrl: 'https://untrusted.invalid/photo.jpg' }),
        한강: null,
        invalid: { id: 'OL1A/../secret' },
    } });
    const calls = [];
    let changes = 0;
    const store = createAuthorProfileStore({ storage, search: async name => { calls.push(name); return { success: true, profiles: [] }; }, onChange: () => { changes += 1; } });
    assert.equal(changes, 0);
    assert.equal(store.hasOverride('Jane Doe'), true);
    assert.equal(store.hasOverride('한강'), true);
    assert.equal(store.hasOverride('invalid'), false);
    assert.equal(store.getProfile('Jane Doe').photoUrl, 'https://covers.openlibrary.org/a/olid/OL9A-M.jpg?default=false');
    assert.equal(store.getProfile('한강'), null);
    store.setAuthors([author(), author('한강')]);
    await flush();
    assert.deepEqual(calls, []);
    assert.equal(store.setManual('한강', profile('OL2A', '한강')), true);
    assert.equal(store.setManual('Jane Doe', null), true);
    assert.equal(storage.read(AUTHOR_PROFILES_KEY)['jane doe'], null);
    assert.equal(storage.read(AUTHOR_PROFILES_KEY).한강.id, 'OL2A');
    assert.equal(store.setManual('Jane Doe', { id: 'invalid' }), false);
    assert.equal(store.hasOverride('Jane Doe'), true);
    store.dispose();
});

test('이름·별칭 일치와 소장 도서의 대표작 일치 순서로 자동 프로필을 선택한다', async () => {
    const responses = [
        [profile('OL1A', 'Someone Else'), profile('OL2A', 'JANE  DOE'), profile('OL3A', 'Jane Doe', { topWork: 'The Book' })],
        [profile('OL4A', 'Other'), profile('OL5A', 'Han Kang', { alternateNames: ['한강'] })],
        [{ id: 'javascript:bad' }, profile('OL6A', 'Provider First'), profile('OL7A', 'Provider Second')],
    ];
    const storage = memoryStorage();
    const store = createAuthorProfileStore({ storage, now: () => 100, search: async () => ({ success: true, profiles: responses.shift() }) });
    store.setAuthors([author('Jane Doe', [{ name: 'the   book.epub' }]), author('한강'), author('Unknown')]);
    await flush();
    assert.equal(store.getProfile('Jane Doe').id, 'OL3A');
    assert.equal(store.getProfile('한강').id, 'OL5A');
    assert.equal(store.getProfile('Unknown'), null);
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY)['jane doe'].expiresAt, 100 + 7 * DAY_MS);
    assert.deepEqual(storage.read(AUTHOR_PROFILES_KEY), {});
    store.dispose();
});

test('현재 화면 대상만 순차 조회하고 대기 중 화면 밖으로 나간 저자를 시작하지 않는다', async () => {
    const first = deferred();
    const second = deferred();
    const calls = [];
    const store = createAuthorProfileStore({ storage: memoryStorage(), search: name => {
        calls.push(name);
        return calls.length === 1 ? first.promise : second.promise;
    } });
    store.setAuthors([author('First'), author('Removed')]);
    assert.deepEqual(calls, ['First']);
    store.setAuthors([author('Replacement'), author('Replacement')]);
    assert.deepEqual(calls, ['First']);
    first.resolve({ success: true, profiles: [profile('OL1A', 'First')] });
    await flush();
    assert.deepEqual(calls, ['First', 'Replacement']);
    store.setAuthors([]);
    second.resolve({ success: true, profiles: [profile('OL2A', 'Replacement')] });
    await flush();
    assert.deepEqual(calls, ['First', 'Replacement']);
    assert.equal(store.getProfile('First').id, 'OL1A');
    store.dispose();
});

test('조회 중 수동 선택과 이니셜 선택은 늦은 자동 결과보다 우선한다', async () => {
    for (const manualProfile of [profile('OL9A', 'Chosen'), null]) {
        const pending = deferred();
        const storage = memoryStorage();
        const store = createAuthorProfileStore({ storage, search: () => pending.promise });
        store.setAuthors([author()]);
        assert.equal(store.setManual('Jane Doe', manualProfile), true);
        pending.resolve({ success: true, profiles: [profile()] });
        await flush();
        assert.equal(store.hasOverride('Jane Doe'), true);
        assert.equal(store.getProfile('Jane Doe')?.id || null, manualProfile?.id || null);
        assert.equal(storage.read(AUTHOR_PROFILES_KEY)['jane doe']?.id || null, manualProfile?.id || null);
        assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY)['jane doe'].profile.id, 'OL1A');
        store.dispose();
    }
});

test('성공·빈 결과를 7일간 캐시하고 오류는 1시간 후 다시 조회한다', async () => {
    let clock = 100;
    const counts = new Map();
    const storage = memoryStorage();
    const targets = [author('Found'), author('Empty'), author('Failed'), author('Throws'), author('Malformed')];
    const search = async name => {
        counts.set(name, (counts.get(name) || 0) + 1);
        if (name === 'Throws') throw new Error('offline');
        if (name === 'Failed') return { success: false, profiles: [] };
        if (name === 'Malformed') return { success: true, profiles: null };
        return { success: true, profiles: name === 'Found' ? [profile()] : [] };
    };
    let store = createAuthorProfileStore({ storage, now: () => clock, search });
    store.setAuthors(targets);
    await flush();
    assert.deepEqual([...counts.values()], [1, 1, 1, 1, 1]);
    const cached = storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY);
    assert.equal(cached.found.expiresAt, clock + 7 * DAY_MS);
    assert.equal(cached.empty.expiresAt, clock + 7 * DAY_MS);
    assert.equal(cached.failed.expiresAt, clock + HOUR_MS);
    assert.equal(cached.throws.expiresAt, clock + HOUR_MS);
    assert.equal(cached.malformed.expiresAt, clock + HOUR_MS);
    store.dispose();
    store = createAuthorProfileStore({ storage, now: () => clock, search });
    store.setAuthors(targets);
    await flush();
    assert.deepEqual([...counts.values()], [1, 1, 1, 1, 1]);
    clock += HOUR_MS;
    store.setAuthors(targets);
    await flush();
    assert.deepEqual([...counts.values()], [1, 1, 2, 2, 2]);
    clock += 7 * DAY_MS;
    store.setAuthors(targets);
    await flush();
    assert.deepEqual([...counts.values()], [2, 2, 3, 3, 3]);
    store.dispose();
});

test('저장 실패와 저장소 사용 불가 상태에서도 자동 결과를 세션에 유지한다', async () => {
    for (const storage of [null, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, {
        getItem() { return null; }, setItem() { throw new Error('full'); },
    }]) {
        let calls = 0;
        const store = createAuthorProfileStore({ storage, search: async () => {
            calls += 1;
            return { success: true, profiles: [profile()] };
        } });
        store.setAuthors([author()]);
        await flush();
        for (let attempt = 0; attempt < 3; attempt += 1) { store.reload(); store.setAuthors([author()]); }
        await flush();
        assert.equal(calls, 1);
        assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
        assert.equal(store.setManual('Jane Doe', profile('OL9A')), false);
        assert.equal(store.hasOverride('Jane Doe'), false);
        store.dispose();
    }
});

test('자동으로 다시 찾기는 기존 결과를 무효화하고 진행 중인 이전 결과도 무시한다', async () => {
    const first = deferred();
    const second = deferred();
    let calls = 0;
    const storage = memoryStorage();
    const store = createAuthorProfileStore({ storage, search: () => ++calls === 1 ? first.promise : second.promise });
    store.setAuthors([author()]);
    store.setManual('Jane Doe', profile('OL9A'));
    assert.equal(store.useAutomatic('Jane Doe'), true);
    assert.equal(store.hasOverride('Jane Doe'), false);
    first.resolve({ success: true, profiles: [profile('OL1A')] });
    await flush();
    assert.equal(calls, 2);
    assert.equal(store.getProfile('Jane Doe'), null);
    second.resolve({ success: true, profiles: [profile('OL2A')] });
    await flush();
    assert.equal(store.getProfile('Jane Doe').id, 'OL2A');
    assert.deepEqual(storage.read(AUTHOR_PROFILES_KEY), {});
    store.dispose();
});

test('다른 창의 수동 변경·해제와 자동 캐시를 다시 읽고 조회 대상을 갱신한다', async () => {
    const storage = memoryStorage();
    const pending = deferred();
    let changes = 0;
    let calls = 0;
    const store = createAuthorProfileStore({ storage, now: () => 100, onChange: () => { changes += 1; }, search: () => { calls += 1; return pending.promise; } });
    store.setAuthors([author()]);
    storage.setItem(AUTHOR_PROFILES_KEY, JSON.stringify({ 'jane doe': null }));
    store.reload();
    assert.equal(changes, 1);
    pending.resolve({ success: true, profiles: [profile()] });
    await flush();
    assert.equal(store.getProfile('Jane Doe'), null);
    assert.equal(store.hasOverride('Jane Doe'), true);
    storage.setItem(AUTHOR_PROFILES_KEY, '{}');
    storage.setItem(AUTOMATIC_AUTHOR_PROFILES_KEY, JSON.stringify({ 'jane doe': { profile: profile('OL9A'), checkedAt: 101, expiresAt: 101 + DAY_MS, version: AUTHOR_PROFILE_CACHE_VERSION } }));
    store.reload();
    await flush();
    assert.equal(store.hasOverride('Jane Doe'), false);
    assert.equal(store.getProfile('Jane Doe').id, 'OL9A');
    assert.equal(calls, 1);
    store.dispose();
});

test('손상되거나 검증되지 않은 캐시는 무시하고 안전한 프로필만 다시 저장한다', async () => {
    const storage = memoryStorage({ [AUTOMATIC_AUTHOR_PROFILES_KEY]: {
        valid: { profile: profile('OL1A', 'Valid', { photoUrl: 'javascript:alert(1)' }), checkedAt: 1, expiresAt: 200, version: AUTHOR_PROFILE_CACHE_VERSION },
        invalid: { profile: { id: 'OL0A' }, checkedAt: 1, expiresAt: 200 },
        missing: { checkedAt: 1, expiresAt: 200 },
        invalidTime: { profile: null, checkedAt: '1', expiresAt: 200 },
        reversed: { profile: null, checkedAt: 200, expiresAt: 1 },
    }, [AUTHOR_PROFILES_KEY]: [] });
    const calls = [];
    const store = createAuthorProfileStore({ storage, now: () => 100, search: async name => { calls.push(name); return { success: true, profiles: [] }; } });
    assert.equal(store.getProfile('valid').photoUrl, 'https://covers.openlibrary.org/a/olid/OL1A-M.jpg?default=false');
    store.setAuthors([author('Valid'), author('Invalid'), author('Missing')]);
    await flush();
    assert.deepEqual(calls, ['Invalid', 'Missing']);
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY).valid.profile.photoUrl, 'https://covers.openlibrary.org/a/olid/OL1A-M.jpg?default=false');
    store.dispose();
});

test('해제 후 진행 중 응답은 저장·알림을 하지 않고 후속 요청도 시작하지 않는다', async () => {
    const pending = deferred();
    const storage = memoryStorage();
    const calls = [];
    let changes = 0;
    const store = createAuthorProfileStore({ storage, onChange: () => { changes += 1; }, search: name => { calls.push(name); return pending.promise; } });
    store.setAuthors([author('First'), author('Second')]);
    store.dispose();
    pending.resolve({ success: true, profiles: [profile()] });
    await flush();
    store.setAuthors([author('Third')]);
    store.reload();
    assert.equal(store.setManual('First', profile()), false);
    assert.equal(store.useAutomatic('First'), false);
    assert.deepEqual(calls, ['First']);
    assert.equal(changes, 0);
    assert.deepEqual(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY), {});
});

test('자동 사진은 출처 우선순위와 작품 근거를 사용하고 동명이인은 이니셜로 남긴다', async () => {
    const wiki = (id, provider = 'wikidata', extra = {}) => ({
        id, provider, name: '한강', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg', ...extra,
    });
    const cases = [
        { profiles: [profile('OL1A', '한강'), wiki('Q1')], expected: 'Q1' },
        { profiles: [wiki('Q1', 'wikidata', { photoUrl: '' }), profile('OL1A', '한강')], expected: 'OL1A' },
        { profiles: [wiki('Q1'), wiki('Q2')], expected: null },
        { profiles: [wiki('Q1'), wiki('Q2', 'wikidata', { photoUrl: '' }), profile('OL1A', '한강')], expected: null },
        { profiles: [wiki('Q1'), wiki('Q2', 'wikidata', { works: ['채식주의자'] })], expected: 'Q2' },
        { profiles: [wiki('Q1'), profile('OL1A', '한강', { topWork: '채식주의자' })], expected: 'OL1A' },
        { profiles: [wiki('Q1'), wiki('wikipedia:ko:123', 'wikipedia', { entityId: 'Q1' })], expected: 'Q1' },
        { profiles: [wiki('Q1', 'wikidata', { photoUrl: '' }), wiki('Q2', 'wikidata', { photoUrl: '' }), wiki('wikipedia:ko:123', 'wikipedia', { entityId: 'Q1' })], expected: null },
        { profiles: [wiki('Q1', 'wikidata', { photoUrl: '' }), wiki('Q2', 'wikidata', { photoUrl: '' }), wiki('wikipedia:ko:123', 'wikipedia', { entityId: 'Q1', works: ['채식주의자'] })], expected: 'wikipedia:ko:123' },
        { profiles: [wiki('Q1'), wiki('wikipedia:ko:123', 'wikipedia', { entityId: 'Q2' })], expected: null },
        { profiles: [wiki('wikipedia:ko:123', 'wikipedia', { entityId: 'Q1' }), wiki('wikipedia:en:456', 'wikipedia', { entityId: 'Q1' })], expected: 'wikipedia:ko:123' },
        { profiles: [wiki('wikipedia:ko:123', 'wikipedia', { entityId: 'Q1' }), wiki('wikipedia:en:456', 'wikipedia', { entityId: 'Q2' })], expected: null },
        { profiles: [wiki('Q1', 'wikidata', { name: 'Wrong Person', works: ['채식주의자'] })], expected: null },
        { profiles: [wiki('Q1', 'wikidata', { authorVerified: false })], expected: null },
        { profiles: [wiki('Q1', 'wikidata', { authorVerified: false }), profile('OL1A', '한강')], expected: 'OL1A' },
    ];
    for (const { profiles, expected } of cases) {
        const store = createAuthorProfileStore({ storage: memoryStorage(), search: async () => ({ success: true, profiles }) });
        store.setAuthors([author('한강', [{ title: '채식주의자.epub' }])]);
        await flush();
        assert.equal(store.getProfile('한강')?.id || null, expected);
        store.dispose();
    }
});

test('이전 자동 캐시는 사진을 유지한 채 다시 찾고 기존 수동 지정은 변경하지 않는다', async () => {
    const pending = deferred();
    const legacy = (value, checkedAt = 1) => ({ profile: value, checkedAt, expiresAt: checkedAt + 7 * DAY_MS });
    const storage = memoryStorage({
        [AUTOMATIC_AUTHOR_PROFILES_KEY]: {
            'jane doe': legacy(profile('OL1A')),
            empty: legacy(null),
            manual: legacy(profile('OL2A', 'Manual')),
            initials: legacy(profile('OL3A', 'Initials')),
        },
        [AUTHOR_PROFILES_KEY]: { manual: profile('OL9A', 'Manual'), initials: null },
    });
    const calls = [];
    const search = async name => {
        calls.push(name);
        return name === 'Jane Doe' ? pending.promise : { success: true, profiles: [] };
    };
    let store = createAuthorProfileStore({ storage, now: () => 100, search });
    store.setAuthors([author(), author('Empty'), author('Manual'), author('Initials')]);
    assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
    assert.equal(store.getProfile('Manual').id, 'OL9A');
    assert.equal(store.getProfile('Initials'), null);
    assert.deepEqual(calls, ['Jane Doe']);
    pending.resolve({ success: true, profiles: [{ provider: 'wikidata', id: 'Q1', name: 'Jane Doe', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg' }] });
    await flush();
    assert.deepEqual(calls, ['Jane Doe', 'Empty']);
    assert.equal(store.getProfile('Jane Doe').id, 'Q1');
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY)['jane doe'].version, AUTHOR_PROFILE_CACHE_VERSION);
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY).empty.version, AUTHOR_PROFILE_CACHE_VERSION);
    store.dispose();
    store = createAuthorProfileStore({ storage, now: () => 101, search });
    store.setAuthors([author(), author('Empty'), author('Manual'), author('Initials')]);
    await flush();
    assert.deepEqual(calls, ['Jane Doe', 'Empty']);
    assert.equal(store.getProfile('Jane Doe').provider, 'wikidata');
    assert.equal(store.getProfile('Manual').id, 'OL9A');
    assert.equal(store.hasOverride('Initials'), true);
    store.dispose();
});

test('새 출처를 직접 지정한 사진과 이니셜 선택은 재시작 후에도 우선 유지한다', async () => {
    const storage = memoryStorage();
    let calls = 0;
    const search = async () => { calls += 1; return { success: true, profiles: [] }; };
    let store = createAuthorProfileStore({ storage, search });
    assert.equal(store.setManual('한강', {
        provider: 'wikipedia', id: 'wikipedia:ko:123', entityId: 'Q1', name: '한강', authorVerified: false,
        photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg',
        imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Author.jpg', imageLicense: 'CC BY-SA', imageArtist: 'Author',
    }), true);
    assert.equal(store.setManual('Jane Doe', null), true);
    store.dispose();
    store = createAuthorProfileStore({ storage, search });
    store.setAuthors([author('한강'), author()]);
    await flush();
    assert.equal(calls, 0);
    assert.equal(store.getProfile('한강').imageLicense, 'CC BY-SA');
    assert.equal(store.getProfile('한강').authorVerified, false);
    assert.equal(store.getProfile('한강').imageSourceUrl, 'https://commons.wikimedia.org/wiki/File:Author.jpg');
    assert.equal(store.hasOverride('Jane Doe'), true);
    store.dispose();
});

test('일부 출처만 응답하면 사진은 표시하고 한 시간 후 전체 출처를 다시 조회한다', async () => {
    let clock = 100;
    let calls = 0;
    const storage = memoryStorage();
    const store = createAuthorProfileStore({ storage, now: () => clock, search: async () => {
        calls += 1;
        return { success: true, partial: calls === 1, profiles: [profile()] };
    } });
    store.setAuthors([author()]);
    await flush();
    assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY)['jane doe'].expiresAt, clock + HOUR_MS);
    clock += HOUR_MS;
    store.setAuthors([author()]);
    await flush();
    assert.equal(calls, 2);
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY)['jane doe'].expiresAt, clock + 7 * DAY_MS);
    store.dispose();
});

test('Naver에서 고른 사진과 기존 작가 소개는 다시 시작한 뒤에도 자동 결과보다 우선한다', async () => {
    const photoOverride = { id: 'ab'.repeat(32), sourceUrl: 'https://images.example.com/author.jpg', query: 'Jane Doe author' };
    const pending = deferred();
    const storage = memoryStorage();
    let store = createAuthorProfileStore({ storage, search: () => pending.promise });
    store.setAuthors([author()]);
    assert.equal(store.setManual('Jane Doe', profile('OL9A', 'Jane Doe', { description: 'Saved biography', photoOverride })), true);
    pending.resolve({ success: true, profiles: [profile()] });
    await flush();
    assert.equal(store.getProfile('Jane Doe').id, 'OL9A');
    assert.equal(store.getProfile('Jane Doe').photoUrl, `bookmanager-thumbnail://author-photo/${photoOverride.id}.png`);
    store.dispose();
    let calls = 0;
    store = createAuthorProfileStore({ storage, search: async () => { calls += 1; return { success: true, profiles: [profile()] }; } });
    store.setAuthors([author()]);
    await flush();
    assert.equal(calls, 0);
    assert.equal(store.hasOverride('Jane Doe'), true);
    assert.deepEqual(store.getProfile('Jane Doe').photoOverride, photoOverride);
    assert.equal(store.getProfile('Jane Doe').description, 'Saved biography');
    assert.equal(store.getProfile('Jane Doe').sourceUrl, 'https://openlibrary.org/authors/OL9A');
    store.dispose();
});

test('Naver 단독 사진은 수동으로만 사용하고 이니셜 또는 자동 검색으로 다시 전환한다', async () => {
    const id = 'cd'.repeat(32);
    const chosen = { provider: 'naver', id, name: 'Jane Doe', photoOverride: { id, sourceUrl: 'https://images.example.com/author.jpg', query: 'Jane Doe' } };
    const storage = memoryStorage();
    let calls = 0;
    let store = createAuthorProfileStore({ storage, search: async () => { calls += 1; return { success: true, profiles: [profile()] }; } });
    assert.equal(store.setManual('Jane Doe', chosen), true);
    store.dispose();
    store = createAuthorProfileStore({ storage, search: async () => { calls += 1; return { success: true, profiles: [profile()] }; } });
    store.setAuthors([author()]);
    await flush();
    assert.equal(calls, 0);
    assert.equal(store.getProfile('Jane Doe').provider, 'naver');
    assert.equal(store.setManual('Jane Doe', null), true);
    assert.equal(store.getProfile('Jane Doe'), null);
    assert.equal(store.hasOverride('Jane Doe'), true);
    assert.equal(store.useAutomatic('Jane Doe'), true);
    await flush();
    assert.equal(calls, 1);
    assert.equal(store.hasOverride('Jane Doe'), false);
    assert.equal(store.getProfile('Jane Doe').provider, 'openlibrary');
    assert.equal(store.getProfile('Jane Doe').photoOverride, undefined);
    assert.deepEqual(storage.read(AUTHOR_PROFILES_KEY), {});
    store.dispose();
});

test('검색 응답이나 자동 캐시에 수동 사진이 섞여 있어도 자동으로 지정하지 않는다', async () => {
    const id = 'ef'.repeat(32);
    const photoOverride = { id, sourceUrl: 'https://images.example.com/author.jpg', query: 'Jane Doe' };
    const naver = { provider: 'naver', id, name: 'Jane Doe', photoOverride };
    const overridden = profile('OL9A', 'Jane Doe', { photoOverride });
    for (const profiles of [[naver], [overridden], [naver, overridden], [naver, overridden, profile()]]) {
        const storage = memoryStorage({ [AUTOMATIC_AUTHOR_PROFILES_KEY]: {
            'jane doe': { profile: naver, checkedAt: 1, expiresAt: DAY_MS, version: AUTHOR_PROFILE_CACHE_VERSION },
            other: { profile: overridden, checkedAt: 1, expiresAt: DAY_MS, version: AUTHOR_PROFILE_CACHE_VERSION },
        } });
        const store = createAuthorProfileStore({ storage, now: () => 100, search: async () => ({ success: true, profiles }) });
        assert.equal(store.getProfile('Jane Doe'), null);
        assert.equal(store.getProfile('Other'), null);
        store.setAuthors([author()]);
        await flush();
        assert.equal(store.getProfile('Jane Doe')?.id || null, profiles.length === 3 ? 'OL1A' : null);
        assert.equal(store.getProfile('Jane Doe')?.photoOverride, undefined);
        store.dispose();
    }
});
