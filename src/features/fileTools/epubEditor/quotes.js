import { Extension } from '@tiptap/core';
import { AllSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { insertCharacter } from './richFormatting.js';
import { BRACKET_PAIRS } from '../../../editorTextPairs.js';

export const QUOTE_CHARACTERS = [
    { command: 'openDoubleQuote', value: '“' },
    { command: 'closeDoubleQuote', value: '”' },
    { command: 'openSingleQuote', value: '‘' },
    { command: 'closeSingleQuote', value: '’' },
];

export const QUOTE_PAIRS = [
    { command: 'wrapDoubleQuotes', shortcutCommand: 'doubleQuotes', open: '“', close: '”', display: '“…”' },
    { command: 'wrapSingleQuotes', shortcutCommand: 'singleQuotes', open: '‘', close: '’', display: '‘…’' },
];

const quotePairKey = new PluginKey('quotePairs');
const typedPairs = [{ open: '"', close: '"' }, { open: "'", close: "'" }, ...BRACKET_PAIRS];

export function createQuotePairPlugin(editor) {
    return new Plugin({
        key: quotePairKey,
        props: {
            handleKeyDown(view, event) {
                const pair = typedPairs.find(item => item.open === event.key);
                if (!pair || view.state.selection.empty || !view.editable || view.composing || event.defaultPrevented ||
                    event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.getModifierState?.('AltGraph')) return false;
                if (event.target !== view.dom && event.target?.closest('input, textarea, select, button, audio, video, [contenteditable="false"]')) return false;
                return wrapQuotePair(editor, pair);
            },
        },
        state: {
            init: () => [],
            apply(tr, pairs) {
                const meta = tr.getMeta(quotePairKey);
                let next = pairs.filter(pair => pair !== meta?.skip);
                if (tr.docChanged) {
                    next = next.flatMap(pair => {
                        const from = tr.mapping.mapResult(pair.from, 1);
                        const to = tr.mapping.mapResult(pair.to, 1);
                        if (from.deleted || to.deleted || from.pos >= to.pos ||
                            tr.doc.textBetween(from.pos, from.pos + pair.open.length) !== pair.open ||
                            tr.doc.textBetween(to.pos, to.pos + pair.close.length) !== pair.close) return [];
                        return [{ ...pair, from: from.pos, to: to.pos }];
                    });
                }
                return meta?.add ? [...next, meta.add] : next;
            },
        },
    });
}

export const QuotePairs = Extension.create({
    name: 'quotePairs',
    addProseMirrorPlugins() {
        return [createQuotePairPlugin(this.editor)];
    },
});

function quoteSelection(state) {
    const selection = state.selection;
    return selection instanceof AllSelection ? TextSelection.between(selection.$from, selection.$to) : selection;
}

export function canInsertQuotes(editor) {
    if (!editor || !editor.isEditable || editor.view.composing) return false;
    const selection = quoteSelection(editor.state);
    return selection instanceof TextSelection && selection.$from.parent.inlineContent && selection.$to.parent.inlineContent;
}

export function insertQuote(editor, command) {
    const quote = QUOTE_CHARACTERS.find(item => item.command === command);
    if (!quote || !canInsertQuotes(editor)) return false;
    const pair = !editor.state.selection.empty && QUOTE_PAIRS.find(item => item.open === quote.value);
    return pair ? wrapWithQuotes(editor, pair.command) : insertCharacter(editor, quote.value);
}

export function insertQuotePair(editor, command) {
    const pair = QUOTE_PAIRS.find(item => item.shortcutCommand === command);
    if (!pair || !canInsertQuotes(editor)) return false;
    const { state } = editor;
    const pending = state.selection.empty && quotePairKey.getState(state)?.find(item => item.to === state.selection.from && item.close === pair.close);
    if (!pending) return wrapWithQuotes(editor, pair.command);
    const tr = closeHistory(state.tr).setSelection(TextSelection.create(state.doc, pending.to + pair.close.length));
    tr.setMeta(quotePairKey, { skip: pending }).setMeta('addToHistory', false).scrollIntoView();
    editor.view.dispatch(tr);
    return true;
}

export function wrapWithQuotes(editor, command) {
    return wrapQuotePair(editor, QUOTE_PAIRS.find(item => item.command === command));
}

function wrapQuotePair(editor, pair) {
    if (!pair || !canInsertQuotes(editor)) return false;
    return editor.commands.command(({ state, tr, dispatch }) => {
        if (!dispatch) return true;
        const { schema } = state;
        const selection = quoteSelection(state);
        const { from, to, anchor, head, $from, $to } = selection;
        closeHistory(tr);
        if (selection.empty) {
            const marks = state.storedMarks || $from.marks();
            tr.insert(from, schema.text(pair.open + pair.close, marks));
            tr.setSelection(TextSelection.create(tr.doc, from + pair.open.length));
            tr.ensureMarks(marks);
        } else {
            tr.insert(to, schema.text(pair.close, $to.marks()));
            tr.insert(from, schema.text(pair.open, $from.marks()));
            tr.setSelection(TextSelection.create(tr.doc, anchor + pair.open.length, head + pair.open.length));
        }
        if (QUOTE_PAIRS.some(item => item.open === pair.open)) tr.setMeta(quotePairKey, { add: { from, to: to + pair.open.length, open: pair.open, close: pair.close } });
        tr.scrollIntoView();
        return true;
    });
}
