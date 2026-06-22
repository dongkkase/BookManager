import assert from 'node:assert/strict';
import test from 'node:test';
import {
    dropdownVerticalPlacement,
    hasPrimaryModifier,
    isShortcutKey,
    isTextEntryTarget,
    shortcutCode,
    shouldHandleGlobalShortcut,
} from './interactionPolicy.js';

test('input, textarea, select, contenteditable 입력을 전역 단축키에서 제외한다', () => {
    assert.equal(isTextEntryTarget({ tagName: 'INPUT' }), true);
    assert.equal(isTextEntryTarget({ tagName: 'textarea' }), true);
    assert.equal(isTextEntryTarget({ tagName: 'SELECT' }), true);
    assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(shouldHandleGlobalShortcut({ target: { tagName: 'TEXTAREA' } }), false);
    assert.equal(shouldHandleGlobalShortcut({ target: { tagName: 'DIV' } }), true);
});

test('Windows/Linux Ctrl과 macOS Cmd를 primary modifier로 구분한다', () => {
    assert.equal(hasPrimaryModifier({ ctrlKey: true, metaKey: false }, 'Win32'), true);
    assert.equal(hasPrimaryModifier({ ctrlKey: false, metaKey: true }, 'MacIntel'), true);
    assert.equal(hasPrimaryModifier({ ctrlKey: true, metaKey: false }, 'MacIntel'), false);
});

test('알파벳 단축키는 IME 문자보다 물리 키 코드를 우선한다', () => {
    assert.equal(shortcutCode({ code: 'KeyR', key: 'ㄲ' }), 'KeyR');
    assert.equal(isShortcutKey({ code: 'KeyR', key: 'ㄲ' }, 'r'), true);
    assert.equal(isShortcutKey({ code: '', key: 'r' }, 'r'), true);
});

test('드롭다운은 아래 공간이 부족하고 위 공간이 더 넓으면 위로 열린다', () => {
    assert.equal(dropdownVerticalPlacement({ top: 700, bottom: 730 }, 240, 800), 'up');
    assert.equal(dropdownVerticalPlacement({ top: 100, bottom: 130 }, 240, 800), 'down');
});
