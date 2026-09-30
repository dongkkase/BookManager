import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { history } from '@tiptap/pm/history';
import { createAudioExtension, normalizeAudioVolume } from './audioNode.js';

const assetId = 'a_audio';
const resolveAsset = id => id === assetId ? 'blob:audio' : '';

function fixture(t, attrs = {}) {
    const extension = createAudioExtension(resolveAsset);
    const editor = new Editor({
        element: null, extensions: [StarterKit, extension],
        content: { type: 'doc', content: [{ type: 'audio', attrs: { assetId, ...attrs } }, { type: 'paragraph' }] },
    });
    editor.registerPlugin(history());
    editor.commands.setNodeSelection(0);
    t.after(() => editor.destroy());
    return { editor, extension };
}

test('existing audio gains visible-player and full-volume defaults without changing purpose or looping', t => {
    const { editor } = fixture(t, { title: '기존 배경음', kind: 'background', loop: true });
    assert.deepEqual(editor.getAttributes('audio'), { assetId, title: '기존 배경음', kind: 'background', loop: true, controls: true, volume: 1 });
});

test('hidden-player and zero-volume settings survive JSON reload and undo/redo', t => {
    const { editor } = fixture(t);
    const before = editor.getJSON();
    editor.commands.updateAttributes('audio', { controls: false, volume: 0, loop: true });
    const changed = editor.getJSON();
    assert.equal(changed.content[0].attrs.controls, false);
    assert.equal(changed.content[0].attrs.volume, 0);
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(editor.commands.redo(), true);
    assert.deepEqual(editor.getJSON(), changed);
    editor.commands.setContent(changed);
    assert.deepEqual(editor.getJSON(), changed);
});

test('audio clipboard HTML preserves visibility, silence, loop, purpose and label', t => {
    const { editor, extension } = fixture(t, { title: '효과 <>&', kind: 'background', controls: false, volume: 0, loop: true });
    const html = extension.config.renderHTML({ node: editor.state.doc.firstChild });
    const audio = html[3];
    assert.equal(html[1]['data-bookmanager-audio-controls'], 'false');
    assert.equal(audio[1]['data-bookmanager-audio-controls'], 'false');
    assert.equal(audio[1]['data-bookmanager-audio-volume'], 0);
    assert.equal(audio[1]['data-bookmanager-audio-kind'], 'background');
    assert.equal(audio[1].controls, undefined);
    assert.equal(audio[1].loop, 'loop');
    const element = {
        getAttribute: name => html[1][name] == null ? null : String(html[1][name]),
        querySelector: () => ({ getAttribute: name => audio[1][name] == null ? null : String(audio[1][name]) }),
    };
    assert.deepEqual(extension.config.parseHTML()[0].getAttrs(element), { assetId, title: '효과 <>&', kind: 'background', loop: true, controls: false, volume: 0 });
});

test('legacy and malformed clipboard audio use safe defaults and reject unknown assets', () => {
    const extension = createAudioExtension(resolveAsset);
    const attributes = { 'data-audio-asset': assetId };
    const element = { getAttribute: name => attributes[name] ?? null, querySelector: () => null };
    const parse = extension.config.parseHTML()[0].getAttrs;
    assert.deepEqual(parse(element), { assetId, title: '', kind: 'effect', loop: false, controls: true, volume: 1 });
    attributes['data-bookmanager-audio-volume'] = '0';
    attributes['data-bookmanager-audio-controls'] = 'false';
    assert.equal(parse(element).volume, 0);
    assert.equal(parse(element).controls, false);
    attributes['data-bookmanager-audio-volume'] = 'invalid';
    assert.equal(parse(element).volume, 1);
    attributes['data-audio-asset'] = 'a_unknown';
    assert.equal(parse(element), false);
    for (const value of [undefined, null, '', ' ', false, true, {}, [], NaN, Infinity, 'invalid']) assert.equal(normalizeAudioVolume(value), 1);
    assert.equal(normalizeAudioVolume(-1), 0);
    assert.equal(normalizeAudioVolume(2), 1);
    assert.equal(normalizeAudioVolume('0.35'), 0.35);
});

test('editing keeps hidden audio visible, auditions volume and loop, and selects from its caption', t => {
    const { editor, extension } = fixture(t, { controls: false, volume: 0.35, loop: true, title: '배경음' });
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const elements = [];
    globalThis.document = {
        createElement(tagName) {
            const attributes = {};
            const element = {
                tagName, children: [], listeners: {},
                setAttribute(name, value) { attributes[name] = String(value); },
                getAttribute(name) { return attributes[name] ?? null; },
                removeAttribute(name) { delete attributes[name]; },
                set src(value) { attributes.src = value; },
                addEventListener(name, callback) { this.listeners[name] = callback; },
                append(...children) { this.children.push(...children); },
                pause() { this.paused = true; },
                load() { this.loaded = true; },
            };
            elements.push(element);
            return element;
        },
    };
    t.after(() => {
        if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
        else delete globalThis.document;
    });
    let focused = false;
    const editorView = {
        isDestroyed: false, isEditable: true,
        get state() { return editor.state; },
        view: { dispatch: transaction => editor.view.dispatch(transaction), focus: () => { focused = true; } },
    };
    const view = extension.config.addNodeView()({ node: editor.state.doc.firstChild, editor: editorView, getPos: () => 0 });
    const [, caption, audio] = elements;
    assert.equal(audio.controls, true);
    assert.equal(audio.volume, 0.35);
    assert.equal(audio.loop, true);
    assert.match(caption.textContent, /배경음/);
    editor.commands.setTextSelection(2);
    caption.listeners.click();
    assert.equal(editor.state.selection.node.type.name, 'audio');
    assert.equal(focused, true);
    editor.commands.updateAttributes('audio', { volume: 0, loop: false });
    assert.equal(view.update(editor.state.doc.firstChild), true);
    assert.equal(audio.volume, 0);
    assert.equal(audio.loop, false);
    assert.equal(audio.controls, true);
    view.destroy();
    assert.equal(audio.paused, true);
    assert.equal(audio.getAttribute('src'), null);
    assert.equal(audio.loaded, true);
});
