import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcuts, matchesShortcut } from './shortcuts.js';

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
