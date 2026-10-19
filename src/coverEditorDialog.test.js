import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { runCoverEditorBatch } from './coverEditorBatch.js';
import { coverEditorSearchTitle } from './coverEditorSearchTitle.js';
import { coverEditorMetadataCoverUrl, coverEditorMetadataThumbnail, searchCoverEditorMetadata, upgradeCoverEditorMetadataThumbnails } from './coverEditorMetadataSearch.js';
import { metadataSearchResultKey } from './metadataSearch.js';
import * as metadataApiPolicy from './metadataApiPolicy.js';
import { createCoverEditorResultLog } from './coverEditorResultLog.js';
import { isTextEntryTarget } from './interactionPolicy.js';
import { normalizeStatusState } from './statusState.js';
import { resolveEffectiveWorkingTab, shouldUseLibraryScanSlide } from './appLockState.js';

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
const metadataResult = { id: '123', title: 'Book from metadata', author: 'Search author', coverUrl: 'https://covers.example/book.jpg', metadata: { Title: 'Search title', Writer: 'Search writer' } };
const preview = imagePath => ({ imagePath, imageVersion: 'image-version', dataUrl: `data:image/png;base64,${imagePath}`, extension: '.png', width: 400, height: 600, size: 12000 });

async function fixture(options = {}) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const statusStates = [];
    const actionListeners = new Set();
    const slots = [];
    const listeners = new Map();
    const calls = { inspect: [], select: [], preview: [], importedPreview: [], clipboardPreview: [], arrivals: [], cancelledArrivals: [], metadata: [], metadataPreview: [], archiveList: [], archivePreview: [], archiveThumbnails: [], released: [], execute: [], executeOptions: [], preferences: [], translations: [], exported: [], toasts: [], toggledFiles: [], removedFiles: [], busy: [], imageDropAvailable: [], toggledAll: 0, reset: 0, close: 0, restoredFocus: 0, updatesAfterUnmount: 0 };
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let mounted = true;
    let tree;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        Fragment: Symbol('Fragment'),
        Suspense: Symbol('Suspense'),
        lazy: () => 'CoverImageEditorDialog',
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
    globalThis.window = {
        addEventListener: (type, callback) => { if (type === 'bookmanager:action') actionListeners.add(callback); },
        removeEventListener: (type, callback) => { if (type === 'bookmanager:action') actionListeners.delete(callback); },
        electronAPI: {
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
        previewCoverEditorImportedImage: async request => {
            calls.importedPreview.push(request);
            return options.importedPreview ? options.importedPreview(request) : preview('/temporary/imported-cover.png');
        },
        previewCoverEditorClipboardImage: async (...args) => {
            calls.clipboardPreview.push(args);
            return options.clipboardPreview ? options.clipboardPreview() : preview('/temporary/clipboard-cover.png');
        },
        fetchMetadata: async request => {
            calls.metadata.push(request);
            return options.metadata ? options.metadata(request) : { success: true, results: request.apiSource === '리디북스' ? [metadataResult] : [], hasNext: false };
        },
        cacheMetadataRemoteCover: options.cacheCover,
        previewCoverEditorMetadataImage: async request => {
            calls.metadataPreview.push(request);
            return options.metadataPreview ? options.metadataPreview(request) : preview('/temporary/metadata-cover.png');
        },
        listCoverEditorArchiveImages: async request => {
            calls.archiveList.push(request);
            return options.archiveList ? options.archiveList(request) : { entries: [{ name: 'pages/02.png' }], total: 1, offset: request.offset };
        },
        previewCoverEditorArchiveThumbnails: async request => {
            calls.archiveThumbnails.push(request);
            return options.archiveThumbnails ? options.archiveThumbnails(request) : { entries: request.entryNames.map(name => ({ name, thumbnailDataUrl: `data:image/png;base64,thumbnail:${name}`, width: 1200, height: 1800 })) };
        },
        previewCoverEditorArchiveImage: async request => {
            calls.archivePreview.push(request);
            return options.archivePreview ? options.archivePreview(request) : preview('/temporary/archive-cover.png');
        },
        releaseCoverEditorImages: async request => { calls.released.push(request); },
        exportMetadataCover: async request => { calls.exported.push(request); return { success: true }; },
    } };
    const mocks = { react, '../FaIcon': { FaIcon: 'Icon' }, '../SmoothCoverImage': { SmoothCoverImage: 'SmoothCoverImage' }, '../ResultLogDialog': { ResultLogDialog: 'ResultLogDialog' }, '../../coverEditorResultLog': { createCoverEditorResultLog }, '../../interactionPolicy': { isTextEntryTarget }, '../../images/noimage.png': 'noimage.png', '../../images/rainbow cat remix.gif': 'rainbow-cat.gif', '../../resourcePolicy': { DRAG_DROP_IMAGES: ['draganddrop.png'], selectRandomResource: resources => resources[0] }, '../../coverEditorSearchTitle': { coverEditorSearchTitle }, '../../coverEditorMetadataSearch': { coverEditorMetadataCoverUrl, coverEditorMetadataThumbnail, searchCoverEditorMetadata }, '../../metadataSearch': { metadataSearchResultKey }, '../../coverEditorSearchScroll': { attachCoverEditorSearchScroll: () => undefined }, '../../styles/RenamerTab.css': {}, '../../styles/CoverEditorDialog.css': {} };
    const module = { exports: {} };
    mocks['../../coverEditorMetadataSearch'].upgradeCoverEditorMetadataThumbnails = (results, cacheCover, runtime) => (
        upgradeCoverEditorMetadataThumbnails(results, cacheCover, { ...runtime, ...(options.readImageSize ? { readImageSize: options.readImageSize } : {}) })
    );
    mocks['../../statusState'] = { emitStatusState: (tabId, state) => statusStates.push(normalizeStatusState(tabId, state)) };
    mocks['../../metadataApiPolicy'] = metadataApiPolicy;
    mocks['../../hooks/useReducedMotion'] = { useReducedMotion: () => Boolean(options.reducedMotion) };
    mocks['../../coverEditorImageArrival'] = { animateCoverEditorImageArrival: request => {
        calls.arrivals.push(request);
        if (!options.deferArrival) request.onFinish();
        return () => calls.cancelledArrivals.push(request);
    } };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
        assert.ok(name in mocks, name);
        return mocks[name];
    });
    const props = {
        file: options.file || (options.embedded ? undefined : { name: 'book.cbz', path: '/ignored/path.cbz', full_path: '/library/book.cbz' }),
        ...(options.files ? { files: options.files } : {}),
        embedded: Boolean(options.embedded),
        localImageRequest: options.localImageRequest,
        externalBusy: Boolean(options.externalBusy),
        onToggleFile: filePath => { calls.toggledFiles.push(filePath); },
        onToggleAll: () => { calls.toggledAll += 1; },
        onRemoveFile: filePath => { calls.removedFiles.push(filePath); },
        onBusyChange: busy => { calls.busy.push(busy); },
        onImageDropAvailabilityChange: available => { calls.imageDropAvailable.push(available); },
        onReset: () => { calls.reset += 1; },
        apiKeys: options.apiKeys || {},
        metadataApiEnabled: options.metadataApiEnabled,
        preferences: options.preferences,
        onPreferencesChange: preferences => {
            calls.preferences.push(preferences);
            options.onPreferencesChange?.(preferences);
        },
        showToast: message => calls.toasts.push(message),
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
        node.getClientRects = () => {
            for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
                if (ancestor.type === 'details' && !ancestor.props.open) {
                    const summary = childrenOf(ancestor).find(child => child.type === 'summary');
                    if (!summary?.contains(node)) return [];
                }
            }
            return [{}];
        };
        node.querySelectorAll = () => nodes(node).filter(candidate => {
            if (!['button', 'input', 'select', 'summary'].includes(candidate.type) && candidate.props.tabIndex !== 0) return false;
            for (let ancestor = candidate; ancestor; ancestor = ancestor.parent) {
                if (ancestor.props.disabled && (ancestor === candidate || ancestor.type === 'fieldset')) return false;
            }
            return true;
        });
        if (typeof node.props.ref === 'function') node.props.ref(node);
        else if (node.props.ref) node.props.ref.current = node;
        childrenOf(node).forEach(child => attach(child, node));
    };
    const render = () => {
        cursor = 0;
        dirty = false;
        nodes(tree).forEach(node => {
            if (node.props.ref?.current === node) node.props.ref.current = null;
        });
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
        calls, settle, render, unmount, button, input, statusStates,
        dispatchAction: detail => actionListeners.forEach(callback => callback({ detail })),
        actionListenerCount: () => actionListeners.size,
        updateProps: updates => { Object.assign(props, updates); render(); },
        focusElement,
        focusListenerCount: () => listeners.get('focusin')?.size || 0,
        tree: () => tree,
        dialog: () => nodes(tree).find(node => node.props.role === 'dialog'),
        all: predicate => nodes(tree).filter(predicate),
        text: () => textContent(tree),
        currentImage: () => nodes(tree).find(node => node.type === 'img' && node.props.alt === 'cover_editor_current'),
        newImage: () => nodes(tree).find(node => node.type === 'img' && node.props.alt === 'cover_editor_new'),
        imageEditor: () => nodes(tree).find(node => node.type === 'CoverImageEditorDialog'),
        alert: () => textContent(nodes(tree).find(node => node.props.role === 'alert')),
        browse: async () => { await button('cover_editor_local_browse').props.onClick(); await settle(); },
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
    return value.all(node => (node.type === 'button' && 'aria-pressed' in node.props || node.type === 'tr' && node.props['data-cover-file']) && textContent(node).includes(name))[0];
}

const resultLogDialog = value => value.all(node => node.type === 'ResultLogDialog')[0];

function fileDetailsButton(value, name) {
    return nodes(fileButton(value, name).parent).find(node => node.props.className === 'cover-editor-file-detail-toggle');
}

function filenamePreviewButton(value, name) {
    return nodes(fileButton(value, name)).find(node => node.props.className === 'cover-editor-filename-preview-button');
}

function openFilenamePreview(value, name) {
    const button = filenamePreviewButton(value, name);
    button.props.onClick(event({ currentTarget: button }));
    value.render();
    return button;
}

const filenameDialog = value => value.all(node => node.props.className?.split(' ').includes('cover-editor-filename-dialog'))[0];
const filenameRows = value => nodes(filenameDialog(value)).filter(node => node.type === 'tr' && childrenOf(node).some(child => child.type === 'td'))
    .map(row => childrenOf(row).map(textContent));

const saveBatchSuccessfully = (requests, options) => runCoverEditorBatch(requests,
    async request => ({ success: true, filePath: request.filePath }), options);

test('saved cover options override inspection defaults, including explicitly unchecked options', async () => {
    for (const coverDataUrl of [defaultInfo.coverDataUrl, '']) {
        for (const mode of ['replace', 'add']) {
            const value = await fixture({ preferences: { mode, backup: false, renumber: false }, info: { coverDataUrl } });
            try {
                assert.equal(value.input(`cover_editor_${mode}`).props.checked, true);
                assert.equal(value.input('cover_editor_backup').props.checked, false);
                assert.equal(value.input('cover_editor_renumber').props.checked, false);
                assert.deepEqual(value.calls.preferences, []);
                await value.browse();
                await value.button('cover_editor_save').props.onClick();
                assert.equal(value.calls.execute[0].mode, mode);
                assert.equal(value.calls.execute[0].backup, false);
                assert.equal(value.calls.execute[0].renumber, false);
            } finally { value.close(); }
        }
    }
});

test('option changes are remembered on cancellation and restored for another book without saving its cover', async () => {
    let preferences;
    const value = await fixture({ onPreferencesChange: options => { preferences = options; } });
    try {
        value.input('cover_editor_add').props.onChange();
        value.input('cover_editor_renumber').props.onChange({ target: { checked: false } });
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.render();
        assert.deepEqual(value.calls.preferences, [
            { mode: 'add', renumber: true, backup: true, apiSource: '통합검색' },
            { mode: 'add', renumber: false, backup: true, apiSource: '통합검색' },
            { mode: 'add', renumber: false, backup: false, apiSource: '통합검색' },
        ]);
        value.button('cover_editor_cancel').props.onClick();
        assert.equal(value.calls.close, 1);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
    const reopened = await fixture({ file: selectedFile('other.cbz'), info: fileInfo('other.cbz'), preferences });
    try {
        assert.equal(reopened.input('cover_editor_add').props.checked, true);
        assert.equal(reopened.input('cover_editor_backup').props.checked, false);
        assert.equal(reopened.input('cover_editor_renumber').props.checked, false);
        reopened.input('cover_editor_replace').props.onChange();
        assert.deepEqual(reopened.calls.preferences, [{ mode: 'replace', backup: false, renumber: false, apiSource: '통합검색' }]);
    } finally { reopened.close(); }
});

test('absent or malformed saved options preserve the initial cover-aware defaults', async () => {
    for (const preferences of [undefined, null, { mode: 'invalid', renumber: 'false', backup: 'false' }]) {
        for (const coverDataUrl of [defaultInfo.coverDataUrl, '']) {
            const value = await fixture({ preferences, info: { coverDataUrl } });
            try {
                assert.equal(value.input(coverDataUrl ? 'cover_editor_replace' : 'cover_editor_add').props.checked, true);
                assert.equal(value.input('cover_editor_renumber').props.checked, !coverDataUrl);
                assert.equal(value.input('cover_editor_backup').props.checked, true);
                assert.deepEqual(value.calls.preferences, []);
            } finally { value.close(); }
        }
    }
});

test('unsupported files limit the operation without overwriting the remembered preferences', async () => {
    const preferences = { mode: 'add', renumber: true, backup: false };
    const value = await fixture({
        embedded: true,
        preferences,
        files: [selectedFile('book.cbz'), selectedFile('book.txt')],
        inspect: name => fileInfo(name.split('/').at(-1)),
        execute: saveBatchSuccessfully,
    });
    try {
        assert.equal(value.input('cover_editor_add'), undefined);
        assert.equal(value.input('cover_editor_renumber').props.checked, true);
        assert.equal(value.input('cover_editor_backup').props.checked, false);
        openFilenamePreview(value, 'book.cbz');
        assert.deepEqual(filenameRows(value), [['01.png', '0000.png'], ['02.png', '0001.png']]);
        assert.ok(!value.text().includes('cover_editor_new_first'));
        value.tree().props.onKeyDown(event({ key: 'Escape' }));
        value.render();
        await value.browse();
        await value.button('cover_editor_batch_save').props.onClick();
        assert.deepEqual(value.calls.execute[0].map(({ mode, renumber, backup }) => ({ mode, renumber, backup })), [
            { mode: 'replace', renumber: true, backup: false },
            { mode: 'replace', renumber: false, backup: false },
        ]);
        assert.deepEqual(value.calls.preferences, []);
    } finally { value.close(); }
    const supported = await fixture({ preferences });
    try {
        assert.equal(supported.input('cover_editor_add').props.checked, true);
        assert.equal(supported.input('cover_editor_renumber').props.checked, true);
    } finally { supported.close(); }
});

test('config save responses do not reset newer choices or the selected cover', async () => {
    const initial = { mode: 'replace', renumber: false, backup: true };
    const value = await fixture({ preferences: initial });
    try {
        await value.browse();
        value.input('cover_editor_add').props.onChange();
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.updateProps({ preferences: initial });
        await value.settle();
        assert.equal(value.input('cover_editor_add').props.checked, true);
        assert.equal(value.input('cover_editor_backup').props.checked, false);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.deepEqual(value.calls.inspect, ['/library/book.cbz']);
    } finally { value.close(); }
});

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

test('the local file action stays available while its preview loads and saving waits for the image', async () => {
    const pending = deferred();
    const value = await fixture({ preview: () => pending.promise });
    try {
        const choosing = value.button('cover_editor_local_browse').props.onClick();
        await value.settle();
        assert.equal(value.button('cover_editor_local_browse').props.disabled, false);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        assert.equal(value.currentImage().props.src, defaultInfo.coverDataUrl);
        assert.deepEqual(value.calls.preview, ['/images/new.png']);
        pending.resolve(preview('/images/new.png'));
        await choosing;
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.button('cover_editor_local_browse').props.disabled, false);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        assert.deepEqual(value.calls.execute, []);
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
            value.button('cover_editor_local_browse').props.onDrop(drop);
            value.render();
            assert.equal(value.alert(), '');
            assert.deepEqual(value.calls.toasts.at(-1), { key: 'cover_editor_drop_one' });
            assert.equal(drop.defaultPrevented, true);
            assert.equal(drop.propagationStopped, true);
        }
        assert.deepEqual(value.calls.preview, []);
        const drop = value.button('cover_editor_local_browse').props.onDrop;
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
        assert.equal(value.calls.toasts.length, 3);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('image selection failures use localized toast keys and preserve the previous cover', async () => {
    const errors = [
        ['COVER_IMAGE_INVALID', 'cover_editor_invalid_image'],
        ['COVER_IMAGE_TOO_MANY_PIXELS', 'cover_editor_image_too_many_pixels'],
        ['COVER_IMAGE_TOO_LARGE', 'cover_editor_image_too_large'],
        ['COVER_IMAGE_UNSUPPORTED_FORMAT', 'cover_editor_image_unsupported_format'],
        ['COVER_IMAGE_CONVERSION_FAILED', 'cover_editor_image_conversion_failed'],
        ['IMAGE_SOURCE_CHANGED', 'cover_editor_image_changed'],
        ['COVER_SOURCE_CHANGED', 'cover_editor_source_changed'],
        ['ENOENT', 'cover_editor_image_load_failed'],
        ['', 'cover_editor_image_load_failed'],
    ];
    for (const [code, key] of errors) {
        for (const rejects of [false, true]) {
            let fail = false;
            const value = await fixture({ preview: path => {
                if (!fail) return preview(path);
                if (rejects) throw Object.assign(new Error('Raw backend error'), { code });
                return { error: 'Raw backend error', code };
            } });
            try {
                await value.browse();
                const selected = value.newImage().props.src;
                fail = true;
                await value.browse();
                assert.deepEqual(value.calls.toasts, [{ key }], `${code}:${rejects}`);
                assert.equal(value.alert(), '');
                assert.ok(!value.text().includes('Raw backend error'));
                assert.equal(value.newImage().props.src, selected);
                assert.equal(value.button('cover_editor_save').props.disabled, false);
                assert.deepEqual(value.calls.released, []);
            } finally { value.close(); }
        }
    }
});

test('an empty image preview shows the translated invalid-image toast', async () => {
    const value = await fixture({ preview: () => ({}) });
    try {
        await value.browse();
        assert.deepEqual(value.calls.toasts, [{ key: 'cover_editor_invalid_image' }]);
        assert.equal(value.alert(), '');
        assert.equal(value.button('cover_editor_save').props.disabled, true);
    } finally { value.close(); }
});

test('only the local source accepts drops while both cover previews block viewer drop handlers', async () => {
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
        const candidate = value.all(node => node.props.className?.split(' ').includes('cover-editor-candidate'))[0];
        assert.equal(candidate.type, 'div');
        assert.equal(candidate.props.onClick, undefined);
        assert.equal(candidate.props.onDrop, undefined);
        for (const target of [currentCover, candidate]) for (const handler of ['onDragEnter', 'onDragLeave', 'onDragOver', 'onDrop']) {
            const drag = bubble(target, handler);
            assert.equal(drag.propagationStopped, true, handler);
            if (handler !== 'onDragLeave') assert.equal(drag.defaultPrevented, true, handler);
            if (handler === 'onDragOver') assert.equal(drag.dataTransfer.dropEffect, 'none');
        }
        assert.deepEqual(value.calls.preview, []);
        const imageTarget = value.button('cover_editor_local_browse');
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
                value.button('cover_editor_local_browse').props.onDrop(event({ dataTransfer: { files: [{ path: '/pending.png' }] } }));
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
        assert.equal(value.button('cover_editor_local_browse').props.disabled, false);
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
        assert.ok(value.text().includes('cover_editor_count_failed'));
        assert.ok(!value.text().includes('The archive cannot be inspected'));
        value.button('cover_editor_view_result').props.onClick();
        value.render();
        fileDetailsButton(value, 'broken.cbz').props.onClick();
        value.render();
        assert.ok(value.text().includes('The archive cannot be inspected'));
        assert.equal(fileButton(value, 'first.cbz').props['aria-pressed'], true);
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
        value.button('cover_editor_view_result').props.onClick();
        value.render();
        for (const name of ['broken.cbz', 'locked.epub']) {
            fileDetailsButton(value, name).props.onClick();
            value.render();
        }
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
        assert.equal(value.all(node => node.props.className === 'cover-editor-batch')[0].props.open, false);
        await value.browse();
        const saving = value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        assert.deepEqual(applied, ['/library/first.cbz']);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_progress').at(-1)?.values, [0, 3]);
        pending[0].resolve({ success: false, code: 'COVER_SOURCE_CHANGED' });
        await value.settle();
        assert.deepEqual(applied, ['/library/first.cbz', '/library/second.cbz']);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_progress').at(-1)?.values, [1, 3]);
        assert.ok(textContent(fileButton(value, 'first.cbz')).includes('cover_editor_status_failed'));
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
        assert.equal(value.button('cover_editor_batch_save'), undefined);
        assert.equal(value.all(node => node.props.className === 'cover-editor-batch')[0].props.open, false);
        assert.ok(!value.text().includes('/library/second_cover.cbz'));
        const footer = value.all(node => node.props.className === 'cover-editor-footer')[0];
        assert.ok(textContent(footer).includes('cover_editor_count_saved'));
        assert.ok(textContent(footer).includes('cover_editor_count_failed'));
        assert.ok(!textContent(footer).includes('cover_editor_count_cancelled'));
        assert.equal(value.all(node => node.props.className === 'cover-editor-batch-summary').length, 0);
        value.button('cover_editor_view_result').props.onClick();
        value.render();
        assert.equal(value.all(node => node.props.className === 'cover-editor-batch')[0].props.open, true);
        fileDetailsButton(value, 'second.cbz').props.onClick();
        value.render();
        assert.ok(value.text().includes('/library/second_cover.cbz'));
        assert.ok(value.text().includes('/library/bak/second.cbz'));
        fileDetailsButton(value, 'first.cbz').props.onClick();
        value.render();
        assert.ok(value.text().includes('cover_editor_source_changed'));
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
        assert.equal(value.button('cover_editor_local_browse').props.disabled, true);
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
    const value = await fixture({
        files: [selectedFile('only.cbz')], inspect: () => fileInfo('only.cbz'),
        execute: request => ({ success: true, filePath: request.filePath, backupPath: '/library/bak/only.cbz', readingWarning: 'Reading position needs attention' }),
    });
    try {
        await value.browse();
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(Array.isArray(value.calls.execute[0]), false);
        assert.equal(value.calls.execute[0].filePath, '/library/only.cbz');
        assert.equal(value.calls.executeOptions[0], undefined);
        const footer = value.all(node => node.props.className === 'cover-editor-footer')[0];
        assert.ok(textContent(footer).includes('cover_editor_saved'));
        assert.ok(textContent(footer).includes('cover_editor_count_warning'));
        assert.ok(!value.text().includes('/library/bak/only.cbz'));
        value.button('cover_editor_view_result').props.onClick();
        await value.settle();
        assert.ok(value.text().includes('/library/bak/only.cbz'));
        assert.ok(value.text().includes('Reading position needs attention'));
        assert.equal(document.activeElement.props['aria-label'], 'cover_editor_result_details');
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

function helpDialog(value) {
    return value.all(node => node.props.role === 'dialog' && node.props.className?.split(' ').includes('cover-editor-help-dialog'))[0];
}

test('cover help opens beside the inert editor and closing it preserves the selected image and save options', async () => {
    const value = await fixture();
    try {
        await value.browse();
        value.input('cover_editor_add').props.onChange();
        value.render();
        value.input('cover_editor_renumber').props.onChange({ target: { checked: false } });
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.render();
        const header = childrenOf(value.dialog()).find(node => node.type === 'header');
        const buttons = nodes(header).filter(node => node.type === 'button');
        assert.deepEqual(buttons.map(node => node.props['aria-label']), ['cover_editor_help_button', 'cover_editor_close']);
        assert.equal(textContent(buttons[0]), '?');
        buttons[0].props.onClick();
        value.render();
        const help = helpDialog(value);
        assert.ok(help);
        assert.ok(!value.dialog().contains(help), 'The help dialog is outside the inert editor');
        assert.ok(help.parent.parent === value.dialog().parent, 'Both dialogs share the editor backdrop');
        assert.equal(value.dialog().props.inert, '');
        assert.equal(String(value.dialog().props['aria-hidden']), 'true');
        assert.equal(help.props['aria-labelledby'], `${value.dialog().props['aria-labelledby']}-help`);
        assert.ok(nodes(help).some(node => node.props.id === help.props['aria-labelledby']));
        assert.ok(nodes(help).some(node => node.type === 'table'), 'The format and storage guide is present');
        assert.deepEqual(value.calls.execute, []);
        const close = nodes(help).find(node => node.type === 'button' && textContent(node) === 'cover_editor_close');
        assert.ok(close);
        close.props.onClick();
        value.render();
        assert.equal(helpDialog(value), undefined);
        assert.notEqual(value.dialog().props.inert, '');
        assert.notEqual(String(value.dialog().props['aria-hidden']), 'true');
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.input('cover_editor_add').props.checked, true);
        assert.equal(value.input('cover_editor_renumber').props.checked, false);
        assert.equal(value.input('cover_editor_backup').props.checked, false);
        assert.deepEqual(value.calls.inspect, ['/library/book.cbz']);
        assert.deepEqual(value.calls.preview, ['/images/new.png']);
        assert.equal(value.calls.close, 0);
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(value.calls.execute[0].imagePath, '/images/new.png');
        assert.equal(value.calls.execute[0].mode, 'add');
        assert.equal(value.calls.execute[0].renumber, false);
        assert.equal(value.calls.execute[0].backup, false);
    } finally { value.close(); }
});

test('help contains focus and keyboard navigation, and Escape returns focus without closing the cover editor', async () => {
    const value = await fixture();
    try {
        value.button('cover_editor_help_button').props.onClick();
        value.render();
        const help = helpDialog(value);
        assert.ok(help.contains(document.activeElement));
        for (const outside of [value.dialog(), value.button('cover_editor_local_browse'), { tagName: 'DIV', className: 'selected' }]) {
            const focused = value.focusElement(outside);
            assert.equal(document.activeElement, help);
            assert.equal(focused.propagationStopped, true);
        }
        const focusable = help.querySelectorAll();
        assert.ok(focusable.length >= 2);
        focusable.at(-1).focus();
        const tab = event({ key: 'Tab' });
        value.tree().props.onKeyDown(tab);
        assert.equal(tab.defaultPrevented, true);
        assert.equal(tab.propagationStopped, true);
        assert.equal(document.activeElement, focusable[0]);
        const reverse = event({ key: 'Tab', shiftKey: true });
        value.tree().props.onKeyDown(reverse);
        assert.equal(reverse.defaultPrevented, true);
        assert.equal(document.activeElement, focusable.at(-1));
        const escape = event({ key: 'Escape' });
        value.tree().props.onKeyDown(escape);
        value.render();
        assert.equal(escape.defaultPrevented, true);
        assert.equal(escape.propagationStopped, true);
        assert.equal(helpDialog(value), undefined);
        assert.equal(value.calls.close, 0);
        assert.equal(document.activeElement, value.button('cover_editor_help_button'));
        value.tree().props.onKeyDown(event({ key: 'Escape' }));
        assert.equal(value.calls.close, 1);
    } finally { value.close(); }
});

test('the help header close button and backdrop dismiss only help and leave the cover editor usable', async () => {
    const value = await fixture();
    try {
        for (const gesture of ['header', 'backdrop']) {
            value.button('cover_editor_help_button').props.onClick();
            value.render();
            const help = helpDialog(value);
            const contentClick = event({ target: help, currentTarget: help.parent });
            help.parent.props.onMouseDown(contentClick);
            assert.equal(contentClick.propagationStopped, true);
            value.render();
            assert.ok(helpDialog(value), 'Clicking help content does not dismiss it');
            if (gesture === 'header') {
                const header = childrenOf(helpDialog(value)).find(node => node.type === 'header');
                nodes(header).find(node => node.type === 'button' && node.props['aria-label'] === 'cover_editor_close').props.onClick();
            } else {
                const backdrop = helpDialog(value).parent;
                const backdropClick = event({ target: backdrop, currentTarget: backdrop });
                backdrop.props.onMouseDown(backdropClick);
                assert.equal(backdropClick.propagationStopped, true);
            }
            value.render();
            assert.equal(helpDialog(value), undefined, gesture);
            assert.equal(value.calls.close, 0, gesture);
            assert.equal(document.activeElement, value.button('cover_editor_help_button'), gesture);
        }
        assert.deepEqual(value.calls.execute, []);
        await value.browse();
        assert.equal(value.button('cover_editor_save').props.disabled, false);
    } finally { value.close(); }
});

function searchForm(value) {
    return value.all(node => node.type === 'form' && node.props.className === 'cover-editor-search')[0];
}

const searchApiSelect = value => value.all(node => node.type === 'select' && node.props.className === 'cover-editor-search-api')[0];

test('disabled cover sources disappear from the menu and a restored disabled selection falls back to unified', async () => {
    const metadataApiEnabled = { '리디북스': false, '문피아': false, Goodreads: false };
    const value = await fixture({ metadataApiEnabled, preferences: { apiSource: '문피아' } });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        await value.settle();
        assert.equal(searchApiSelect(value).props.value, '통합검색');
        const choices = childrenOf(searchApiSelect(value)).map(node => node.props.value);
        assert.ok(choices.includes('통합검색'));
        assert.ok(choices.includes('Open Library'));
        assert.ok(!choices.some(source => metadataApiEnabled[source] === false));
        assert.equal(value.calls.preferences.at(-1).apiSource, '통합검색');
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.ok(value.calls.metadata.length > 0);
        assert.ok(value.calls.metadata.every(request => metadataApiEnabled[request.apiSource] !== false));
    } finally { value.close(); }
});

test('changing enabled cover sources cancels pending results and all-off search sends no requests', async () => {
    const pending = deferred();
    const value = await fixture({ preferences: { apiSource: '리디북스' }, metadata: () => pending.promise });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.equal(value.calls.metadata.length, 1);
        const metadataApiEnabled = Object.fromEntries(metadataApiPolicy.ALL_METADATA_API_SOURCES.map(source => [source.value, false]));
        value.updateProps({ metadataApiEnabled });
        await value.settle();
        assert.equal(searchApiSelect(value).props.value, '통합검색');
        assert.deepEqual(childrenOf(searchApiSelect(value)).map(node => node.props.value), ['통합검색']);
        pending.resolve({ success: true, results: [metadataResult], hasNext: true });
        await value.settle();
        assert.ok(!value.text().includes(metadataResult.title));
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.equal(value.calls.metadata.length, 1);
        assert.deepEqual(value.calls.toasts.at(-1), { key: 'cover_editor_metadata_no_apis' });
    } finally { value.close(); }
});

test('saving unrelated settings with the same enabled sources preserves an ongoing cover search', async () => {
    const pending = deferred();
    const value = await fixture({ metadataApiEnabled: { Goodreads: false }, preferences: { apiSource: '리디북스' }, metadata: () => pending.promise });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        value.updateProps({ metadataApiEnabled: { Goodreads: false, '리디북스': true } });
        await value.settle();
        pending.resolve({ success: true, results: [metadataResult], hasNext: true });
        await value.settle();
        assert.ok(value.text().includes(metadataResult.title));
        assert.equal(value.calls.metadata.length, 1);
    } finally { value.close(); }
});

test('cover API selection defaults to unified, persists with other options, and is restored on reopen', async () => {
    let preferences;
    const value = await fixture({ onPreferencesChange: updated => { preferences = updated; } });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        assert.equal(searchApiSelect(value).props.value, '통합검색');
        assert.equal(childrenOf(searchForm(value))[1], searchApiSelect(value));
        searchApiSelect(value).props.onChange({ target: { value: '문피아' } });
        value.render();
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.render();
        assert.equal(preferences.apiSource, '문피아');
        assert.equal(preferences.backup, false);
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.deepEqual(value.calls.metadata.map(request => request.apiSource), ['문피아']);
        value.button('cover_editor_metadata_reset').props.onClick();
        value.render();
        assert.equal(searchApiSelect(value).props.value, '문피아');
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
    const reopened = await fixture({ preferences });
    try {
        reopened.button('cover_editor_source_metadata').props.onClick();
        reopened.render();
        assert.equal(searchApiSelect(reopened).props.value, '문피아');
        assert.equal(reopened.input('cover_editor_backup').props.checked, false);
        assert.deepEqual(reopened.calls.preferences, []);
    } finally { reopened.close(); }
});

test('changing the cover API cancels old requests and pagination uses only the newly selected provider', async () => {
    const pending = deferred();
    const value = await fixture({ metadata: request => request.apiSource === '문피아'
        ? { success: true, results: [{ ...metadataResult, title: 'Current provider' }], hasNext: request.page === 1 }
        : pending.promise });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        const oldCount = value.calls.metadata.length;
        searchApiSelect(value).props.onChange({ target: { value: '문피아' } });
        value.render();
        assert.equal(value.button('cover_editor_metadata_next').props.disabled, true);
        assert.equal(value.all(node => node.props['aria-label'] === 'cover_editor_metadata_loading').length, 0);
        searchForm(value).props.onSubmit(event());
        await value.settle();
        await value.button('cover_editor_metadata_next').props.onClick();
        await value.settle();
        pending.resolve({ success: true, results: [{ ...metadataResult, title: 'Obsolete provider' }], hasNext: true });
        await value.settle();
        assert.deepEqual(value.calls.metadata.slice(oldCount).map(({ apiSource, page }) => [apiSource, page]), [['문피아', 1], ['문피아', 2]]);
        assert.ok(value.text().includes('Current provider'));
        assert.ok(!value.text().includes('Obsolete provider'));
        assert.equal(value.button('cover_editor_metadata_next').props.disabled, true);
        searchApiSelect(value).props.onChange({ target: { value: '리디북스' } });
        value.render();
        assert.ok(!value.text().includes('Current provider'));
        assert.equal(value.button('cover_editor_metadata_previous').props.disabled, true);
    } finally { value.close(); }
});

test('unsupported file types temporarily use unified search without losing the saved API', async () => {
    const value = await fixture({ embedded: true, files: ['book.cbz', 'book.epub'].map(selectedFile),
        preferences: { apiSource: 'Anilist' }, inspect: path => fileInfo(path.split('/').at(-1)) });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        assert.equal(searchApiSelect(value).props.value, 'Anilist');
        fileButton(value, 'book.epub').props.onMouseDown(event({ button: 0, target: { closest: () => null } }));
        await value.settle();
        assert.equal(searchApiSelect(value).props.value, '통합검색');
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.render();
        assert.equal(value.calls.preferences.at(-1).apiSource, 'Anilist');
        fileButton(value, 'book.cbz').props.onMouseDown(event({ button: 0, target: { closest: () => null } }));
        await value.settle();
        assert.equal(searchApiSelect(value).props.value, 'Anilist');
    } finally { value.close(); }
});

test('a selected cover API without its required key shows the settings hint without fetching', async () => {
    const value = await fixture({ preferences: { apiSource: '알라딘' } });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.deepEqual(value.calls.metadata, []);
        assert.deepEqual(value.calls.toasts, [{ key: 'api_key_missing' }]);
        assert.equal(searchApiSelect(value).props.value, '알라딘');
        assert.equal(value.button('cover_editor_metadata_next').props.disabled, true);
        assert.equal(value.all(node => node.props['aria-label'] === 'cover_editor_metadata_loading').length, 0);
    } finally { value.close(); }
});

test('unified cover search passes file type and API keys, then applies only the selected cover image', async () => {
    const chosen = deferred();
    const apiKeys = { aladin: 'configured-key' };
    const value = await fixture({ apiKeys, metadataPreview: () => chosen.promise });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        const query = value.all(node => node.type === 'input' && node.props.type === 'text')[0];
        assert.equal(query.props.value, 'book');
        query.props.onChange({ target: { value: '  Book volume 2 cover  ' } });
        value.render();
        const submit = event();
        searchForm(value).props.onSubmit(submit);
        await value.settle();
        assert.equal(submit.defaultPrevented, true);
        assert.ok(value.calls.metadata.length > 1);
        assert.ok(value.calls.metadata.every(request => request.query === 'Book volume 2 cover' && request.page === 1 && request.bookType === 'comic' && request.apiKeys === apiKeys));
        assert.ok(value.calls.metadata.some(request => request.apiSource === '알라딘'));
        assert.deepEqual(value.calls.metadataPreview, []);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        const choice = value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0];
        const selecting = choice.props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.metadataPreview, [{ imageUrl: 'https://img.ridicdn.net/cover/123/xxlarge?dpi=xxhdpi#1' }]);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        chosen.resolve(preview('/temporary/metadata-cover.png'));
        await selecting;
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/temporary/metadata-cover.png').dataUrl);
        assert.equal(value.currentImage().props.src, defaultInfo.coverDataUrl);
        assert.deepEqual(value.calls.execute, []);
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute[0].imagePath, '/temporary/metadata-cover.png');
        assert.equal(value.calls.execute[0].imageVersion, 'image-version');
        assert.equal(value.calls.execute[0].filePath, defaultInfo.filePath);
        assert.equal(value.calls.execute[0].targetEntry, defaultInfo.coverEntry);
        assert.equal('metadata' in value.calls.execute[0], false);
        assert.equal('title' in value.calls.execute[0], false);
        assert.equal('author' in value.calls.execute[0], false);
    } finally { value.close(); }
});

test('cover search uses book providers for EPUB and text while preserving PDF and audio search types', async () => {
    for (const [kind, bookType] of [['epub', 'book'], ['text', 'book'], ['pdf', 'pdf'], ['audio', 'audio']]) {
        const value = await fixture({ info: { kind } });
        try {
            value.button('cover_editor_source_metadata').props.onClick();
            value.render();
            searchForm(value).props.onSubmit(event());
            await value.settle();
            assert.ok(value.calls.metadata.length > 0);
            assert.ok(value.calls.metadata.every(request => request.bookType === bookType), kind);
        } finally { value.close(); }
    }
});

test('cover search starts with a cleaned title and preserves volume numbers added by the user', async () => {
    const value = await fixture({ file: selectedFile('마계 001화_고해상도_전체판.zip') });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        const query = value.all(node => node.type === 'input' && node.props.type === 'text')[0];
        assert.equal(query.props.value, '마계');
        query.props.onChange({ target: { value: '1984 vol3 cover' } });
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.ok(value.calls.metadata.every(request => request.query === '1984 vol3 cover'));
    } finally { value.close(); }
});

test('cancelled or failed metadata cover selection preserves the chosen image and empty queries do not search', async () => {
    for (const outcome of [{ cancelled: true }, { error: 'Image download failed' }, { code: 'COVER_METADATA_IMAGE_UNAVAILABLE', error: 'Unavailable remote cover' },
        { code: 'COVER_IMAGE_TOO_MANY_PIXELS', error: 'Choose a valid image with no more than 64 million pixels.' }]) {
        const value = await fixture({ metadataPreview: () => outcome });
        try {
            await value.browse();
            value.button('cover_editor_source_metadata').props.onClick();
            value.render();
            searchForm(value).props.onSubmit(event());
            await value.settle();
            await value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0].props.onClick();
            await value.settle();
            assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
            assert.equal(value.button('cover_editor_save').props.disabled, false);
            assert.equal(value.alert(), '');
            assert.deepEqual(value.calls.toasts, outcome.cancelled ? [] : [{ key: outcome.code === 'COVER_METADATA_IMAGE_UNAVAILABLE'
                ? 'cover_editor_metadata_image_unavailable' : outcome.code === 'COVER_IMAGE_TOO_MANY_PIXELS'
                    ? 'cover_editor_image_too_many_pixels' : 'cover_editor_image_load_failed' }]);
            assert.deepEqual(value.calls.released, []);
            const requestCount = value.calls.metadata.length;
            const query = value.all(node => node.type === 'input' && node.props.type === 'text')[0];
            query.props.onChange({ target: { value: '   ' } });
            value.render();
            assert.equal(value.button('cover_editor_metadata_search').props.disabled, true);
            searchForm(value).props.onSubmit(event());
            await value.settle();
            assert.equal(value.calls.metadata.length, requestCount);
        } finally { value.close(); }
    }
});

test('changing the image source discards a pending metadata cover and releases its obsolete temporary image', async () => {
    const pending = deferred();
    const value = await fixture({ metadataPreview: () => pending.promise });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0].props.onClick();
        value.render();
        value.button('cover_editor_source_local').props.onClick();
        await value.settle();
        await value.browse();
        pending.resolve(preview('/temporary/obsolete-metadata.png'));
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.deepEqual(value.calls.released, [{ imagePath: '/temporary/obsolete-metadata.png' }]);
        assert.equal(value.alert(), '');
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        value.button('cover_editor_clear').props.onClick();
        value.render();
        assert.equal(value.newImage(), undefined);
        assert.deepEqual(value.calls.released.at(-1), { imagePath: '/images/new.png' });
    } finally { value.close(); }
});

test('thumbnail loading keeps the editor available and preserves the preview until the latest selection finishes', async () => {
    for (const source of ['metadata', 'archive']) {
        for (const obsoleteOutcome of ['success', 'failure']) {
            const first = deferred();
            const second = deferred();
            const titles = source === 'metadata' ? [metadataResult.title, 'Second metadata cover'] : ['first.png', 'second.png'];
            const value = await fixture({
                embedded: true, files: [selectedFile('book.cbz')], info: { canSelectArchiveImage: true },
                preferences: { apiSource: '리디북스' },
                metadata: () => ({ success: true, hasNext: true, results: [metadataResult, { ...metadataResult, id: '456', title: titles[1] }] }),
                metadataPreview: ({ imageUrl }) => imageUrl.includes('/123/') ? first.promise : second.promise,
                archiveList: () => ({ entries: titles.map(name => ({ name })), offset: 0, total: 3 }),
                archivePreview: ({ entryName }) => entryName === titles[0] ? first.promise : second.promise,
            });
            try {
                await value.browse();
                value.button(`cover_editor_source_${source}`).props.onClick();
                await value.settle();
                if (source === 'metadata') {
                    searchForm(value).props.onSubmit(event());
                    await value.settle();
                }
                const choice = title => value.all(node => node.type === 'button' && node.props.title === title)[0];
                const busyUpdates = [...value.calls.busy];
                const choosingFirst = choice(titles[0]).props.onClick();
                await value.settle();
                assert.equal(value.calls.busy.at(-1), false);
                assert.deepEqual(value.calls.busy, busyUpdates);
                assert.equal(value.calls.imageDropAvailable.at(-1), true);
                assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
                assert.equal(value.all(node => node.props.className?.includes('cover-editor-candidate'))[0].props['aria-busy'], true);
                assert.equal(value.all(node => node.type === 'fieldset' && node.props.className === 'cover-editor-options')[0].props.disabled, false);
                assert.equal(value.button('cover_editor_export').props.disabled, false);
                assert.equal(value.button('cover_editor_clear').props.disabled, false);
                assert.equal(value.button(`cover_editor_${source}_next`).props.disabled, false);
                assert.ok(titles.every(title => choice(title).props.disabled === false));
                if (source === 'metadata') {
                    assert.equal(searchApiSelect(value).props.disabled, false);
                    assert.equal(value.button('cover_editor_metadata_search').props.disabled, false);
                }
                assert.equal(value.button('cover_editor_save').props.disabled, true);
                await value.button('cover_editor_save').props.onClick();
                assert.deepEqual(value.calls.execute, []);
                const choosingSecond = choice(titles[1]).props.onClick();
                await value.settle();
                second.resolve(preview('/temporary/latest.png'));
                await choosingSecond;
                await value.settle();
                assert.equal(value.newImage().props.src, preview('/temporary/latest.png').dataUrl);
                assert.equal(value.button('cover_editor_save').props.disabled, false);
                if (obsoleteOutcome === 'success') first.resolve(preview('/temporary/obsolete.png'));
                else first.reject(new Error('Obsolete image failure'));
                await choosingFirst;
                await value.settle();
                assert.equal(value.newImage().props.src, preview('/temporary/latest.png').dataUrl);
                assert.deepEqual(value.calls.busy, busyUpdates);
                assert.deepEqual(value.calls.toasts, []);
                assert.deepEqual(value.calls.released, [{ imagePath: '/images/new.png' },
                    ...(obsoleteOutcome === 'success' ? [{ imagePath: '/temporary/obsolete.png' }] : [])]);
            } finally { value.close(); }
        }
    }
});

test('clearing a cover during thumbnail loading cancels the selection and releases its late image', async () => {
    const pending = deferred();
    const value = await fixture({ metadataPreview: () => pending.promise });
    try {
        await value.browse();
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        const selecting = value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0].props.onClick();
        await value.settle();
        assert.equal(value.button('cover_editor_clear').props.disabled, false);
        value.button('cover_editor_clear').props.onClick();
        await value.settle();
        assert.equal(value.newImage(), undefined);
        assert.equal(value.all(node => node.props.className?.includes('cover-editor-candidate'))[0].props['aria-busy'], false);
        pending.resolve(preview('/temporary/cleared.png'));
        await selecting;
        await value.settle();
        assert.equal(value.newImage(), undefined);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        assert.deepEqual(value.calls.released, [{ imagePath: '/images/new.png' }, { imagePath: '/temporary/cleared.png' }]);
        assert.deepEqual(value.calls.toasts, []);
    } finally { value.close(); }
});

test('partial search failures toast once without inline retry controls and keep usable paginated results', async () => {
    let fail = true;
    const value = await fixture({ metadata: request => request.apiSource === '문피아' && fail
        ? { success: false, error: 'Unavailable provider' }
        : { success: true, hasNext: request.page === 1 && request.apiSource === '리디북스', results: request.apiSource === '리디북스' ? [{ ...metadataResult, id: request.page, title: `Page ${request.page}` }] : [] } });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.deepEqual(value.calls.toasts, [{ key: 'cover_editor_metadata_partial_failed', values: ['문피아'] }]);
        assert.equal(value.text().includes('cover_editor_metadata_partial_failed'), false);
        assert.equal(value.button('cover_editor_metadata_retry'), undefined);
        assert.ok(value.all(node => node.type === 'button' && node.props.title === 'Page 1').length);
        await value.settle();
        assert.equal(value.calls.toasts.length, 1);
        assert.equal(value.button('cover_editor_metadata_previous').props.disabled, true);
        const query = value.all(node => node.type === 'input' && node.props.type === 'text')[0];
        query.props.onChange({ target: { value: 'Unsubmitted new query' } });
        value.render();
        await value.button('cover_editor_metadata_next').props.onClick();
        await value.settle();
        assert.ok(value.calls.metadata.filter(request => request.page === 2).every(request => request.query === 'book'));
        assert.equal(value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.value, 'book');
        assert.equal(value.button('cover_editor_metadata_previous').props.disabled, false);
        assert.equal(value.button('cover_editor_metadata_next').props.disabled, true);
        assert.equal(value.calls.toasts.length, 2);
        fail = false;
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.equal(value.text().includes('cover_editor_metadata_partial_failed'), false);
        assert.equal(value.calls.toasts.length, 2);
        assert.ok(value.all(node => node.type === 'button' && node.props.title === 'Page 1').length);
    } finally { value.close(); }
});

test('search failure toasts and can search again without losing the selected cover or coverless pagination', async () => {
    let fail = true;
    const value = await fixture({ metadata: () => fail ? { success: false, error: 'Provider failed' }
        : { success: true, results: [{ title: 'No image' }], hasNext: true } });
    try {
        await value.browse();
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.deepEqual(value.calls.toasts, [{ key: 'cover_editor_metadata_failed' }]);
        assert.equal(value.alert(), '');
        assert.equal(value.button('cover_editor_metadata_retry'), undefined);
        assert.equal(value.text().includes('cover_editor_metadata_empty'), false);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        fail = false;
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.equal(value.alert(), '');
        assert.ok(value.text().includes('cover_editor_metadata_empty'));
        assert.equal(value.button('cover_editor_metadata_next').props.disabled, false);
    } finally { value.close(); }
});

test('superseded cover searches cannot overwrite the latest results', async () => {
    const old = deferred();
    const value = await fixture({ metadata: request => request.query === 'book' ? old.promise
        : { success: true, results: request.apiSource === '리디북스' ? [{ ...metadataResult, title: 'Current result' }] : [] } });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.ok(value.all(node => node.props.role === 'status' && node.props['aria-label'] === 'cover_editor_metadata_loading').length);
        value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.onChange({ target: { value: 'Current query' } });
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.ok(value.all(node => node.type === 'button' && node.props.title === 'Current result').length);
        const previousRequestCount = value.calls.metadata.filter(request => request.query === 'book').length;
        old.resolve({ success: true, results: [{ ...metadataResult, title: 'Obsolete result' }] });
        await value.settle();
        assert.equal(value.calls.metadata.filter(request => request.query === 'book').length, previousRequestCount);
        assert.equal(value.text().includes('Obsolete result'), false);
        assert.ok(value.text().includes('Current result'));
    } finally { value.close(); }
});

test('reduced motion replaces the animated search graphic with visible progress text', async () => {
    const pending = deferred();
    const value = await fixture({ reducedMotion: true, metadata: () => pending.promise });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        const status = value.all(node => node.props.className === 'cover-editor-search-loading')[0];
        assert.equal(status.props.role, 'status');
        assert.equal(textContent(status), 'cover_editor_metadata_loading');
        assert.equal(nodes(status).some(node => node.type === 'img'), false);
        pending.resolve({ success: true, results: [], hasNext: false });
        await value.settle();
        assert.equal(value.all(node => node.props.className === 'cover-editor-search-loading').length, 0);
    } finally { value.close(); }
});

test('changing a source or target and closing cancel pending metadata search work', async () => {
    for (const action of ['source', 'target', 'close']) {
        const pending = deferred();
        const value = await fixture({ files: ['first.cbz', 'second.cbz'].map(selectedFile), inspect: filePath => fileInfo(filePath.split('/').at(-1)), metadata: () => pending.promise });
        try {
            value.button('cover_editor_source_metadata').props.onClick();
            value.render();
            searchForm(value).props.onSubmit(event());
            await value.settle();
            const requestCount = value.calls.metadata.length;
            if (action === 'source') value.button('cover_editor_source_local').props.onClick();
            else if (action === 'target') await fileButton(value, 'second.cbz').props.onClick();
            else { value.button('cover_editor_cancel').props.onClick(); value.unmount(); }
            await value.settle();
            pending.resolve({ success: false, error: 'Obsolete failure' });
            await value.settle();
            assert.equal(value.calls.metadata.length, requestCount, action);
            assert.equal(value.text().includes('Obsolete result'), false, action);
            assert.equal(value.calls.updatesAfterUnmount, 0, action);
            assert.deepEqual(value.calls.toasts, [], action);
            if (action === 'target') assert.equal(value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.value, 'second');
        } finally { value.close(); }
    }
});

test('reset cancels pending cover searches, clears failed search state, focuses the input, and preserves the selected cover', async () => {
    const pending = deferred();
    let responseMode = 'normal';
    const value = await fixture({ metadata: request => responseMode === 'pending' ? pending.promise
        : responseMode === 'failed' ? { success: false, error: 'Provider failed' }
            : { success: true, results: request.apiSource === '리디북스' ? [metadataResult] : [] } });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        await value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0].props.onClick();
        await value.settle();
        responseMode = 'pending';
        value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.onChange({ target: { value: 'Pending query' } });
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        const requestCount = value.calls.metadata.length;
        const input = value.all(node => node.type === 'input' && node.props.type === 'text')[0];
        value.button('cover_editor_metadata_reset').props.onClick();
        assert.equal(document.activeElement, input);
        await value.settle();
        assert.equal(value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.value, '');
        assert.equal(value.button('cover_editor_metadata_search').props.disabled, true);
        assert.equal(value.all(node => node.props.role === 'status' && node.props['aria-label'] === 'cover_editor_metadata_loading').length, 0);
        const clearedResults = value.all(node => node.props.className === 'cover-editor-search-results');
        assert.equal(clearedResults.length, 1);
        assert.equal(textContent(clearedResults[0]), '');
        assert.equal(value.newImage().props.src, preview('/temporary/metadata-cover.png').dataUrl);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        pending.resolve({ success: false, error: 'Late failure' });
        await value.settle();
        assert.equal(value.calls.metadata.length, requestCount);
        assert.equal(value.text().includes('Late result'), false);
        assert.deepEqual(value.calls.toasts, []);
        responseMode = 'failed';
        value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.onChange({ target: { value: 'Failed query' } });
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        assert.deepEqual(value.calls.toasts, [{ key: 'cover_editor_metadata_failed' }]);
        assert.equal(value.alert(), '');
        value.button('cover_editor_metadata_reset').props.onClick();
        await value.settle();
        assert.equal(value.alert(), '');
        assert.equal(value.newImage().props.src, preview('/temporary/metadata-cover.png').dataUrl);
        assert.deepEqual(value.calls.released, []);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('cover result dimensions use the loaded thumbnail and ignore old image events across pages and searches', async () => {
    const value = await fixture({ metadata: request => ({ success: true, hasNext: request.page === 1,
        results: request.apiSource === '리디북스' ? [{ ...metadataResult, coverCacheUrl: `data:image/png;base64,page-${request.page}` }] : [] }) });
    const loadedImage = page => value.all(node => node.type === 'img' && node.props.src === `data:image/png;base64,page-${page}`)[0];
    const dimensions = () => textContent(value.all(node => node.props.className === 'cover-editor-search-dimensions')[0]);
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        const first = loadedImage(1);
        assert.equal(dimensions(), 'cover_editor_metadata_dimensions_unknown');
        first.props.onLoad({ currentTarget: { naturalWidth: 640, naturalHeight: 900 } });
        value.render();
        assert.equal(dimensions(), '640 × 900');
        await value.button('cover_editor_metadata_next').props.onClick();
        await value.settle();
        loadedImage(2).props.onLoad({ currentTarget: { naturalWidth: 800, naturalHeight: 1200 } });
        value.render();
        first.props.onLoad({ currentTarget: { naturalWidth: 999, naturalHeight: 999 } });
        first.props.onError({ currentTarget: {} });
        value.render();
        assert.equal(dimensions(), '800 × 1200');
        assert.notEqual(loadedImage(2).props.hidden, true);
        value.button('cover_editor_metadata_reset').props.onClick();
        value.render();
        value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.onChange({ target: { value: 'book' } });
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        first.props.onLoad({ currentTarget: { naturalWidth: 111, naturalHeight: 222 } });
        first.props.onError({ currentTarget: {} });
        value.render();
        assert.equal(dimensions(), 'cover_editor_metadata_dimensions_unknown');
        assert.notEqual(loadedImage(1).props.hidden, true);
        loadedImage(1).props.onLoad({ currentTarget: { naturalWidth: 0, naturalHeight: 0 } });
        value.render();
        assert.equal(dimensions(), 'cover_editor_metadata_dimensions_unknown');
        loadedImage(1).props.onLoad({ currentTarget: { naturalWidth: 320, naturalHeight: 480 } });
        value.render();
        assert.equal(dimensions(), '320 × 480');
        const current = loadedImage(1);
        current.props.onError({ currentTarget: {} });
        value.render();
        assert.equal(dimensions(), 'cover_editor_metadata_dimensions_unknown');
        assert.equal(loadedImage(1).props.hidden, true);
        assert.deepEqual(value.calls.metadataPreview, []);
        assert.deepEqual(value.calls.preview, []);
        value.unmount();
        current.props.onLoad({ currentTarget: { naturalWidth: 12, naturalHeight: 34 } });
        assert.equal(value.calls.updatesAfterUnmount, 0);
    } finally { value.close(); }
});

test('cover search upgrades cached thumbnails in the background and selects the displayed high quality cover', async () => {
    const pending = deferred();
    const fallback = 'bookmanager-thumbnail://api-cover/small.jpg';
    const highQuality = 'bookmanager-thumbnail://api-cover/original.jpg';
    const value = await fixture({
        metadata: request => ({ success: true, results: request.apiSource === '리디북스' ? [{ ...metadataResult, coverCacheUrl: fallback }] : [] }),
        cacheCover: () => pending.promise,
        readImageSize: async url => url === highQuality ? { width: 1200, height: 1800 } : { width: 240, height: 360 },
    });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        searchForm(value).props.onSubmit(event());
        await value.settle();
        const initial = value.all(node => node.type === 'img' && node.props.src === fallback)[0];
        assert.ok(initial);
        assert.equal(value.button('cover_editor_metadata_search').props.disabled, false);
        assert.equal(value.all(node => node.props.className === 'cover-editor-search-loading').length, 0);
        pending.resolve({ coverCacheUrl: highQuality });
        await value.settle();
        assert.ok(value.all(node => node.type === 'img' && node.props.src === highQuality).length);
        assert.equal(textContent(value.all(node => node.props.className === 'cover-editor-search-dimensions')[0]), '1200 × 1800');
        initial.props.onError({ currentTarget: {} });
        value.render();
        assert.ok(value.all(node => node.type === 'img' && node.props.src === highQuality).length);
        await value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0].props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.metadataPreview, [{ imageUrl: highQuality }]);
        const upgraded = value.all(node => node.type === 'img' && node.props.src === highQuality)[0];
        upgraded.props.onError({ currentTarget: {} });
        value.render();
        const restored = value.all(node => node.type === 'img' && node.props.src === fallback)[0];
        assert.ok(restored);
        assert.notEqual(restored.props.hidden, true);
        upgraded.props.onLoad({ currentTarget: { naturalWidth: 1200, naturalHeight: 1800 } });
        restored.props.onLoad({ currentTarget: { naturalWidth: 240, naturalHeight: 360 } });
        value.render();
        assert.equal(textContent(value.all(node => node.props.className === 'cover-editor-search-dimensions')[0]), '240 × 360');
        assert.deepEqual(value.calls.toasts, []);
    } finally { value.close(); }
});

test('late high quality thumbnails cannot replace results after search reset, page or source changes, or unmount', async () => {
    for (const change of ['reset', 'page', 'source', 'unmount']) {
        const pending = deferred();
        const highQuality = 'bookmanager-thumbnail://api-cover/obsolete.jpg';
        let cacheCalls = 0;
        const value = await fixture({
            metadata: request => ({ success: true, hasNext: true, results: request.apiSource === '리디북스'
                ? [{ ...metadataResult, id: String(123 + request.page), coverCacheUrl: `bookmanager-thumbnail://api-cover/page-${request.page}.jpg` }] : [] }),
            cacheCover: async () => ++cacheCalls === 1 ? pending.promise : {},
            readImageSize: async url => url === highQuality ? { width: 1200, height: 1800 } : { width: 240, height: 360 },
        });
        try {
            value.button('cover_editor_source_metadata').props.onClick();
            value.render();
            searchForm(value).props.onSubmit(event());
            await value.settle();
            assert.equal(cacheCalls, 1);
            if (change === 'reset') value.button('cover_editor_metadata_reset').props.onClick();
            else if (change === 'page') await value.button('cover_editor_metadata_next').props.onClick();
            else if (change === 'source') value.button('cover_editor_source_local').props.onClick();
            else value.unmount();
            await value.settle();
            pending.resolve({ coverCacheUrl: highQuality });
            await value.settle();
            assert.equal(value.all(node => node.type === 'img' && node.props.src === highQuality).length, 0, change);
            assert.equal(value.calls.updatesAfterUnmount, 0, change);
            assert.deepEqual(value.calls.toasts, [], change);
        } finally { value.close(); }
    }
});

test('archive pages request thumbnails separately and only the selected entry gets a full size preview', async () => {
    const entries = Array.from({ length: 41 }, (_, index) => ({ name: `images/page-${index + 1}.png` }));
    const value = await fixture({
        info: { canSelectArchiveImage: true },
        archiveList: ({ offset, limit }) => ({ entries: entries.slice(offset, offset + limit), total: entries.length, offset }),
    });
    try {
        assert.deepEqual(value.calls.archiveList, []);
        value.button('cover_editor_source_archive').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.archiveList, [{ filePath: defaultInfo.filePath, version: defaultInfo.version, offset: 0, limit: 40 }]);
        assert.deepEqual(value.calls.archivePreview, []);
        assert.equal(value.button('cover_editor_archive_previous').props.disabled, true);
        assert.equal(value.button('cover_editor_archive_next').props.disabled, false);
        await value.button('cover_editor_archive_next').props.onClick();
        await value.settle();
        assert.equal(value.calls.archiveList[1].offset, 40);
        assert.equal(value.button('cover_editor_archive_previous').props.disabled, false);
        assert.equal(value.button('cover_editor_archive_next').props.disabled, true);
        assert.deepEqual(value.calls.archivePreview, []);
        const choice = value.all(node => node.type === 'button' && node.props.title === entries[40].name)[0];
        await choice.props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.archivePreview, [{ filePath: defaultInfo.filePath, version: defaultInfo.version, entryName: entries[40].name }]);
        assert.equal(value.newImage().props.src, preview('/temporary/archive-cover.png').dataUrl);
        assert.equal(value.all(node => node.type === 'button' && node.props.title === entries[40].name)[0].props['aria-pressed'], true);
        assert.deepEqual(value.calls.execute, []);
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute[0].imagePath, '/temporary/archive-cover.png');
        assert.equal(value.calls.execute[0].targetEntry, defaultInfo.coverEntry);
    } finally { value.close(); }
});

test('archive thumbnail batches display progressively with dimensions and keep failed items selectable', async () => {
    const entries = Array.from({ length: 17 }, (_, index) => ({ name: `page-${index + 1}.png` }));
    const pending = [deferred(), deferred(), deferred()];
    let next = 0;
    const value = await fixture({
        info: { canSelectArchiveImage: true },
        archiveList: () => ({ entries, total: entries.length, offset: 0 }),
        archiveThumbnails: () => pending[next++].promise,
    });
    try {
        value.button('cover_editor_source_archive').props.onClick();
        await value.settle();
        assert.equal(value.calls.archiveThumbnails.length, 1);
        assert.deepEqual(value.calls.archiveThumbnails[0], { filePath: defaultInfo.filePath, version: defaultInfo.version, entryNames: entries.slice(0, 8).map(entry => entry.name) });
        assert.equal(value.all(node => node.type === 'button' && node.props.title === 'page-17.png')[0].props.disabled, false);
        assert.ok(value.text().includes('cover_editor_archive_thumbnail_loading'));
        pending[0].resolve({ entries: entries.slice(0, 8).map((entry, index) => index === 1 ? { ...entry, error: 'Invalid image' }
            : { ...entry, thumbnailDataUrl: `data:image/png;base64,thumb:${entry.name}`, width: 1600, height: 2400 }) });
        await value.settle();
        assert.equal(value.calls.archiveThumbnails.length, 2);
        assert.equal(value.calls.archiveThumbnails[1].entryNames.length, 8);
        assert.ok(value.all(node => node.type === 'img' && node.props.src === 'data:image/png;base64,thumb:page-1.png').length);
        const firstChoice = value.all(node => node.type === 'button' && node.props.title === 'page-1.png')[0];
        assert.ok(textContent(firstChoice).includes('1600 × 2400'));
        const failedChoice = value.all(node => node.type === 'button' && node.props.title === 'page-2.png')[0];
        assert.ok(textContent(failedChoice).includes('cover_editor_archive_thumbnail_unavailable'));
        assert.equal(failedChoice.props.disabled, false);
        assert.deepEqual(value.calls.archivePreview, []);
        await failedChoice.props.onClick();
        await value.settle();
        assert.equal(value.calls.archivePreview[0].entryName, 'page-2.png');
        pending[1].reject(new Error('Batch preview failed'));
        await value.settle();
        assert.equal(value.calls.archiveThumbnails.length, 3);
        assert.deepEqual(value.calls.archiveThumbnails[2].entryNames, ['page-17.png']);
        pending[2].resolve({ entries: [{ name: 'page-17.png', thumbnailDataUrl: 'data:image/png;base64,last', width: 800, height: 1200 }] });
        await value.settle();
        assert.equal(value.text().includes('cover_editor_archive_thumbnail_loading'), false);
        assert.ok(value.text().includes('800 × 1200'));
    } finally { value.close(); }
});

test('changing archive pages abandons pending thumbnails and prevents more obsolete batch requests', async () => {
    const entries = Array.from({ length: 41 }, (_, index) => ({ name: `page-${index + 1}.png` }));
    const oldPage = deferred();
    const value = await fixture({
        info: { canSelectArchiveImage: true },
        archiveList: ({ offset, limit }) => ({ entries: entries.slice(offset, offset + limit), total: entries.length, offset }),
        archiveThumbnails: ({ entryNames }) => entryNames[0] === 'page-1.png' ? oldPage.promise
            : { entries: entryNames.map(name => ({ name, thumbnailDataUrl: 'data:image/png;base64,current-page', width: 600, height: 900 })) },
    });
    try {
        value.button('cover_editor_source_archive').props.onClick();
        await value.settle();
        await value.button('cover_editor_archive_next').props.onClick();
        await value.settle();
        assert.equal(value.calls.archiveThumbnails.length, 2);
        oldPage.resolve({ entries: [{ name: 'page-1.png', thumbnailDataUrl: 'data:image/png;base64,obsolete', width: 100, height: 200 }] });
        await value.settle();
        assert.equal(value.calls.archiveThumbnails.length, 2);
        assert.equal(value.all(node => node.type === 'img' && node.props.src === 'data:image/png;base64,obsolete').length, 0);
        assert.ok(value.all(node => node.type === 'img' && node.props.src === 'data:image/png;base64,current-page').length);
    } finally { value.close(); }
});

test('source changes, selected targets, and closing stop obsolete archive thumbnail batches', async () => {
    for (const action of ['source', 'target', 'close']) {
        const pending = deferred();
        const infos = ['first.cbz', 'second.cbz'].map(name => fileInfo(name, { canSelectArchiveImage: true }));
        const value = await fixture({
            files: infos.map(info => selectedFile(info.name)),
            inspect: filePath => infos.find(info => info.filePath === filePath),
            archiveList: () => ({ entries: Array.from({ length: 9 }, (_, index) => ({ name: `page-${index}.png` })), total: 9, offset: 0 }),
            archiveThumbnails: ({ filePath, entryNames }) => filePath === infos[0].filePath ? pending.promise
                : { entries: entryNames.map(name => ({ name, thumbnailDataUrl: 'data:image/png;base64,second', width: 600, height: 900 })) },
        });
        try {
            value.button('cover_editor_source_archive').props.onClick();
            await value.settle();
            if (action === 'source') value.button('cover_editor_source_local').props.onClick();
            else if (action === 'target') await fileButton(value, 'second.cbz').props.onClick();
            else { value.button('cover_editor_cancel').props.onClick(); value.unmount(); }
            await value.settle();
            pending.resolve({ entries: [{ name: 'page-0.png', thumbnailDataUrl: 'data:image/png;base64,obsolete', width: 100, height: 200 }] });
            await value.settle();
            assert.equal(value.calls.archiveThumbnails.filter(request => request.filePath === infos[0].filePath).length, 1, action);
            assert.equal(value.calls.updatesAfterUnmount, 0, action);
            assert.equal(value.all(node => node.type === 'img' && node.props.src === 'data:image/png;base64,obsolete').length, 0, action);
        } finally { value.close(); }
    }
});

test('thumbnail cancellation and source conflicts stop the remaining requests', async () => {
    for (const response of [{ cancelled: true }, { error: 'Changed archive', code: 'COVER_SOURCE_CHANGED' }]) {
        const value = await fixture({
            info: { canSelectArchiveImage: true },
            archiveList: () => ({ entries: Array.from({ length: 9 }, (_, index) => ({ name: `page-${index}.png` })), total: 9, offset: 0 }),
            archiveThumbnails: () => response,
        });
        try {
            value.button('cover_editor_source_archive').props.onClick();
            await value.settle();
            assert.equal(value.calls.archiveThumbnails.length, 1);
            assert.equal(value.text().includes('cover_editor_archive_thumbnail_loading'), false);
            assert.equal(value.alert(), response.error ? 'cover_editor_source_changed' : '');
        } finally { value.close(); }
    }
});

test('unsupported sources never request archive contents and a failed archive listing can be retried', async () => {
    const unsupported = await fixture({ info: { kind: 'text', canSelectArchiveImage: false } });
    try {
        unsupported.button('cover_editor_source_archive').props.onClick();
        await unsupported.settle();
        assert.ok(unsupported.text().includes('cover_editor_archive_unavailable'));
        assert.deepEqual(unsupported.calls.archiveList, []);
    } finally { unsupported.close(); }
    let requests = 0;
    const value = await fixture({
        info: { canSelectArchiveImage: true },
        archiveList: () => ++requests === 1 ? { error: 'Archive could not be opened' } : { entries: [], offset: 0, total: 0 },
    });
    try {
        value.button('cover_editor_source_archive').props.onClick();
        await value.settle();
        assert.equal(value.alert(), 'Archive could not be opened');
        await value.button('cover_editor_archive_retry').props.onClick();
        await value.settle();
        assert.equal(value.alert(), '');
        assert.ok(value.text().includes('cover_editor_archive_empty'));
        assert.deepEqual(value.calls.archivePreview, []);
    } finally { value.close(); }
});

test('batch archive selection ignores previous file listings and applies the chosen image to every target', async () => {
    const infos = ['first.cbz', 'second.cbz'].map(name => fileInfo(name, { canSelectArchiveImage: true }));
    const firstListing = deferred();
    const value = await fixture({
        files: infos.map(info => selectedFile(info.name)),
        inspect: filePath => infos.find(info => info.filePath === filePath),
        archiveList: ({ filePath }) => filePath === infos[0].filePath ? firstListing.promise : { entries: [{ name: 'second-page.png' }], offset: 0, total: 1 },
        execute: saveBatchSuccessfully,
    });
    try {
        value.button('cover_editor_source_archive').props.onClick();
        await value.settle();
        await fileButton(value, 'second.cbz').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.archiveList.map(request => request.filePath), infos.map(info => info.filePath));
        firstListing.resolve({ entries: [{ name: 'obsolete-first-page.png' }], offset: 0, total: 1 });
        await value.settle();
        assert.equal(value.text().includes('obsolete-first-page.png'), false);
        await value.all(node => node.type === 'button' && node.props.title === 'second-page.png')[0].props.onClick();
        await value.settle();
        assert.equal(value.calls.archivePreview[0].filePath, infos[1].filePath);
        assert.equal(value.calls.archivePreview[0].version, infos[1].version);
        await value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.execute[0].map(request => request.imagePath), ['/temporary/archive-cover.png', '/temporary/archive-cover.png']);
        assert.deepEqual(value.calls.execute[0].map(request => request.filePath), infos.map(info => info.filePath));
    } finally { value.close(); }
});

test('changing the batch source file invalidates an in-flight archive preview', async () => {
    const pending = deferred();
    const infos = ['first.cbz', 'second.cbz'].map(name => fileInfo(name, { canSelectArchiveImage: true }));
    const value = await fixture({
        files: infos.map(info => selectedFile(info.name)),
        inspect: filePath => infos.find(info => info.filePath === filePath),
        archivePreview: () => pending.promise,
    });
    try {
        value.button('cover_editor_source_archive').props.onClick();
        await value.settle();
        value.all(node => node.type === 'button' && node.props.title === 'pages/02.png')[0].props.onClick();
        value.render();
        await fileButton(value, 'second.cbz').props.onClick();
        await value.settle();
        pending.resolve(preview('/temporary/old-file-preview.png'));
        await value.settle();
        assert.equal(value.newImage(), undefined);
        assert.deepEqual(value.calls.released, [{ imagePath: '/temporary/old-file-preview.png' }]);
        assert.equal(value.button('cover_editor_batch_save').props.disabled, true);
        value.button('cover_editor_source_metadata').props.onClick();
        value.render();
        assert.equal(value.all(node => node.type === 'input' && node.props.type === 'text')[0].props.value, 'second');
    } finally { value.close(); }
});

test('closing while a remote selection is pending releases its late result without updating unmounted state', async () => {
    for (const source of ['metadata', 'archive']) {
        const pending = deferred();
        const value = await fixture({ info: { canSelectArchiveImage: true }, metadataPreview: () => pending.promise, archivePreview: () => pending.promise });
        try {
            value.button(`cover_editor_source_${source}`).props.onClick();
            await value.settle();
            if (source === 'metadata') {
                searchForm(value).props.onSubmit(event());
                await value.settle();
                value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0].props.onClick();
            }
            else value.all(node => node.type === 'button' && node.props.title === 'pages/02.png')[0].props.onClick();
            value.render();
            value.button('cover_editor_cancel').props.onClick();
            value.unmount();
            pending.resolve(preview(`/temporary/late-${source}.png`));
            await value.settle();
            assert.equal(value.calls.updatesAfterUnmount, 0);
            assert.equal(value.calls.close, 1);
            assert.deepEqual(value.calls.released, [undefined, { imagePath: `/temporary/late-${source}.png` }]);
            assert.deepEqual(value.calls.execute, []);
        } finally { value.close(); }
    }
});

test('the embedded select-all button reflects target checks without changing the preview or cover options', async () => {
    const files = ['first.cbz', 'second.cbz'].map(selectedFile);
    const value = await fixture({ embedded: true, files, inspect: path => fileInfo(path.split('/').at(-1)),
        preferences: { mode: 'add', backup: true, renumber: true } });
    try {
        await value.browse();
        fileButton(value, 'second.cbz').props.onMouseDown(event({ button: 0, target: { closest: () => null } }));
        await value.settle();
        const initialInspections = [...value.calls.inspect];
        for (const checked of [[true, true], [false, false], [true, false]]) {
            value.updateProps({ files: files.map((file, index) => ({ ...file, checked: checked[index] })) });
            await value.settle();
            const button = value.button('toggle_all');
            assert.equal(button.props.disabled, false);
            assert.equal(button.props['aria-pressed'], checked.every(Boolean));
            button.props.onClick(event());
            assert.equal(fileButton(value, 'second.cbz').props['aria-selected'], true);
            assert.equal(value.currentImage().props.src, fileInfo('second.cbz').coverDataUrl);
            assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
            assert.equal(value.input('cover_editor_add').props.checked, true);
            assert.equal(value.input('cover_editor_backup').props.checked, true);
            assert.equal(value.input('cover_editor_renumber').props.checked, true);
        }
        assert.equal(value.calls.toggledAll, 3);
        assert.deepEqual(value.calls.inspect, initialInspections);
        assert.deepEqual(value.calls.toggledFiles, []);
        assert.deepEqual(value.calls.released, []);
        value.updateProps({ onToggleAll: undefined });
        assert.equal(value.button('toggle_all').props.disabled, true);
        value.button('toggle_all').props.onClick(event());
        assert.equal(value.calls.toggledAll, 3);
    } finally { value.close(); }
});

test('the embedded tool keeps file addition in the shared toolbar and locks selection during inspection', async () => {
    const pending = deferred();
    const value = await fixture({ embedded: true, files: [], inspect: () => pending.promise });
    try {
        assert.deepEqual(value.calls.inspect, []);
        assert.equal(value.dialog(), undefined);
        assert.ok(value.text().includes('drag_drop'));
        assert.equal(value.currentImage(), undefined);
        assert.equal(value.newImage(), undefined);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        assert.equal(value.button('cover_editor_tool_clear_files'), undefined);
        assert.equal(value.button('cover_editor_tool_add_files'), undefined);
        assert.equal(value.button('toggle_all').props.disabled, true);
        assert.equal(value.button('toggle_all').props['aria-pressed'], false);
        value.button('toggle_all').props.onClick(event());
        assert.equal(value.calls.toggledAll, 0);
        assert.equal(value.all(node => node.props.className === 'renamer-archive-delete-btn').length, 0);
        value.updateProps({ files: [selectedFile('added.cbz')] });
        await value.settle();
        assert.deepEqual(value.calls.inspect, ['/library/added.cbz']);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-check')[0].props.disabled, true);
        assert.equal(value.button('toggle_all').props.disabled, true);
        value.button('toggle_all').props.onClick(event());
        assert.equal(value.calls.toggledAll, 0);
        const remove = value.all(node => node.props.className === 'renamer-archive-delete-btn')[0];
        assert.equal(remove.props.disabled, true);
        remove.props.onClick(event());
        assert.deepEqual(value.calls.removedFiles, []);
        assert.equal(value.button('tools.back').props.disabled, true);
        assert.equal(value.calls.busy.at(-1), true);
        pending.resolve(fileInfo('added.cbz'));
        await value.settle();
        assert.ok(fileButton(value, 'added.cbz'));
        assert.equal(value.currentImage().props.src, fileInfo('added.cbz').coverDataUrl);
        const checkbox = value.all(node => node.props.className === 'cover-editor-file-check')[0];
        assert.equal(checkbox.props.disabled, false);
        assert.equal(checkbox.props['aria-label'], 'added.cbz');
        checkbox.props.onChange(event());
        assert.deepEqual(value.calls.toggledFiles, ['/library/added.cbz']);
        assert.equal(value.calls.busy.at(-1), false);
    } finally { value.close(); }
});

test('the embedded worklist uses the shared table, plain status columns, and independent keyboard preview selection', async () => {
    const files = ['first.cbz', 'notes.txt', 'last.epub'].map(selectedFile);
    const value = await fixture({ embedded: true, files,
        inspect: path => fileInfo(path.split('/').at(-1), { size: 1572864, pageCount: 12 }) });
    try {
        const table = value.all(node => node.props.className === 'renamer-table')[0];
        assert.ok(table);
        assert.deepEqual(nodes(table).filter(node => node.type === 'th').map(textContent), ['col_name', 'cover_editor_tool_page_count', 'col_size', 'tf_col_status', 'cover_editor_filename_preview', 'cover_editor_tool_remove']);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-detail-toggle').length, 0);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-badges').length, 0);
        assert.deepEqual(childrenOf(fileButton(value, 'first.cbz')).map(textContent), ['first.cbz', '12', '1.5 MB', 'cover_editor_batch_ready', 'cover_editor_filename_preview', '']);
        assert.deepEqual(childrenOf(fileButton(value, 'notes.txt')).map(textContent), ['notes.txt', '—', '1.5 MB', 'cover_editor_batch_ready', 'cover_editor_filename_preview', '']);
        const wrapper = () => value.all(node => node.props.className === 'renamer-table-wrapper cover-editor-file-table')[0];
        assert.equal(wrapper().props.tabIndex, 0);
        fileButton(value, 'notes.txt').props.onMouseDown(event({ button: 0, target: { closest: () => null } }));
        await value.settle();
        assert.equal(fileButton(value, 'notes.txt').props.className, 'selected');
        assert.equal(value.currentImage().props.src, fileInfo('notes.txt').coverDataUrl);
        assert.deepEqual(value.calls.toggledFiles, []);
        for (const [key, selected] of [['ArrowDown', 'last.epub'], ['Home', 'first.cbz'], ['End', 'last.epub'], ['ArrowUp', 'notes.txt']]) {
            const keyEvent = event({ key, target: { tagName: 'DIV' } });
            wrapper().props.onKeyDown(keyEvent);
            await value.settle();
            assert.equal(keyEvent.defaultPrevented, true);
            assert.equal(fileButton(value, selected).props.className, 'selected');
        }
        const checkboxKey = event({ key: 'ArrowDown', target: { tagName: 'INPUT' } });
        wrapper().props.onKeyDown(checkboxKey);
        await value.settle();
        assert.equal(checkboxKey.defaultPrevented, false);
        assert.equal(fileButton(value, 'notes.txt').props.className, 'selected');
        const checkbox = value.all(node => node.props.className === 'cover-editor-file-check' && node.props['aria-label'] === 'first.cbz')[0];
        const checkboxClick = event();
        checkbox.props.onClick(checkboxClick);
        assert.equal(checkboxClick.propagationStopped, true);
        checkbox.props.onChange(event());
        assert.deepEqual(value.calls.toggledFiles, ['/library/first.cbz']);
        assert.equal(fileButton(value, 'notes.txt').props.className, 'selected');
    } finally { value.close(); }
});

test('removing the previewed row selects its neighbour and preserves the chosen cover until the list is empty', async () => {
    let files = ['first.cbz', 'middle.cbz', 'last.cbz'].map(selectedFile);
    const value = await fixture({ embedded: true, files, inspect: path => fileInfo(path.split('/').at(-1)) });
    try {
        await value.browse();
        fileButton(value, 'middle.cbz').props.onMouseDown(event({ button: 0, target: { closest: () => null } }));
        await value.settle();
        for (const [name, next] of [['middle.cbz', 'last.cbz'], ['last.cbz', 'first.cbz'], ['first.cbz', null]]) {
            const remove = nodes(fileButton(value, name)).find(node => node.type === 'button' && node.props['aria-label'] === 'cover_editor_tool_remove_file');
            assert.equal(remove.props.disabled, false);
            const click = event();
            remove.props.onClick(click);
            assert.equal(click.propagationStopped, true);
            assert.equal(value.calls.removedFiles.at(-1), `/library/${name}`);
            files = files.filter(file => file.name !== name);
            value.updateProps({ files });
            await value.settle();
            if (next) assert.equal(fileButton(value, next).props['aria-selected'], true);
            else assert.equal(value.currentImage(), undefined);
            assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
            assert.deepEqual(value.calls.translations.filter(call => call.key === 'cover_editor_tool_total_files').at(-1).values, { count: files.length });
        }
        assert.deepEqual(value.calls.toggledFiles, []);
        assert.deepEqual(value.calls.released, []);
    } finally { value.close(); }
});

test('checking embedded targets preserves inspection and cover state and saves only the checked file', async () => {
    const files = [selectedFile('notes.txt'), selectedFile('book.cbz')];
    const value = await fixture({ embedded: true, files, inspect: path => fileInfo(path.split('/').at(-1)),
        preferences: { mode: 'add', backup: true, renumber: true } });
    try {
        assert.equal(value.input('cover_editor_add'), undefined);
        await value.browse();
        const initialInspections = [...value.calls.inspect];
        const notesCheckbox = value.all(node => node.props.className === 'cover-editor-file-check' && node.props['aria-label'] === 'notes.txt')[0];
        assert.equal(notesCheckbox.props.checked, true);
        notesCheckbox.props.onChange(event());
        assert.deepEqual(value.calls.toggledFiles, ['/library/notes.txt']);
        value.updateProps({ files: files.map(file => ({ ...file, checked: file.name === 'book.cbz' })) });
        await value.settle();
        assert.equal(fileButton(value, 'notes.txt').props['aria-selected'], true);
        assert.equal(value.currentImage().props.src, fileInfo('notes.txt').coverDataUrl);
        assert.deepEqual(value.calls.inspect, initialInspections);
        assert.deepEqual(value.calls.released, []);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.input('cover_editor_add').props.checked, true);
        assert.equal(value.input('cover_editor_renumber').props.checked, true);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(Array.isArray(value.calls.execute[0]), false);
        assert.equal(value.calls.execute[0].filePath, '/library/book.cbz');
        assert.equal(value.calls.execute[0].mode, 'add');
        assert.equal(value.calls.execute[0].renumber, true);
        assert.ok(textContent(fileButton(value, 'book.cbz')).includes('cover_editor_status_saved'));
        assert.ok(textContent(fileButton(value, 'notes.txt')).includes('cover_editor_batch_ready'));
        const completedLog = resultLogDialog(value).props.result;
        assert.equal(completedLog.stats.success.length, 1);
        assert.ok(completedLog.stats.success[0].includes('book.cbz'));
        resultLogDialog(value).props.onClose();
        await value.settle();
        assert.equal(value.button('toggle_all').props.disabled, false);
        value.button('toggle_all').props.onClick(event());
        assert.equal(value.calls.toggledAll, 1);
        value.button('cover_editor_view_result').props.onClick();
        await value.settle();
        assert.equal(resultLogDialog(value).props.result, completedLog);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-detail-toggle').length, 0);
    } finally { value.close(); }
});

test('embedded saving is disabled for no checked files and batch requests exclude unchecked and invalid files', async () => {
    const files = ['first.cbz', 'second.cbz', 'third.cbz', 'broken.cbz'].map(name => ({ ...selectedFile(name), checked: false }));
    const value = await fixture({ embedded: true, files,
        inspect: path => path.endsWith('broken.cbz') ? { error: 'Cannot inspect' } : fileInfo(path.split('/').at(-1)), execute: saveBatchSuccessfully });
    try {
        await value.browse();
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        await value.button('cover_editor_save').props.onClick();
        assert.deepEqual(value.calls.execute, []);
        value.updateProps({ files: files.map(file => ({ ...file, checked: file.name !== 'third.cbz' })) });
        await value.settle();
        const button = value.button('cover_editor_batch_save');
        assert.equal(button.props.disabled, false);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_batch_save').at(-1).values, [2]);
        await button.props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.execute[0].map(request => request.filePath), ['/library/first.cbz', '/library/second.cbz']);
        assert.equal(value.calls.inspect.length, files.length);
        assert.ok(textContent(fileButton(value, 'third.cbz')).includes('cover_editor_batch_ready'));
        assert.ok(textContent(fileButton(value, 'broken.cbz')).includes('cover_editor_batch_inspect_failed'));
    } finally { value.close(); }
});

test('external file collection locks embedded actions without reporting itself as internal busy work', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], inspect: () => fileInfo('book.cbz') });
    try {
        await value.browse();
        const busyUpdates = [...value.calls.busy];
        value.updateProps({ externalBusy: true });
        await value.settle();
        assert.deepEqual(value.calls.busy, busyUpdates);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        assert.equal(value.button('tools.back').props.disabled, true);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-check')[0].props.disabled, true);
        assert.equal(value.button('cover_editor_source_metadata').props.disabled, true);
        assert.equal(value.button('toggle_all').props.disabled, true);
        value.button('toggle_all').props.onClick(event());
        assert.equal(value.calls.toggledAll, 0);
        await value.button('cover_editor_save').props.onClick();
        assert.deepEqual(value.calls.execute, []);
        value.updateProps({ externalBusy: false });
        await value.settle();
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-check')[0].props.disabled, false);
        assert.deepEqual(value.calls.busy, busyUpdates);
    } finally { value.close(); }
});

test('the first embedded single-file inspection restores cover-aware defaults and honors explicitly saved false settings', async () => {
    for (const preferences of [undefined, { mode: 'replace', backup: false, renumber: false }, { renumber: false }]) {
        for (const initiallyEmpty of [false, true]) {
            const value = await fixture({ embedded: true, files: initiallyEmpty ? [] : [selectedFile('uncovered.cbz')], preferences,
                inspect: () => fileInfo('uncovered.cbz', { coverDataUrl: '' }) });
            try {
                if (initiallyEmpty) {
                    value.updateProps({ files: [selectedFile('uncovered.cbz')] });
                    await value.settle();
                }
                assert.equal(value.input(`cover_editor_${preferences?.mode || 'add'}`).props.checked, true);
                assert.equal(value.input('cover_editor_renumber').props.checked, preferences?.renumber ?? true);
                assert.equal(value.input('cover_editor_backup').props.checked, preferences?.backup ?? true);
                assert.deepEqual(value.calls.preferences, []);
                await value.browse();
                await value.button('cover_editor_save').props.onClick();
                assert.equal(value.calls.execute[0].mode, preferences?.mode || 'add');
                assert.equal(value.calls.execute[0].renumber, preferences?.renumber ?? true);
            } finally { value.close(); }
        }
    }
});

test('empty-tool option edits and defaults already applied to a batch survive later single-file inspections', async () => {
    for (const initialFiles of [[], [selectedFile('first.cbz'), selectedFile('second.cbz')]]) {
        const value = await fixture({ embedded: true, files: initialFiles, inspect: path => fileInfo(path.split('/').at(-1), { coverDataUrl: '' }) });
        try {
            if (!initialFiles.length) {
                value.input('cover_editor_replace').props.onChange();
                value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
                await value.settle();
            }
            value.updateProps({ files: [selectedFile('uncovered.cbz')] });
            await value.settle();
            assert.equal(value.input('cover_editor_replace').props.checked, true);
            assert.equal(value.input('cover_editor_renumber').props.checked, false);
            assert.equal(value.input('cover_editor_backup').props.checked, Boolean(initialFiles.length));
            value.updateProps({ files: [selectedFile('uncovered.cbz'), selectedFile('next.cbz')] });
            await value.settle();
            value.updateProps({ files: [selectedFile('next.cbz')] });
            await value.settle();
            assert.equal(value.input('cover_editor_replace').props.checked, true);
            assert.equal(value.input('cover_editor_renumber').props.checked, false);
            assert.equal(value.input('cover_editor_backup').props.checked, Boolean(initialFiles.length));
        } finally { value.close(); }
    }
});

test('embedded file inspection shows shared loading progress and unlocks after inspection errors', async () => {
    const first = deferred();
    const second = deferred();
    const value = await fixture({ embedded: true, files: ['first.cbz', 'second.cbz'].map(selectedFile),
        inspect: path => path.endsWith('first.cbz') ? first.promise : second.promise });
    try {
        const status = value.statusStates.at(-1);
        assert.equal(status.phase, 'analyzing');
        assert.equal(status.message, 'cover_editor_batch_inspecting');
        assert.equal(status.currentItemName, 'first.cbz');
        assert.equal(status.progress, 0);
        assert.equal(status.canCancel, false);
        assert.equal(resolveEffectiveWorkingTab(null, { tools: status }, 'tools'), 'tools');
        assert.equal(shouldUseLibraryScanSlide('tools', status), false);
        assert.equal(value.all(node => node.props.className?.includes('cover-editor-embedded'))[0].props.inert, '');
        first.resolve(fileInfo('first.cbz'));
        await value.settle();
        assert.equal(value.statusStates.at(-1).currentItemName, 'second.cbz');
        assert.equal(value.statusStates.at(-1).progress, 50);
        assert.ok(value.calls.translations.some(call => call.key === 'cover_editor_batch_inspecting' && call.values[0] === 1 && call.values[1] === 2));
        second.reject(new Error('Cannot read file'));
        await value.settle();
        assert.equal(value.statusStates.at(-1).phase, 'idle');
        assert.equal(value.statusStates.at(-1).currentItem, '');
        assert.equal(value.all(node => node.props.className?.includes('cover-editor-embedded'))[0].props.inert, undefined);
    } finally { value.close(); }
});

test('file collection shows the shared loading screen without marking its own collector busy or locking an empty tool', async () => {
    const value = await fixture({ embedded: true, files: [] });
    try {
        assert.ok(value.statusStates.every(status => status.phase === 'idle'));
        value.updateProps({ externalBusy: true });
        await value.settle();
        assert.equal(value.statusStates.at(-1).phase, 'analyzing');
        assert.equal(value.statusStates.at(-1).message, 'cover_editor_loading');
        assert.equal(value.statusStates.at(-1).canCancel, false);
        assert.equal(value.calls.busy.at(-1), false);
        value.updateProps({ externalBusy: false });
        await value.settle();
        assert.equal(value.statusStates.at(-1).phase, 'idle');
        value.updateProps({ externalBusy: true });
        await value.settle();
        value.unmount();
        assert.equal(value.statusStates.at(-1).phase, 'idle');
    } finally { value.close(); }
});

test('embedded single saves lock the app with the checked file and release the overlay on success or failure', async () => {
    for (const outcome of ['success', 'failure', 'throw']) {
        const pending = deferred();
        const value = await fixture({ embedded: true,
            files: [{ ...selectedFile('unchecked.cbz'), checked: false }, selectedFile('checked.cbz')],
            inspect: path => fileInfo(path.split('/').at(-1)), execute: () => pending.promise });
        try {
            await value.browse();
            assert.equal(value.statusStates.at(-1).phase, 'idle');
            const saving = value.button('cover_editor_save').props.onClick();
            await value.settle();
            const status = value.statusStates.at(-1);
            assert.equal(status.phase, 'executing');
            assert.equal(status.message, 'cover_editor_saving');
            assert.equal(status.currentItem, '/library/checked.cbz');
            assert.equal(status.currentItemName, 'checked.cbz');
            assert.equal(status.canCancel, false);
            assert.equal(resolveEffectiveWorkingTab(null, { tools: status }, 'tools'), 'tools');
            assert.equal(shouldUseLibraryScanSlide('tools', status), false);
            assert.equal(value.all(node => node.props.className?.includes('cover-editor-embedded'))[0].props.inert, '');
            if (outcome === 'throw') pending.reject(new Error('Write failed'));
            else pending.resolve({ success: outcome === 'success', filePath: '/library/checked.cbz', error: outcome === 'failure' ? 'Write failed' : '' });
            await saving;
            await value.settle();
            const finished = value.statusStates.at(-1);
            assert.equal(finished.phase, 'idle');
            assert.equal(finished.currentItem, '');
            assert.equal(finished.canCancel, false);
            assert.equal(resolveEffectiveWorkingTab(null, { tools: finished }, 'tools'), null);
            assert.ok(resultLogDialog(value));
        } finally { value.close(); }
    }
});

test('embedded batch overlay advances to the current file and the app cancel action stops remaining saves', async () => {
    const first = deferred();
    const second = deferred();
    const applied = [];
    const value = await fixture({ embedded: true, files: ['first.cbz', 'second.cbz', 'third.cbz'].map(selectedFile),
        inspect: path => fileInfo(path.split('/').at(-1)),
        execute: (requests, callbacks) => runCoverEditorBatch(requests, request => {
            applied.push(request.filePath);
            return applied.length === 1 ? first.promise : second.promise;
        }, callbacks) });
    try {
        await value.browse();
        const saving = value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        assert.equal(value.statusStates.at(-1).currentItemName, 'first.cbz');
        assert.equal(value.statusStates.at(-1).progress, 0);
        assert.equal(value.statusStates.at(-1).canCancel, true);
        first.resolve({ success: false, error: 'First file failed' });
        await value.settle();
        const status = value.statusStates.at(-1);
        assert.equal(status.currentItemName, 'second.cbz');
        assert.equal(status.progress, 1 / 3 * 100);
        assert.deepEqual(applied, ['/library/first.cbz', '/library/second.cbz']);
        value.dispatchAction({ activeTab: 'renamer', action: 'cancel-current' });
        assert.equal(value.calls.executeOptions[0].shouldCancel(), false);
        value.dispatchAction({ activeTab: 'tools', action: 'cancel-current' });
        await value.settle();
        assert.equal(value.calls.executeOptions[0].shouldCancel(), true);
        assert.equal(value.statusStates.at(-1).phase, 'cancelling');
        assert.equal(value.statusStates.at(-1).message, 'cover_editor_batch_cancelling');
        assert.equal(value.statusStates.at(-1).canCancel, true);
        assert.equal(value.statusStates.at(-1).currentItemName, 'second.cbz');
        second.resolve({ success: true });
        await saving;
        await value.settle();
        assert.equal(applied.length, 2);
        assert.equal(value.statusStates.at(-1).phase, 'idle');
        assert.equal(resultLogDialog(value).props.result.stats.skip.length, 1);
    } finally { value.close(); }
});

test('unmounting the embedded save clears its app lock and cancel listener without late status updates', async () => {
    const pending = deferred();
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')],
        inspect: () => fileInfo('only.cbz'), execute: () => pending.promise });
    try {
        await value.browse();
        const saving = value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.statusStates.at(-1).phase, 'executing');
        value.unmount();
        assert.equal(value.statusStates.at(-1).phase, 'idle');
        assert.equal(value.actionListenerCount(), 0);
        const statusCount = value.statusStates.length;
        pending.resolve({ success: true });
        await saving;
        assert.equal(value.statusStates.length, statusCount);
        assert.equal(value.calls.updatesAfterUnmount, 0);
    } finally { value.close(); }
});

test('an embedded single target opens the shared result log with warnings and can start a new task after closing it', async () => {
    const pending = deferred();
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')], inspect: () => fileInfo('only.cbz'), execute: () => pending.promise });
    try {
        assert.ok(fileButton(value, 'only.cbz').getClientRects().length);
        await value.browse();
        const saving = value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.busy.at(-1), true);
        assert.equal(value.button('tools.back').props.disabled, true);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-check')[0].props.disabled, true);
        pending.resolve({ success: true, filePath: '/library/only.cbz', backupPath: '/library/only.cbz.bak', warning: 'Refresh could not finish', readingAdjustmentUncertain: true });
        await saving;
        await value.settle();
        const row = fileButton(value, 'only.cbz');
        assert.ok(textContent(row).includes('cover_editor_status_saved'));
        assert.ok(textContent(row).includes('cover_editor_status_warning'));
        assert.ok(!value.text().includes('/library/only.cbz.bak'));
        assert.equal(value.calls.busy.at(-1), true);
        assert.equal(value.calls.imageDropAvailable.at(-1), false);
        const completedLog = resultLogDialog(value).props.result;
        assert.equal(completedLog.stats.success.length, 1);
        assert.deepEqual(completedLog.stats.error, []);
        assert.ok(completedLog.stats.success[0].includes('/library/only.cbz.bak'));
        assert.ok(completedLog.stats.success[0].includes('Refresh could not finish'));
        assert.ok(completedLog.stats.success[0].includes('cover_editor_reading_check'));
        assert.equal(value.all(node => node.props.className?.split(' ').includes('cover-editor-embedded'))[0].props.inert, '');
        resultLogDialog(value).props.onClose();
        await value.settle();
        assert.equal(value.calls.busy.at(-1), false);
        assert.equal(value.calls.close, 0);
        assert.equal(document.activeElement, value.button('cover_editor_view_result'));
        value.button('cover_editor_view_result').props.onClick();
        await value.settle();
        assert.equal(resultLogDialog(value).props.result, completedLog);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-detail-toggle').length, 0);
        assert.equal(value.button('cover_editor_save'), undefined);
        resultLogDialog(value).props.onClose();
        await value.settle();
        value.button('cover_editor_tool_reset').props.onClick();
        assert.equal(value.calls.reset, 1);
        assert.equal(value.calls.close, 0);
        assert.equal(value.calls.execute[0].filePath, '/library/only.cbz');
        assert.equal(Array.isArray(value.calls.execute[0]), false);
    } finally { value.close(); }
});

test('an embedded single-target failure opens the shared result log and a successful retry replaces it', async () => {
    let attempts = 0;
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')], inspect: () => fileInfo('only.cbz'),
        execute: async request => ++attempts === 1 ? { success: false, error: 'File is temporarily locked' } : { success: true, filePath: request.filePath } });
    try {
        await value.browse();
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.ok(textContent(fileButton(value, 'only.cbz')).includes('cover_editor_status_failed'));
        assert.equal(value.alert(), '');
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        const failedLog = resultLogDialog(value).props.result;
        assert.ok(failedLog.stats.error[0].includes('File is temporarily locked'));
        resultLogDialog(value).props.onClose();
        await value.settle();
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        value.button('cover_editor_view_result').props.onClick();
        await value.settle();
        assert.equal(resultLogDialog(value).props.result, failedLog);
        resultLogDialog(value).props.onClose();
        await value.settle();
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.ok(textContent(fileButton(value, 'only.cbz')).includes('cover_editor_status_saved'));
        assert.ok(!textContent(fileButton(value, 'only.cbz')).includes('cover_editor_status_failed'));
        assert.equal(value.alert(), '');
        assert.ok(!value.text().includes('File is temporarily locked'));
        assert.deepEqual(resultLogDialog(value).props.result.stats.error, []);
        assert.equal(resultLogDialog(value).props.result.stats.success.length, 1);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.calls.execute.length, 2);
    } finally { value.close(); }
});

test('embedded completion logs capture checked inspection errors, cancellations, warnings, and real outputs without row expansion', async () => {
    const files = ['saved.cbr', 'failed.cbz', 'cancelled.cbz', 'broken.cbz', 'unchecked.cbz'].map(name => ({ ...selectedFile(name), checked: name !== 'unchecked.cbz' }));
    const value = await fixture({ embedded: true, files,
        inspect: path => /(?:broken|unchecked)\.cbz$/.test(path) ? { error: `Cannot inspect ${path}` } : fileInfo(path.split('/').at(-1)),
        execute: async requests => ({ batch: true, successCount: 1, failureCount: 1, cancelledCount: 1, results: [
            { success: true, sourcePath: requests[0].filePath, filePath: '/library/saved.cbz', backupPath: '/library/saved.cbr.bak', readingWarning: 'Review reading progress' },
            { success: false, sourcePath: requests[1].filePath, error: 'Cannot save this file' },
            { success: false, sourcePath: requests[2].filePath, cancelled: true },
        ] }) });
    try {
        await value.browse();
        await value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        const completedLog = resultLogDialog(value).props.result;
        assert.equal(completedLog.stats.success.length, 1);
        assert.equal(completedLog.stats.skip.length, 1);
        assert.equal(completedLog.stats.error.length, 2);
        assert.deepEqual(completedLog.outputFiles, ['/library/saved.cbz']);
        assert.equal(completedLog.cancelled, true);
        assert.ok(completedLog.stats.success[0].includes('Review reading progress'));
        assert.ok(completedLog.stats.error.some(line => line.includes('broken.cbz')));
        assert.ok(!JSON.stringify(completedLog).includes('unchecked.cbz'));
        const logWrapper = value.all(node => node.props.className === 'cover-editor-result-modal')[0];
        const drop = event({ dataTransfer: {} });
        logWrapper.props.onDrop(drop);
        assert.equal(drop.defaultPrevented, true);
        assert.equal(drop.propagationStopped, true);
        resultLogDialog(value).props.onClose();
        await value.settle();
        value.updateProps({ files: files.map(file => ({ ...file, checked: false })) });
        await value.settle();
        value.button('cover_editor_view_result').props.onClick();
        await value.settle();
        assert.equal(resultLogDialog(value).props.result, completedLog);
        assert.equal(value.calls.close, 0);
        assert.equal(value.all(node => node.props.className === 'cover-editor-file-result').length, 0);
    } finally { value.close(); }
});

test('embedded batch failures cannot open a partial result log while the remaining saves can still be cancelled', async () => {
    const pending = deferred();
    const files = ['first.cbz', 'second.cbz'].map(selectedFile);
    const failed = { success: false, sourcePath: '/library/first.cbz', error: 'First file failed' };
    const value = await fixture({ embedded: true, files, inspect: path => fileInfo(path.split('/').at(-1)),
        execute: (requests, callbacks) => {
            callbacks.onProgress({ completed: 1, total: requests.length, filePath: requests[0].filePath, result: failed });
            return pending.promise;
        } });
    try {
        await value.browse();
        const saving = value.button('cover_editor_batch_save').props.onClick();
        await value.settle();
        assert.ok(textContent(fileButton(value, 'first.cbz')).includes('cover_editor_status_failed'));
        assert.equal(value.button('cover_editor_view_result'), undefined);
        assert.equal(resultLogDialog(value), undefined);
        assert.equal(value.button('cover_editor_batch_cancel_remaining').props.disabled, false);
        value.button('cover_editor_batch_cancel_remaining').props.onClick();
        assert.equal(value.calls.executeOptions[0].shouldCancel(), true);
        pending.resolve({ batch: true, successCount: 0, failureCount: 1, cancelledCount: 1,
            results: [failed, { success: false, sourcePath: '/library/second.cbz', cancelled: true }] });
        await saving;
        await value.settle();
        assert.ok(value.button('cover_editor_view_result'));
        assert.equal(resultLogDialog(value).props.result.stats.error.length, 1);
        assert.equal(resultLogDialog(value).props.result.stats.skip.length, 1);
    } finally { value.close(); }
});

test('embedded inspection errors are available through the shared result view before saving', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('broken.cbz')], inspect: () => ({ error: 'Archive cannot be read' }) });
    try {
        assert.equal(resultLogDialog(value), undefined);
        value.button('cover_editor_view_result').props.onClick();
        await value.settle();
        assert.ok(resultLogDialog(value).props.result.stats.error[0].includes('Archive cannot be read'));
        assert.equal(value.calls.busy.at(-1), true);
        resultLogDialog(value).props.onClose();
        await value.settle();
        assert.equal(value.calls.busy.at(-1), false);
        assert.equal(value.calls.close, 0);
    } finally { value.close(); }
});

test('unchecked inspection failures stay in the list without changing the completed run summary or success tone', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz'), { ...selectedFile('broken.cbz'), checked: false }],
        inspect: path => path.endsWith('broken.cbz') ? { error: 'Unchecked inspection failed' } : fileInfo('book.cbz') });
    try {
        await value.browse();
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.deepEqual(resultLogDialog(value).props.result.stats.error, []);
        assert.ok(value.all(node => node.props.className === 'cover-editor-footer-status is-success').length);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'log_summary').at(-1).values, [1, 0, 0]);
        assert.ok(textContent(fileButton(value, 'broken.cbz')).includes('cover_editor_batch_inspect_failed'));
    } finally { value.close(); }
});

test('adding, removing, and clearing embedded targets preserve the chosen cover and explicit save options', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('first.cbz')], inspect: path => fileInfo(path.split('/').at(-1)) });
    try {
        await value.browse();
        value.input('cover_editor_add').props.onChange();
        value.input('cover_editor_renumber').props.onChange({ target: { checked: false } });
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        await value.settle();
        value.updateProps({ files: [selectedFile('first.cbz'), selectedFile('second.cbz')] });
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.input('cover_editor_add').props.checked, true);
        value.updateProps({ files: [selectedFile('second.cbz')] });
        await value.settle();
        assert.equal(value.currentImage().props.src, fileInfo('second.cbz').coverDataUrl);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        value.updateProps({ files: [] });
        await value.settle();
        assert.ok(value.text().includes('drag_drop'));
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.input('cover_editor_add').props.checked, true);
        assert.equal(value.input('cover_editor_renumber').props.checked, false);
        assert.equal(value.input('cover_editor_backup').props.checked, false);
        assert.deepEqual(value.calls.released, []);
        value.updateProps({ files: [selectedFile('next.cbz')] });
        await value.settle();
        await value.button('cover_editor_save').props.onClick();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(value.calls.execute[0].filePath, '/library/next.cbz');
        assert.equal(value.calls.execute[0].imagePath, '/images/new.png');
        assert.equal(value.calls.execute[0].mode, 'add');
        assert.equal(value.calls.execute[0].renumber, false);
        assert.equal(value.calls.execute[0].backup, false);
        value.unmount();
        assert.deepEqual(value.calls.released, [undefined]);
    } finally { value.close(); }
});

test('changing embedded targets discards a pending image without releasing the previously chosen cover', async () => {
    const pending = deferred();
    const value = await fixture({ embedded: true, files: [selectedFile('first.cbz')], inspect: path => fileInfo(path.split('/').at(-1)),
        preview: path => path === '/images/new.png' ? preview(path) : pending.promise });
    try {
        await value.browse();
        value.updateProps({ localImageRequest: { id: 1, path: '/pending.png' } });
        await value.settle();
        value.updateProps({ files: [selectedFile('second.cbz')] });
        await value.settle();
        pending.resolve(preview('/pending.png'));
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.deepEqual(value.calls.released, [{ imagePath: '/pending.png' }]);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
    } finally { value.close(); }
});

test('the embedded editor allows app focus and keys and leaves only through its explicit back action', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')], inspect: () => fileInfo('only.cbz') });
    try {
        const outside = { tagName: 'BUTTON', name: 'other tool' };
        const focused = value.focusElement(outside);
        assert.equal(document.activeElement, outside);
        assert.equal(focused.propagationStopped, false);
        for (const key of ['Escape', 'Tab', 'ArrowDown']) {
            const keyEvent = event({ key });
            value.tree().props.onKeyDown(keyEvent);
            assert.equal(keyEvent.defaultPrevented, false, key);
            assert.equal(keyEvent.propagationStopped, false, key);
            assert.equal(document.activeElement, outside);
        }
        const root = value.tree();
        root.props.onMouseDown(event({ target: root, currentTarget: root }));
        assert.equal(value.calls.close, 0);
        const editor = value.all(node => node.props.className?.split(' ').includes('cover-editor-embedded'))[0];
        assert.notEqual(editor.props.role, 'dialog');
        assert.equal(editor.props['aria-modal'], undefined);
        value.button('tools.back').props.onClick();
        assert.equal(value.calls.close, 1);
        value.unmount();
        assert.equal(value.calls.restoredFocus, 0);
        assert.equal(value.focusListenerCount(), 0);
    } finally { value.close(); }
});

test('help remains modal inside the embedded tool and Escape restores the help button without leaving the tool', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')], inspect: () => fileInfo('only.cbz') });
    try {
        await value.browse();
        value.input('cover_editor_backup').props.onChange({ target: { checked: false } });
        value.button('cover_editor_help_button').props.onClick();
        value.render();
        const help = helpDialog(value);
        const editor = value.all(node => node.props.className?.split(' ').includes('cover-editor-embedded'))[0];
        assert.equal(help.props['aria-modal'], 'true');
        assert.equal(editor.props.inert, '');
        const focused = value.focusElement({ tagName: 'BUTTON', name: 'background' });
        assert.equal(focused.propagationStopped, true);
        assert.equal(document.activeElement, help);
        const focusable = help.querySelectorAll();
        focusable.at(-1).focus();
        const tab = event({ key: 'Tab' });
        value.tree().props.onKeyDown(tab);
        assert.equal(tab.defaultPrevented, true);
        assert.equal(document.activeElement, focusable[0]);
        const escape = event({ key: 'Escape' });
        value.tree().props.onKeyDown(escape);
        value.render();
        assert.equal(escape.defaultPrevented, true);
        assert.equal(helpDialog(value), undefined);
        assert.equal(document.activeElement, value.button('cover_editor_help_button'));
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.input('cover_editor_backup').props.checked, false);
        value.tree().props.onKeyDown(event({ key: 'Escape' }));
        assert.equal(value.calls.close, 0);
    } finally { value.close(); }
});

test('filename previews open the requested file without selecting or checking its row', async () => {
    const value = await fixture({ embedded: true,
        files: [selectedFile('first.cbz'), { ...selectedFile('second.cbz'), checked: false }],
        preferences: { mode: 'replace', renumber: true, backup: true },
        inspect: path => fileInfo(path.split('/').at(-1), path.endsWith('second.cbz')
            ? { coverEntry: 'second/cover.jpg', pages: [{ name: 'second/cover.jpg' }, { name: 'second/page.webp' }] }
            : { pages: [{ name: 'first/cover.png' }] }),
    });
    try {
        assert.equal(value.all(node => ['cover-editor-advanced', 'cover-editor-filenames'].includes(node.props.className)).length, 0);
        const currentCover = value.currentImage().props.src;
        const previewButton = filenamePreviewButton(value, 'second.cbz');
        const click = event({ currentTarget: previewButton });
        previewButton.props.onClick(click);
        value.render();
        assert.equal(click.propagationStopped, true);
        const modal = filenameDialog(value);
        assert.ok(modal);
        assert.ok(textContent(modal).includes('second.cbz'));
        assert.deepEqual(filenameRows(value), [['second/cover.jpg', '0000.jpg'], ['second/page.webp', '0001.webp']]);
        assert.equal(value.currentImage().props.src, currentCover);
        assert.equal(fileButton(value, 'first.cbz').props['aria-selected'], true);
        assert.deepEqual(value.calls.toggledFiles, []);
        assert.deepEqual(value.calls.removedFiles, []);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('filename replacement previews change the chosen cover extension and preserve other page extensions', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')],
        preferences: { mode: 'replace', renumber: true, backup: true },
        inspect: () => fileInfo('only.cbz', { coverEntry: 'pages/cover.jpg', pages: [{ name: 'pages/front.webp' }, { name: 'pages/cover.jpg' }, { name: 'pages/end.jpeg' }], pageCount: 3 }),
    });
    try {
        await value.browse();
        openFilenamePreview(value, 'only.cbz');
        assert.deepEqual(filenameRows(value), [['pages/front.webp', '0000.webp'], ['pages/cover.jpg', '0001.png'], ['pages/end.jpeg', '0002.jpeg']]);
    } finally { value.close(); }
});

test('filename addition previews use the full page count for numbering even when inspection returns only a sample', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')],
        preferences: { mode: 'add', renumber: true, backup: true },
        inspect: () => fileInfo('only.cbz', { pages: [{ name: 'pages/first.jpg' }, { name: 'pages/second.webp' }], pageCount: 10000 }),
    });
    try {
        await value.browse();
        openFilenamePreview(value, 'only.cbz');
        const rows = filenameRows(value);
        assert.equal(rows.length, 3);
        assert.deepEqual(rows[0], ['cover_editor_new', '00000.png']);
        assert.deepEqual(rows.slice(1), [['pages/first.jpg', '00001.jpg'], ['pages/second.webp', '00002.webp']]);
        assert.deepEqual(value.calls.translations.filter(item => item.key === 'cover_editor_filename_preview_count').at(-1).values, [2, 10000]);
        assert.deepEqual(value.calls.execute, []);
    } finally { value.close(); }
});

test('filename previews are unavailable when renumbering is off, unsupported, empty, or the tool is busy', async () => {
    for (const scenario of [
        { preferences: { renumber: false } },
        { info: { canRenumber: false } },
        { info: { pages: [], pageCount: 0 } },
        { externalBusy: true },
    ]) {
        const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')],
            preferences: { renumber: true, ...scenario.preferences }, externalBusy: scenario.externalBusy,
            inspect: () => fileInfo('only.cbz', scenario.info),
        });
        try {
            assert.equal(filenamePreviewButton(value, 'only.cbz').props.disabled, true);
            assert.equal(filenameDialog(value), undefined);
        } finally { value.close(); }
    }
});

test('filename preview traps focus, blocks saves and drops, and restores its row button on dismissal', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')],
        preferences: { mode: 'replace', renumber: true, backup: false }, inspect: () => fileInfo('only.cbz') });
    try {
        await value.browse();
        const imageSource = value.newImage().props.src;
        for (const gesture of ['escape', 'header', 'footer', 'backdrop']) {
            const opener = openFilenamePreview(value, 'only.cbz');
            const modal = filenameDialog(value);
            const editor = value.all(node => node.props.className?.split(' ').includes('cover-editor-embedded'))[0];
            assert.equal(modal.props['aria-modal'], 'true');
            assert.equal(editor.props.inert, '');
            assert.equal(String(editor.props['aria-hidden']), 'true');
            assert.equal(value.calls.busy.at(-1), true);
            assert.equal(value.calls.imageDropAvailable.at(-1), false);
            const focus = value.focusElement({ tagName: 'BUTTON', name: 'background' });
            assert.equal(focus.propagationStopped, true);
            assert.equal(document.activeElement, modal);
            const focusable = modal.querySelectorAll();
            focusable.at(-1).focus();
            const tab = event({ key: 'Tab' });
            value.tree().props.onKeyDown(tab);
            assert.equal(tab.defaultPrevented, true);
            assert.equal(document.activeElement, focusable[0]);
            const reverseTab = event({ key: 'Tab', shiftKey: true });
            value.tree().props.onKeyDown(reverseTab);
            assert.equal(reverseTab.defaultPrevented, true);
            assert.equal(document.activeElement, focusable.at(-1));
            assert.equal(value.button('cover_editor_save').props.disabled, true);
            await value.button('cover_editor_save').props.onClick();
            assert.deepEqual(value.calls.execute, []);
            const drop = event({ dataTransfer: { files: [{ path: '/library/dropped.cbz' }] } });
            modal.parent.props.onDrop(drop);
            assert.equal(drop.defaultPrevented, true);
            assert.equal(drop.propagationStopped, true);
            const contentClick = event({ target: modal, currentTarget: modal.parent });
            modal.parent.props.onMouseDown(contentClick);
            value.render();
            assert.ok(filenameDialog(value));
            if (gesture === 'escape') {
                const escape = event({ key: 'Escape' });
                value.tree().props.onKeyDown(escape);
                assert.equal(escape.defaultPrevented, true);
                assert.equal(escape.propagationStopped, true);
            } else if (gesture === 'backdrop') {
                const backdrop = filenameDialog(value).parent;
                backdrop.props.onMouseDown(event({ target: backdrop, currentTarget: backdrop }));
            } else {
                const area = childrenOf(filenameDialog(value)).find(node => node.type === gesture);
                nodes(area).find(node => node.type === 'button').props.onClick();
            }
            value.render();
            assert.equal(filenameDialog(value), undefined, gesture);
            assert.equal(document.activeElement, opener, gesture);
            assert.equal(value.calls.busy.at(-1), false, gesture);
            assert.equal(value.calls.imageDropAvailable.at(-1), true, gesture);
            assert.equal(value.newImage().props.src, imageSource, gesture);
            assert.equal(value.input('cover_editor_backup').props.checked, false, gesture);
            assert.equal(value.calls.close, 0, gesture);
        }
    } finally { value.close(); }
});

test('embedded book and image drops reach the wrapper from every editor surface while help blocks drops', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('only.cbz')], inspect: () => fileInfo('only.cbz') });
    let wrapperDrops = 0;
    const bubbleDrop = (target, path) => {
        const drop = event({ target, dataTransfer: { files: [{ path }] } });
        for (let current = target; current && !drop.propagationStopped; current = current.parent) {
            drop.currentTarget = current;
            current.props.onDrop?.(drop);
        }
        if (!drop.propagationStopped) wrapperDrops += 1;
        return drop;
    };
    try {
        const fileArea = value.all(node => node.props.className === 'cover-editor-tool-files')[0];
        bubbleDrop(fileArea, '/library/next.cbz');
        const candidate = value.all(node => node.props.className?.split(' ').includes('cover-editor-candidate'))[0];
        bubbleDrop(candidate, '/library/next.epub');
        assert.equal(wrapperDrops, 2);
        assert.deepEqual(value.calls.preview, []);
        const imageDrop = bubbleDrop(value.button('cover_editor_local_browse'), '/images/dropped.png');
        await value.settle();
        assert.equal(imageDrop.defaultPrevented, false);
        assert.equal(wrapperDrops, 3);
        assert.deepEqual(value.calls.preview, []);
        const localPanel = value.all(node => node.props.className === 'cover-editor-local-picker')[0];
        assert.equal(localPanel.type, 'div');
        assert.equal(localPanel.props.onClick, undefined);
        assert.equal(localPanel.props.onDrop, undefined);
        assert.equal(localPanel.props.onDragOver, undefined);
        assert.ok(textContent(localPanel).includes('cover_editor_source_local_hint'));
        assert.equal(value.calls.imageDropAvailable.at(-1), true);
        value.button('cover_editor_help_button').props.onClick();
        value.render();
        assert.equal(value.calls.imageDropAvailable.at(-1), false);
        assert.equal(bubbleDrop(helpDialog(value), '/library/other.cbz').defaultPrevented, true);
        assert.equal(wrapperDrops, 3);
    } finally { value.close(); }
});

test('wrapper image requests switch embedded metadata and archive sources to local exactly once', async () => {
    for (const source of ['metadata', 'archive']) {
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], inspect: () => fileInfo('book.cbz', { canSelectArchiveImage: true }) });
        try {
            value.button(`cover_editor_source_${source}`).props.onClick();
            await value.settle();
            value.updateProps({ localImageRequest: { id: 1, path: '/images/dropped.png' } });
            await value.settle();
            assert.deepEqual(value.calls.preview, ['/images/dropped.png']);
            assert.equal(value.button('cover_editor_source_local').props['aria-selected'], true);
            assert.equal(value.newImage().props.src, preview('/images/dropped.png').dataUrl);
            value.button('cover_editor_clear').props.onClick();
            await value.settle();
            value.updateProps({ localImageRequest: { id: 1, path: '/images/dropped.png' } });
            await value.settle();
            assert.deepEqual(value.calls.preview, ['/images/dropped.png']);
            assert.equal(value.newImage(), undefined);
            await value.browse();
            value.updateProps({ files: [selectedFile('book.cbz'), selectedFile('next.cbz')] });
            await value.settle();
            assert.deepEqual(value.calls.preview, ['/images/dropped.png', '/images/new.png']);
            assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        } finally { value.close(); }
    }
});

test('successful local selections and file, URL, and clipboard imports reveal the candidate only after its arrival finishes', async () => {
    for (const kind of ['browse', 'path', 'file', 'url', 'clipboard']) {
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], deferArrival: true });
        try {
            if (kind === 'browse') await value.browse();
            else {
                const request = kind === 'path' ? { path: '/images/dropped.png' }
                    : kind === 'file' ? { file: { size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } }
                        : kind === 'url' ? { url: 'https://images.example/cover.png' } : { clipboard: true };
                value.updateProps({ localImageRequest: { id: 1, ...request } });
                await value.settle();
            }
            const imagePath = kind === 'browse' ? '/images/new.png' : kind === 'path' ? '/images/dropped.png'
                : kind === 'clipboard' ? '/temporary/clipboard-cover.png' : '/temporary/imported-cover.png';
            assert.equal(value.calls.arrivals.length, 1, kind);
            const arrival = value.calls.arrivals[0];
            assert.equal(arrival.image.imagePath, imagePath);
            assert.match(arrival.sourceElement.props.className, /cover-editor-local-picker/);
            assert.match(arrival.targetElement.props.className, /cover-editor-candidate/);
            assert.equal(value.newImage(), undefined);
            assert.equal(value.all(node => node.props.className === 'cover-editor-arrival-highlight').length, 0);
            arrival.onFinish();
            await value.settle();
            assert.equal(value.calls.arrivals.length, 1);
            assert.equal(value.newImage().props.src, preview(imagePath).dataUrl);
            assert.equal(value.all(node => node.props.className === 'cover-editor-arrival-highlight').length, 1);
        } finally { value.close(); }
    }
});

test('cancelled or failed local selections and metadata covers do not start an arrival animation', async () => {
    for (const kind of ['cancel', 'error', 'empty', 'metadata']) {
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], deferArrival: true,
            select: () => kind === 'cancel' ? null : '/images/new.png',
            preview: () => ({ error: 'Cannot decode', code: 'COVER_IMAGE_INVALID' }),
            clipboardPreview: () => ({ empty: true }) });
        try {
            if (kind === 'metadata') {
                value.button('cover_editor_source_metadata').props.onClick();
                value.render();
                searchForm(value).props.onSubmit(event());
                await value.settle();
                await value.all(node => node.type === 'button' && node.props.title === metadataResult.title)[0].props.onClick();
                await value.settle();
                assert.equal(value.newImage().props.src, preview('/temporary/metadata-cover.png').dataUrl);
            } else if (kind === 'empty') {
                value.updateProps({ localImageRequest: { id: 1, clipboard: true } });
                await value.settle();
            } else await value.browse();
            assert.deepEqual(value.calls.arrivals, []);
            assert.equal(value.all(node => node.props.className === 'cover-editor-arrival-highlight').length, 0);
        } finally { value.close(); }
    }
});

test('new selections, clearing, source or target changes, and unmounting cancel arrivals and suppress stale completions', async () => {
    for (const action of ['replace', 'clear', 'source', 'targets', 'unmount']) {
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], deferArrival: true,
            inspect: path => fileInfo(path.split('/').pop()) });
        try {
            await value.browse();
            const oldArrival = value.calls.arrivals[0];
            if (action === 'replace') value.updateProps({ localImageRequest: { id: 1, url: 'https://images.example/latest.png' } });
            else if (action === 'clear') value.button('cover_editor_clear').props.onClick();
            else if (action === 'source') value.button('cover_editor_source_metadata').props.onClick();
            else if (action === 'targets') value.updateProps({ files: [selectedFile('next.cbz')] });
            else value.unmount();
            await value.settle();
            assert.ok(value.calls.cancelledArrivals.includes(oldArrival), action);
            oldArrival.onFinish();
            await value.settle();
            assert.equal(value.calls.updatesAfterUnmount, 0);
            assert.equal(value.all(node => node.props.className === 'cover-editor-arrival-highlight').length, 0);
            if (action === 'replace') {
                assert.equal(value.calls.arrivals.length, 2);
                assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
                value.calls.arrivals[1].onFinish();
                await value.settle();
                assert.equal(value.newImage().props.src, preview('/temporary/imported-cover.png').dataUrl);
                oldArrival.onFinish();
                await value.settle();
                assert.equal(value.newImage().props.src, preview('/temporary/imported-cover.png').dataUrl);
            } else if (action !== 'unmount') {
                assert.equal(value.newImage()?.props.src, action === 'clear' ? undefined : preview('/images/new.png').dataUrl);
            }
        } finally { value.close(); }
    }
});

test('arrival playback preserves the previous preview without globally disabling controls and saves the new candidate', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], deferArrival: true });
    try {
        await value.browse();
        value.calls.arrivals[0].onFinish();
        await value.settle();
        const busyUpdates = [...value.calls.busy];
        value.updateProps({ localImageRequest: { id: 1, url: 'https://images.example/new.png' } });
        await value.settle();
        const arrival = value.calls.arrivals[1];
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.deepEqual(value.calls.busy, busyUpdates);
        assert.equal(value.all(node => node.props.className?.includes('cover-editor-candidate'))[0].props['aria-busy'], false);
        assert.equal(value.button('cover_editor_source_metadata').props.disabled, false);
        assert.equal(value.button('cover_editor_clear').props.disabled, false);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute[0].imagePath, '/temporary/imported-cover.png');
        assert.equal(value.calls.execute[0].imageVersion, 'image-version');
        assert.ok(value.calls.cancelledArrivals.includes(arrival));
    } finally { value.close(); }
});

test('clipboard files and browser image URLs become local covers and each import request is consumed once', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    for (const kind of ['file', 'url']) {
        const request = kind === 'file'
            ? { id: 1, file: { type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes.buffer } }
            : { id: 1, url: 'https://images.example/cover.png' };
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')],
            inspect: () => fileInfo('book.cbz', { canSelectArchiveImage: true }) });
        try {
            value.button(`cover_editor_source_${kind === 'file' ? 'metadata' : 'archive'}`).props.onClick();
            await value.settle();
            value.updateProps({ localImageRequest: request });
            await value.settle();
            assert.equal(value.button('cover_editor_source_local').props['aria-selected'], true);
            assert.equal(value.newImage().props.src, preview('/temporary/imported-cover.png').dataUrl);
            assert.deepEqual(value.calls.preview, []);
            assert.deepEqual(value.calls.importedPreview, [kind === 'file' ? { bytes } : { url: request.url }]);
            value.updateProps({ localImageRequest: { ...request } });
            await value.settle();
            assert.equal(value.calls.importedPreview.length, 1);
            await value.button('cover_editor_save').props.onClick();
            assert.equal(value.calls.execute.length, 1);
            assert.equal(value.calls.execute[0].imagePath, '/temporary/imported-cover.png');
            assert.equal(value.calls.execute[0].imageVersion, 'image-version');
        } finally { value.close(); }
    }
});

test('native clipboard requests import a local cover once and use its verified image in saves', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')] });
    try {
        value.button('cover_editor_source_metadata').props.onClick();
        await value.settle();
        value.updateProps({ localImageRequest: { id: 1, clipboard: true } });
        await value.settle();
        assert.equal(value.button('cover_editor_source_local').props['aria-selected'], true);
        assert.equal(value.newImage().props.src, preview('/temporary/clipboard-cover.png').dataUrl);
        assert.deepEqual(value.calls.clipboardPreview, [[]]);
        assert.deepEqual(value.calls.importedPreview, []);
        assert.deepEqual(value.calls.preview, []);
        value.updateProps({ localImageRequest: { id: 1, clipboard: true } });
        await value.settle();
        assert.equal(value.calls.clipboardPreview.length, 1);
        await value.button('cover_editor_save').props.onClick();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(value.calls.execute[0].imagePath, '/temporary/clipboard-cover.png');
        assert.equal(value.calls.execute[0].imageVersion, 'image-version');
    } finally { value.close(); }
});

test('empty native clipboards leave the selected image intact without an error or temporary image release', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], clipboardPreview: () => ({ empty: true }) });
    try {
        await value.browse();
        value.updateProps({ localImageRequest: { id: 1, clipboard: true } });
        await value.settle();
        assert.deepEqual(value.calls.clipboardPreview, [[]]);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.all(node => node.props.className?.includes('cover-editor-candidate'))[0].props['aria-busy'], false);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        assert.deepEqual(value.calls.toasts, []);
        assert.deepEqual(value.calls.released, []);
    } finally { value.close(); }
});

test('native clipboard failures show localized errors while retaining the selected cover', async () => {
    for (const kind of ['decode', 'read', 'throw']) {
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], clipboardPreview: () => {
            if (kind === 'throw') throw new Error('Private clipboard transport details');
            return { error: 'Private clipboard decoding details', code: kind === 'decode' ? 'COVER_IMAGE_TOO_MANY_PIXELS' : 'COVER_IMAGE_IMPORT_FAILED' };
        } });
        try {
            await value.browse();
            value.updateProps({ localImageRequest: { id: 1, clipboard: true } });
            await value.settle();
            assert.deepEqual(value.calls.clipboardPreview, [[]]);
            assert.deepEqual(value.calls.toasts, [{ key: kind === 'decode' ? 'cover_editor_image_too_many_pixels' : 'cover_editor_image_import_failed' }]);
            assert.equal(value.alert(), '');
            assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
            assert.equal(value.button('cover_editor_save').props.disabled, false);
            assert.deepEqual(value.calls.released, []);
        } finally { value.close(); }
    }
});

test('superseding or unmounting a pending native clipboard import releases its late preview and ignores stale errors', async () => {
    for (const action of ['source', 'replace', 'unmount']) {
        for (const outcome of ['resolve', 'reject']) {
            const pending = deferred();
            const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], clipboardPreview: () => pending.promise });
            try {
                await value.browse();
                const busyUpdates = [...value.calls.busy];
                value.updateProps({ localImageRequest: { id: 1, clipboard: true } });
                await value.settle();
                assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
                assert.equal(value.button('cover_editor_save').props.disabled, true);
                assert.equal(value.button('cover_editor_source_metadata').props.disabled, false);
                assert.deepEqual(value.calls.busy, busyUpdates);
                if (action === 'source') value.button('cover_editor_source_metadata').props.onClick();
                else if (action === 'replace') value.updateProps({ localImageRequest: { id: 2, url: 'https://images.example/latest.png' } });
                else value.unmount();
                await value.settle();
                if (outcome === 'resolve') pending.resolve(preview('/temporary/obsolete-clipboard.png'));
                else pending.reject(new Error('Stale native clipboard read failed'));
                await value.settle();
                assert.deepEqual(value.calls.clipboardPreview, [[]]);
                assert.equal(value.calls.updatesAfterUnmount, 0);
                assert.deepEqual(value.calls.toasts, []);
                assert.deepEqual(value.calls.released, [
                    ...(action === 'replace' ? [{ imagePath: '/images/new.png' }] : action === 'unmount' ? [undefined] : []),
                    ...(outcome === 'resolve' ? [{ imagePath: '/temporary/obsolete-clipboard.png' }] : []),
                ]);
                if (action !== 'unmount') {
                    assert.equal(value.newImage().props.src, preview(action === 'replace' ? '/temporary/imported-cover.png' : '/images/new.png').dataUrl);
                    assert.equal(value.button('cover_editor_save').props.disabled, false);
                }
            } finally { value.close(); }
        }
    }
});

test('reading an imported image keeps the previous preview and editor controls available while preventing saves', async () => {
    const reading = deferred();
    const importing = deferred();
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')],
        importedPreview: () => importing.promise });
    try {
        await value.browse();
        const busyUpdates = [...value.calls.busy];
        value.updateProps({ localImageRequest: { id: 1, file: { size: 4, arrayBuffer: () => reading.promise } } });
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.all(node => node.props.className?.includes('cover-editor-candidate'))[0].props['aria-busy'], true);
        assert.equal(value.button('cover_editor_source_metadata').props.disabled, false);
        assert.equal(value.button('cover_editor_clear').props.disabled, false);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        await value.button('cover_editor_save').props.onClick();
        assert.deepEqual(value.calls.execute, []);
        assert.deepEqual(value.calls.importedPreview, []);
        assert.deepEqual(value.calls.busy, busyUpdates);
        const bytes = new Uint8Array([137, 80, 78, 71]);
        reading.resolve(bytes.buffer);
        await value.settle();
        assert.deepEqual(value.calls.importedPreview, [{ bytes }]);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        importing.resolve(preview('/temporary/pasted.png'));
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/temporary/pasted.png').dataUrl);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
        assert.deepEqual(value.calls.busy, busyUpdates);
        assert.deepEqual(value.calls.released, [{ imagePath: '/images/new.png' }]);
    } finally { value.close(); }
});

test('superseding an asynchronous file read prevents its IPC import and suppresses stale read errors', async () => {
    for (const outcome of ['resolve', 'reject']) {
        const reading = deferred();
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')] });
        try {
            value.updateProps({ localImageRequest: { id: 1, file: { size: 4, arrayBuffer: () => reading.promise } } });
            await value.settle();
            value.updateProps({ localImageRequest: { id: 2, url: 'https://images.example/latest.png' } });
            await value.settle();
            assert.equal(value.newImage().props.src, preview('/temporary/imported-cover.png').dataUrl);
            if (outcome === 'resolve') reading.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
            else reading.reject(new Error('An obsolete file is unavailable'));
            await value.settle();
            assert.deepEqual(value.calls.importedPreview, [{ url: 'https://images.example/latest.png' }]);
            assert.equal(value.newImage().props.src, preview('/temporary/imported-cover.png').dataUrl);
            assert.deepEqual(value.calls.toasts, []);
            assert.deepEqual(value.calls.released, []);
        } finally { value.close(); }
    }
});

test('switching sources, clearing, changing targets, and unmounting cancel an imported cover and release its late preview', async () => {
    for (const action of ['source', 'clear', 'targets', 'unmount']) {
        const pending = deferred();
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')],
            importedPreview: () => pending.promise });
        try {
            await value.browse();
            value.updateProps({ localImageRequest: { id: 1, url: 'https://images.example/pending.png' } });
            await value.settle();
            if (action === 'source') value.button('cover_editor_source_metadata').props.onClick();
            else if (action === 'clear') value.button('cover_editor_clear').props.onClick();
            else if (action === 'targets') value.updateProps({ files: [selectedFile('next.cbz')] });
            else value.unmount();
            await value.settle();
            pending.resolve(preview('/temporary/obsolete-import.png'));
            await value.settle();
            assert.equal(value.calls.importedPreview.length, 1);
            assert.equal(value.calls.updatesAfterUnmount, 0);
            assert.deepEqual(value.calls.toasts, []);
            assert.deepEqual(value.calls.released, [
                ...(action === 'clear' ? [{ imagePath: '/images/new.png' }] : action === 'unmount' ? [undefined] : []),
                { imagePath: '/temporary/obsolete-import.png' },
            ]);
            if (action !== 'unmount') {
                assert.equal(value.newImage()?.props.src, action === 'clear' ? undefined : preview('/images/new.png').dataUrl);
            }
        } finally { value.close(); }
    }
});

test('oversized clipboard files fail before reading bytes and preserve the chosen cover', async () => {
    let reads = 0;
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')] });
    try {
        await value.browse();
        value.updateProps({ localImageRequest: { id: 1, file: { size: 16 * 1024 * 1024 + 1,
            arrayBuffer: async () => { reads += 1; return new ArrayBuffer(0); } } } });
        await value.settle();
        assert.equal(reads, 0);
        assert.deepEqual(value.calls.importedPreview, []);
        assert.deepEqual(value.calls.toasts, [{ key: 'cover_editor_image_too_large' }]);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
    } finally { value.close(); }
});

test('file read and browser import failures show localized toasts without discarding the chosen cover', async () => {
    for (const kind of ['read', 'download', 'image']) {
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')],
            importedPreview: () => ({ error: 'Private transport details', code: kind === 'image' ? 'COVER_IMAGE_TOO_MANY_PIXELS' : 'COVER_IMAGE_IMPORT_FAILED' }) });
        try {
            await value.browse();
            const request = kind === 'read'
                ? { file: { size: 4, arrayBuffer: async () => { throw new Error('Cannot read the clipboard image'); } } }
                : { url: 'https://images.example/unavailable.png' };
            value.updateProps({ localImageRequest: { id: 1, ...request } });
            await value.settle();
            assert.equal(value.calls.importedPreview.length, kind === 'read' ? 0 : 1);
            assert.deepEqual(value.calls.toasts, [{ key: kind === 'image' ? 'cover_editor_image_too_many_pixels' : 'cover_editor_image_import_failed' }]);
            assert.equal(value.alert(), '');
            assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
            assert.equal(value.button('cover_editor_save').props.disabled, false);
            assert.deepEqual(value.calls.released, []);
        } finally { value.close(); }
    }
});

test('mixed book and image requests wait for new-file inspection and external collection before loading the cover', async () => {
    const pending = deferred();
    const value = await fixture({ embedded: true, files: [selectedFile('first.cbz')],
        inspect: path => path.endsWith('next.cbz') ? pending.promise : fileInfo('first.cbz') });
    try {
        value.updateProps({ files: [selectedFile('first.cbz'), selectedFile('next.cbz')],
            localImageRequest: { id: 1, path: '/images/mixed.png' }, externalBusy: true });
        await value.settle();
        assert.deepEqual(value.calls.preview, []);
        assert.equal(value.calls.imageDropAvailable.at(-1), false);
        pending.resolve(fileInfo('next.cbz'));
        await value.settle();
        assert.deepEqual(value.calls.preview, []);
        value.updateProps({ externalBusy: false });
        await value.settle();
        assert.deepEqual(value.calls.preview, ['/images/mixed.png']);
        assert.equal(value.newImage().props.src, preview('/images/mixed.png').dataUrl);
        assert.equal(value.calls.imageDropAvailable.at(-1), true);
        value.updateProps({ localImageRequest: null });
        await value.settle();
        assert.deepEqual(value.calls.preview, ['/images/mixed.png']);
    } finally { value.close(); }
});

test('a dropped cover invalidated by changed targets is released without replaying or replacing the next request', async () => {
    const pending = deferred();
    const value = await fixture({ embedded: true, files: [selectedFile('first.cbz')],
        inspect: path => fileInfo(path.split('/').at(-1)),
        preview: path => path === '/images/old-drop.png' ? pending.promise : preview(path) });
    try {
        value.updateProps({ localImageRequest: { id: 1, path: '/images/old-drop.png' } });
        await value.settle();
        assert.equal(value.calls.imageDropAvailable.at(-1), true);
        value.updateProps({ files: [selectedFile('second.cbz')] });
        await value.settle();
        assert.deepEqual(value.calls.preview, ['/images/old-drop.png']);
        value.updateProps({ localImageRequest: { id: 2, path: '/images/new-drop.png' } });
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/images/new-drop.png').dataUrl);
        pending.resolve(preview('/images/old-drop.png'));
        await value.settle();
        assert.equal(value.newImage().props.src, preview('/images/new-drop.png').dataUrl);
        assert.deepEqual(value.calls.preview, ['/images/old-drop.png', '/images/new-drop.png']);
        assert.deepEqual(value.calls.released, [{ imagePath: '/images/old-drop.png' }]);
    } finally { value.close(); }
});

test('new-cover actions share a separate row below image details with edit after clear', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')] });
    try {
        assert.equal(value.button('cover_editor_clear'), undefined);
        assert.equal(value.button('cover_editor_edit'), undefined);
        await value.browse();
        const clear = value.button('cover_editor_clear');
        const edit = value.button('cover_editor_edit');
        assert.ok(clear);
        assert.ok(edit);
        assert.equal(clear.parent, edit.parent);
        assert.deepEqual(childrenOf(clear.parent).map(textContent), ['cover_editor_clear', 'cover_editor_edit']);
        const rows = childrenOf(clear.parent.parent);
        const actionIndex = rows.indexOf(clear.parent);
        assert.ok(actionIndex > 0);
        assert.equal(textContent(rows[actionIndex - 1]), '400 × 600 · 12 KB');
        assert.equal(edit.props.disabled, false);
        clear.props.onClick();
        await value.settle();
        assert.equal(value.button('cover_editor_clear'), undefined);
        assert.equal(value.button('cover_editor_edit'), undefined);
    } finally { value.close(); }
});

test('editing a chosen cover locks its parent and saves the validated edited image', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const edited = { ...preview('/temporary/edited-cover.png'), imageVersion: 'edited-version', width: 250, height: 500, size: 4096 };
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], importedPreview: () => edited });
    try {
        await value.browse();
        value.button('cover_editor_edit').props.onClick();
        await value.settle();
        const editor = value.imageEditor();
        assert.ok(editor);
        assert.equal(editor.props.image.imagePath, '/images/new.png');
        assert.equal(editor.props.image.imageVersion, 'image-version');
        assert.equal(value.calls.busy.at(-1), true);
        assert.equal(value.calls.imageDropAvailable.at(-1), false);
        assert.equal(value.button('cover_editor_save').props.disabled, true);
        assert.equal(value.button('cover_editor_clear').props.disabled, true);
        await value.button('cover_editor_save').props.onClick();
        assert.deepEqual(value.calls.execute, []);
        await editor.props.onApply(new Blob([bytes], { type: 'image/png' }));
        editor.props.onClose();
        await value.settle();
        assert.deepEqual(value.calls.importedPreview, [{ bytes }]);
        assert.equal(value.newImage().props.src, edited.dataUrl);
        assert.ok(value.text().includes('250 × 500 · 4 KB'));
        assert.deepEqual(value.calls.released, [{ imagePath: '/images/new.png' }]);
        assert.equal(value.imageEditor(), undefined);
        assert.equal(value.calls.busy.at(-1), false);
        assert.equal(value.calls.imageDropAvailable.at(-1), true);
        await value.button('cover_editor_save').props.onClick();
        await value.settle();
        assert.equal(value.calls.execute.length, 1);
        assert.equal(value.calls.execute[0].imagePath, edited.imagePath);
        assert.equal(value.calls.execute[0].imageVersion, edited.imageVersion);
    } finally { value.close(); }
});

test('cancelling cover image editing retains the original candidate and avoids importing an image', async () => {
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')] });
    try {
        await value.browse();
        value.button('cover_editor_edit').props.onClick();
        await value.settle();
        value.imageEditor().props.onClose();
        await value.settle();
        assert.equal(value.imageEditor(), undefined);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.deepEqual(value.calls.importedPreview, []);
        assert.deepEqual(value.calls.released, []);
        assert.equal(value.calls.busy.at(-1), false);
        assert.equal(value.calls.imageDropAvailable.at(-1), true);
        assert.equal(value.button('cover_editor_save').props.disabled, false);
    } finally { value.close(); }
});

test('failed edited-image imports retain the candidate and keep editing open for retry', async () => {
    for (const failure of ['result', 'throw']) {
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], importedPreview: () => {
            if (failure === 'throw') throw new Error('Image import unavailable');
            return { error: 'Invalid edited image', code: 'COVER_IMAGE_INVALID' };
        } });
        try {
            await value.browse();
            value.button('cover_editor_edit').props.onClick();
            await value.settle();
            await assert.rejects(value.imageEditor().props.onApply(new Blob(['edited'], { type: 'image/png' })));
            await value.settle();
            assert.ok(value.imageEditor());
            assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
            assert.deepEqual(value.calls.released, []);
            assert.deepEqual(value.calls.execute, []);
            assert.equal(value.button('cover_editor_save').props.disabled, true);
            value.imageEditor().props.onClose();
            await value.settle();
            assert.equal(value.button('cover_editor_save').props.disabled, false);
        } finally { value.close(); }
    }
});

test('oversized edited images fail before reading or importing bytes and preserve the selected cover', async () => {
    let reads = 0;
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')] });
    try {
        await value.browse();
        value.button('cover_editor_edit').props.onClick();
        await value.settle();
        await assert.rejects(value.imageEditor().props.onApply({
            size: 16 * 1024 * 1024 + 1,
            arrayBuffer: async () => { reads += 1; return new ArrayBuffer(0); },
        }), { code: 'COVER_IMAGE_TOO_LARGE' });
        await value.settle();
        assert.equal(reads, 0);
        assert.deepEqual(value.calls.importedPreview, []);
        assert.deepEqual(value.calls.released, []);
        assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
        assert.ok(value.imageEditor());
    } finally { value.close(); }
});

test('closing during edited-image import releases a late result without replacing the selected cover', async () => {
    for (const close of ['editor', 'unmount']) {
        const pending = deferred();
        const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], importedPreview: () => pending.promise });
        try {
            await value.browse();
            value.button('cover_editor_edit').props.onClick();
            await value.settle();
            const editor = value.imageEditor();
            const applying = editor.props.onApply(new Blob(['edited'], { type: 'image/png' }));
            await value.settle();
            assert.equal(value.calls.importedPreview.length, 1);
            if (close === 'unmount') value.unmount();
            else editor.props.onClose();
            await value.settle();
            pending.resolve(preview('/temporary/late-edited-cover.png'));
            await assert.rejects(applying, { code: 'IMAGE_EDIT_CLOSED' });
            await value.settle();
            assert.equal(value.calls.updatesAfterUnmount, 0);
            assert.deepEqual(value.calls.released, [
                ...(close === 'unmount' ? [undefined] : []),
                { imagePath: '/temporary/late-edited-cover.png' },
            ]);
            assert.deepEqual(value.calls.execute, []);
            if (close === 'editor') {
                assert.equal(value.imageEditor(), undefined);
                assert.equal(value.newImage().props.src, preview('/images/new.png').dataUrl);
            }
        } finally { value.close(); }
    }
});

test('cover editing remains disabled while another candidate loads or an external task runs', async () => {
    const pending = deferred();
    const value = await fixture({ embedded: true, files: [selectedFile('book.cbz')], importedPreview: () => pending.promise });
    try {
        await value.browse();
        value.updateProps({ externalBusy: true });
        await value.settle();
        assert.equal(value.button('cover_editor_edit').props.disabled, true);
        value.updateProps({ externalBusy: false, localImageRequest: { id: 1, url: 'https://images.example/next.png' } });
        await value.settle();
        assert.equal(value.button('cover_editor_edit').props.disabled, true);
        pending.resolve(preview('/temporary/next-cover.png'));
        await value.settle();
        assert.equal(value.button('cover_editor_edit').props.disabled, false);
    } finally { value.close(); }
});
