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

test('목록 추가 방식 질문은 명시적인 버튼과 안전한 기본 선택을 제공한다', () => {
    const labels = {
        ko: ['기존 목록에 추가', '기존 목록 전체 비우고 추가', '취소'],
        en: ['Add to the existing list', 'Clear the list and add files', 'Cancel'],
        ja: ['既存の一覧に追加', '既存の一覧を空にして追加', 'キャンセル'],
    };
    for (const [language, buttons] of Object.entries(labels)) {
        const options = createMessageDialogOptions({ type: 'question', buttons: 'append-replace-cancel', language });
        assert.deepEqual(options.buttons, buttons);
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 2);
        assert.equal(options.noLink, true);
    }
    for (const [defaultChoice, defaultId] of [['append', 0], ['replace', 1], ['cancel', 2], ['unknown', 0]]) {
        const options = createMessageDialogOptions({ type: 'question', buttons: 'append-replace-cancel', defaultChoice });
        assert.equal(options.defaultId, defaultId);
        assert.equal(options.cancelId, 2);
    }
});

test('목록 추가 방식은 선택 결과를 구분하고 닫기나 알 수 없는 결과를 취소로 처리한다', () => {
    const options = { type: 'question', buttons: 'append-replace-cancel' };
    for (const [response, result] of [[0, 'append'], [1, 'replace'], [2, 'cancel'], [-1, 'cancel'], [3, 'cancel']]) {
        assert.equal(resolveMessageDialogResponse(options, response), result);
    }
    const dialogOptions = createMessageDialogOptions(options);
    assert.equal(resolveMessageDialogResponse(options, dialogOptions.cancelId), 'cancel');
});

test('메시지 줄바꿈과 동적 값을 변경하지 않는다', () => {
    const message = '3개 처리 실패\n오류:\n책.cbz: 권한 없음';
    assert.equal(createMessageDialogOptions({ type: 'error', message }).message, message);
});
