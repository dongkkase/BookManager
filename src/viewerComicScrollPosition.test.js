import assert from 'node:assert/strict';
import test from 'node:test';
import { captureComicScrollPosition, restoreComicScrollPosition } from './viewerComicScrollPosition.js';

function fixture() {
    let now = 0;
    let sequence = 0;
    let callbacksRun = 0;
    const scheduled = new Map();
    const listeners = new Set();
    const schedule = (callback, delay, animation) => {
        const id = ++sequence;
        scheduled.set(id, { callback, due: now + delay, animation });
        return id;
    };
    const document = new EventTarget();
    const addListener = document.addEventListener.bind(document);
    const removeListener = document.removeEventListener.bind(document);
    document.addEventListener = (type, callback, options) => {
        listeners.add(type);
        addListener(type, callback, options);
    };
    document.removeEventListener = (type, callback, options) => {
        listeners.delete(type);
        removeListener(type, callback, options);
    };
    document.defaultView = {
        requestAnimationFrame: callback => schedule(callback, 16, true),
        cancelAnimationFrame: id => scheduled.delete(id),
        setTimeout: (callback, delay) => schedule(callback, delay, false),
        clearTimeout: id => scheduled.delete(id),
    };
    const image = { complete: false, naturalWidth: 0 };
    const geometry = { top: 10000, height: 700, error: false };
    const root = {
        ownerDocument: document,
        isConnected: true,
        clientTop: 0,
        clientHeight: 600,
        scrollTop: 0,
        scrollHeight: 200000,
        getBoundingClientRect: () => ({ top: 0 }),
        querySelector: () => page,
        querySelectorAll: () => [page],
    };
    const page = {
        dataset: { pageIndex: '20' },
        getBoundingClientRect: () => ({
            top: geometry.top - root.scrollTop,
            bottom: geometry.top - root.scrollTop + geometry.height,
            height: geometry.height,
        }),
        querySelectorAll: () => [image],
        querySelector: () => geometry.error ? {} : null,
    };
    const completions = [];
    let current = true;
    const cancel = restoreComicScrollPosition(root, { pageIndex: 20, offsetRatio: 0.35 }, {
        isCurrent: () => current,
        onFinish: result => completions.push(result.reason),
    });
    return {
        root, image, geometry, completions, cancel,
        get resources() { return scheduled.size + listeners.size; },
        get callbacksRun() { return callbacksRun; },
        replaceSession() { current = false; },
        input(type) { document.dispatchEvent(new Event(type)); },
        advance(milliseconds) {
            const end = now + milliseconds;
            while (true) {
                const next = [...scheduled].sort((left, right) => left[1].due - right[1].due)[0];
                if (!next || next[1].due > end) break;
                const [id, task] = next;
                scheduled.delete(id);
                now = task.due;
                callbacksRun += 1;
                task.callback(task.animation ? now : undefined);
            }
            now = end;
        },
    };
}

test('10초 넘게 기다린 긴 만화 이미지도 원래 페이지 내부 비율로 복원한다', () => {
    const state = fixture();
    state.advance(15000);
    assert.deepEqual(state.completions, []);
    assert.equal(state.root.scrollTop, 10245);
    assert.ok(state.callbacksRun < 300, 'Pending decoding must not poll at animation-frame frequency.');

    state.geometry.height = 100000;
    state.image.complete = true;
    state.image.naturalWidth = 720;
    state.advance(116);
    assert.equal(state.root.scrollTop, 45000);
    assert.deepEqual(state.completions, [], 'A newly decoded image must settle before restoration completes.');
    state.advance(300);
    assert.deepEqual(state.completions, ['restored']);
    assert.deepEqual(captureComicScrollPosition(state.root, 20), { pageIndex: 20, offsetRatio: 0.35 });
    assert.equal(state.resources, 0);
    state.cancel();
    assert.deepEqual(state.completions, ['restored']);
});

test('디코딩 후 늦게 바뀐 높이도 반영하고 오류 표시는 대기를 끝낸다', () => {
    const state = fixture();
    state.advance(15000);
    state.image.complete = true;
    state.image.naturalWidth = 720;
    state.geometry.height = 79000;
    state.advance(116);
    assert.equal(state.root.scrollTop, 37650);
    state.advance(100);
    state.geometry.height = 125000;
    state.advance(16);
    assert.equal(state.root.scrollTop, 53750);
    state.advance(200);
    assert.deepEqual(state.completions, []);
    state.advance(100);
    assert.deepEqual(state.completions, ['restored']);
    assert.equal(state.resources, 0);

    const failed = fixture();
    failed.advance(15000);
    failed.geometry.error = true;
    failed.advance(500);
    assert.deepEqual(failed.completions, ['restored']);
    assert.equal(failed.resources, 0);
});

test('오래 대기 중에도 사용자 입력과 세션 교체는 복원 및 타이머를 취소한다', () => {
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
        const state = fixture();
        state.advance(15000);
        state.input(type);
        assert.deepEqual(state.completions, ['cancelled']);
        assert.equal(state.resources, 0);
        state.root.scrollTop = 123;
        state.geometry.height = 100000;
        state.image.complete = true;
        state.image.naturalWidth = 720;
        state.advance(1000);
        assert.equal(state.root.scrollTop, 123);
    }
    const replaced = fixture();
    replaced.advance(15000);
    replaced.replaceSession();
    replaced.advance(116);
    assert.deepEqual(replaced.completions, ['cancelled']);
    assert.equal(replaced.resources, 0);

    const detached = fixture();
    detached.advance(15000);
    detached.root.isConnected = false;
    detached.advance(116);
    assert.deepEqual(detached.completions, ['cancelled']);
    assert.equal(detached.resources, 0);
});
