import { EditorSelection, MapMode, StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { BRACKET_PAIRS } from './editorTextPairs.js';
import { matchesShortcut, shortcuts } from './features/fileTools/epubEditor/shortcuts.js';

export const TEXT_CLEANER_QUOTE_PAIRS = [
    { open: '“', close: '”', shortcutCommand: 'doubleQuotes' },
    { open: '‘', close: '’', shortcutCommand: 'singleQuotes' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '「', close: '」' },
    { open: '『', close: '』' },
];

const textPairs = [...TEXT_CLEANER_QUOTE_PAIRS, ...BRACKET_PAIRS];
const quotePairsEffect = StateEffect.define();
export const textCleanerQuotePairs = StateField.define({
    create: () => [],
    update(pairs, transaction) {
        let next = pairs;
        if (transaction.docChanged) {
            next = pairs.flatMap(pair => {
                const from = transaction.changes.mapPos(pair.from, 1, MapMode.TrackAfter);
                const to = transaction.changes.mapPos(pair.to, 1, MapMode.TrackAfter);
                if (from === null || to === null || from >= to
                    || transaction.newDoc.sliceString(from, from + pair.open.length) !== pair.open
                    || transaction.newDoc.sliceString(to, to + pair.close.length) !== pair.close) return [];
                return [{ ...pair, from, to }];
            });
        }
        for (const effect of transaction.effects) {
            if (!effect.is(quotePairsEffect)) continue;
            next = next.filter(pair => pair !== effect.value.skip).concat(effect.value.add || []);
        }
        return next;
    },
});

export function insertTextCleanerContent(view, value, pair = false) {
    if (view.state.readOnly || view.composing || typeof value !== 'string' || !value) return false;
    const quote = textPairs.find(item => item.open === value);
    const change = view.state.changeByRange(range => {
        if (quote && (pair || !range.empty)) {
            return {
                changes: range.empty
                    ? { from: range.from, insert: quote.open + quote.close }
                    : [{ from: range.from, insert: quote.open }, { from: range.to, insert: quote.close }],
                range: EditorSelection.range(range.anchor + quote.open.length, range.head + quote.open.length),
            };
        }
        return {
            changes: { from: range.from, to: range.to, insert: value },
            range: EditorSelection.cursor(range.from + value.length),
        };
    });
    const addedPairs = quote?.shortcutCommand ? view.state.selection.ranges.filter(range => pair || !range.empty).map(range => ({
        from: change.changes.mapPos(range.from, -1),
        to: change.changes.mapPos(range.to, 1) - quote.close.length,
        open: quote.open, close: quote.close,
    })) : [];
    view.dispatch({ ...change, effects: quotePairsEffect.of({ add: addedPairs }), annotations: isolateHistory.of('full'), userEvent: 'input.insert', scrollIntoView: true });
    return true;
}

export function handleTextCleanerQuoteKey(event, view) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229
        || view.state.readOnly || view.composing || event.altKey || event.getModifierState?.('AltGraph')) return false;
    if (event.ctrlKey || event.metaKey) {
        const quote = TEXT_CLEANER_QUOTE_PAIRS.find(pair => pair.shortcutCommand && matchesShortcut(event, shortcuts[pair.shortcutCommand]));
        if (!quote) return false;
        const { selection } = view.state;
        const pending = selection.ranges.length === 1 && selection.main.empty
            && view.state.field(textCleanerQuotePairs, false)?.find(pair => pair.to === selection.main.from && pair.close === quote.close);
        if (pending) {
            view.dispatch({
                selection: EditorSelection.cursor(pending.to + pending.close.length),
                effects: quotePairsEffect.of({ skip: pending }),
                annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full')],
                scrollIntoView: true,
            });
            return true;
        }
        return insertTextCleanerContent(view, quote.open, true);
    }
    if (view.state.selection.main.empty || !textPairs.some(pair => pair.open === event.key)) return false;
    return insertTextCleanerContent(view, event.key, true);
}
