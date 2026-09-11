import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const compiled = transformSync(fs.readFileSync(new URL('./components/folder/CoverEditorDialog.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;
const childrenOf = node => [node?.props?.children].flat(Infinity).filter(child => child && typeof child === 'object');
const nodes = node => node ? [node, ...childrenOf(node).flatMap(nodes)] : [];
const textContent = node => Array.isArray(node) ? node.map(textContent).join('') : node && typeof node === 'object' ? textContent(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
};

const defaultInfo = {
    filePath: '/library/book.cbz', name: 'book.cbz', version: 'current-source-version', textContentHash: '',
    kind: 'comic', storage: 'file', canAdd: true, canRenumber: true, conversion: false,
    coverDataUrl: 'data:image/png;base64,old', coverEntry: '01.png', pageCount: 2,
    pages: [{ name: '01.png' }, { name: '02.png' }],
};
const preview = imagePath => ({ imagePath, imageVersion: 'image-version', dataUrl: `data:image/png;base64,${imagePath}`, extension: '.png', width: 400, height: 600, size: 12000 });

async function fixture(options = {}) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const slots = [];
    const listeners = new Map();
    const calls = { inspect: [], select: [], preview: [], execute: [], close: 0, restoredFocus: 0, updatesAfterUnmount: 0 };
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let mounted = true;
    let tree;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        Fragment: Symbol('Fragment'),
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, update => {
                if (!mounted) calls.updatesAfterUnmount += 1;
                const next = typeof update === 'function' ? update(slots[index].value) : update;
                if (!Object.is(next, slots[index].value)) dirty = true;
                slots[index].value = next;
            }];
        },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useId: () => `cover-editor-${cursor++}`,
        useEffect(effect, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) {
                const previous = slots[index];
                slots[index] = { deps };
                effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
            }
        },
    };
    const focusElement = element => {
        document.activeElement = element;
        const focusEvent = event({ target: element });
        for (const listener of listeners.get('focusin') || []) listener.callback(focusEvent);
        return focusEvent;
    };
    const previousFocus = { focus: () => { calls.restoredFocus += 1; focusElement(previousFocus); } };
    globalThis.document = {
        activeElement: previousFocus,
        addEventListener(type, callback, capture) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add({ callback, capture });
        },
        removeEventListener(type, callback, capture) {
            for (const listener of listeners.get(type) || []) {
                if (listener.callback === callback && listener.capture === capture) listeners.get(type).delete(listener);
            }
        },
    };
    globalThis.window = { electronAPI: {
        inspectCoverEditor: async filePath => {
            calls.inspect.push(filePath);
            return options.inspect ? options.inspect(filePath) : { ...defaultInfo, ...options.info };
        },
        selectFile: async (...args) => {
            calls.select.push(args);
            return options.select ? options.select() : '/images/new.png';
        },
        previewCoverEditorImage: async imagePath => {
            calls.preview.push(imagePath);
            return options.preview ? options.preview(imagePath) : preview(imagePath);
        },
    } };
    const mocks = { react, '../FaIcon': { FaIcon: 'Icon' }, '../../styles/CoverEditorDialog.css': {} };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
        assert.ok(name in mocks, name);
        return mocks[name];
    });
    const props = {
        file: { name: 'book.cbz', path: '/ignored/path.cbz', full_path: '/library/book.cbz' },
        t: key => key,
        onClose: () => { calls.close += 1; },
        onExecute: async request => {
            calls.execute.push(request);
            return options.execute ? options.execute(request) : { success: true, filePath: request.filePath, backupPath: '' };
        },
    };
    const attach = (node, parent = null) => {
        node.parent = parent;
        node.focus = () => { focusElement(node); };
        node.contains = candidate => nodes(node).includes(candidate);
        node.querySelectorAll = () => nodes(node).filter(candidate => {
            if (!['button', 'input', 'select'].includes(candidate.type) && candidate.props.tabIndex !== 0) return false;
            for (let ancestor = candidate; ancestor; ancestor = ancestor.parent) {
                if (ancestor.props.disabled && (ancestor === candidate || ancestor.type === 'fieldset')) return false;
            }
            return true;
        });
        if (node.props.ref) node.props.ref.current = node;
        childrenOf(node).forEach(child => attach(child, node));
    };
    const render = () => {
        cursor = 0;
        dirty = false;
        tree = module.exports.CoverEditorDialog(props);
        attach(tree);
        const pending = effects;
        effects = [];
        pending.forEach(effect => effect());
    };
    const settle = async () => {
        for (let pass = 0; pass < 20; pass += 1) {
            if (mounted) render();
            await tick();
            if (!dirty || !mounted) return;
        }
        assert.fail('Cover dialog did not settle');
    };
    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        slots.forEach(slot => slot.cleanup?.());
    };
    await settle();
    const button = label => nodes(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || textContent(node) === label));
    const input = label => {
        const element = nodes(tree).find(node => node.type === 'label' && textContent(node).includes(label));
        return nodes(element).find(node => node.type === 'input');
    };
    return {
        calls, settle, render, unmount, button, input,
        focusElement,
        focusListenerCount: () => listeners.get('focusin')?.size || 0,
        tree: () => tree,
        dialog: () => nodes(tree).find(node => node.props.role === 'dialog'),
        newImage: () => nodes(tree).find(node => node.type === 'img' && node.props.alt === 'cover_editor_new'),
        alert: () => textContent(nodes(tree).find(node => node.props.role === 'alert')),
        browse: async () => { await button('cover_editor_select').props.onClick(); await settle(); },
        close: () => { unmount(); globalThis.window = originalWindow; globalThis.document = originalDocument; },
    };
}

function event(extra = {}) {
    return {
        defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...extra,
    };
}

test('inspection and image selection remain read-only until the exact chosen save operation is submitted', async () => {
    const value = await fixture();
    try {
        assert.deepEqual(value.calls.inspect, ['/library/book.cbz']);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        assert.equal(value.input('cover_editor_replace').props.checked, true);
        await value.browse();
        assert.deepEqual(value.calls.preview, ['/images/new.png']);
        assert.deepEqual(value.calls.select[0][1][0].extensions, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        value.input('cover_editor_add').props.onChange();
        value.render();
        assert.equal(value.input('cover_editor_renumber').props.checked, true);
        value.input('cover_editor_renumber').props.onChange({ target: { checked: false } });
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.render();
        assert.deepEqual(value.calls.execute, []);
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.execute, [{
            filePath: '/library/book.cbz', version: 'current-source-version', textContentHash: '',
            targetEntry: '01.png', imagePath: '/images/new.png', imageVersion: 'image-version', mode: 'add', renumber: false, backup: false,
        }]);
        assert.equal(value.button('cover_editor_save'), undefined);
        assert.ok(textContent(value.tree()).includes('cover_editor_saved'));
    } finally { value.close(); }
});

test('a pending save blocks duplicate execution and every close gesture, then permits retry after a source conflict', async () => {
    const saving = deferred();
    const value = await fixture({ execute: () => saving.promise });
    try {
        await value.browse();
        const submit = value.button('cover_editor_save').props.onClick;
        const first = submit();
        await submit();
        value.render();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(value.dialog().props['aria-busy'], true);
        assert.equal(value.button('cover_editor_cancel').props.disabled, true);
        value.button('cover_editor_close').props.onClick();
        const escape = event({ key: 'Escape' });
        value.tree().props.onKeyDown(escape);
        value.tree().props.onMouseDown({ target: value.tree(), currentTarget: value.tree() });
        assert.equal(value.calls.close, 0);
        assert.equal(escape.defaultPrevented, true);
        assert.equal(escape.propagationStopped, true);
        saving.resolve({ success: false, code: 'COVER_SOURCE_CHANGED' });
        await first;
        await value.settle();
        assert.equal(value.alert(), 'cover_editor_source_changed');
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        value.button('cover_editor_cancel').props.onClick();
        assert.equal(value.calls.close, 1);
    } finally { value.close(); }
});

test('drag and drop accepts one local image and stale image responses cannot replace the newest preview', async () => {
    const first = deferred();
    const second = deferred();
    const value = await fixture({ preview: imagePath => imagePath === '/first.png' ? first.promise : second.promise });
    try {
        for (const files of [[], [{ path: '/a.png' }, { path: '/b.png' }], [{ name: 'remote.png' }]]) {
            const drop = event({ dataTransfer: { files } });
            value.button('cover_editor_select').props.onDrop(drop);
            value.render();
            assert.equal(value.alert(), 'cover_editor_drop_one');
            assert.equal(drop.defaultPrevented, true);
            assert.equal(drop.propagationStopped, true);
        }
        assert.deepEqual(value.calls.preview, []);
        const drop = value.button('cover_editor_select').props.onDrop;
        drop(event({ dataTransfer: { files: [{ path: '/first.png' }] } }));
        drop(event({ dataTransfer: { files: [{ path: '/second.png' }] } }));
        value.render();
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        second.resolve(preview('/second.png'));
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/second.png').dataUrl);
        first.reject(new Error('obsolete preview error'));
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/second.png').dataUrl);
        assert.equal(value.alert(), '');
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('modal background drag events never reach the viewer drop handler while the new cover still accepts an image', async () => {
    const value = await fixture();
    let globalDropEvents = 0;
    const bubble = (target, handler) => {
        const drag = event({ target, dataTransfer: { types: ['Files'], files: [{ path: '/images/new.png' }], dropEffect: 'copy' } });
        for (let current = target; current; current = current.parent) {
            drag.currentTarget = current;
            current.props[handler]?.(drag);
            if (drag.propagationStopped) break;
        }
        if (!drag.propagationStopped) globalDropEvents += 1;
        return drag;
    };
    try {
        const currentCover = nodes(value.tree()).find(node => node.type === 'img' && node.props.alt === 'cover_editor_current');
        for (const handler of ['onDragEnter', 'onDragLeave', 'onDragOver', 'onDrop']) {
            const drag = bubble(currentCover, handler);
            assert.equal(drag.propagationStopped, true, handler);
            if (handler !== 'onDragLeave') assert.equal(drag.defaultPrevented, true, handler);
            if (handler === 'onDragOver') assert.equal(drag.dataTransfer.dropEffect, 'none');
        }
        assert.deepEqual(value.calls.preview, []);
        const imageTarget = value.button('cover_editor_select');
        bubble(imageTarget, 'onDragEnter');
        assert.equal(bubble(imageTarget, 'onDragOver').dataTransfer.dropEffect, 'copy');
        const drop = bubble(imageTarget, 'onDrop');
        assert.equal(drop.defaultPrevented, true);
        await value.settle();
        assert.equal(globalDropEvents, 0);
        assert.deepEqual(value.calls.preview, ['/images/new.png']);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('cancelling pending inspection or image loading ignores late responses without changing a file', async () => {
    for (const phase of ['inspect', 'preview']) {
        const pending = deferred();
        const value = await fixture({ [phase]: () => pending.promise });
        try {
            if (phase === 'preview') {
                value.button('cover_editor_select').props.onDrop(event({ dataTransfer: { files: [{ path: '/pending.png' }] } }));
                value.render();
            }
            value.button('cover_editor_cancel').props.onClick();
            value.unmount();
            pending.resolve(phase === 'inspect' ? defaultInfo : preview('/pending.png'));
            await value.settle();
            assert.equal(value.calls.close, 1);
            assert.equal(value.calls.restoredFocus, 1);
            assert.equal(value.calls.updatesAfterUnmount, 0);
            assert.deepEqual(value.calls.execute, []);
        } finally { value.close(); }
    }
});

test('TXT saves carry source identity and dialog keys remain inside the modal', async () => {
    const value = await fixture({ info: {
        filePath: '/library/book.txt', kind: 'text', storage: 'database', canAdd: false, canRenumber: false,
        textContentHash: 'txt-content-hash', coverEntry: '', coverDataUrl: '',
    } });
    try {
        await value.browse();
        assert.equal(value.input('cover_editor_add'), undefined);
        assert.equal(value.input('cover_editor_renumber'), undefined);
        for (const key of ['Delete', 'Backspace', 'F3', 'Enter']) {
            const keyEvent = event({ key });
            value.tree().props.onKeyDown(keyEvent);
            assert.equal(keyEvent.propagationStopped, true, key);
        }
        const focusable = value.dialog().querySelectorAll();
        focusable.at(-1).focus();
        const tab = event({ key: 'Tab' });
        value.tree().props.onKeyDown(tab);
        assert.equal(tab.defaultPrevented, true);
        assert.equal(document.activeElement, focusable[0]);
        const backTab = event({ key: 'Tab', shiftKey: true });
        value.tree().props.onKeyDown(backTab);
        assert.equal(document.activeElement, focusable.at(-1));
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute[0].filePath, '/library/book.txt');
        assert.equal(value.calls.execute[0].textContentHash, 'txt-content-hash');
        assert.equal(value.calls.execute[0].renumber, false);
        assert.equal(value.calls.execute[0].mode, 'replace');
    } finally { value.close(); }
});

test('an image changed after preview reports the conflict and allows selecting it again', async () => {
    const value = await fixture({ execute: () => ({ success: false, code: 'IMAGE_SOURCE_CHANGED' }) });
    try {
        await value.browse();
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute[0].imageVersion, 'image-version');
        assert.equal(value.alert(), 'cover_editor_image_changed');
        assert.equal(value.button('cover_editor_select').props.disabled, false);
        await value.browse();
        assert.equal(value.alert(), '');
        assert.equal(value.calls.execute.length, 1);
    } finally { value.close(); }
});

test('folder refresh cannot move focus behind the cover dialog during or after saving', async () => {
    const saving = deferred();
    const value = await fixture({ execute: () => saving.promise });
    try {
        assert.equal(value.focusListenerCount(), 1);
        const backgroundRow = { className: 'selected', tagName: 'DIV' };
        const moved = value.focusElement(backgroundRow);
        assert.equal(document.activeElement, value.dialog());
        assert.equal(moved.propagationStopped, true);
        const cancel = value.button('cover_editor_cancel');
        value.focusElement(cancel);
        assert.equal(document.activeElement, cancel);
        await value.browse();
        const pending = value.button('cover_editor_save').props.onClick();
        document.activeElement = backgroundRow;
        value.render();
        assert.equal(document.activeElement, value.dialog(), 'Disabling the save controls restores modal focus');
        saving.resolve({ success: true, filePath: '/library/book.cbz' });
        await pending;
        document.activeElement = backgroundRow;
        value.render();
        assert.equal(document.activeElement, value.dialog(), 'Removing the save button restores modal focus');
        value.focusElement(backgroundRow);
        assert.equal(document.activeElement, value.dialog(), 'A later folder refresh is also contained');
        const deleteKey = event({ key: 'Delete', target: document.activeElement });
        value.tree().props.onKeyDown(deleteKey);
        assert.equal(deleteKey.propagationStopped, true);
        value.unmount();
        assert.equal(value.focusListenerCount(), 0);
        assert.equal(value.calls.restoredFocus, 1);
        value.focusElement(backgroundRow);
        assert.equal(document.activeElement, backgroundRow, 'Closing removes the focus listener');
    } finally { value.close(); }
});
