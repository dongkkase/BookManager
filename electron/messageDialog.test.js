import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createMessageDialogOptions,
    resolveMessageDialogResponse,
} from './messageDialog.js';

test('정보·경고·오류 팝업은 확인 버튼만 제공한다', () => {
    for (const type of ['info', 'warning', 'error']) {
        const options = createMessageDialogOptions({ type, language: 'ko' });
        assert.deepEqual(options.buttons, ['확인']);
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 0);
    }
});

test('예/아니오 질문은 아니오를 Escape로 처리할 수 있다', () => {
    const options = createMessageDialogOptions({
        type: 'question',
        buttons: 'yes-no',
        defaultChoice: 'no',
        language: 'en',
    });

    assert.deepEqual(options.buttons, ['Yes', 'No']);
    assert.equal(options.defaultId, 1);
    assert.equal(options.cancelId, 1);
    assert.equal(resolveMessageDialogResponse({ type: 'question', buttons: 'yes-no' }, 1), 'no');
});

test('예/아니오/취소 질문은 취소를 Escape 결과로 사용한다', () => {
    const options = createMessageDialogOptions({
        type: 'question',
        buttons: 'yes-no-cancel',
        language: 'ja',
    });

    assert.deepEqual(options.buttons, ['はい', 'いいえ', 'キャンセル']);
    assert.equal(options.cancelId, 2);
    assert.equal(
        resolveMessageDialogResponse({ type: 'question', buttons: 'yes-no-cancel' }, 2),
        'cancel',
    );
});

test('메시지 줄바꿈과 동적 값을 변경하지 않는다', () => {
    const message = '3개 처리 실패\n오류:\n책.cbz: 권한 없음';
    assert.equal(createMessageDialogOptions({ type: 'error', message }).message, message);
});
