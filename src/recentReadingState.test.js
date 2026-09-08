import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recentReadingTimeText } from './recentReadingState.js';

const t = (key, values = []) => ({
    'folder.recent.just_now': '방금 전',
    'folder.recent.minutes_ago': `${values[0]}분 전`,
    'folder.recent.hours_ago': `${values[0]}시간 전`,
    'folder.recent.days_ago': `${values[0]}일 전`,
})[key] || key;

test('최근 읽은 시간은 경과 시간과 날짜 형식으로 표시한다', () => {
    const now = new Date('2026-08-23T12:00:00.000Z').getTime();
    assert.equal(recentReadingTimeText('2026-08-23T11:59:40.000Z', t, now), '방금 전');
    assert.equal(recentReadingTimeText('2026-08-23T11:45:00.000Z', t, now), '15분 전');
    assert.equal(recentReadingTimeText('2026-08-23T09:00:00.000Z', t, now), '3시간 전');
    assert.equal(recentReadingTimeText('2026-08-21T12:00:00.000Z', t, now), '2일 전');
    assert.match(recentReadingTimeText('2026-08-01T12:00:00.000Z', t, now, 'ko'), /2026/);
    assert.equal(recentReadingTimeText('', t, now), '');
});

const tick = () => new Promise(resolve => setImmediate(resolve));

function recentReadingFixture({ mutationSuccess = true, confirmation = 'yes' } = {}) {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const stateStart = source.indexOf('  const [recentReadingFiles,');
    const stateEnd = source.indexOf('  const isRecentReading', stateStart);
    const loaderStart = source.indexOf('  const loadRecentReading =');
    const loaderEnd = source.indexOf('  // 필터링된 파일 데이터', loaderStart);
    const mutationStart = source.indexOf('  const removeRecentReading =');
    const mutationEnd = source.indexOf('  useEffect', mutationStart);
    const loadingCondition = source.match(/\{(isRecentReading && recentReadingLoading[^?]+)\?\s*\(\s*<div className="recent-reading-state"/)?.[1];
    assert.ok(stateStart >= 0 && stateEnd > stateStart && loaderStart >= 0 && loaderEnd > loaderStart && loadingCondition);
    const slots = [];
    const requests = [];
    const listeners = new Set();
    const timers = new Map();
    const errors = [];
    let cursor = 0;
    let cleanup;
    let effect;
    let effectMounted = false;
    let timerId = 0;
    let writes = 0;
    const context = vm.createContext({
        RECENT_READING_LIMIT: 50,
        config: { language: 'ko' },
        clearSelection: () => {},
        t: key => key,
        console: { error: (...args) => errors.push(args) },
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = initial;
            return [slots[index], next => { writes += 1; slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
        },
        useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
        useCallback: callback => callback,
        useEffect(callback) { if (!effectMounted) effect = callback; },
        window: {
            electronAPI: {
                listRecentReading(limit) { assert.equal(limit, 50); return new Promise((resolve, reject) => requests.push({ resolve, reject })); },
                onRecentReadingChanged(callback) { listeners.add(callback); return () => listeners.delete(callback); },
                removeRecentReading: async () => ({ success: mutationSuccess }),
                clearRecentReading: async () => ({ success: mutationSuccess }),
                showMessage: async () => confirmation,
            },
            setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
            clearTimeout(id) { timers.delete(id); },
        },
    });
    vm.runInContext(`function render() { const isRecentReading = true; ${source.slice(stateStart, stateEnd)} ${source.slice(loaderStart, loaderEnd)} ${source.slice(mutationStart, mutationEnd)} return { files: recentReadingFiles, loading: recentReadingLoading, showLoading: Boolean(${loadingCondition}), refresh: loadRecentReading, remove: removeRecentReading, clear: clearRecentReading }; }`, context);
    const fixture = {
        requests,
        errors,
        render() { cursor = 0; return context.render(); },
        notify() {
            for (const callback of listeners) callback();
            const pending = [...timers.values()];
            timers.clear();
            for (const callback of pending) callback();
        },
        unmount() { cleanup?.(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0); },
        get writes() { return writes; },
    };
    fixture.render();
    effectMounted = true;
    cleanup = effect();
    return fixture;
}

test('최근 읽음은 첫 조회에만 로딩 화면을 표시하고 주기 갱신 중 기존 목록을 유지한다', async () => {
    const f = recentReadingFixture();
    assert.equal(f.render().showLoading, true);
    const files = [{ path: '/books/a.cbz', readingState: { pageIndex: 8 } }];
    f.requests[0].resolve(files); await tick();
    assert.equal(f.render().showLoading, false);
    f.notify();
    assert.equal(f.render().loading, true);
    assert.equal(f.render().files, files);
    assert.equal(f.render().showLoading, false, 'a refresh must keep the existing view stack mounted');
    const updated = [{ ...files[0], readingState: { pageIndex: 12 } }];
    f.requests[1].resolve(updated); await tick();
    assert.equal(f.render().files, updated);
    assert.equal(f.render().loading, false);
    f.unmount();
});

test('성공한 빈 목록도 주기 갱신 중 로딩 표시로 깜빡이지 않고 새 기록은 반영한다', async () => {
    const f = recentReadingFixture();
    f.requests[0].resolve([]); await tick();
    f.notify();
    assert.equal(f.render().showLoading, false);
    assert.equal(f.render().files.length, 0);
    const files = [{ path: '/books/new.txt' }];
    f.requests[1].resolve(files); await tick();
    assert.equal(f.render().files, files);
    f.unmount();
});

test('조회 실패는 표시 중인 최근 읽음을 지우지 않고 재시도 결과를 반영한다', async () => {
    const f = recentReadingFixture();
    f.requests[0].reject(new Error('initial offline')); await tick();
    assert.equal(f.render().loading, false);
    const retry = f.render().refresh();
    assert.equal(f.render().showLoading, true);
    const files = [{ path: '/books/a.txt' }];
    f.requests[1].resolve(files); await retry;
    f.notify();
    f.requests[2].reject(new Error('offline')); await tick();
    assert.equal(f.render().files, files);
    assert.equal(f.render().showLoading, false);
    assert.equal(f.render().loading, false);
    f.notify();
    f.requests[3].resolve([]); await tick();
    assert.equal(f.render().files.length, 0);
    assert.equal(f.errors.length, 2);
    f.unmount();
});

test('오래된 조회 완료나 실패가 최신 목록과 진행 중 표시를 되돌리지 않는다', async () => {
    const f = recentReadingFixture();
    const latest = f.render().refresh();
    f.requests[0].reject(new Error('stale failure')); await tick();
    assert.equal(f.render().loading, true);
    const files = [{ path: '/books/new.txt' }];
    f.requests[1].resolve(files); await latest;
    const older = f.render().refresh();
    const newer = f.render().refresh();
    f.requests[3].resolve([]); await newer;
    f.requests[2].resolve(files); await older;
    assert.equal(f.render().files.length, 0);
    assert.equal(f.render().loading, false);
    f.unmount();
});

test('패널 해제 뒤 늦게 도착한 조회 응답은 상태를 갱신하지 않는다', async () => {
    const f = recentReadingFixture();
    f.unmount();
    const writes = f.writes;
    f.requests[0].resolve([{ path: '/books/late.txt' }]); await tick();
    assert.equal(f.writes, writes);
});

test('갱신 중 최근 읽음에서 제거하거나 비운 기록을 이전 조회 응답이 복구하지 않는다', async () => {
    for (const action of ['remove', 'clear']) {
        const f = recentReadingFixture();
        const files = [{ path: '/books/a.txt' }];
        f.requests[0].resolve(files); await tick();
        f.notify();
        await f.render()[action]('/books/a.txt');
        assert.equal(f.render().files.length, 0, action);
        f.requests[1].resolve(files); await tick();
        assert.equal(f.render().files.length, 0, action);
        assert.equal(f.render().loading, false, action);
        f.notify();
        const updated = [{ path: '/books/new.txt' }];
        f.requests[2].resolve(updated); await tick();
        assert.equal(f.render().files, updated, action);
        f.unmount();
    }
});

test('기록 제거 실패나 전체 비우기 취소는 표시 목록과 진행 중 조회를 유지한다', async () => {
    for (const [action, options] of [['remove', { mutationSuccess: false }], ['clear', { mutationSuccess: false }], ['clear', { confirmation: 'no' }]]) {
        const f = recentReadingFixture(options);
        const files = [{ path: '/books/a.txt' }];
        f.requests[0].resolve(files); await tick();
        f.notify();
        await f.render()[action]('/books/a.txt');
        assert.equal(f.render().files, files);
        assert.equal(f.render().loading, true);
        const updated = [{ path: '/books/b.txt' }];
        f.requests[1].resolve(updated); await tick();
        assert.equal(f.render().files, updated);
        f.unmount();
    }
});
