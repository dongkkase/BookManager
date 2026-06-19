import assert from 'node:assert/strict';
import test from 'node:test';
import { isTaskActive } from './statusState.js';

test('분석·실행·취소 대기 상태만 작업 중으로 판정한다', () => {
    assert.equal(isTaskActive('idle'), false);
    assert.equal(isTaskActive('analyzing'), true);
    assert.equal(isTaskActive('executing'), true);
    assert.equal(isTaskActive('cancelling'), true);
});
