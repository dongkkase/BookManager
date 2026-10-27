import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const compiled = transformSync(fs.readFileSync(new URL('./hooks/useDashboardActivity.js', import.meta.url), 'utf8'), { format: 'cjs', target: 'es2022' }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (month = '2026-10', marker = 'initial') => ({
    success: true, month, marker, days: [], totals: { seconds: 600, readingDays: 1, completedBooks: 1 },
    goal: { books: 2, minutes: 120 }, completedFiles: [], completedCount: 0,
});

function fixture(initialMonth = '2026-10', initialScope = '/books') {
    const slots = [];
    const requests = [];
    const timers = new Map();
    const recentListeners = new Set();
    const listListeners = new Set();
    let cursor = 0;
    let nextTimer = 0;
    let effects = [];
    let result;
    let month = initialMonth;
    let scope = initialScope;
    let updates = 0;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        useState(initialValue) {
            const index = cursor++;
            slots[index] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue };
            return [slots[index].value, update => {
                updates += 1;
                slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;
            }];
        },
        useRef(initialValue) { return slots[cursor++] ??= { current: initialValue }; },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: callback, dependencies };
            return slots[index].value;
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
                const previous = slots[index];
                const current = { dependencies };
                slots[index] = current;
                effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
            }
        },
    };
    const eventTarget = () => {
        const listeners = new Map();
        return {
            listeners,
            addEventListener: (type, listener) => {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(listener);
            },
            removeEventListener: (type, listener) => {
                listeners.get(type)?.delete(listener);
                if (!listeners.get(type)?.size) listeners.delete(type);
            },
            emit: type => { for (const listener of listeners.get(type) || []) listener(); },
        };
    };
    const window = {
        ...eventTarget(),
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        electronAPI: {
            readingLists: request => new Promise((resolve, reject) => requests.push({ ...request, resolve, reject })),
            onRecentReadingChanged: listener => { recentListeners.add(listener); return () => recentListeners.delete(listener); },
            onReadingListsChanged: listener => { listListeners.add(listener); return () => listListeners.delete(listener); },
        },
    };
    const document = { ...eventTarget(), visibilityState: 'visible' };
    const module = { exports: {} };
    vm.runInNewContext(compiled, {
        module, exports: module.exports, window, document,
        require: name => { assert.equal(name, 'react'); return react; },
    });
    const flushEffects = () => effects.splice(0).forEach(effect => effect());
    const render = (nextMonth = month, nextScope = scope, flush = true) => {
        month = nextMonth;
        scope = nextScope;
        cursor = 0;
        result = module.exports.useDashboardActivity(month, scope);
        if (flush) flushEffects();
        return result;
    };
    render();
    return {
        requests, timers, window, document, recentListeners, listListeners, render, flushEffects,
        result: () => result,
        updates: () => updates,
        runTimers: () => {
            const ready = [...timers.values()];
            timers.clear();
            ready.forEach(timer => timer.callback());
        },
        close: () => { for (const slot of slots) slot.cleanup?.(); },
    };
}

test('독서 기록 재조회는 기존 데이터를 유지하며 오류와 재시도에서 복구한다', async () => {
    const f = fixture();
    const initial = response();
    assert.equal(f.result().data, null);
    assert.equal(f.result().loading, true);
    assert.equal(f.requests[0].operation, 'dashboard');
    assert.equal(f.requests[0].month, '2026-10');
    f.requests[0].resolve(initial);
    await tick();
    assert.equal(f.render().data, initial);
    assert.equal(f.result().loading, false);
    const refresh = f.result().refresh();
    assert.equal(f.render().data, initial);
    assert.equal(f.result().loading, true);
    f.requests[1].reject(new Error('offline'));
    await refresh;
    assert.equal(f.render().data, initial);
    assert.equal(f.result().error, true);
    assert.equal(f.result().loading, false);
    const retry = f.result().refresh();
    assert.equal(f.render().data, initial);
    assert.equal(f.result().error, false);
    const updated = response('2026-10', 'updated');
    f.requests[2].resolve(updated);
    await retry;
    assert.equal(f.render().data, updated);
    assert.equal(f.result().loading, false);
    assert.equal(f.result().error, false);
    f.close();
});

test('이전 달의 늦은 응답과 같은 달의 오래된 재조회 응답은 최신 기록을 덮어쓰지 않는다', async () => {
    const f = fixture();
    f.render('2026-09');
    assert.equal(f.result().data, null);
    const previous = response('2026-09', 'selected previous month');
    f.requests[1].resolve(previous);
    await tick();
    assert.equal(f.render().data, previous);
    f.requests[0].resolve(response('2026-10', 'late October'));
    await tick();
    assert.equal(f.render().data, previous);
    const older = f.result().refresh();
    const newest = f.result().refresh();
    const latest = response('2026-09', 'latest September');
    f.requests[3].resolve(latest);
    await newest;
    f.requests[2].resolve(response('2026-09', 'stale September'));
    await older;
    assert.equal(f.render().data, latest);
    assert.equal(f.result().error, false);
    f.close();
});

test('월과 라이브러리 범위 변경 직후 효과 정리 전에 도착한 응답도 무시한다', async () => {
    for (const [month, scope] of [['2026-09', '/books'], ['2026-10', '/new-library']]) {
        const f = fixture();
        f.render(month, scope, false);
        const before = f.updates();
        f.requests[0].resolve(response('2026-10', 'old scope'));
        await tick();
        assert.equal(f.updates(), before, 'Old requests must not update state between render and effect cleanup');
        assert.equal(f.result().data, null);
        f.flushEffects();
        const current = response(month, scope);
        f.requests[1].resolve(current);
        await tick();
        assert.equal(f.render().data, current);
        assert.equal(f.recentListeners.size, 1);
        assert.equal(f.listListeners.size, 1);
        f.close();
    }
});

test('목표 저장 중 월이나 범위가 바뀌면 이전 저장의 재조회가 현재 요청을 무효화하지 않는다', async () => {
    for (const [month, scope] of [['2026-09', '/books'], ['2026-10', '/new-library']]) {
        const f = fixture();
        f.requests[0].resolve(response());
        await tick();
        f.render();
        const saving = f.result().saveGoal({ books: 5, minutes: 300 });
        assert.equal(f.requests[1].operation, 'dashboard-goal');
        assert.equal(f.requests[1].month, '2026-10');
        f.render(month, scope);
        const currentRequest = f.requests[2];
        f.requests[1].resolve({ success: true });
        await saving;
        assert.equal(f.requests.length, 3, 'Old goal save must not start a refresh for the previous key');
        const current = response(month, scope);
        currentRequest.resolve(current);
        await tick();
        assert.equal(f.render().data, current);
        assert.equal(f.result().loading, false);
        assert.equal(f.result().error, false);
        f.close();
    }
});

test('월별 목표 저장 실패는 기존 화면을 보존하고 성공하면 같은 월을 다시 조회한다', async () => {
    const f = fixture('2026-09');
    const initial = response('2026-09');
    f.requests[0].resolve(initial);
    await tick();
    f.render();
    const failed = f.result().saveGoal({ books: 4, minutes: 240 });
    const rejection = assert.rejects(failed, /goal_save_failed/);
    f.requests[1].resolve({ success: false, error: 'disk full' });
    await rejection;
    assert.equal(f.requests.length, 2);
    assert.equal(f.render().data, initial);
    assert.equal(f.result().error, false);
    const saved = f.result().saveGoal({ books: 4, minutes: 240 });
    assert.equal(f.requests[2].month, '2026-09');
    assert.equal(f.requests[2].goal.books, 4);
    assert.equal(f.requests[2].goal.minutes, 240);
    f.requests[2].resolve({ success: true, goal: { books: 4, minutes: 240 } });
    await tick();
    assert.equal(f.requests[3].operation, 'dashboard');
    assert.equal(f.requests[3].month, '2026-09');
    assert.equal(f.render().data, initial);
    const updated = { ...initial, goal: { books: 4, minutes: 240 } };
    f.requests[3].resolve(updated);
    await saved;
    assert.equal(f.render().data, updated);
    assert.equal(f.result().loading, false);
    f.close();
});

test('목표 저장의 전송 오류는 호출자에게 전달하고 데이터 조회 오류와 구분한다', async () => {
    const f = fixture();
    f.requests[0].resolve(response());
    await tick();
    const initial = f.render().data;
    const failed = f.result().saveGoal({ books: 1, minutes: 60 });
    const rejection = assert.rejects(failed, /transport unavailable/);
    f.requests[1].reject(new Error('transport unavailable'));
    await rejection;
    assert.equal(f.render().data, initial);
    assert.equal(f.result().error, false);
    assert.equal(f.requests.length, 2);
    f.close();
});

test('집계 실패 응답과 잘못된 응답은 빈 오류 상태로 표시하고 다시 조회할 수 있다', async () => {
    for (const failure of [undefined, { success: false }, { success: true, days: null }]) {
        const f = fixture();
        f.requests[0].resolve(failure);
        await tick();
        assert.equal(f.render().data, null);
        assert.equal(f.result().loading, false);
        assert.equal(f.result().error, true);
        const retry = f.result().refresh();
        const current = response();
        f.requests[1].resolve(current);
        await retry;
        assert.equal(f.render().data, current);
        assert.equal(f.result().error, false);
        f.close();
    }
});

test('독서·목표 변경과 창 복귀는 재조회를 합치고 숨겨진 문서는 조회하지 않는다', async () => {
    const f = fixture();
    f.requests[0].resolve(response());
    await tick();
    f.render();
    f.document.visibilityState = 'hidden';
    f.document.emit('visibilitychange');
    assert.equal(f.timers.size, 0);
    for (const listener of f.recentListeners) listener();
    for (const listener of f.listListeners) listener();
    f.window.emit('focus');
    f.document.visibilityState = 'visible';
    f.document.emit('visibilitychange');
    assert.equal(f.timers.size, 1);
    assert.equal([...f.timers.values()][0].delay, 250);
    assert.equal(f.requests.length, 1);
    f.runTimers();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve(response('2026-10', 'event refresh'));
    await tick();
    assert.equal(f.render().data.marker, 'event refresh');
    f.close();
});

test('언마운트는 모든 구독과 대기 타이머를 해제하고 늦은 조회·목표 저장을 무시한다', async () => {
    const f = fixture();
    const saving = f.result().saveGoal({ books: 3, minutes: 90 });
    f.window.emit('focus');
    assert.equal(f.timers.size, 1);
    assert.equal(f.recentListeners.size, 1);
    assert.equal(f.listListeners.size, 1);
    f.close();
    assert.equal(f.timers.size, 0);
    assert.equal(f.recentListeners.size, 0);
    assert.equal(f.listListeners.size, 0);
    assert.equal(f.window.listeners.size, 0);
    assert.equal(f.document.listeners.size, 0);
    const before = f.updates();
    f.requests[0].resolve(response());
    f.requests[1].resolve({ success: true });
    await saving;
    await tick();
    assert.equal(f.updates(), before);
    assert.equal(f.requests.length, 2);
    await f.result().refresh();
    assert.equal(f.requests.length, 2);
});
