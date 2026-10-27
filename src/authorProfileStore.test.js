import assert from 'node:assert/strict';
import test from 'node:test';
import { authorKey, normalizeAuthorProfile } from './authorCatalog.js';
import { AUTOMATIC_AUTHOR_PROFILES_KEY, AUTHOR_PROFILES_KEY, AUTHOR_PROFILE_CACHE_VERSION, createAuthorProfileStore } from './authorProfileStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const profile = (id = 'OL1A', name = 'Jane Doe', extra = {}) => ({ id, name, ...extra });
const author = (name = 'Jane Doe', books = []) => ({ key: authorKey(name), name, books });
const flush = () => new Promise(resolve => setImmediate(resolve));
const savedPhoto = value => {
    const normalized = normalizeAuthorProfile(value);
    return normalizeAuthorProfile({ ...normalized, storedPhoto: { id: 'ab'.repeat(32), sourceUrl: normalized.photoUrl } });
};
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

function scheduler() {
    let time = 100;
    let nextId = 0;
    const timers = new Map();
    const nextTimer = () => [...timers].sort((left, right) => left[1].at - right[1].at)[0];
    const runNext = async () => {
        const next = nextTimer();
        if (!next) return;
        const [id, timer] = next;
        timers.delete(id);
        time = timer.at;
        timer.callback();
        await flush();
    };
    return {
        now: () => time,
        setTimer(callback, delay) {
            const id = ++nextId;
            timers.set(id, { callback, at: time + delay });
            return id;
        },
        clearTimer: id => timers.delete(id),
        pending: () => timers.size,
        runNext,
        async advance(duration) {
            const until = time + duration;
            while (nextTimer()?.[1].at <= until) await runNext();
            time = until;
            await flush();
        },
    };
}

test('사진이 설정된 저자는 캐시 버전·만료·부분 실패와 무관하게 다시 검색하지 않는다', async () => {
    const clock = scheduler();
    const cached = {};
    for (const name of ['Legacy', 'Expired', 'Partial']) cached[authorKey(name)] = {
        profile: profile('OL1A', name), checkedAt: 1, expiresAt: 2,
        ...(name === 'Legacy' ? {} : { version: AUTHOR_PROFILE_CACHE_VERSION }),
        ...(name === 'Partial' ? { failed: true } : {}),
    };
    const store = createAuthorProfileStore({ storage: memoryStorage({ [AUTOMATIC_AUTHOR_PROFILES_KEY]: cached }), ...clock,
        search: () => assert.fail('A configured photo must never trigger automatic search') });
    const targets = Object.keys(cached).map(name => author(name));
    store.setBackgroundAuthors(targets);
    store.setAuthors(targets);
    await clock.advance(5000);
    assert.equal(clock.pending(), 0);
    await clock.advance(30 * DAY_MS);
    store.reload();
    store.setAuthors(targets);
    await clock.advance(0);
    assert.equal(clock.pending(), 0);
    for (const target of targets) assert.equal(store.getStatus(target.key), 'ready');
    store.dispose();
});

test('기존 자동·수동 사진은 검색 없이 한 장씩 전용 저장소로 이전하고 다시 이전하지 않는다', async () => {
    const clock = scheduler();
    const storage = memoryStorage({
        [AUTOMATIC_AUTHOR_PROFILES_KEY]: { automatic: { profile: profile('OL1A', 'Automatic'), checkedAt: 1, expiresAt: 2 } },
        [AUTHOR_PROFILES_KEY]: { manual: profile('OL2A', 'Manual'), initials: null },
    });
    const calls = [];
    const first = deferred();
    const persistPhoto = async value => {
        calls.push(value.name);
        if (calls.length === 1) await first.promise;
        return savedPhoto(value);
    };
    const create = () => createAuthorProfileStore({ storage, ...clock, persistPhoto,
        search: () => assert.fail('Migrating an existing photo must not search for a replacement') });
    let store = create();
    const targets = ['Automatic', 'Manual', 'Initials'].map(name => author(name));
    store.setBackgroundAuthors(targets);
    await clock.advance(5000);
    assert.deepEqual(calls, ['Automatic']);
    assert.equal(store.getStatus('Automatic'), 'ready');
    store.setAuthors(targets);
    await clock.advance(5000);
    assert.deepEqual(calls, ['Automatic']);
    first.resolve();
    await flush();
    assert.deepEqual(calls, ['Automatic', 'Manual']);
    assert.ok(store.getProfile('Automatic').storedPhoto);
    assert.ok(store.getProfile('Manual').storedPhoto);
    assert.equal(store.hasOverride('Manual'), true);
    assert.equal(store.getProfile('Initials'), null);
    store.dispose();
    store = create();
    store.setBackgroundAuthors(targets);
    store.setAuthors(targets);
    await clock.advance(30 * DAY_MS);
    assert.deepEqual(calls, ['Automatic', 'Manual']);
    assert.equal(clock.pending(), 0);
    store.dispose();
});

test('기존 사진의 저장 실패는 사진을 유지하고 다운로드만 한 시간 뒤 다시 시도한다', async () => {
    for (const manual of [false, true]) {
        const clock = scheduler();
        const storage = memoryStorage(manual
            ? { [AUTHOR_PROFILES_KEY]: { 'jane doe': profile() } }
            : { [AUTOMATIC_AUTHOR_PROFILES_KEY]: { 'jane doe': { profile: profile(), checkedAt: 1, expiresAt: 2 } } });
        let downloads = 0;
        const store = createAuthorProfileStore({ storage, ...clock,
            search: () => assert.fail('Existing configured photos may only retry their download'),
            persistPhoto: async value => {
                if (++downloads === 1) throw new Error('offline');
                return savedPhoto(value);
            },
        });
        store.setBackgroundAuthors([author()]);
        await clock.advance(5000);
        assert.equal(downloads, 1);
        assert.equal(store.getStatus('Jane Doe'), 'ready');
        assert.equal(store.getProfile('Jane Doe').photoUrl, normalizeAuthorProfile(profile()).photoUrl);
        store.reload();
        store.setAuthors([author()]);
        await clock.advance(HOUR_MS - 1);
        assert.equal(downloads, 1);
        await clock.advance(1);
        assert.equal(downloads, 2);
        assert.ok(store.getProfile('Jane Doe').storedPhoto);
        assert.equal(store.hasOverride('Jane Doe'), manual);
        await clock.advance(30 * DAY_MS);
        assert.equal(downloads, 2);
        store.dispose();
    }
});

test('새 자동 사진은 파일 저장에 성공해야 설정하며 실패 결과는 한 시간 뒤 다시 찾는다', async () => {
    const clock = scheduler();
    const storage = memoryStorage();
    let searches = 0;
    let downloads = 0;
    const store = createAuthorProfileStore({ storage, ...clock,
        search: async () => { searches += 1; return { success: true, profiles: [profile()] }; },
        persistPhoto: async value => {
            if (++downloads === 1) throw new Error('Photo is unavailable');
            return savedPhoto(value);
        },
    });
    store.setBackgroundAuthors([author()]);
    await clock.advance(5000);
    assert.equal(store.getProfile('Jane Doe').photoUrl, '');
    assert.equal(store.getStatus('Jane Doe'), 'error');
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY)['jane doe'].expiresAt, clock.now() + HOUR_MS);
    await clock.advance(HOUR_MS - 1);
    assert.equal(searches, 1);
    await clock.advance(1);
    assert.equal(searches, 2);
    assert.ok(store.getProfile('Jane Doe').storedPhoto);
    await clock.advance(30 * DAY_MS);
    assert.equal(searches, 2);
    assert.equal(downloads, 2);
    store.dispose();
});

test('직접 지정한 사진은 저장 완료 후 적용하고 실패하면 기존 사진을 유지한다', async () => {
    const previous = savedPhoto(profile('OL9A', 'Previous'));
    const storage = memoryStorage({ [AUTHOR_PROFILES_KEY]: { 'jane doe': previous } });
    const pending = deferred();
    let fail = false;
    const store = createAuthorProfileStore({ storage, persistPhoto: async value => {
        await pending.promise;
        if (fail) throw new Error('Disk is full');
        return savedPhoto(value);
    } });
    const saving = store.saveManual('Jane Doe', profile('OL1A', 'Chosen'));
    assert.equal(store.getProfile('Jane Doe').id, previous.id);
    pending.resolve();
    assert.equal(await saving, true);
    assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
    assert.ok(store.getProfile('Jane Doe').storedPhoto);
    fail = true;
    assert.equal(await store.saveManual('Jane Doe', profile('OL2A', 'Failed')), false);
    assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
    store.dispose();
});

test('수동 사진 저장도 자동 작업과 직렬 처리하고 새 선택·해제·다른 창 변경을 덮지 않는다', async () => {
    for (const change of ['initials', 'automatic', 'new-selection', 'reload', 'dispose']) {
        const clock = scheduler();
        const storage = memoryStorage();
        const first = deferred();
        const downloads = [];
        let searches = 0;
        const store = createAuthorProfileStore({ storage, ...clock,
            search: async () => { searches += 1; return { success: true, profiles: [] }; },
            persistPhoto: async value => {
                downloads.push(value.id);
                if (downloads.length === 1) await first.promise;
                return savedPhoto(value);
            },
        });
        const saving = store.saveManual('Jane Doe', profile('OL1A'));
        store.setAuthors([author('Background')]);
        assert.equal(searches, 0, 'Automatic search must wait for the active manual save');
        let replacement;
        if (change === 'initials') store.setManual('Jane Doe', null);
        else if (change === 'automatic') store.useAutomatic('Jane Doe');
        else if (change === 'new-selection') replacement = store.saveManual('Jane Doe', profile('OL2A'));
        else if (change === 'reload') {
            storage.setItem(AUTHOR_PROFILES_KEY, JSON.stringify({ 'jane doe': null }));
            store.reload();
        } else store.dispose();
        first.resolve();
        assert.equal(await saving, false);
        if (replacement) assert.equal(await replacement, true);
        await flush();
        assert.equal(store.getProfile('Jane Doe')?.id || null, change === 'new-selection' ? 'OL2A' : null);
        assert.equal(searches, change === 'dispose' ? 0 : 1);
        assert.deepEqual(downloads, change === 'new-selection' ? ['OL1A', 'OL2A'] : ['OL1A']);
        store.dispose();
    }
});

test('백그라운드 대상은 5초 후 한 명씩 찾고 화면 대상과 하나의 요청만 공유한다', async () => {
    const clock = scheduler();
    const pending = new Map();
    const calls = [];
    let active = 0;
    let maximumActive = 0;
    const store = createAuthorProfileStore({ storage: memoryStorage(), ...clock, search: async name => {
        calls.push(name);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const request = deferred();
        pending.set(name, request);
        try {
            return await request.promise;
        } finally {
            active -= 1;
        }
    } });
    store.setBackgroundAuthors([author('Background'), author('Shared'), author('Last')]);
    assert.equal(store.getStatus('Background'), 'idle');
    assert.equal(store.getSnapshot(), 0);
    assert.equal(clock.pending(), 1);
    await clock.advance(4999);
    assert.deepEqual(calls, []);
    await clock.advance(1);
    assert.deepEqual(calls, ['Background']);
    assert.equal(store.getStatus('Background'), 'loading');
    store.setAuthors([author('Background'), author('Shared')]);
    assert.equal(store.getStatus('Shared'), 'queued');
    await clock.advance(10000);
    assert.deepEqual(calls, ['Background']);
    pending.get('Background').resolve({ success: true, profiles: [] });
    await flush();
    assert.deepEqual(calls, ['Background', 'Shared']);
    pending.get('Shared').resolve({ success: true, profiles: [] });
    await flush();
    store.setAuthors([]);
    await clock.advance(4999);
    assert.deepEqual(calls, ['Background', 'Shared']);
    await clock.advance(1);
    assert.deepEqual(calls, ['Background', 'Shared', 'Last']);
    assert.equal(maximumActive, 1);
    pending.get('Last').resolve({ success: true, profiles: [] });
    await flush();
    await clock.advance(5000);
    assert.equal(clock.pending(), 1, 'Only the next cache expiration remains scheduled');
    store.dispose();
    assert.equal(clock.pending(), 0);
});

test('화면 대상은 백그라운드 대기 타이머보다 먼저 시작하고 조회 결과를 재사용한다', async () => {
    const clock = scheduler();
    const calls = [];
    const store = createAuthorProfileStore({ storage: memoryStorage(), ...clock, search: async name => {
        calls.push(name);
        return { success: true, profiles: [profile('OL1A', name)] };
    } });
    store.setBackgroundAuthors([author('Visible'), author('Background')]);
    await clock.advance(2000);
    store.setAuthors([author('Visible')]);
    assert.deepEqual(calls, ['Visible']);
    await flush();
    assert.equal(clock.pending(), 1);
    store.setAuthors([]);
    await clock.advance(4999);
    assert.deepEqual(calls, ['Visible']);
    await clock.advance(1);
    assert.deepEqual(calls, ['Visible', 'Background']);
    store.setAuthors([author('Background')]);
    await flush();
    assert.deepEqual(calls, ['Visible', 'Background']);
    assert.equal(store.getStatus('Background'), 'ready');
    store.dispose();
    assert.equal(clock.pending(), 0);
});

test('카탈로그와 캐시를 자주 갱신해도 백그라운드 조회 예정 시간을 늦추지 않는다', async () => {
    for (const refresh of ['catalog', 'cache']) {
        const clock = scheduler();
        const calls = [];
        const store = createAuthorProfileStore({ storage: memoryStorage(), ...clock, search: async name => {
            calls.push({ name, at: clock.now() });
            return { success: true, profiles: [] };
        } });
        const targets = [author('First'), author('Second')];
        store.setBackgroundAuthors(targets);
        for (let second = 1; second <= 10; second += 1) {
            await clock.advance(1000);
            if (refresh === 'catalog') store.setBackgroundAuthors(targets.map(value => ({ ...value })));
            else store.reload();
        }
        assert.deepEqual(calls, [{ name: 'First', at: 5100 }, { name: 'Second', at: 10100 }], refresh);
        store.dispose();
        assert.equal(clock.pending(), 0);
    }
});

test('백그라운드 실패·부분 실패 후 1분간 쉬며 화면 조회가 대기 시간을 줄이지 않는다', async () => {
    for (const result of [{ success: false, profiles: [] }, { success: true, partial: true, profiles: [] }, new Error('offline')]) {
        const clock = scheduler();
        const storage = memoryStorage();
        const calls = [];
        const store = createAuthorProfileStore({ storage, ...clock, search: async name => {
            calls.push(name);
            if (name !== 'Failed') return { success: true, profiles: [] };
            if (result instanceof Error) throw result;
            return result;
        } });
        store.setBackgroundAuthors([author('Failed'), author('Later')]);
        await clock.advance(5000);
        assert.deepEqual(calls, ['Failed']);
        assert.equal(store.getStatus('Failed'), 'error');
        assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY).failed.expiresAt, clock.now() + HOUR_MS);
        await clock.advance(1000);
        store.setAuthors([author('Visible')]);
        await flush();
        assert.deepEqual(calls, ['Failed', 'Visible']);
        store.reload();
        store.setBackgroundAuthors([author('Failed'), author('Later')]);
        await clock.advance(58999);
        assert.deepEqual(calls, ['Failed', 'Visible']);
        await clock.advance(1);
        assert.deepEqual(calls, ['Failed', 'Visible', 'Later']);
        store.dispose();
    }
});

test('백그라운드 대상 교체·삭제·해제는 오래된 대기와 타이머를 정리한다', async () => {
    const clock = scheduler();
    const pending = deferred();
    const storage = memoryStorage();
    const calls = [];
    const store = createAuthorProfileStore({ storage, ...clock, search: name => {
        calls.push(name);
        return pending.promise;
    } });
    store.setBackgroundAuthors([author('Removed')]);
    await clock.advance(3000);
    store.setBackgroundAuthors([author('Replacement'), author('Never')]);
    assert.equal(clock.pending(), 1);
    await clock.advance(1999);
    assert.deepEqual(calls, []);
    await clock.advance(1);
    assert.deepEqual(calls, ['Replacement']);
    store.setBackgroundAuthors([]);
    assert.equal(clock.pending(), 0);
    pending.resolve({ success: true, profiles: [] });
    await flush();
    await clock.advance(10000);
    assert.deepEqual(calls, ['Replacement']);
    store.setBackgroundAuthors([author('AfterDispose')]);
    assert.equal(clock.pending(), 1);
    store.dispose();
    assert.equal(clock.pending(), 0);
    store.setBackgroundAuthors([author('Ignored')]);
    await clock.advance(10000);
    assert.deepEqual(calls, ['Replacement']);
});

test('백그라운드 조회도 수동 설정·사진 없는 캐시·만료 시간을 유지한다', async () => {
    const clock = scheduler();
    const storage = memoryStorage({
        [AUTHOR_PROFILES_KEY]: { manual: profile('OL9A', 'Manual'), initials: null },
        [AUTOMATIC_AUTHOR_PROFILES_KEY]: {
            empty: { profile: null, checkedAt: 1, expiresAt: DAY_MS, version: AUTHOR_PROFILE_CACHE_VERSION },
            failed: { profile: null, checkedAt: 1, expiresAt: 6000, failed: true, version: AUTHOR_PROFILE_CACHE_VERSION },
        },
    });
    const calls = [];
    const store = createAuthorProfileStore({ storage, ...clock, search: async name => {
        calls.push(name);
        return { success: true, profiles: [] };
    } });
    const targets = ['Manual', 'Initials', 'Empty', 'Failed'].map(name => author(name));
    store.setBackgroundAuthors(targets);
    await clock.advance(5000);
    assert.deepEqual(calls, []);
    assert.equal(clock.pending(), 1);
    assert.equal(store.getProfile('Manual').id, 'OL9A');
    assert.equal(store.getStatus('Initials'), 'initials');
    assert.equal(store.getStatus('Empty'), 'empty');
    assert.equal(store.getStatus('Failed'), 'error');
    await clock.advance(899);
    assert.deepEqual(calls, []);
    await clock.advance(1);
    assert.deepEqual(calls, ['Failed']);
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY).failed.expiresAt, clock.now() + 7 * DAY_MS);
    assert.equal(store.useAutomatic('Manual'), true);
    await clock.advance(5000);
    assert.deepEqual(calls, ['Failed', 'Manual']);
    store.dispose();
});

test('사진 없는 백그라운드 캐시가 만료되면 화면 진입 없이 한 타이머로 다시 조회한다', async () => {
    const cases = [
        { result: { success: false, profiles: [] }, ttl: HOUR_MS },
        { result: { success: true, partial: true, profiles: [] }, ttl: HOUR_MS },
        { result: { success: true, profiles: [] }, ttl: 7 * DAY_MS },
    ];
    for (const { result, ttl } of cases) {
        const clock = scheduler();
        const calls = [];
        const store = createAuthorProfileStore({ storage: memoryStorage(), ...clock, search: async name => {
            calls.push({ name, at: clock.now() });
            return result;
        } });
        store.setBackgroundAuthors([author()]);
        await clock.advance(5000);
        assert.deepEqual(calls, [{ name: 'Jane Doe', at: 5100 }]);
        await clock.advance(ttl - 1);
        assert.equal(calls.length, 1);
        assert.equal(clock.pending(), 1);
        await clock.advance(1);
        assert.deepEqual(calls, [{ name: 'Jane Doe', at: 5100 }, { name: 'Jane Doe', at: 5100 + ttl }]);
        store.dispose();
        assert.equal(clock.pending(), 0);
    }
});

test('수동 설정·대상 제거·해제 뒤에는 캐시 만료가 자동 조회를 다시 시작하지 않는다', async () => {
    for (const stop of ['manual', 'remove', 'dispose']) {
        const clock = scheduler();
        const storage = memoryStorage({ [AUTOMATIC_AUTHOR_PROFILES_KEY]: {
            'jane doe': { profile: null, checkedAt: 1, expiresAt: 6000, failed: true, version: AUTHOR_PROFILE_CACHE_VERSION },
        } });
        let calls = 0;
        const store = createAuthorProfileStore({ storage, ...clock, search: async () => {
            calls += 1;
            return { success: true, profiles: [] };
        } });
        store.setBackgroundAuthors([author()]);
        await clock.advance(5000);
        assert.equal(clock.pending(), 1);
        if (stop === 'manual') store.setManual('Jane Doe', null);
        else if (stop === 'remove') store.setBackgroundAuthors([]);
        else store.dispose();
        await clock.advance(0);
        assert.equal(clock.pending(), 0, stop);
        await clock.advance(DAY_MS);
        assert.equal(calls, 0, stop);
        store.dispose();
    }
});

test('큰 백그라운드 목록의 캐시 확인은 100명씩 나누고 이어서 진행한다', async () => {
    const clock = scheduler();
    const cached = {};
    const targets = [];
    for (let index = 0; index < 250; index += 1) {
        const name = `Cached ${index}`;
        targets.push(author(name));
        cached[authorKey(name)] = { profile: null, checkedAt: 1, expiresAt: DAY_MS, version: AUTHOR_PROFILE_CACHE_VERSION };
    }
    const calls = [];
    const store = createAuthorProfileStore({ storage: memoryStorage({ [AUTOMATIC_AUTHOR_PROFILES_KEY]: cached }), ...clock, search: async name => {
        calls.push(name);
        return { success: true, profiles: [] };
    } });
    store.setBackgroundAuthors([...targets, author('New First'), author('New Last')]);
    await clock.runNext();
    assert.deepEqual(calls, []);
    assert.equal(clock.pending(), 1);
    await clock.runNext();
    assert.deepEqual(calls, []);
    assert.equal(clock.pending(), 1);
    await clock.runNext();
    assert.deepEqual(calls, ['New First']);
    await clock.runNext();
    assert.deepEqual(calls, ['New First', 'New Last']);
    await clock.runNext();
    assert.equal(clock.pending(), 1);
    store.dispose();
    assert.equal(clock.pending(), 0);
});

test('구독자는 같은 리비전의 스냅샷을 공유하고 구독 해제와 store 해제를 따른다', async () => {
    const pending = deferred();
    const storage = memoryStorage();
    const store = createAuthorProfileStore({ storage, search: () => pending.promise });
    const first = [];
    const second = [];
    const unsubscribe = store.subscribe(() => first.push(store.getSnapshot()));
    store.subscribe(() => second.push(store.getSnapshot()));
    assert.equal(store.getSnapshot(), 0);
    store.setAuthors([author()]);
    assert.deepEqual(first, [1, 2]);
    assert.deepEqual(second, [1, 2]);
    assert.equal(store.getSnapshot(), 2);
    unsubscribe();
    assert.equal(store.setManual('Jane Doe', null), true);
    assert.deepEqual(first, [1, 2]);
    assert.deepEqual(second, [1, 2, 3]);
    store.dispose();
    pending.resolve({ success: true, profiles: [profile()] });
    await flush();
    assert.equal(store.getSnapshot(), 3);
    assert.deepEqual(second, [1, 2, 3]);
    assert.deepEqual(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY), {});
});

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

test('조회 대기·진행·완료 상태를 알리고 같은 조회 대상에는 중복 알림을 보내지 않는다', async () => {
    const first = deferred();
    const second = deferred();
    const calls = [];
    const states = [];
    const store = createAuthorProfileStore({
        storage: memoryStorage(),
        search: name => {
            calls.push(name);
            return calls.length === 1 ? first.promise : second.promise;
        },
        onChange: () => states.push([store.getStatus('First'), store.getStatus('Second')]),
    });
    assert.equal(store.getStatus('First'), 'idle');
    store.setAuthors([author('First'), author('Second')]);
    assert.deepEqual(states, [['queued', 'queued'], ['loading', 'queued']]);
    const changes = states.length;
    store.setAuthors([author('First'), author('Second'), author('Second')]);
    assert.equal(states.length, changes);
    first.resolve({ success: true, profiles: [] });
    await flush();
    assert.equal(store.getStatus('First'), 'empty');
    assert.equal(store.getStatus(' Second '), 'loading');
    assert.deepEqual(states.slice(-2), [['empty', 'queued'], ['empty', 'loading']]);
    second.resolve({ success: true, profiles: [profile('OL2A', 'Second')] });
    await flush();
    assert.equal(store.getStatus('Second'), 'ready');
    assert.deepEqual(states.at(-1), ['empty', 'ready']);
    store.dispose();
});

test('조회 대상을 비우면 대기 상태만 해제하고 실제 요청은 완료될 때까지 진행 중으로 유지한다', async () => {
    const pending = deferred();
    const calls = [];
    let changes = 0;
    const store = createAuthorProfileStore({ storage: memoryStorage(), search: name => {
        calls.push(name);
        return pending.promise;
    }, onChange: () => { changes += 1; } });
    store.setAuthors([author('First'), author('Second')]);
    const beforeClear = changes;
    store.setAuthors([]);
    assert.equal(changes, beforeClear + 1);
    assert.equal(store.getStatus('First'), 'loading');
    assert.equal(store.getStatus('Second'), 'idle');
    store.setAuthors([]);
    assert.equal(changes, beforeClear + 1);
    pending.resolve({ success: true, profiles: [profile('OL1A', 'First')] });
    await flush();
    assert.equal(store.getStatus('First'), 'ready');
    assert.deepEqual(calls, ['First']);
    store.dispose();
});

test('조회 중 수동 선택과 이니셜 선택은 늦은 자동 결과보다 우선한다', async () => {
    for (const manualProfile of [profile('OL9A', 'Chosen'), null]) {
        const pending = deferred();
        const storage = memoryStorage();
        const store = createAuthorProfileStore({ storage, search: () => pending.promise });
        store.setAuthors([author()]);
        assert.equal(store.getStatus('Jane Doe'), 'loading');
        assert.equal(store.setManual('Jane Doe', manualProfile), true);
        assert.equal(store.getStatus('Jane Doe'), manualProfile ? 'ready' : 'initials');
        pending.resolve({ success: true, profiles: [profile()] });
        await flush();
        assert.equal(store.hasOverride('Jane Doe'), true);
        assert.equal(store.getProfile('Jane Doe')?.id || null, manualProfile?.id || null);
        assert.equal(store.getStatus('Jane Doe'), manualProfile ? 'ready' : 'initials');
        assert.equal(storage.read(AUTHOR_PROFILES_KEY)['jane doe']?.id || null, manualProfile?.id || null);
        assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY)['jane doe'], undefined);
        store.dispose();
    }
});

test('빈 결과와 실패·부분 실패를 구분하고 재시작 후에도 같은 상태를 유지한다', async () => {
    const responses = {
        Found: { success: true, profiles: [profile('OL1A', 'Found')] },
        Empty: { success: true, profiles: [] },
        NoPhoto: { success: true, profiles: [{ provider: 'wikidata', id: 'Q1', name: 'NoPhoto' }] },
        Failed: { success: false, profiles: [] },
        Partial: { success: true, partial: true, profiles: [] },
        PartialPhoto: { success: true, partial: true, profiles: [profile('OL2A', 'PartialPhoto')] },
        Malformed: { success: true, profiles: null },
    };
    const expected = { Found: 'ready', Empty: 'empty', NoPhoto: 'empty', Failed: 'error', Partial: 'error', PartialPhoto: 'ready', Malformed: 'error', Throws: 'error' };
    const storage = memoryStorage();
    let calls = 0;
    const search = async name => {
        calls += 1;
        if (name === 'Throws') throw new Error('offline');
        return responses[name];
    };
    let store = createAuthorProfileStore({ storage, now: () => 100, search });
    store.setAuthors(Object.keys(expected).map(name => author(name)));
    await flush();
    for (const [name, status] of Object.entries(expected)) assert.equal(store.getStatus(name), status, name);
    const cached = storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY);
    for (const name of ['failed', 'partial', 'partialphoto', 'malformed', 'throws']) assert.equal(cached[name].failed, true, name);
    assert.equal(cached.empty.failed, undefined);
    store.dispose();
    store = createAuthorProfileStore({ storage, now: () => 100, search });
    store.setAuthors(Object.keys(expected).map(name => author(name)));
    await flush();
    for (const [name, status] of Object.entries(expected)) assert.equal(store.getStatus(name), status, name);
    assert.equal(calls, Object.keys(expected).length);
    store.dispose();
});

test('실패 정보가 없는 기존 캐시는 호환하며 사진 없는 수동 프로필은 이니셜 선택과 구분한다', () => {
    const storage = memoryStorage({
        [AUTOMATIC_AUTHOR_PROFILES_KEY]: {
            found: { profile: profile('OL1A', 'Found'), checkedAt: 1, expiresAt: DAY_MS, version: AUTHOR_PROFILE_CACHE_VERSION },
            empty: { profile: null, checkedAt: 1, expiresAt: DAY_MS, version: AUTHOR_PROFILE_CACHE_VERSION },
        },
        [AUTHOR_PROFILES_KEY]: {
            'no photo': { provider: 'wikidata', id: 'Q1', name: 'No Photo' },
            initials: null,
        },
    });
    const store = createAuthorProfileStore({ storage, now: () => 100, search: () => assert.fail('fresh cached profiles must not be searched') });
    store.setAuthors([author('Found'), author('Empty'), author('No Photo'), author('Initials')]);
    assert.equal(store.getStatus('Found'), 'ready');
    assert.equal(store.getStatus('Empty'), 'empty');
    assert.equal(store.getStatus('No Photo'), 'empty');
    assert.equal(store.getStatus('Initials'), 'initials');
    store.dispose();
});

test('사진 있는 성공 결과는 유지하고 빈 결과는 7일·오류는 1시간 후 다시 조회한다', async () => {
    let clock = 100;
    const counts = new Map();
    const storage = memoryStorage();
    const targets = [author('Found'), author('Empty'), author('Failed'), author('Throws'), author('Malformed')];
    const search = async name => {
        counts.set(name, (counts.get(name) || 0) + 1);
        if (name === 'Throws') throw new Error('offline');
        if (name === 'Failed') return { success: false, profiles: [] };
        if (name === 'Malformed') return { success: true, profiles: null };
        return { success: true, profiles: name === 'Found' ? [profile('OL1A', name)] : [] };
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
    assert.deepEqual([...counts.values()], [1, 2, 3, 3, 3]);
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
    const beforeReload = changes;
    storage.setItem(AUTHOR_PROFILES_KEY, JSON.stringify({ 'jane doe': null }));
    store.reload();
    assert.equal(changes, beforeReload + 1);
    assert.equal(store.getStatus('Jane Doe'), 'initials');
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
    const beforeDispose = changes;
    store.dispose();
    pending.resolve({ success: true, profiles: [profile()] });
    await flush();
    store.setAuthors([author('Third')]);
    store.reload();
    assert.equal(store.setManual('First', profile()), false);
    assert.equal(store.useAutomatic('First'), false);
    assert.deepEqual(calls, ['First']);
    assert.equal(changes, beforeDispose);
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

test('이전 자동 캐시도 사진이 있으면 다시 찾지 않고 사진 없는 저자만 갱신한다', async () => {
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
        return { success: true, profiles: [] };
    };
    let store = createAuthorProfileStore({ storage, now: () => 100, search });
    store.setAuthors([author(), author('Empty'), author('Manual'), author('Initials')]);
    assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
    assert.equal(store.getProfile('Manual').id, 'OL9A');
    assert.equal(store.getProfile('Initials'), null);
    assert.deepEqual(calls, ['Empty']);
    await flush();
    assert.deepEqual(calls, ['Empty']);
    assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
    assert.equal(storage.read(AUTOMATIC_AUTHOR_PROFILES_KEY).empty.version, AUTHOR_PROFILE_CACHE_VERSION);
    store.dispose();
    store = createAuthorProfileStore({ storage, now: () => 101, search });
    store.setAuthors([author(), author('Empty'), author('Manual'), author('Initials')]);
    await flush();
    assert.deepEqual(calls, ['Empty']);
    assert.equal(store.getProfile('Jane Doe').provider, 'openlibrary');
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

test('일부 출처만 응답해도 사진이 있으면 만료 후 전체 출처를 다시 조회하지 않는다', async () => {
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
    clock += 30 * DAY_MS;
    store.setAuthors([author()]);
    await flush();
    assert.equal(calls, 1);
    assert.equal(store.getProfile('Jane Doe').id, 'OL1A');
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
