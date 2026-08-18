import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AUDIOBOOK_CLOSE_ACTION,
    createAudiobookCloseDialogOptions,
    resolveAudiobookCloseAction,
} from './audiobookClosePolicy.js';

test('오디오북 닫기 다이얼로그는 전환, 닫기, 취소를 표시하고 취소를 기본으로 사용한다', () => {
    assert.deepEqual(createAudiobookCloseDialogOptions('ko'), {
        type: 'question',
        title: '오디오북',
        message: '미니플레이어로 전환 하시겠습니까?',
        buttons: ['전환', '닫기', '취소'],
        defaultId: 2,
        cancelId: 2,
        noLink: true,
    });
});

test('오디오북 닫기 다이얼로그는 설정 언어에 맞는 버튼을 사용한다', () => {
    assert.deepEqual(createAudiobookCloseDialogOptions('en-US').buttons, ['Switch', 'Close', 'Cancel']);
    assert.deepEqual(createAudiobookCloseDialogOptions('ja_JP').buttons, ['切り替え', '閉じる', 'キャンセル']);
    assert.equal(createAudiobookCloseDialogOptions('unsupported').message, '미니플레이어로 전환 하시겠습니까?');
});

test('오디오북 닫기 응답은 안전한 동작으로 변환한다', () => {
    assert.equal(resolveAudiobookCloseAction(0), AUDIOBOOK_CLOSE_ACTION.TRANSFER);
    assert.equal(resolveAudiobookCloseAction(1), AUDIOBOOK_CLOSE_ACTION.CLOSE);
    assert.equal(resolveAudiobookCloseAction(2), AUDIOBOOK_CLOSE_ACTION.CANCEL);
    assert.equal(resolveAudiobookCloseAction(-1), AUDIOBOOK_CLOSE_ACTION.CANCEL);
    assert.equal(resolveAudiobookCloseAction(undefined), AUDIOBOOK_CLOSE_ACTION.CANCEL);
});
