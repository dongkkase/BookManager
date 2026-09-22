import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { EditorState, TextSelection, NodeSelection, AllSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { history, undo, redo } from '@tiptap/pm/history';
import { ParagraphIndent, selectedIndentBlocks, indentSelectionState, updateParagraphIndent } from './paragraphIndent.js';
import { paragraphIndentCss } from '../../../../electron/epubEditor/paragraphIndent.js';
import { createChapter, createProject, newId, validateProject, bookCss, renderChapterBody } from '../../../../electron/epubEditor/model.js';
import { splitProjectChapter, mergeProjectChapters } from './chapterOperations.js';

const schema = getSchema([StarterKit, TableKit, ParagraphIndent]);
const p = (text, attrs) => schema.node('paragraph', attrs, text ? schema.text(text) : null);
const doc = (...nodes) => schema.node('doc', null, nodes);
const at = (document, from, to = from) => EditorState.create({ doc: document, selection: TextSelection.create(document, from, to), plugins: [history()] });
const commands = ParagraphIndent.config.addCommands();
function run(state, command) {
    const tr = state.tr;
    if (!command({ tr, dispatch: () => {} })) return state;
    return state.apply(tr);
}

test('new books and all built-in styles start without indentation; old books retain their style', () => {
    for (const template of ['blank', 'essay', 'guide']) assert.equal(createProject(template).style.indent, 0);
    const old = createProject();
    old.style.indent = 1;
    validateProject(old);
    assert.match(bookCss(old), /text-indent:1em/);
    assert.equal(schema.nodes.paragraph.defaultAttrs.indentLevel, 0);
    assert.equal(schema.nodes.paragraph.defaultAttrs.firstLineIndent, null);
});

test('indent buttons affect the caret paragraph and clamp at zero and eight levels', () => {
    let state = at(doc(p('첫째'), p('둘째')), 5);
    for (let i = 0; i < 10; i += 1) state = run(state, commands.increaseParagraphIndent());
    assert.equal(state.doc.child(0).attrs.indentLevel, 0);
    assert.equal(state.doc.child(1).attrs.indentLevel, 8);
    assert.equal(indentSelectionState(state).canIncrease, false);
    for (let i = 0; i < 10; i += 1) state = run(state, commands.decreaseParagraphIndent());
    assert.equal(state.doc.child(1).attrs.indentLevel, 0);
    assert.equal(indentSelectionState(state).canDecrease, false);
    assert.equal(state.doc.textContent, '첫째둘째');
});

test('ranges affect multiple selected blocks, excluding a paragraph touched only at its start', () => {
    const document = doc(p('첫째'), schema.node('heading', { level: 2 }, schema.text('제목')), p('끝'));
    const firstTwo = at(document, 2, 9);
    assert.deepEqual(selectedIndentBlocks(firstTwo).map(item => item.node.type.name), ['paragraph', 'heading']);
    const changed = run(firstTwo, commands.increaseParagraphIndent());
    assert.deepEqual(changed.doc.content.content.map(node => node.attrs.indentLevel), [1, 1, 0]);
    assert.equal(changed.selection.from, firstTwo.selection.from);
    assert.equal(changed.selection.to, firstTwo.selection.to);
    const all = EditorState.create({ doc: document, selection: new AllSelection(document) });
    assert.equal(selectedIndentBlocks(all).length, 3);
});

test('first-line, hanging, none and inherited values are independent of paragraph offset', () => {
    let state = at(doc(p('내용', { indentLevel: 2 })), 1);
    for (const value of [1, -1, 0, null]) {
        state = run(state, commands.setFirstLineIndent(value));
        assert.equal(state.doc.child(0).attrs.firstLineIndent, value);
        assert.equal(state.doc.child(0).attrs.indentLevel, 2);
        assert.equal(indentSelectionState(state).firstLine, value);
    }
    assert.equal(paragraphIndentCss({ indentLevel: 2, firstLineIndent: -1 }), 'margin-left:5em;text-indent:-1em');
    assert.equal(paragraphIndentCss({ firstLineIndent: -1 }), 'margin-left:1em;text-indent:-1em');
    assert.equal(paragraphIndentCss({ firstLineIndent: 0 }), 'text-indent:0em');
    assert.equal(paragraphIndentCss({ firstLineIndent: null }), '');
});

test('mixed selection reports its state and applies or resets formatting together', () => {
    let state = at(doc(p('첫째', { firstLineIndent: 1, indentLevel: 2 }), p('둘째', { firstLineIndent: -1 })), 1, 7);
    assert.equal(indentSelectionState(state).firstLine, 'mixed');
    state = run(state, commands.setFirstLineIndent(0));
    assert.equal(indentSelectionState(state).firstLine, 0);
    state = run(state, commands.resetParagraphIndent());
    assert.deepEqual(state.doc.content.content.map(node => [node.attrs.indentLevel, node.attrs.firstLineIndent]), [[0, null], [0, null]]);
});

test('cell ranges change only selected cells, including noncontiguous document ranges', () => {
    const cell = text => schema.node('tableCell', null, p(text));
    const table = schema.node('table', null, [schema.node('tableRow', null, [cell('a'), cell('b')]), schema.node('tableRow', null, [cell('c'), cell('d')])]);
    const document = doc(p('앞'), table, p('뒤'));
    const cells = [];
    document.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
    let state = EditorState.create({ doc: document, selection: CellSelection.create(document, cells[0], cells[2]) });
    assert.equal(selectedIndentBlocks(state).length, 2);
    state = run(state, commands.setFirstLineIndent(-1));
    const values = [];
    state.doc.descendants(node => { if (node.type.name === 'paragraph') values.push([node.textContent, node.attrs.firstLineIndent]); });
    assert.deepEqual(values, [['앞', null], ['a', -1], ['b', null], ['c', -1], ['d', null], ['뒤', null]]);
});

test('lists retain their structure, while code blocks and selected atoms do not accept indentation', () => {
    const list = schema.node('bulletList', null, [schema.node('listItem', null, p('항목'))]);
    const document = doc(list, schema.node('codeBlock', null, schema.text('code')), schema.node('horizontalRule'));
    const changed = run(at(document, 3), commands.increaseParagraphIndent());
    assert.equal(changed.doc.child(0).type.name, 'bulletList');
    assert.equal(changed.doc.child(0).child(0).child(0).attrs.indentLevel, 1);
    assert.equal(indentSelectionState(at(document, list.nodeSize + 1)).enabled, false);
    const selectedRule = EditorState.create({ doc: document, selection: NodeSelection.create(document, list.nodeSize + document.child(1).nodeSize) });
    assert.equal(indentSelectionState(selectedRule).enabled, false);
});

test('dry runs and invalid values do not mutate transactions, and each command has one undo step', () => {
    let state = at(doc(p('원고')), 2);
    const tr = state.tr;
    assert.equal(updateParagraphIndent({ tr }, () => ({ indentLevel: 1 })), true);
    assert.equal(tr.steps.length, 0);
    for (const value of [4, -4, NaN, Infinity, '1', undefined]) assert.equal(commands.setFirstLineIndent(value)({ tr, dispatch: () => {} }), false);
    assert.equal(tr.steps.length, 0);
    state = run(state, commands.increaseParagraphIndent());
    const increased = state.doc;
    state = run(state, commands.setFirstLineIndent(-1));
    const hanging = state.doc;
    assert.equal(undo(state, transaction => { state = state.apply(transaction); }), true);
    assert.ok(state.doc.eq(increased));
    assert.equal(redo(state, transaction => { state = state.apply(transaction); }), true);
    assert.ok(state.doc.eq(hanging));
});

test('serialized attributes and XHTML use the same spacing and preserve it through split and merge', () => {
    const document = doc(p('앞뒤', { indentLevel: 2, firstLineIndent: -1 }));
    const chapter = { ...createChapter('본문'), content: document.toJSON() };
    const project = { ...createProject(), chapters: [chapter] };
    validateProject(project);
    assert.match(renderChapterBody(chapter, project), /style="margin-left:5em;text-indent:-1em"/);
    const split = splitProjectChapter([chapter], chapter.id, at(document, 2));
    for (const item of split.chapters) {
        assert.equal(item.content.content[0].attrs.indentLevel, 2);
        assert.equal(item.content.content[0].attrs.firstLineIndent, -1);
    }
    const merged = mergeProjectChapters(split.chapters, chapter.id, split.selectedId);
    assert.equal(schema.nodeFromJSON(merged.chapters[0].content).child(1).attrs.firstLineIndent, -1);
});

test('project validation rejects invalid indentation and attributes on unsupported nodes', () => {
    const project = createProject();
    const original = p('本文').toJSON();
    for (const attrs of [{ indentLevel: -1 }, { indentLevel: 1.5 }, { indentLevel: 9 }, { indentLevel: '2' }, { firstLineIndent: 4 }, { firstLineIndent: -4 }, { firstLineIndent: 'url(x)' }, { firstLineIndent: Infinity }]) {
        project.chapters[0].content.content = [{ ...original, attrs }];
        assert.throws(() => validateProject(project), { code: 'INVALID_DOCUMENT' });
    }
    project.chapters[0].content.content = [{ type: 'horizontalRule', attrs: { id: newId(), indentLevel: 1 } }];
    assert.throws(() => validateProject(project), { code: 'INVALID_DOCUMENT' });
});

test('HTML attributes retain explicit zero and hanging settings, rejecting invalid pasted values', () => {
    const attributes = ParagraphIndent.config.addGlobalAttributes()[0].attributes;
    const element = values => ({ getAttribute: name => values[name] ?? null });
    assert.equal(attributes.firstLineIndent.parseHTML(element({})), null);
    assert.equal(attributes.firstLineIndent.parseHTML(element({ 'data-first-line-indent': '0' })), 0);
    assert.equal(attributes.firstLineIndent.parseHTML(element({ 'data-first-line-indent': '-1' })), -1);
    assert.equal(attributes.firstLineIndent.parseHTML(element({ 'data-first-line-indent': '-99' })), null);
    assert.equal(attributes.indentLevel.parseHTML(element({ 'data-indent-level': '1.5' })), 0);
    assert.equal(attributes.indentLevel.parseHTML(element({ 'data-indent-level': '3' })), 3);
    assert.equal(attributes.indentLevel.renderHTML({ indentLevel: 0, firstLineIndent: -1 }).style, 'margin-left:1em;text-indent:-1em');
});
