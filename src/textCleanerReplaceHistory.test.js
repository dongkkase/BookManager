import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { EditorSelection, EditorState } from '@codemirror/state';
import { history, isolateHistory, redo, undo, undoDepth } from '@codemirror/commands';

test('바꾸기 트랜잭션은 이전 편집과 분리되어 한 번에 실행 취소와 다시 실행된다', () => {
    const source = fs.readFileSync(new URL('./textCleanerEditor.js', import.meta.url), 'utf8');
    const method = source.slice(source.indexOf('    editor.replaceText ='), source.indexOf('    editor.setSelectionRange ='));
    const editor = {};
    const view = {
        state: EditorState.create({ doc: 'cat cat', extensions: [history()] }),
        dispatch(spec) { view.state = view.state.update(spec).state; },
    };
    vm.runInNewContext(method, { editor, view, EditorSelection, isolateHistory });
    view.dispatch({ changes: { from: 7, insert: '!' }, userEvent: 'input.type' });
    editor.replaceText({ from: 0, to: 7, insert: 'dog dog' });
    assert.equal(view.state.doc.toString(), 'dog dog!');
    assert.equal(undoDepth(view.state), 2);
    assert.equal(undo(view), true);
    assert.equal(view.state.doc.toString(), 'cat cat!');
    assert.equal(redo(view), true);
    assert.equal(view.state.doc.toString(), 'dog dog!');
});
