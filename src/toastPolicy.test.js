import assert from 'node:assert/strict';
import test from 'node:test';
import {
    TOAST_DUPLICATE_WINDOW_MS,
    createToastDescriptor,
    resolveToastMessage,
    shouldShowToast,
    toastIdentity,
} from './toastPolicy.js';

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

test('번역 키 Toast는 현재 언어로 문구를 다시 계산한다', () => {
    const toast = createToastDescriptor({ key: 'msg_rename_success' });
    const translations = {
        ko: { msg_rename_success: '파일 이름이 성공적으로 변경되었습니다.' },
        en: { msg_rename_success: 'File name changed successfully.' },
    };

    assert.equal(resolveToastMessage(toast, key => translations.ko[key]), translations.ko.msg_rename_success);
    assert.equal(resolveToastMessage(toast, key => translations.en[key]), translations.en.msg_rename_success);
});

test('번역 키와 인자가 같은 Toast는 같은 알림으로 판정한다', () => {
    const first = createToastDescriptor({ key: 'tf_toast_missing', values: [2] });
    const second = createToastDescriptor({ key: 'tf_toast_missing', values: [2] });

    assert.equal(toastIdentity(first), toastIdentity(second));
});
