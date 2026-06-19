import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWindowState, serializeWindowState } from './windowState.js';

const primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1080 };
const displays = [{ workArea: primaryWorkArea }];

test('저장된 창 위치와 최대화 상태를 복원한다', () => {
    const state = resolveWindowState({
        x: 100,
        y: 80,
        width: 1400,
        height: 900,
        is_maximized: true,
    }, displays, primaryWorkArea);

    assert.deepEqual(state.bounds, { x: 100, y: 80, width: 1400, height: 900 });
    assert.equal(state.isMaximized, true);
});

test('화면 밖에 저장된 창을 주 모니터 중앙으로 복구한다', () => {
    const state = resolveWindowState({
        x: 5000,
        y: 5000,
        width: 1200,
        height: 800,
    }, displays, primaryWorkArea);

    assert.deepEqual(state.bounds, { x: 360, y: 140, width: 1200, height: 800 });
});

test('저장된 창 크기가 최소 크기보다 작으면 제한한다', () => {
    const state = resolveWindowState({
        width: 100,
        height: 100,
    }, displays, primaryWorkArea);

    assert.equal(state.bounds.width, 1200);
    assert.equal(state.bounds.height, 750);
});

test('원본과 같은 최초 크기와 최소 크기를 사용한다', () => {
    const state = resolveWindowState({}, displays, primaryWorkArea);

    assert.equal(state.bounds.width, 1200);
    assert.equal(state.bounds.height, 800);
    assert.equal(state.minWidth, 1200);
    assert.equal(state.minHeight, 750);
});

test('과거 config의 잘못된 최소 크기 값은 원본 고정값을 덮어쓰지 않는다', () => {
    const state = resolveWindowState({
        min_window_width: 1250,
        min_window_height: 780,
    }, displays, primaryWorkArea);

    assert.equal(state.minWidth, 1200);
    assert.equal(state.minHeight, 750);
});

test('연결된 보조 모니터에 저장된 창 위치를 유지한다', () => {
    const allDisplays = [
        { workArea: primaryWorkArea },
        { workArea: { x: 1920, y: 0, width: 1440, height: 900 } },
    ];
    const state = resolveWindowState({
        x: 2100,
        y: 50,
        width: 1200,
        height: 800,
    }, allDisplays, primaryWorkArea);

    assert.deepEqual(state.bounds, { x: 2100, y: 50, width: 1200, height: 800 });
});

test('일반 창 bounds와 최대화 상태를 저장 형식으로 변환한다', () => {
    const state = serializeWindowState({
        getNormalBounds: () => ({ x: 10, y: 20, width: 1300, height: 820 }),
        isMaximized: () => false,
    });

    assert.deepEqual(state, {
        x: 10,
        y: 20,
        width: 1300,
        height: 820,
        is_maximized: false,
    });
});
