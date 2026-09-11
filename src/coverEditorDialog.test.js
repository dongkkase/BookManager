import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { runCoverEditorBatch } from './coverEditorBatch.js';

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
    const calls = { inspect: [], select: [], preview: [], execute: [], executeOptions: [], translations: [], exported: [], close: 0, restoredFocus: 0, updatesAfterUnmount: 0 };
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
        useMemo(compute, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: compute(), deps };
            return slots[index].value;
        },
        useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
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
        exportMetadataCover: async request => { calls.exported.push(request); return { success: true }; },
    } };
    const mocks = { react, '../FaIcon': { FaIcon: 'Icon' }, '../../styles/CoverEditorDialog.css': {} };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
        assert.ok(name in mocks, name);
        return mocks[name];
    });
    const props = {
        file: options.file || { name: 'book.cbz', path: '/ignored/path.cbz', full_path: '/library/book.cbz' },
        ...(options.files ? { files: options.files } : {}),
        t: (key, values) => { calls.translations.push({ key, values }); return options.t ? options.t(key, values) : key; },
        onClose: () => { calls.close += 1; },
        onExecute: async (request, executionOptions) => {
            calls.execute.push(request);
            calls.executeOptions.push(executionOptions);
            return options.execute ? options.execute(request, executionOptions) : { success: true, filePath: request.filePath, backupPath: '' };
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
        all: predicate => nodes(tree).filter(predicate),
        text: () => textContent(tree),
        currentImage: () => nodes(tree).find(node => node.type === 'img' && node.props.alt === 'cover_editor_current'),
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

function selectedFile(name) {
    return { name, full_path: `/library/${name}` };
}

function fileInfo(name, overrides = {}) {
    const kind = name.endsWith('.epub') ? 'epub' : name.endsWith('.txt') ? 'text' : name.endsWith('.pdf') ? 'pdf' : 'comic';
    return {
        ...defaultInfo,
        filePath: `/library/${name}`,
        name,
        version: `version:${name}`,
        textContentHash: kind === 'text' ? `text-hash:${name}` : '',
        coverEntry: kind === 'comic' ? `${name}/first.png` : '',
        coverDataUrl: `data:image/png;base64,cover:${name}`,
        kind,
        storage: ['text', 'pdf'].includes(kind) ? 'database' : 'file',
        canAdd: ['comic', 'epub'].includes(kind),
        canRenumber: kind === 'comic',
        ...overrides,
    };
}

function fileButton(value, name) {
    return value.all(node => node.type === 'button' && 'aria-pressed' in node.props && textContent(node).includes(name))[0];
}

const saveBatchSuccessfully = (requests, options) => runCoverEditorBatch(requests,
    async request => ({ success: true, filePath: request.filePath }), options);

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

test('batch inspection is sequential, retains failed files, and previews the selected original cover', async () => {
    const first = deferred();
    const broken = deferred();
    const last = deferred();
    const pending = new Map([['/library/first.cbz', first], ['/library/broken.cbz', broken], ['/library/last.epub', last]]);
    const value = await fixture({
        files: ['first.cbz', 'broken.cbz', 'last.epub'].map(selectedFile),
        inspect: filePath => pending.get(filePath).promise,
    });
    try {
        assert.deepEqual(value.calls.inspect, ['/library/first.cbz']);
        first.resolve(fileInfo('first.cbz'));
        await value.settle();
        assert.deepEqual(value.calls.inspect, ['/library/first.cbz', '/library/broken.cbz']);
        broken.reject(new Error('The archive cannot be inspected'));
        await value.settle();
        assert.deepEqual(value.calls.inspect, ['/library/first.cbz', '/library/broken.cbz', '/library/last.epub']);
        last.resolve(fileInfo('last.epub'));
        await value.settle();
        assert.ok(value.text().includes('The archive cannot be inspected'));
        for (const name of ['first.cbz', 'broken.cbz', 'last.epub']) assert.ok(fileButton(value, name), name);
        await fileButton(value, 'last.epub').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.inspect, ['/library/first.cbz', '/library/broken.cbz', '/library/last.epub', '/library/last.epub']);
        assert.equal(fileButton(value, 'last.epub').props['aria-pressed'], true);
        assert.equal(value.currentImage().props.src, fileInfo('last.epub').coverDataUrl);
        await value.button('cover_editor_export').props.onClick();
        assert.equal(value.calls.exported[0].filePath, '/library/last.epub');
        assert.equal(value.calls.exported[0].coverDataUrl, fileInfo('last.epub').coverDataUrl);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('batch requests share the selected image while preserving each file identity and format capabilities', async () => {
    const infos = ['first.cbz', 'last.epub'].map(name => fileInfo(name));
    const value = await fixture({
        files: infos.map(info => selectedFile(info.name)),
        inspect: filePath => infos.find(info => info.filePath === filePath),
        execute: saveBatchSuccessfully,
    });
    try {
        assert.equal(value.input('cover_editor_replace').props.checked, true);
        await value.browse();
        value.input('cover_editor_add').props.onChange();
        value.render();
        assert.equal(value.input('cover_editor_renumber').props.checked, true);
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.render();
        await value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.preview, ['/images/new.png']);
        assert.equal(value.calls.execute.length, 1);
        assert.deepEqual(value.calls.execute[0], infos.map(info => ({
            filePath: info.filePath,
            version: info.version,
            textContentHash: info.textContentHash,
            targetEntry: info.coverEntry,
            imagePath: '/images/new.png', imageVersion: 'image-version', mode: 'add',
            renumber: info.canRenumber, backup: false,
        })));
        assert.equal(typeof value.calls.executeOptions[0].onProgress, 'function');
        assert.equal(typeof value.calls.executeOptions[0].shouldCancel, 'function');
        assert.equal(value.calls.executeOptions[0].shouldCancel(), false);
    } finally { value.close(); }
});

test('mixed comic and TXT selection permits only replacement and renumbers only comic requests', async () => {
    const infos = ['first.cbz', 'notes.txt'].map(name => fileInfo(name));
    const value = await fixture({
        files: infos.map(info => selectedFile(info.name)),
        inspect: filePath => infos.find(info => info.filePath === filePath),
        execute: saveBatchSuccessfully,
    });
    try {
        assert.equal(value.input('cover_editor_add'), undefined);
        assert.ok(value.input('cover_editor_renumber'));
        value.input('cover_editor_renumber').props.onChange({ target: { checked: true } });
        value.render();
        await value.browse();
        await value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        const requests = value.calls.execute[0];
        assert.equal(requests.length, 2);
        assert.deepEqual(requests.map(request => request.mode), ['replace', 'replace']);
        assert.deepEqual(requests.map(request => request.renumber), [true, false]);
        assert.equal(requests[1].textContentHash, 'text-hash:notes.txt');
        assert.equal(requests[1].version, 'version:notes.txt');
    } finally { value.close(); }
});

test('inspection failures never become save requests and a remaining single valid file keeps batch semantics', async () => {
    const value = await fixture({
        files: ['broken.cbz', 'ready.cbz'].map(selectedFile),
        inspect: filePath => filePath.endsWith('broken.cbz') ? { error: 'Inspection failed for broken.cbz' } : fileInfo('ready.cbz'),
        execute: saveBatchSuccessfully,
    });
    try {
        assert.ok(value.text().includes('Inspection failed for broken.cbz'));
        await value.browse();
        await value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute.length, 1);
        assert.ok(Array.isArray(value.calls.execute[0]));
        assert.deepEqual(value.calls.execute[0].map(request => request.filePath), ['/library/ready.cbz']);
        assert.ok(fileButton(value, 'broken.cbz'));
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_summary').at(-1)?.values, [1, 1, 0]);
    } finally { value.close(); }
});

test('a batch with no inspectable file cannot save and can still be closed', async () => {
    const value = await fixture({
        files: ['broken.cbz', 'locked.epub'].map(selectedFile),
        inspect: filePath => { throw new Error(`Unreadable: ${filePath}`); },
    });
    try {
        assert.deepEqual(value.calls.inspect, ['/library/broken.cbz', '/library/locked.epub']);
        assert.ok(value.text().includes('Unreadable: /library/broken.cbz'));
        assert.ok(value.text().includes('Unreadable: /library/locked.epub'));
        const save = value.button('cover_editor_batch_save');
        assert.ok(!save || save.props.disabled);
        assert.equal(value.dialog().props['aria-busy'], false);
        value.button('cover_editor_cancel').props.onClick();
        assert.equal(value.calls.close, 1);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('closing during sequential batch inspection prevents later inspections and state updates', async () => {
    const first = deferred();
    const value = await fixture({
        files: ['first.cbz', 'last.cbz'].map(selectedFile),
        inspect: () => first.promise,
    });
    try {
        assert.deepEqual(value.calls.inspect, ['/library/first.cbz']);
        value.button('cover_editor_cancel').props.onClick();
        value.unmount();
        first.resolve(fileInfo('first.cbz'));
        await value.settle();
        assert.deepEqual(value.calls.inspect, ['/library/first.cbz']);
        assert.equal(value.calls.updatesAfterUnmount, 0);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('batch progress reports individual failures and still completes subsequent files with a full summary', async () => {
    const names = ['first.cbz', 'second.cbz', 'third.cbz'];
    const pending = names.map(() => deferred());
    const applied = [];
    const value = await fixture({
        files: names.map(selectedFile),
        inspect: filePath => fileInfo(filePath.split('/').at(-1)),
        execute: (requests, options) => runCoverEditorBatch(requests, request => {
            applied.push(request.filePath);
            return pending[applied.length - 1].promise;
        }, options),
    });
    try {
        await value.browse();
        const saving = value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        assert.deepEqual(applied, ['/library/first.cbz']);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_progress').at(-1)?.values, [0, 3]);
        pending[0].resolve({ success: false, code: 'COVER_SOURCE_CHANGED' });
        await value.settle();
        assert.deepEqual(applied, ['/library/first.cbz', '/library/second.cbz']);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_progress').at(-1)?.values, [1, 3]);
        assert.ok(value.text().includes('cover_editor_source_changed'));
        assert.equal(value.dialog().props['aria-busy'], true);
        pending[1].resolve({ success: true, filePath: '/library/second_cover.cbz', backupPath: '/library/bak/second.cbz' });
        await value.settle();
        assert.deepEqual(applied, names.map(name => `/library/${name}`));
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_progress').at(-1)?.values, [2, 3]);
        pending[2].resolve({ success: true, filePath: '/library/third.cbz' });
        await saving;
        await value.settle();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(value.dialog().props['aria-busy'], false);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_summary').at(-1)?.values, [2, 1, 0]);
        assert.ok(value.text().includes('/library/second_cover.cbz'));
        assert.ok(value.text().includes('/library/bak/second.cbz'));
        assert.equal(value.button('cover_editor_batch_save'), undefined);
        assert.ok(fileButton(value, 'first.cbz'));
        assert.ok(fileButton(value, 'third.cbz'));
    } finally { value.close(); }
});

test('cancelling a batch waits for the current save, skips remaining files, and blocks all close gestures', async () => {
    const first = deferred();
    const applied = [];
    const value = await fixture({
        files: ['first.cbz', 'second.cbz', 'third.cbz'].map(selectedFile),
        inspect: filePath => fileInfo(filePath.split('/').at(-1)),
        execute: (requests, options) => runCoverEditorBatch(requests, request => {
            applied.push(request.filePath);
            return first.promise;
        }, options),
    });
    try {
        await value.browse();
        const submit = value.button('cover_editor_batch_save').props.onClick;
        const saving = submit();
        await submit();
        await value.settle();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(value.calls.executeOptions[0].shouldCancel(), false);
        assert.equal(value.button('cover_editor_select').props.disabled, true);
        assert.equal(value.button('cover_editor_cancel').props.disabled, true);
        assert.equal(value.all(node => node.type === 'fieldset')[0].props.disabled, true);
        value.button('cover_editor_close').props.onClick();
        const escape = event({ key: 'Escape' });
        value.tree().props.onKeyDown(escape);
        value.tree().props.onMouseDown({ target: value.tree(), currentTarget: value.tree() });
        assert.equal(escape.defaultPrevented, true);
        assert.equal(escape.propagationStopped, true);
        assert.equal(value.calls.close, 0);
        value.button('cover_editor_batch_cancel_remaining').props.onClick();
        assert.equal(value.calls.executeOptions[0].shouldCancel(), true, 'Cancellation is visible before React renders again');
        value.render();
        assert.equal(value.dialog().props['aria-busy'], true);
        assert.ok(value.text().includes('cover_editor_batch_cancelling'));
        assert.deepEqual(applied, ['/library/first.cbz']);
        value.button('cover_editor_close').props.onClick();
        assert.equal(value.calls.close, 0);
        first.resolve({ success: true, filePath: '/library/first.cbz' });
        await saving;
        await value.settle();
        assert.deepEqual(applied, ['/library/first.cbz']);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_summary').at(-1)?.values, [1, 0, 2]);
        assert.equal(value.dialog().props['aria-busy'], false);
        value.button('cover_editor_close').props.onClick();
        assert.equal(value.calls.close, 1);
    } finally { value.close(); }
});

test('a files array containing one file preserves the existing single-request contract', async () => {
    const value = await fixture({ files: [selectedFile('only.cbz')], inspect: () => fileInfo('only.cbz') });
    try {
        await value.browse();
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(Array.isArray(value.calls.execute[0]), false);
        assert.equal(value.calls.execute[0].filePath, '/library/only.cbz');
        assert.equal(value.calls.executeOptions[0], undefined);
    } finally { value.close(); }
});

test('async original-cover selection ignores obsolete responses and preserves the initially inspected save identity', async () => {
    for (const obsoleteOutcome of ['resolve', 'reject']) {
        const infos = ['first.cbz', 'notes.txt'].map(name => fileInfo(name));
        const counts = new Map();
        const firstReload = deferred();
        const notesReload = deferred();
        const value = await fixture({
            files: infos.map(info => selectedFile(info.name)),
            inspect: filePath => {
                const count = (counts.get(filePath) || 0) + 1;
                counts.set(filePath, count);
                if (count === 1) return infos.find(info => info.filePath === filePath);
                return filePath === infos[0].filePath ? firstReload.promise : notesReload.promise;
            },
            execute: saveBatchSuccessfully,
        });
        try {
            assert.equal(value.currentImage().props.src, infos[0].coverDataUrl);
            const oldSelection = fileButton(value, 'first.cbz').props.onClick();
            value.render();
            assert.equal(value.currentImage(), undefined, 'The previously displayed image is cleared while a fresh cover loads');
            const newSelection = fileButton(value, 'notes.txt').props.onClick();
            value.render();
            const refreshedNotes = {
                ...infos[1],
                coverDataUrl: 'data:image/png;base64,newest-notes-cover',
                version: 'changed-source-version',
                textContentHash: 'changed-text-hash',
                coverEntry: 'changed-cover-entry.png',
            };
            notesReload.resolve(refreshedNotes);
            await newSelection;
            await value.settle();
            assert.equal(value.currentImage().props.src, refreshedNotes.coverDataUrl);
            if (obsoleteOutcome === 'resolve') firstReload.resolve({ ...infos[0], coverDataUrl: 'data:image/png;base64,obsolete-cover' });
            else firstReload.reject(new Error('Obsolete selected-cover failure'));
            await oldSelection;
            await value.settle();
            assert.equal(fileButton(value, 'notes.txt').props['aria-pressed'], true);
            assert.equal(value.currentImage().props.src, refreshedNotes.coverDataUrl);
            assert.equal(value.text().includes('Obsolete selected-cover failure'), false);
            await value.browse();
            await value.button('cover_editor_batch_save').props.onClick();
            await value.settle();
            assert.deepEqual(value.calls.execute[0].map(request => ({
                filePath: request.filePath,
                version: request.version,
                textContentHash: request.textContentHash,
                targetEntry: request.targetEntry,
            })), infos.map(info => ({
                filePath: info.filePath,
                version: info.version,
                textContentHash: info.textContentHash,
                targetEntry: info.coverEntry,
            })));
        } finally { value.close(); }
    }
});
