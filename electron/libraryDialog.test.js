import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createLibrarySyncDialogOptions,
    resolveLibrarySyncChoice,
} from './libraryDialog.js';

test('라이브러리 동기화는 스마트 갱신, 전체 재스캔, 취소를 제공한다', () => {
    const options = createLibrarySyncDialogOptions({ language: 'ko' });

    assert.deepEqual(options.buttons, ['스마트 갱신', '전체 재스캔', '취소']);
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 2);
});

test('라이브러리 동기화 응답을 작업 모드로 변환한다', () => {
    assert.equal(resolveLibrarySyncChoice(0), 'smart');
    assert.equal(resolveLibrarySyncChoice(1), 'force');
    assert.equal(resolveLibrarySyncChoice(2), 'cancel');
});
