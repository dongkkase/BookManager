import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { history, closeHistory } from '@tiptap/pm/history';
import { StyledDivider, applyDivider } from './dividers.js';
import { selectionContext } from './contextTools.js';
import { DIVIDER_STYLES } from '../../../../electron/epubEditor/dividers.js';
import { createProject, paragraph, validateProject, renderChapterBody } from '../../../../electron/epubEditor/model.js';

function fixture(t, content = [paragraph('before after')]) {
    const editor = new Editor({ element: null, extensions: [StarterKit.configure({ horizontalRule: false }), StyledDivider], content: { type: 'doc', content } });
    editor.registerPlugin(history());
    t.after(() => editor.destroy());
    return editor;
}

test('every divider inserts between text, leaves a writing cursor and survives JSON reload', t => {
    for (const style of Object.keys(DIVIDER_STYLES)) {
        const editor = fixture(t);
        editor.commands.setTextSelection(8);
        assert.equal(applyDivider(editor, style), true);
        const saved = editor.getJSON();
        assert.deepEqual(saved.content.map(node => node.type), ['paragraph', 'horizontalRule', 'paragraph']);
        assert.equal(saved.content[0].content[0].text, 'before ');
        assert.equal(saved.content[1].attrs.dividerStyle, style);
        assert.equal(saved.content[2].content[0].text, 'after');
        assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph');
        const project = createProject();
        project.chapters[0].content = saved;
        validateProject(project);
        assert.match(renderChapterBody(project.chapters[0], project), new RegExp(`bm-divider-${style}`));
        editor.commands.setContent(saved);
        assert.deepEqual(editor.getJSON(), saved);
    }
});

test('a selected divider changes design without inserting another node and supports undo and redo', t => {
    const editor = fixture(t, [paragraph('before'), { type: 'horizontalRule' }, paragraph('after')]);
    editor.commands.setNodeSelection(8);
    assert.equal(selectionContext(editor.state).kind, 'horizontalRule');
    assert.equal(applyDivider(editor, 'stars'), true);
    assert.equal(editor.state.doc.childCount, 3);
    assert.equal(editor.state.selection.node.attrs.dividerStyle, 'stars');
    assert.equal(applyDivider(editor, 'shortDouble'), true);
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.state.doc.child(1).attrs.dividerStyle, 'stars');
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.state.doc.child(1).attrs.dividerStyle, null);
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.state.doc.child(1).attrs.dividerStyle, 'stars');
});

test('insertion at document end adds a paragraph and is separate from preceding typing', t => {
    const editor = fixture(t, [paragraph('before')]);
    editor.commands.setTextSelection(7);
    editor.view.dispatch(editor.state.tr.insertText(' text'));
    applyDivider(editor, 'diamonds');
    assert.deepEqual(editor.getJSON().content.map(node => node.type), ['paragraph', 'horizontalRule', 'paragraph']);
    assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph');
    assert.equal(editor.state.selection.$from.parent.content.size, 0);
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.state.doc.childCount, 1);
    assert.equal(editor.state.doc.textContent, 'before text');
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.state.doc.child(1).attrs.dividerStyle, 'diamonds');
});

test('insertion in an empty document and list preserves valid block structure', t => {
    for (const content of [[paragraph()], [{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('item')] }] }]]) {
        const editor = fixture(t, content);
        editor.commands.setTextSelection(content[0].type === 'bulletList' ? 5 : 1);
        assert.equal(applyDivider(editor, 'double'), true);
        editor.state.doc.check();
        const project = createProject();
        project.chapters[0].content = editor.getJSON();
        validateProject(project);
        assert.equal(editor.state.selection.$from.parent.type.name, 'paragraph');
    }
});

test('plain rule commands remain available and invalid or read-only changes do not mutate the document', t => {
    const editor = fixture(t, [paragraph()]);
    assert.equal(editor.commands.setHorizontalRule(), true);
    assert.equal(editor.state.doc.firstChild.attrs.dividerStyle, null);
    const before = editor.getJSON();
    editor.view.dispatch(closeHistory(editor.state.tr));
    assert.equal(applyDivider(editor, 'unknown'), false);
    editor.setEditable(false);
    assert.equal(applyDivider(editor, 'stars'), false);
    assert.deepEqual(editor.getJSON(), before);
});
