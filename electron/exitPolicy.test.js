import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createExitDialogOptions,
    normalizeRuntimeState,
    shouldProceedWithExit,
} from './exitPolicy.js';

test('종료 경고는 아니오를 기본 및 취소 선택으로 사용한다', () => {
    const options = createExitDialogOptions('ko');

    assert.deepEqual(options.buttons, ['예', '아니오']);
    assert.equal(options.defaultId, 1);
    assert.equal(options.cancelId, 1);
});

test('종료 경고 문구를 현재 언어로 제공한다', () => {
    assert.equal(createExitDialogOptions('en').title, 'Confirm Exit');
    assert.equal(createExitDialogOptions('ja').title, '終了確認');
});

test('렌더러 종료 상태를 안전한 기본값으로 정규화한다', () => {
    assert.deepEqual(normalizeRuntimeState({ isWorking: 1, language: 'en', activeTab: 'renamer' }), {
        isWorking: true,
        language: 'en',
        activeTab: 'renamer',
    });
    assert.equal(normalizeRuntimeState({ language: 'invalid' }).language, 'ko');
});

test('종료 거부는 작업 취소와 창 닫기를 진행하지 않는다', () => {
    assert.equal(shouldProceedWithExit(0), true);
    assert.equal(shouldProceedWithExit(1), false);
    assert.equal(shouldProceedWithExit(undefined), false);
});
