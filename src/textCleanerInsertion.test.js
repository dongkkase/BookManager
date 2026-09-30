import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorSelection, EditorState } from '@codemirror/state';
import { history, redo, undo, undoDepth } from '@codemirror/commands';
import { handleTextCleanerQuoteKey, insertTextCleanerContent, TEXT_CLEANER_QUOTE_PAIRS, textCleanerQuotePairs } from './textCleanerInsertion.js';
import { BRACKET_PAIRS } from './editorTextPairs.js';

function fixture(doc = '앞 문장\n다음 문장 뒤', selection = EditorSelection.single(2, 10), readOnly = false) {
    const view = {
        state: EditorState.create({ doc, selection, extensions: [history(), textCleanerQuotePairs, EditorState.readOnly.of(readOnly), EditorState.allowMultipleSelections.of(true)] }),
        dispatch: spec => { view.state = view.state.update(spec).state; },
    };
    return view;
}

test('여는 따옴표와 괄호 입력은 여러 줄 선택과 역방향 선택을 보존하고 한 번에 실행 취소한다', () => {
    for (const pair of [...TEXT_CLEANER_QUOTE_PAIRS, ...BRACKET_PAIRS]) {
        const view = fixture('앞 문장\n다음 문장 뒤', EditorSelection.single(10, 2));
        const original = view.state.doc.toString();
        assert.equal(handleTextCleanerQuoteKey({ key: pair.open }, view), true);
        assert.equal(view.state.doc.toString(), original.slice(0, 2) + pair.open + original.slice(2, 10) + pair.close + original.slice(10));
        assert.equal(view.state.selection.main.anchor, 11);
        assert.equal(view.state.selection.main.head, 3);
        assert.equal(undoDepth(view.state), 1);
        assert.equal(undo(view), true);
        assert.equal(view.state.doc.toString(), original);
        assert.equal(redo(view), true);
        assert.equal(view.state.doc.sliceString(2, 3), pair.open);
    }
});

const shortcutEvent = (double = false, modifiers = {}) => ({
    key: double ? '"' : "'", code: 'Quote', ctrlKey: true, metaKey: false, altKey: false, shiftKey: double, ...modifiers,
});

test('괄호는 빈 선택·닫는 기호·조합 입력·읽기 전용을 가로채지 않는다', () => {
    for (const pair of BRACKET_PAIRS) {
        for (const event of [{ key: pair.close }, { key: pair.open, ctrlKey: true }, { key: pair.open, isComposing: true }, { key: pair.open, altKey: true }]) {
            const view = fixture();
            assert.equal(handleTextCleanerQuoteKey(event, view), false);
            assert.equal(undoDepth(view.state), 0);
        }
        for (const view of [fixture('본문', EditorSelection.single(1)), fixture('본문', EditorSelection.single(0, 2), true)]) {
            assert.equal(handleTextCleanerQuoteKey({ key: pair.open }, view), false);
        }
    }
});

test('따옴표 단축키는 Ctrl과 Cmd 및 한글 물리 키를 지원하고 역방향 선택을 감싼다', () => {
    for (const double of [false, true]) {
        for (const modifiers of [{ ctrlKey: true }, { ctrlKey: false, metaKey: true }]) {
            const view = fixture('앞 본문 뒤', EditorSelection.single(4, 2));
            const event = shortcutEvent(double, { ...modifiers, key: 'ㅁ' });
            assert.equal(handleTextCleanerQuoteKey(event, view), true);
            assert.equal(view.state.doc.toString(), double ? '앞 “본문” 뒤' : '앞 ‘본문’ 뒤');
            assert.deepEqual([view.state.selection.main.anchor, view.state.selection.main.head], [5, 3]);
            assert.equal(undoDepth(view.state), 1);
            assert.equal(undo(view), true);
            assert.equal(view.state.doc.toString(), '앞 본문 뒤');
            assert.equal(redo(view), true);
        }
    }
});

test('단축키는 쌍 안에 커서를 두고 입력 뒤 닫는 따옴표를 중복 삽입하지 않는다', () => {
    for (const double of [false, true]) {
        const view = fixture('앞뒤', EditorSelection.single(1));
        const event = shortcutEvent(double);
        handleTextCleanerQuoteKey(event, view);
        assert.equal(view.state.selection.main.head, 2);
        view.dispatch({ changes: { from: 2, insert: '내용' }, selection: EditorSelection.single(4), userEvent: 'input.type' });
        const before = view.state.doc;
        const depth = undoDepth(view.state);
        assert.equal(handleTextCleanerQuoteKey(event, view), true);
        assert.equal(view.state.doc, before);
        assert.equal(view.state.selection.main.head, 5);
        assert.equal(undoDepth(view.state), depth);
        view.dispatch({ changes: { from: 5, insert: '밖' }, selection: EditorSelection.single(6), userEvent: 'input.type' });
        assert.equal(view.state.doc.toString(), double ? '앞“내용”밖뒤' : '앞‘내용’밖뒤');
        undo(view);
        assert.equal(view.state.doc.toString(), before.toString());
        undo(view);
        assert.equal(view.state.doc.toString(), double ? '앞“”뒤' : '앞‘’뒤');
        undo(view);
        assert.equal(view.state.doc.toString(), '앞뒤');
    }
});

test('중첩 따옴표의 추적 위치는 앞과 안쪽 편집을 따라가고 같은 종류도 구별한다', () => {
    for (const innerDouble of [false, true]) {
        const view = fixture('', EditorSelection.single(0));
        handleTextCleanerQuoteKey(shortcutEvent(true), view);
        insertTextCleanerContent(view, innerDouble ? '“' : '‘', true);
        view.dispatch({ changes: { from: 2, insert: '내용' }, selection: EditorSelection.single(4), userEvent: 'input.type' });
        view.dispatch({ changes: { from: 0, insert: '앞' } });
        assert.equal(view.state.selection.main.head, 5);
        const before = view.state.doc;
        handleTextCleanerQuoteKey(shortcutEvent(innerDouble), view);
        assert.equal(view.state.selection.main.head, 6);
        handleTextCleanerQuoteKey(shortcutEvent(true), view);
        assert.equal(view.state.selection.main.head, 7);
        assert.equal(view.state.doc, before);
        assert.deepEqual(view.state.field(textCleanerQuotePairs), []);
    }
});

test('기존·교체·실행 취소 후 복구·이미 건너뛴 따옴표는 자동 닫기 대상으로 취급하지 않는다', () => {
    for (const reset of [
        view => { view.dispatch({ changes: { from: 1, to: 2, insert: '’' } }); },
        view => { view.dispatch({ changes: { from: 0, to: 1, insert: '‘' } }); },
        view => { undo(view); redo(view); },
        view => { handleTextCleanerQuoteKey(shortcutEvent(), view); },
        view => { view.state = fixture('‘’', EditorSelection.single(1)).state; },
    ]) {
        const view = fixture('', EditorSelection.single(0));
        handleTextCleanerQuoteKey(shortcutEvent(), view);
        reset(view);
        view.dispatch({ selection: EditorSelection.single(1) });
        handleTextCleanerQuoteKey(shortcutEvent(), view);
        assert.equal(view.state.doc.toString(), '‘‘’’');
    }
});

test('따옴표 단축키는 읽기 전용·조합 중·추가 수식 키·기존 Alt 조합에서 실행하지 않는다', () => {
    for (const modifiers of [{ altKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
        { getModifierState: key => key === 'AltGraph' }, { key: '[', code: 'BracketLeft', altKey: true }]) {
        const view = fixture();
        assert.equal(handleTextCleanerQuoteKey(shortcutEvent(false, modifiers), view), false);
        assert.equal(undoDepth(view.state), 0);
    }
    for (const view of [fixture('본문', EditorSelection.single(1), true), { ...fixture(), composing: true }]) {
        assert.equal(handleTextCleanerQuoteKey(shortcutEvent(), view), false);
    }
});

test('키보드 따옴표는 읽기 전용·조합 입력·단축키·빈 선택을 가로채지 않는다', () => {
    for (const event of [
        { key: '”' }, { key: 'a' }, { key: '"', ctrlKey: true }, { key: '"', metaKey: true },
        { key: '"', altKey: true }, { key: '"', isComposing: true }, { key: '"', keyCode: 229 },
        { key: '"', defaultPrevented: true }, { key: '"', getModifierState: () => true },
    ]) {
        const view = fixture();
        assert.equal(handleTextCleanerQuoteKey(event, view), false);
        assert.equal(undoDepth(view.state), 0);
    }
    for (const view of [fixture('본문', EditorSelection.single(0)), fixture('본문', EditorSelection.single(0, 2), true), { ...fixture(), composing: true }]) {
        assert.equal(handleTextCleanerQuoteKey({ key: '"' }, view), false);
        assert.equal(undoDepth(view.state), 0);
    }
});

test('삽입 메뉴는 선택이 없으면 문자 또는 따옴표 쌍을 삽입하고 커서를 안에 둔다', () => {
    const view = fixture('본문', EditorSelection.single(1));
    assert.equal(insertTextCleanerContent(view, '“'), true);
    assert.equal(view.state.doc.toString(), '본“문');
    assert.equal(insertTextCleanerContent(view, '「', true), true);
    assert.equal(view.state.doc.toString(), '본“「」문');
    assert.equal(view.state.selection.main.head, 3);
    assert.equal(insertTextCleanerContent(view, '별★\n😊'), true);
    assert.equal(view.state.doc.toString(), '본“「별★\n😊」문');
    assert.equal(undo(view), true);
    assert.equal(view.state.doc.toString(), '본“「」문');
});

test('문자 삽입은 선택을 교체하고 이전 직접 편집과 독립적으로 실행 취소한다', () => {
    const view = fixture('안녕', EditorSelection.single(0, 2));
    view.dispatch({ changes: { from: 2, insert: '!' }, userEvent: 'input.type' });
    view.dispatch({ selection: EditorSelection.single(0, 2) });
    insertTextCleanerContent(view, '★');
    assert.equal(view.state.doc.toString(), '★!');
    assert.equal(undoDepth(view.state), 2);
    assert.equal(undo(view), true);
    assert.equal(view.state.doc.toString(), '안녕!');
});

test('따옴표 메뉴는 선택을 지우지 않으며 여러 선택에도 적용한다', () => {
    const view = fixture('하나 둘', EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 4)]));
    assert.equal(insertTextCleanerContent(view, '“'), true);
    assert.equal(view.state.doc.toString(), '“하나” “둘”');
    assert.deepEqual(view.state.selection.ranges.map(range => [range.from, range.to]), [[1, 3], [6, 7]]);
    assert.equal(undoDepth(view.state), 1);
    assert.equal(insertTextCleanerContent(fixture('본문', EditorSelection.single(0, 2), true), '★'), false);
});
