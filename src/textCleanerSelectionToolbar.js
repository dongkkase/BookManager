import { insertTextCleanerContent, TEXT_CLEANER_QUOTE_PAIRS } from './textCleanerInsertion.js';

export function textCleanerToolbarPosition(anchor, editor, toolbar, viewport) {
    const left = Math.max(8, editor.left + 8);
    const right = Math.min(viewport.width - 8, editor.right - 8);
    const top = Math.max(8, editor.top + 8);
    const bottom = Math.min(viewport.height - 8, editor.bottom - 8);
    if (!anchor || right <= left || bottom <= top
        || anchor.bottom < Math.max(0, editor.top) || anchor.top > Math.min(viewport.height, editor.bottom)
        || anchor.right < Math.max(0, editor.left) || anchor.left > Math.min(viewport.width, editor.right)) return null;
    const width = Math.min(toolbar.width, right - left);
    const above = anchor.top - toolbar.height - 8;
    return {
        left: Math.max(left, Math.min(anchor.left - width / 2, right - width)),
        top: Math.max(top, Math.min(above >= top ? above : anchor.bottom + 8, bottom - toolbar.height)),
    };
}

export function createTextCleanerSelectionToolbar(view, getOptions) {
    const document = view.dom.ownerDocument;
    const window = document.defaultView;
    const toolbar = document.createElement('div');
    toolbar.className = 'text-cleaner-selection-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.hidden = true;
    document.body.appendChild(toolbar);
    let frame = null;
    let selecting = false;
    let dismissed = null;
    let destroyed = false;
    const hide = () => { toolbar.hidden = true; };
    const dismiss = () => {
        dismissed = view.state.selection;
        hide();
    };
    const buttons = TEXT_CLEANER_QUOTE_PAIRS.map(pair => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${pair.open}…${pair.close}`;
        button.addEventListener('click', () => {
            if (view.state.selection.main.empty || !getOptions().quoteToolbar) return;
            if (insertTextCleanerContent(view, pair.open, true)) {
                dismiss();
                view.focus();
            }
        });
        toolbar.appendChild(button);
        return button;
    });
    toolbar.addEventListener('mousedown', event => event.preventDefault());
    toolbar.addEventListener('keydown', event => {
        const index = buttons.indexOf(event.target);
        if (index < 0) return;
        const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length
            : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
        if (next !== null) {
            event.preventDefault();
            buttons[next].focus();
        }
    });
    const refresh = () => {
        frame = null;
        if (destroyed) return;
        const options = getOptions().quoteToolbar;
        const selection = view.state.selection.main;
        if (!options || selecting || view.composing || view.state.readOnly || selection.empty
            || dismissed?.eq(view.state.selection) || !document.hasFocus()
            || (!view.hasFocus && !toolbar.contains(document.activeElement)) || !view.dom.getClientRects().length) {
            hide();
            return;
        }
        const bounds = view.scrollDOM.getBoundingClientRect();
        const anchor = view.coordsAtPos(selection.head, selection.head > selection.anchor ? -1 : 1);
        toolbar.setAttribute('aria-label', options.label);
        buttons.forEach((button, index) => {
            const label = options.quoteLabel(TEXT_CLEANER_QUOTE_PAIRS[index]);
            button.title = label;
            button.setAttribute('aria-label', label);
        });
        toolbar.style.maxWidth = `${Math.max(0, Math.min(bounds.width - 16, window.innerWidth - 16))}px`;
        toolbar.hidden = false;
        const position = textCleanerToolbarPosition(anchor, bounds, toolbar.getBoundingClientRect(), {
            width: window.innerWidth, height: window.innerHeight,
        });
        if (!position) return hide();
        toolbar.style.left = `${position.left}px`;
        toolbar.style.top = `${position.top}px`;
    };
    const schedule = () => {
        if (!destroyed && frame === null) frame = window.requestAnimationFrame(refresh);
    };
    const pointerDown = event => {
        if (view.contentDOM.contains(event.target)) {
            selecting = true;
            dismissed = null;
            hide();
        } else if (!toolbar.contains(event.target)) {
            dismiss();
        }
    };
    const pointerUp = () => {
        selecting = false;
        schedule();
    };
    const escape = event => {
        if (event.key !== 'Escape' || event.isComposing || toolbar.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        const focused = toolbar.contains(document.activeElement);
        dismiss();
        if (focused) view.focus();
    };
    const listeners = [
        [document, 'pointerdown', pointerDown],
        [document, 'pointerup', pointerUp],
        [document, 'pointercancel', pointerUp],
        [document, 'focusin', schedule],
        [document, 'keydown', escape],
        [window, 'scroll', schedule],
        [window, 'resize', schedule],
        [window, 'blur', hide],
        [view.contentDOM, 'compositionstart', hide],
        [view.contentDOM, 'compositionend', schedule],
    ];
    for (const [target, type, listener] of listeners) target.addEventListener(type, listener, true);
    const observer = new window.ResizeObserver(schedule);
    observer.observe(view.scrollDOM);
    return {
        update(update) {
            if (update.docChanged || (update.selectionSet && !update.startState.selection.eq(update.state.selection))) dismissed = null;
            schedule();
        },
        refresh: schedule,
        destroy() {
            destroyed = true;
            if (frame !== null) window.cancelAnimationFrame(frame);
            for (const [target, type, listener] of listeners) target.removeEventListener(type, listener, true);
            observer.disconnect();
            toolbar.remove();
        },
    };
}
