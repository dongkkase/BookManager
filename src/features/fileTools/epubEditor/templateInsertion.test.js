import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection, NodeSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { tableNodes, CellSelection } from '@tiptap/pm/tables';
import { captureTemplate, templateInsertionTransaction } from './templateInsertion.js';
import { validateContentTemplate, builtinContentTemplates, prepareTemplateContent } from '../../../../electron/epubEditor/contentTemplates.js';
import { shortcuts, matchesShortcut } from './shortcuts.js';

const id = { default: null };
const schema = new Schema({ nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', attrs: { id, firstLineIndent: { default: null } } },
    heading: { group: 'block', content: 'inline*', attrs: { id, level: { default: 1 } } },
    text: { group: 'inline' },
    blockquote: { group: 'block', content: 'block+', attrs: { id } },
    bulletList: { group: 'block', content: 'listItem+' }, orderedList: { group: 'block', content: 'listItem+', attrs: { start: { default: 1 } } }, listItem: { content: 'paragraph block*' },
    horizontalRule: { group: 'block' },
    footnote: { inline: true, group: 'inline', atom: true, attrs: { id, text: {} } },
    image: { group: 'block', atom: true, attrs: { assetId: {}, width: { default: 100 }, align: { default: 'center' }, alt: { default: '' } } },
    columns: { group: 'block', content: 'column{2,3}', attrs: { id } }, column: { content: 'block+' },
    ...Object.fromEntries(Object.entries(tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} })).map(([name, spec]) => [({ table_row: 'tableRow', table_cell: 'tableCell', table_header: 'tableHeader' }[name] || name), { ...spec, content: spec.content?.replaceAll('table_row', 'tableRow').replaceAll('table_cell', 'tableCell').replaceAll('table_header', 'tableHeader') }])),
}, marks: { bold: {}, link: { attrs: { href: {} } } } });
const p = text => schema.node('paragraph', null, text ? schema.text(text) : null);
const doc = (...nodes) => schema.node('doc', null, nodes);
const stateAt = (document, from, to = from) => EditorState.create({ doc: document, selection: TextSelection.create(document, from, to), plugins: [history()] });

test('inserting a complete template splits at the cursor, preserves surrounding text and undoes once', () => {
    const original = doc(p('앞문장뒷문장'));
    let state = stateAt(original, 4);
    const template = builtinContentTemplates().find(item => item.id === 'builtin-quote');
    state = state.apply(templateInsertionTransaction(state, template.content, 'c_current'));
    assert.equal(state.doc.firstChild.textContent, '앞문장');
    assert.equal(state.doc.lastChild.textContent, '뒷문장');
    assert.equal(state.doc.child(1).type.name, 'blockquote');
    const inserted = state.doc;
    assert.equal(undo(state, tr => { state = state.apply(tr); }), true);
    assert.ok(state.doc.eq(original));
    assert.equal(redo(state, tr => { state = state.apply(tr); }), true);
    assert.ok(state.doc.eq(inserted));
});

test('replacing a selection inserts only once and clears inherited typing marks', () => {
    let state = stateAt(doc(p('앞교체뒤')), 2, 4);
    state = state.apply(state.tr.setStoredMarks([schema.mark('bold')]));
    const template = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '새 내용' }] }] };
    const tr = templateInsertionTransaction(state, template, 'c_current');
    assert.equal(tr.storedMarks, null);
    state = state.apply(tr);
    assert.equal(state.doc.textContent, '앞새 내용뒤');
    assert.equal(state.doc.textContent.includes('교체'), false);
});

test('selection capture keeps only selected text with its formatting and enclosing list', () => {
    const document = doc(schema.node('bulletList', null, schema.node('listItem', null, schema.node('paragraph', null, schema.text('앞선택뒤', [schema.mark('bold')])))));
    const content = captureTemplate(stateAt(document, 4, 6), 'c_source').content;
    schema.nodeFromJSON(content).check();
    assert.equal(schema.nodeFromJSON(content).textContent, '선택');
    assert.equal(content.content[0].type, 'bulletList');
    assert.equal(content.content[0].content[0].content[0].content[0].marks[0].type, 'bold');
    assert.throws(() => captureTemplate(stateAt(document, 4), 'c_source'), { code: 'TEMPLATE_SELECTION_REQUIRED' });
    assert.equal(schema.nodeFromJSON(captureTemplate(stateAt(document, 4), 'c_source', true).content).textContent, '앞선택뒤');
});

test('table cell selections become reusable valid tables, including merged cells', () => {
    const cell = (text, colspan = 1) => schema.node('tableCell', { colspan }, p(text));
    const table = schema.node('table', null, [schema.node('tableRow', null, [cell('A'), cell('B')]), schema.node('tableRow', null, [cell('Merged', 2)])]);
    const document = doc(table);
    let state = EditorState.create({ doc: document });
    state = state.apply(state.tr.setSelection(CellSelection.create(document, 2, 7)));
    const content = captureTemplate(state, 'c_source').content;
    schema.nodeFromJSON(content).check();
    assert.equal(content.content[0].type, 'table');
    assert.equal(schema.nodeFromJSON(content).textContent, 'AB');
    const whole = captureTemplate(state, 'c_source', true).content;
    assert.equal(whole.content[0].content[1].content[0].attrs.colspan, 2);
    validateContentTemplate({ name: 'Table', description: '', content: whole, assets: [] });
});

test('node capture retains image attributes and repeated insertion preserves regenerated anchor targets', () => {
    const document = doc(schema.node('image', { assetId: 'a_source', width: 80, align: 'left', alt: '그림' }));
    const state = EditorState.create({ doc: document, selection: NodeSelection.create(document, 0) });
    assert.equal(captureTemplate(state, 'c_source').content.content[0].attrs.width, 80);
    const template = prepareTemplateContent({ type: 'doc', content: [
        { type: 'heading', attrs: { id: 'n_title', level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Go', marks: [{ type: 'link', attrs: { href: 'epub:c_source#n_title' } }] }] },
    ] }, 'c_source').content;
    let next = stateAt(doc(p('')), 1);
    next = next.apply(templateInsertionTransaction(next, template, 'c_target'));
    next = next.apply(templateInsertionTransaction(next, template, 'c_target'));
    const ids = [], links = [];
    next.doc.descendants(node => { if (node.attrs.id) ids.push(node.attrs.id); for (const mark of node.marks) if (mark.type.name === 'link') links.push(mark.attrs.href); });
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(links.length, 2);
    for (const href of links) assert.ok(ids.includes(href.split('#')[1]));
});

test('template shortcut works with Korean physical-key input without conflicting with existing commands', () => {
    assert.equal(matchesShortcut({ key: 'ㅣ', code: 'KeyL', metaKey: true, ctrlKey: false, altKey: true, shiftKey: true }, shortcuts.templates), true);
    assert.equal(new Set(Object.values(shortcuts)).size, Object.keys(shortcuts).length);
});

test('partial selection inside a column or a list heading keeps a valid enclosing structure', () => {
    const columns = doc(schema.node('columns', null, [schema.node('column', null, p('앞선택뒤')), schema.node('column', null, p('다른 단'))]));
    const selected = captureTemplate(stateAt(columns, 4, 6), 'c_source').content;
    schema.nodeFromJSON(selected).check();
    validateContentTemplate({ name: 'Column', description: '', content: selected, assets: [] });
    assert.equal(schema.nodeFromJSON(selected).textContent, '선택');
    const heading = doc(schema.node('bulletList', null, schema.node('listItem', null, [p('앞'), schema.node('heading', { level: 2 }, schema.text('선택'))])));
    const listContent = captureTemplate(stateAt(heading, 6, 8), 'c_source').content;
    schema.nodeFromJSON(listContent).check();
    validateContentTemplate({ name: 'List heading', description: '', content: listContent, assets: [] });
    assert.equal(schema.nodeFromJSON(listContent).textContent, '선택');
});
