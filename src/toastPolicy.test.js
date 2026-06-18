import assert from 'node:assert/strict';
import test from 'node:test';
import { TOAST_DUPLICATE_WINDOW_MS, shouldShowToast } from './toastPolicy.js';

test('서로 다른 Toast 문구는 연속 표시할 수 있다', () => {
    assert.equal(
        shouldShowToast({ message: '완료', shownAt: 1000 }, '캐시 삭제 완료', 1100),
        true,
    );
});

test('같은 Toast가 짧은 시간에 반복되면 무시한다', () => {
    assert.equal(
        shouldShowToast({ message: '완료', shownAt: 1000 }, '완료', 1500),
        false,
    );
});

test('중복 방지 시간이 지나면 같은 Toast를 다시 표시한다', () => {
    assert.equal(
        shouldShowToast(
            { message: '완료', shownAt: 1000 },
            '완료',
            1000 + TOAST_DUPLICATE_WINDOW_MS,
        ),
        true,
    );
});
