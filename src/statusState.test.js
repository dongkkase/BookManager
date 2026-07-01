import assert from 'node:assert/strict';
import test from 'node:test';
import { isTaskActive, normalizeStatusState } from './statusState.js';

test('분석·실행·취소 대기 상태만 작업 중으로 판정한다', () => {
    assert.equal(isTaskActive('idle'), false);
    assert.equal(isTaskActive('analyzing'), true);
    assert.equal(isTaskActive('executing'), true);
    assert.equal(isTaskActive('cancelling'), true);
});

test('상태 이벤트는 기본값과 진행률 범위를 정규화한다', () => {
    assert.deepEqual(normalizeStatusState('folder', {
        message: '작업 중',
        progress: 120,
        phase: 'executing',
    }), {
        tabId: 'folder',
        message: '작업 중',
        progress: 100,
        phase: 'executing',
        canRun: false,
    });
});
