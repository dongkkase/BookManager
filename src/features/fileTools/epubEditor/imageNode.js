import { Node } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

export function imageAlignmentPatch(align) {
    return { align, textWrap: 'none' };
}

export function imageTextWrapPatch(attrs, textWrap) {
    return attrs.textWrap === textWrap ? { textWrap: 'none' } : { textWrap, width: Math.min(attrs.width || 100, 50) };
}

function imageStyle(attrs) {
    const side = attrs.textWrap === 'left' ? 'right' : attrs.textWrap === 'right' ? 'left' : 'none';
    const margin = side === 'right' ? '0 0 .75em 1.2em' : side === 'left' ? '0 1.2em .75em 0' : attrs.align === 'center' ? '0 auto' : attrs.align === 'right' ? '0 0 0 auto' : '0 auto 0 0';
    return `width:${attrs.width}%;float:${side};margin:${margin}`;
}

export function createImageExtension(getAssetUrl, label = key => key) {
    return Node.create({
        name: 'image', group: 'block', atom: true, draggable: true,
        addAttributes() {
            return {
                assetId: { default: '' }, alt: { default: '' }, caption: { default: '' },
                width: { default: 100 }, align: { default: 'center' }, decorative: { default: false }, textWrap: { default: 'none' },
            };
        },
        parseHTML() {
            return [{ tag: 'figure[data-asset-id]', getAttrs: element => {
                const assetId = element.getAttribute('data-asset-id');
                if (!getAssetUrl(assetId)) return false;
                return {
                    assetId, alt: element.querySelector('img')?.getAttribute('alt') || '',
                    caption: element.querySelector('figcaption')?.textContent || '',
                    width: Math.max(10, Math.min(100, Number(element.getAttribute('data-width')) || 100)),
                    align: ['left', 'right'].includes(element.getAttribute('data-align')) ? element.getAttribute('data-align') : 'center',
                    decorative: element.getAttribute('data-decorative') === 'true',
                    textWrap: ['left', 'right'].includes(element.getAttribute('data-text-wrap')) ? element.getAttribute('data-text-wrap') : 'none',
                };
            } }];
        },
        renderHTML({ node }) {
            const a = node.attrs;
            return ['figure', { 'data-id': a.id, 'data-asset-id': a.assetId, 'data-width': a.width, 'data-align': a.align, 'data-decorative': String(a.decorative), 'data-text-wrap': a.textWrap, style: imageStyle(a) }, ['img', { src: getAssetUrl(a.assetId), alt: a.decorative ? '' : a.alt, ...(a.decorative ? { role: 'presentation' } : {}) }], ...(a.caption ? [['figcaption', {}, a.caption]] : [])];
        },
        addNodeView() {
            return ({ node, editor, getPos }) => {
                let current = node;
                let composing = false;
                let captionHistory = false;
                const dom = document.createElement('figure');
                dom.className = 'ee-image-node';
                dom.contentEditable = 'false';
                const image = document.createElement('img');
                image.draggable = true;
                image.addEventListener('click', () => {
                    if (!editor.isDestroyed && editor.isEditable && !editor.view.hasFocus()) editor.view.focus();
                });
                const caption = document.createElement('figcaption');
                const input = document.createElement('textarea');
                input.className = 'ee-image-caption';
                input.rows = 1;
                input.maxLength = 2000;
                input.placeholder = label('imageCaptionPlaceholder');
                input.setAttribute('aria-label', label('caption'));
                const placeholder = document.createElement('span');
                placeholder.className = 'ee-image-caption-placeholder';
                placeholder.textContent = input.placeholder;
                placeholder.setAttribute('aria-hidden', 'true');
                caption.append(input, placeholder);
                const handle = document.createElement('span');
                handle.className = 'ee-image-resize';
                handle.setAttribute('aria-hidden', 'true');
                dom.append(image, caption, handle);
                const resizeCaption = () => {
                    placeholder.hidden = input.value.trim().length > 0;
                    input.style.height = 'auto';
                    const border = input.offsetHeight - input.clientHeight;
                    input.style.height = `${Math.max(28, input.scrollHeight + border, placeholder.hidden ? 0 : placeholder.scrollHeight + 8)}px`;
                };
                const draw = () => {
                    const url = getAssetUrl(current.attrs.assetId) || '';
                    if (image.getAttribute('src') !== url) image.src = url;
                    image.alt = current.attrs.decorative ? '' : current.attrs.alt;
                    if (current.attrs.decorative) image.setAttribute('role', 'presentation');
                    else image.removeAttribute('role');
                    dom.style.cssText = imageStyle(current.attrs);
                    dom.dataset.textWrap = current.attrs.textWrap;
                    input.disabled = !editor.isEditable;
                    if (!composing && input.value !== current.attrs.caption) {
                        const start = input.selectionStart;
                        const end = input.selectionEnd;
                        input.value = current.attrs.caption || '';
                        if (document.activeElement === input) input.setSelectionRange(Math.min(start, input.value.length), Math.min(end, input.value.length));
                    }
                    resizeCaption();
                };
                const commitCaption = () => {
                    if (editor.isDestroyed || !editor.isEditable) return;
                    const pos = getPos();
                    const value = input.value.slice(0, 2000);
                    if (typeof pos !== 'number' || value === current.attrs.caption) return;
                    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, caption: value });
                    if (!captionHistory) closeHistory(tr);
                    captionHistory = true;
                    editor.view.dispatch(tr);
                };
                input.addEventListener('focus', () => {
                    if (editor.isDestroyed) return;
                    const pos = getPos();
                    if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)).setMeta('addToHistory', false));
                    captionHistory = false;
                });
                input.addEventListener('input', () => { commitCaption(); resizeCaption(); });
                input.addEventListener('compositionstart', () => { composing = true; });
                input.addEventListener('compositionend', () => { composing = false; commitCaption(); });
                input.addEventListener('blur', () => {
                    composing = false;
                    commitCaption();
                    if (captionHistory && !editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr));
                    captionHistory = false;
                });
                input.addEventListener('keydown', event => {
                    event.stopPropagation();
                    if (event.isComposing || composing) return;
                    const key = event.key.toLowerCase();
                    if ((event.metaKey || event.ctrlKey) && !event.altKey && ['z', 'y'].includes(key)) {
                        event.preventDefault();
                        editor.commands[key === 'y' || event.shiftKey ? 'redo' : 'undo']();
                        captionHistory = false;
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        input.blur();
                        editor.view.focus();
                    }
                });
                let cleanup = () => {};
                handle.addEventListener('pointerdown', event => {
                    if (!editor.isEditable) return;
                    event.preventDefault();
                    const start = event.clientX;
                    const initial = dom.getBoundingClientRect().width;
                    const parent = dom.parentElement.getBoundingClientRect().width;
                    let width = current.attrs.width;
                    const move = e => { width = Math.max(10, Math.min(100, Math.round((initial + e.clientX - start) / parent * 100))); dom.style.width = `${width}%`; };
                    const up = () => {
                        cleanup();
                        const pos = getPos();
                        if (typeof pos === 'number' && !editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, { ...current.attrs, width }));
                    };
                    cleanup = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
                    document.addEventListener('pointermove', move);
                    document.addEventListener('pointerup', up, { once: true });
                });
                draw();
                const observer = new ResizeObserver(resizeCaption);
                observer.observe(dom);
                return {
                    dom,
                    update(next) { if (next.type.name !== 'image') return false; current = next; draw(); return true; },
                    selectNode() { dom.classList.add('ProseMirror-selectednode'); },
                    deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
                    stopEvent(event) { return event.target === handle || event.target === input; },
                    ignoreMutation() { return true; },
                    destroy() { cleanup(); observer.disconnect(); },
                };
            };
        },
    });
}
