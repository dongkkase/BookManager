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
