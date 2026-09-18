import { Compartment, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
import { createTextCleanerScroll } from './textCleanerScroll';

const searchMatchEffect = StateEffect.define();
const searchMatchField = StateField.define({
    create: () => Decoration.none,
    update(matches, transaction) {
        if (transaction.docChanged) matches = Decoration.none;
        for (const effect of transaction.effects) {
            if (!effect.is(searchMatchEffect)) continue;
            const match = effect.value;
            matches = match && match.end > match.start
                ? Decoration.set([Decoration.mark({ class: 'text-cleaner-match' }).range(match.start, match.end)])
                : Decoration.none;
        }
        return matches;
    },
    provide: field => EditorView.decorations.from(field),
});

export function createTextCleanerEditor(parent, getOptions) {
    const configuration = new Compartment();
    let cachedDocument = null;
    let cachedText = '';
    let highlightedMatch = null;
    let resetting = false;

    const editorConfiguration = () => {
        const options = getOptions();
        return [
            EditorState.readOnly.of(Boolean(options.readOnly)),
            EditorView.contentAttributes.of({
                'aria-label': options.label,
                'aria-readonly': String(Boolean(options.readOnly)),
                spellcheck: 'false',
                autocorrect: 'off',
                autocapitalize: 'off',
            }),
        ];
    };
    const createState = text => EditorState.create({
        doc: text,
        extensions: [
            configuration.of(editorConfiguration()),
            EditorState.tabSize.of(4),
            EditorView.lineWrapping,
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            searchMatchField,
            EditorView.updateListener.of(update => {
                if (!update.docChanged || resetting) return;
                highlightedMatch = null;
                getOptions().onInput?.();
            }),
            EditorView.domEventHandlers({
                compositionstart() { getOptions().onCompositionStart?.(); },
                compositionend() { getOptions().onCompositionEnd?.(); },
            }),
        ],
    });
    const view = new EditorView({ parent, state: createState('') });
    const editor = view.scrollDOM;
    const scroll = createTextCleanerScroll(editor, () => getOptions().onScroll?.());
    const clampOffset = offset => Math.min(view.state.doc.length, Math.max(0, Math.round(offset) || 0));

    // Keep document access compatible with the cleaner without putting all text in the DOM.
    Object.defineProperties(editor, {
        value: {
            get() {
                if (cachedDocument !== view.state.doc) {
                    cachedDocument = view.state.doc;
                    cachedText = cachedDocument.toString();
                }
                return cachedText;
            },
            set(text) {
                const value = String(text ?? '');
                if (cachedDocument === view.state.doc && cachedText === value) return;
                resetting = true;
                try {
                    scroll.move(() => view.setState(createState(value)));
                    cachedDocument = view.state.doc;
                    cachedText = value;
                    highlightedMatch = null;
                } finally {
                    resetting = false;
                }
            },
        },
        textLength: { get: () => view.state.doc.length },
        lineCount: { get: () => view.state.doc.lines },
        selectionStart: { get: () => view.state.selection.main.from },
        selectionEnd: { get: () => view.state.selection.main.to },
        selectionDirection: {
            get: () => view.state.selection.main.anchor > view.state.selection.main.head ? 'backward' : 'forward',
        },
    });
    editor.focus = options => view.contentDOM.focus(options);
    editor.blur = () => view.contentDOM.blur();
    editor.replaceText = change => {
        view.dispatch({
            changes: change,
            selection: EditorSelection.cursor(change.from + change.insert.length),
            annotations: isolateHistory.of('full'),
            userEvent: 'input.replace',
        });
        return true;
    };
    editor.setSelectionRange = (start, end, direction = 'forward') => {
        const from = clampOffset(start);
        const to = Math.max(from, clampOffset(end));
        view.dispatch({ selection: direction === 'backward'
            ? EditorSelection.single(to, from) : EditorSelection.single(from, to) });
    };
    editor.centerAtTextOffset = offset => {
        scroll.move(() => {
            view.dispatch({ effects: EditorView.scrollIntoView(clampOffset(offset), { y: 'center' }) });
        });
        return true;
    };
    editor.setScrollTop = top => scroll.move(() => { editor.scrollTop = top; });
    editor.textOffsetAtScrollCenter = () => {
        const bounds = editor.getBoundingClientRect();
        return view.posAtCoords({
            x: bounds.left + 20,
            y: bounds.top + editor.clientHeight / 2,
        }, false) ?? 0;
    };
    editor.setSearchMatch = match => {
        const next = match ? { start: clampOffset(match.start), end: clampOffset(match.end) } : null;
        if (next?.start === highlightedMatch?.start && next?.end === highlightedMatch?.end) return;
        highlightedMatch = next;
        view.dispatch({ effects: searchMatchEffect.of(next) });
    };

    return {
        element: editor,
        configure: () => view.dispatch({ effects: configuration.reconfigure(editorConfiguration()) }),
        destroy() {
            scroll.destroy();
            view.destroy();
        },
    };
}
