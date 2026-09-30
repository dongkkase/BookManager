import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcuts, shortcutLabel, matchesShortcut } from './shortcuts.js';

const keyEvent = patch => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...patch });

test('editor shortcuts recognize physical keys with Korean and macOS Option input', () => {
    assert.equal(matchesShortcut(keyEvent({ key: 'ㅜ', code: 'KeyN', metaKey: true, altKey: true }), shortcuts.footnote), true);
    assert.equal(matchesShortcut(keyEvent({ key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true }), shortcuts.bulletList), true);
    assert.equal(matchesShortcut(keyEvent({ key: 'º', code: 'Digit0', altKey: true }), shortcuts.shortcuts), true);
});

test('extra modifiers do not trigger save or destructive table shortcuts', () => {
    assert.equal(matchesShortcut(keyEvent({ key: 's', code: 'KeyS', metaKey: true, altKey: true }), shortcuts.save), false);
    assert.equal(matchesShortcut(keyEvent({ key: 'Delete', code: 'Delete', ctrlKey: true, altKey: true }), shortcuts.deleteTable), false);
    assert.equal(matchesShortcut(keyEvent({ key: 'Delete', code: 'Delete', ctrlKey: true, altKey: true, shiftKey: true }), shortcuts.deleteTable), true);
    assert.equal(new Set(Object.values(shortcuts)).size, Object.keys(shortcuts).length);
});

test('indentation shortcuts recognize bracket keys and do not conflict with existing commands', () => {
    assert.equal(matchesShortcut(keyEvent({ key: ']', code: 'BracketRight', metaKey: true }), shortcuts.increaseIndent), true);
    assert.equal(matchesShortcut(keyEvent({ key: '[', code: 'BracketLeft', ctrlKey: true }), shortcuts.decreaseIndent), true);
    assert.equal(matchesShortcut(keyEvent({ key: 'x', code: 'BracketRight', ctrlKey: true }), shortcuts.increaseIndent), true);
    assert.equal(matchesShortcut(keyEvent({ key: ']', code: 'BracketRight', metaKey: true, altKey: true }), shortcuts.increaseIndent), false);
    assert.equal(matchesShortcut(keyEvent({ key: 'ㅑ', code: 'KeyI', metaKey: true, altKey: true, shiftKey: true }), shortcuts.firstLineIndent), true);
    assert.equal(new Set(Object.values(shortcuts)).size, Object.keys(shortcuts).length);
});

test('quotation shortcuts use only Mod and the quote key with Shift for double quotes', () => {
    for (const platform of ['ctrlKey', 'metaKey']) {
        for (const [command, shiftKey] of [['singleQuotes', false], ['doubleQuotes', true]]) {
            for (const key of [shiftKey ? '"' : "'", shiftKey ? 'Æ' : 'æ', 'ㅁ']) {
                const event = keyEvent({ key, code: 'Quote', [platform]: true, shiftKey });
                assert.deepEqual(Object.keys(shortcuts).filter(key => matchesShortcut(event, shortcuts[key])), [command]);
                assert.equal(matchesShortcut({ ...event, [platform]: false }, shortcuts[command]), false);
                assert.deepEqual(Object.keys(shortcuts).filter(key => matchesShortcut({ ...event, altKey: true }, shortcuts[key])), []);
            }
            assert.match(shortcutLabel(command), /\+'$/);
            assert.equal(shortcutLabel(command).includes('Shift'), shiftKey);
            assert.equal(/Alt|⌥/.test(shortcutLabel(command)), false);
        }
    }
});

test('plain quote typing and former quote bracket combinations do not trigger commands', () => {
    for (const shiftKey of [false, true]) {
        const plain = keyEvent({ key: shiftKey ? '"' : "'", code: 'Quote', shiftKey });
        assert.deepEqual(Object.keys(shortcuts).filter(key => matchesShortcut(plain, shortcuts[key])), []);
        for (const platform of ['ctrlKey', 'metaKey']) {
            for (const [key, code] of [['[', 'BracketLeft'], [']', 'BracketRight']]) {
                const former = keyEvent({ key, code, [platform]: true, altKey: true, shiftKey });
                assert.deepEqual(Object.keys(shortcuts).filter(key => matchesShortcut(former, shortcuts[key])), []);
            }
        }
    }
});
