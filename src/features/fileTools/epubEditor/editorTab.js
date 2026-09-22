import { Extension } from '@tiptap/core';
import { AllSelection, EditorState, Plugin, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { sinkListItem, liftListItem } from '@tiptap/pm/schema-list';
import { addRowAfter, goToNextCell } from '@tiptap/pm/tables';
import { selectedIndentBlocks, updateParagraphIndent } from './paragraphIndent.js';
import { MAX_PARAGRAPH_INDENT } from '../../../../electron/epubEditor/paragraphIndent.js';

const CODE_INDENT = '    ';

function indentCodeLines(state, dispatch, backwards) {
    const { selection } = state;
    const { $from, $to } = selection;
    if (!$from.sameParent($to) || $from.parent.type.name !== 'codeBlock') return false;
    const text = $from.parent.textContent;
    const start = $from.parentOffset === 0 ? 0 : text.lastIndexOf('\n', $from.parentOffset - 1) + 1;
    const edits = [];
    for (let offset = start; offset <= $to.parentOffset;) {
        if (!selection.empty && offset === $to.parentOffset && offset !== start) break;
        const position = $from.start() + offset;
        if (backwards) {
            const prefix = text.slice(offset).match(/^(?:\t| {1,4})/)?.[0];
            if (prefix) edits.push({ position, remove: prefix.length });
        } else {
            edits.push({ position, remove: 0 });
        }
        const next = text.indexOf('\n', offset);
        if (next < 0) break;
        offset = next + 1;
    }
    if (!edits.length) return false;
    if (dispatch) {
        const tr = state.tr;
        for (const { position, remove } of edits.reverse()) {
            if (backwards) tr.delete(position, position + remove);
            else tr.insertText(CODE_INDENT, position);
        }
        tr.setSelection(selection.map(tr.doc, tr.mapping));
        dispatch(tr.scrollIntoView());
    }
    return true;
}

function navigateTable(state, dispatch, backwards) {
    if (goToNextCell(backwards ? -1 : 1)(state, dispatch)) return true;
    if (backwards) return false;
    return addRowAfter(state, dispatch && (tr => {
        // Append the row and move the caret in one transaction and undo step.
        const next = EditorState.create({ doc: tr.doc, selection: tr.selection });
        goToNextCell(1)(next, move => tr.setSelection(move.selection));
        dispatch(tr.scrollIntoView());
    }));
}

function indentParagraphs(state, dispatch, backwards) {
    const { selection } = state;
    if (!(selection instanceof TextSelection || selection instanceof AllSelection)) return false;
    if (!selectedIndentBlocks(state).length) return false;
    let supported = true;
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
        if (!selection.empty && selection.to === pos + 1) return false;
        if (node.type.spec.tableRole || ['listItem', 'bulletList', 'orderedList'].includes(node.type.name) ||
            (node.isTextblock && !['paragraph', 'heading'].includes(node.type.name))) {
            supported = false;
            return false;
        }
    });
    if (!supported) return false;
    const tr = state.tr;
    const changed = updateParagraphIndent({ tr, dispatch }, attrs => ({
        indentLevel: Math.max(0, Math.min(MAX_PARAGRAPH_INDENT, (attrs.indentLevel || 0) + (backwards ? -1 : 1))),
    }));
    if (changed && dispatch) dispatch(tr.scrollIntoView());
    // Keep the caret in the paragraph even when its indentation is at a limit.
    return true;
}

export function editorTabCommand(state, dispatch, backwards = false) {
    const apply = dispatch && (tr => dispatch(tr.docChanged ? closeHistory(tr) : tr));
    const { selection } = state;
    const { $from, $to } = selection;
    let triedList = false;
    // Resolve the innermost context first, including lists and code inside cells.
    for (let depth = $from.sharedDepth($to.pos); depth > 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.type.name === 'codeBlock' && selection instanceof TextSelection && indentCodeLines(state, apply, backwards)) return true;
        if (node.type.spec.tableRole) return navigateTable(state, apply, backwards);
        if (['listItem', 'bulletList', 'orderedList'].includes(node.type.name) && !triedList) {
            triedList = true;
            const command = backwards ? liftListItem(state.schema.nodes.listItem) : sinkListItem(state.schema.nodes.listItem);
            if (command(state, apply)) return true;
        }
    }
    return !triedList && indentParagraphs(state, apply, backwards);
}

export function handleEditorTab(view, event) {
    if (event.key !== 'Tab') return false;
    // Returning true here skips other editor keymaps but preserves native focus
    // navigation unless an editing command explicitly prevents the default.
    if (event.defaultPrevented || !view.editable || view.composing || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return true;
    if (event.target !== view.dom && event.target?.closest('input, textarea, select, button, audio, video, [contenteditable="false"]')) return true;
    if (editorTabCommand(view.state, tr => view.dispatch(tr), event.shiftKey)) event.preventDefault();
    return true;
}

export const EditorTab = Extension.create({
    name: 'editorTab',
    priority: 1000,
    addProseMirrorPlugins() {
        let escapeNextTab = false;
        const reset = () => { escapeNextTab = false; return false; };
        return [new Plugin({ props: { handleDOMEvents: {
            keydown(view, event) {
                if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && !view.composing) {
                    escapeNextTab = true;
                } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
                    const released = escapeNextTab;
                    escapeNextTab = false;
                    if (released && event.key === 'Tab') return true;
                }
                return handleEditorTab(view, event);
            },
            blur: reset,
            mousedown: reset,
        } } })];
    },
});
