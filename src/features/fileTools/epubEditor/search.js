import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';

export const searchPluginKey = new PluginKey('epubEditorSearch');
const replacementMeta = 'epubEditorSearchReplacement';

export function findDocumentMatches(document, query, { caseSensitive = false } = {}) {
    if (!query) return [];
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
    const matches = [];
    document.descendants((node, position) => {
        if (!node.isTextblock) return;
        let text = '';
        let start = position + 1;
        const collect = () => {
            expression.lastIndex = 0;
            let match;
            while ((match = expression.exec(text))) {
                matches.push({ from: start + match.index, to: start + match.index + match[0].length });
            }
            text = '';
        };
        node.forEach((child, offset) => {
            if (child.isText) {
                if (!text) start = position + 1 + offset;
                text += child.text;
            } else {
                collect();
            }
        });
        collect();
        return false;
    });
    return matches;
}

export function selectedSearchIndex(matches, selection) {
    return matches.findIndex(match => match.from === selection.from && match.to === selection.to);
}

export function adjacentSearchIndex(matches, selection, direction = 1) {
    if (!matches.length) return -1;
    const current = selectedSearchIndex(matches, selection);
    if (current >= 0) return (current + (direction < 0 ? -1 : 1) + matches.length) % matches.length;
    if (direction < 0) {
        for (let index = matches.length - 1; index >= 0; index -= 1) {
            if (matches[index].to <= selection.from) return index;
        }
        return matches.length - 1;
    }
    const next = matches.findIndex(match => match.from >= selection.to);
    return next < 0 ? 0 : next;
}

function matchDecoration(match, active) {
    return Decoration.inline(match.from, match.to, { class: `ee-search-match${active ? ' is-active' : ''}` });
}

function searchState(document, selection, query, caseSensitive, matches) {
    const activeIndex = selectedSearchIndex(matches, selection);
    return {
        query, caseSensitive, matches, activeIndex,
        decorations: matches.length ? DecorationSet.create(document, matches.map((match, index) => matchDecoration(match, index === activeIndex))) : DecorationSet.empty,
    };
}

export function createSearchPlugin() {
    return new Plugin({
        key: searchPluginKey,
        state: {
            init: (_, state) => searchState(state.doc, state.selection, '', false, []),
            apply(transaction, previous, _oldState, nextState) {
                const configuration = transaction.getMeta(searchPluginKey);
                const query = configuration?.query ?? previous.query;
                const caseSensitive = configuration?.caseSensitive ?? previous.caseSensitive;
                const changed = transaction.docChanged || query !== previous.query || caseSensitive !== previous.caseSensitive;
                if (!changed && !transaction.selectionSet) return previous;
                if (!changed) {
                    const activeIndex = selectedSearchIndex(previous.matches, nextState.selection);
                    if (activeIndex === previous.activeIndex) return previous;
                    const indexes = [previous.activeIndex, activeIndex].filter(index => index >= 0);
                    const remove = indexes.flatMap(index => {
                        const match = previous.matches[index];
                        return previous.decorations.find(match.from, match.to).filter(decoration => decoration.from === match.from && decoration.to === match.to);
                    });
                    const add = indexes.map(index => matchDecoration(previous.matches[index], index === activeIndex));
                    return { ...previous, activeIndex, decorations: previous.decorations.remove(remove).add(nextState.doc, add) };
                }
                const matches = findDocumentMatches(nextState.doc, query, { caseSensitive });
                return searchState(nextState.doc, nextState.selection, query, caseSensitive, matches);
            },
        },
        props: { decorations: state => searchPluginKey.getState(state)?.decorations },
        appendTransaction(transactions, _oldState, nextState) {
            if (transactions.some(transaction => transaction.getMeta(replacementMeta))) {
                return closeHistory(nextState.tr).setMeta('addToHistory', false);
            }
            return null;
        },
    });
}

export const SearchHighlights = Extension.create({
    name: 'epubEditorSearch',
    addProseMirrorPlugins() { return [createSearchPlugin()]; },
});

export function configureEditorSearch(editor, query, caseSensitive = false) {
    if (!editor || editor.isDestroyed) return;
    const { state } = editor;
    if (!query && !searchPluginKey.getState(state)?.query) return;
    const matches = findDocumentMatches(state.doc, query, { caseSensitive });
    const current = selectedSearchIndex(matches, state.selection);
    const nearest = matches.findIndex(match => match.from >= state.selection.from);
    const match = matches[current >= 0 ? current : nearest >= 0 ? nearest : 0];
    const transaction = state.tr.setMeta(searchPluginKey, { query, caseSensitive }).setMeta('addToHistory', false);
    if (match) transaction.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView();
    editor.view.dispatch(transaction);
}

export function moveEditorSearch(editor, direction = 1) {
    if (!editor || editor.isDestroyed) return false;
    const matches = searchPluginKey.getState(editor.state)?.matches || [];
    const match = matches[adjacentSearchIndex(matches, editor.state.selection, direction)];
    if (!match) return false;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView().setMeta('addToHistory', false));
    return true;
}

export function replaceSearchMatches(state, matches, replacement) {
    const transaction = state.tr;
    let count = 0;
    for (const match of [...matches].sort((a, b) => b.from - a.from)) {
        if (state.doc.textBetween(match.from, match.to) === replacement) continue;
        if (replacement) {
            const marks = state.doc.nodeAt(match.from)?.marks || [];
            transaction.replaceWith(match.from, match.to, state.schema.text(replacement, marks));
        } else {
            transaction.delete(match.from, match.to);
        }
        count += 1;
    }
    if (count) closeHistory(transaction).setMeta(replacementMeta, true);
    return { transaction, count };
}

export function replaceEditorSearch(editor, replacement, all = false) {
    if (!editor || editor.isDestroyed || !editor.isEditable || editor.view.composing) return 0;
    const search = searchPluginKey.getState(editor.state);
    if (!search?.matches.length) return 0;
    const selected = search.matches[selectedSearchIndex(search.matches, editor.state.selection)];
    if (!all && !selected) {
        moveEditorSearch(editor);
        return 0;
    }
    const { transaction, count } = replaceSearchMatches(editor.state, all ? search.matches : [selected], replacement);
    if (!all) {
        const after = transaction.mapping.map(selected.to, 1);
        const matches = findDocumentMatches(transaction.doc, search.query, { caseSensitive: search.caseSensitive });
        const next = matches.find(match => match.from >= after) || matches[0];
        transaction.setSelection(TextSelection.create(transaction.doc, next?.from ?? after, next?.to ?? after));
    }
    if (count || transaction.selectionSet) editor.view.dispatch(transaction.scrollIntoView());
    return count;
}
