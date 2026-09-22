import React, { useEffect, useRef } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';

const highlight = HighlightStyle.define([
    { tag: [tags.tagName, tags.typeName, tags.className], color: '#94d5ae' },
    { tag: [tags.attributeName, tags.propertyName], color: '#adc9ff' },
    { tag: [tags.string, tags.color, tags.number, tags.unit], color: '#f1ce91' },
    { tag: [tags.keyword, tags.modifier, tags.meta], color: '#d4afff' },
    { tag: tags.comment, color: '#9ba6b4', fontStyle: 'italic' },
    { tag: [tags.punctuation, tags.operator], color: '#bbc5d3' },
]);

export default function CodeEditor({ states, stateKey, value, onChange, language = 'css', readOnly = false, label, apiRef }) {
    const host = useRef(null);
    const view = useRef(null);
    const syncing = useRef(false);
    const change = useRef(onChange);
    change.current = onChange;
    useEffect(() => {
        view.current = new EditorView({
            parent: host.current,
            dispatchTransactions(transactions, current) { current.update(transactions); if (!readOnly && !syncing.current && transactions.some(transaction => transaction.docChanged)) change.current?.(current.state.doc.toString()); },
            state: states?.get(stateKey)?.doc.toString() === value ? states.get(stateKey) : EditorState.create({ doc: value, extensions: [
                language === 'css' ? css() : html(), lineNumbers(), history(), drawSelection(),
                highlightActiveLine(), bracketMatching(), syntaxHighlighting(highlight),
                keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
                EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
                EditorView.contentAttributes.of({ 'aria-label': label, role: 'textbox', 'aria-multiline': 'true', ...(readOnly ? { tabindex: '0', 'aria-readonly': 'true' } : {}) }),
                EditorState.tabSize.of(4), indentUnit.of('    '), EditorView.lineWrapping,

                EditorView.theme({
                    '&': { height: '100%', backgroundColor: '#1c232b', color: '#e4e8ef', fontSize: '13px' },
                    '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', lineHeight: '1.7' },
                    '.cm-content': { padding: '12px 0', caretColor: '#ffffff' },
                    '.cm-gutters': { backgroundColor: '#202933', color: '#a6b0bd', border: 'none' },
                    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#ffffff08' },
                    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#466482' },
                    '.cm-cursor': { borderLeftColor: '#fff' },
                    '&.cm-focused': { outline: '1px solid #94bba0' },
                }, { dark: true }),
            ] }),
        });
        if (apiRef) apiRef.current = {
            selectedText: () => view.current.state.sliceDoc(view.current.state.selection.main.from, view.current.state.selection.main.to),
            replace: text => {
                if (readOnly) return;
                const current = view.current;
                current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: text }, selection: { anchor: text.length }, annotations: isolateHistory.of('full'), scrollIntoView: true });
            },
            focus: () => view.current?.focus(),
        };
        return () => { if (apiRef) apiRef.current = null; if (!readOnly) states?.set(stateKey, view.current.state); view.current.destroy(); view.current = null; };
    }, [language, readOnly, label]);
    useEffect(() => {
        const current = view.current;
        if (current && current.state.doc.toString() !== value) {
            syncing.current = true;
            try { current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) }); }
            finally { syncing.current = false; }
        }
    }, [value]);
    return <div className="ee-code-editor" ref={host} />;
}
