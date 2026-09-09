import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as transferPolicy from './readiveTransferPolicy.js';
import * as destinationPolicy from './readiveDestinationPolicy.js';
import { TABS, normalizeDroppedPaths } from './appShell.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const LAST_DEVICE_KEY = 'bookmanager.readive.lastDeviceId';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...Object.values(tree.props ?? {}).flatMap(nodes)];
const textContent = tree => tree === null || tree === undefined || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(textContent).join('') : typeof tree === 'object' ? textContent(tree.props?.children) : String(tree);
function hooks() {
    const slots = [];
    let cursor = 0;
    let effects = [];
    let dirty = false;
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, value => {
                const next = typeof value === 'function' ? value(slots[index].value) : value;
                if (!Object.is(slots[index].value, next)) dirty = true;
                slots[index].value = next;
            }];
        },
        useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useMemo(compute, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: compute(), deps }; return slots[index].value; },
        useEffect(effect, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); }); } },
    };
    return { react, hasUpdates: () => dirty, render: (component, props) => { cursor = 0; dirty = false; const tree = component(props); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; }, unmount: () => slots.forEach(slot => slot.cleanup?.()) };
}

async function fixture(options = {}) {
    const renderer = hooks();
    const calls = { requested: [], enqueued: [], openedSharing: 0, storageWrites: [] };
    const storage = options.storage ?? new Map();
    const status = { running: options.running ?? true, devices: options.devices ?? [{ id: 'phone', name: 'Phone' }, { id: 'tablet', name: 'Tablet' }], jobs: [] };
    const statusState = { status, refresh: async () => status, statusError: options.statusError ?? false, statusLoaded: options.statusLoaded ?? true };
    const entries = options.entries ?? [{ id: 'source', kind: 'file', name: 'Book.txt', relativePath: 'Book.txt', size: 1 }];
    const originalWindow = globalThis.window;
    const page = parentId => ({ parentId, name: parentId ?? 'Phone', entries: parentId ? [{ id: 'book', name: 'Existing.txt', kind: 'file', size: 12 }] : [{ id: 'shelf', name: 'Shelf', kind: 'directory', size: null }], revision: 'rev-1', nextCursor: null });
    globalThis.window = { localStorage: {
        getItem(key) {
            if (options.storageReadError) throw new Error('storage read unavailable');
            return storage.get(key) ?? null;
        },
        setItem(key, value) {
            if (options.storageWriteError) throw new Error('storage write unavailable');
            calls.storageWrites.push({ key, value });
            storage.set(key, String(value));
        },
        removeItem(key) {
            if (options.storageWriteError) throw new Error('storage write unavailable');
            calls.storageWrites.push({ key, value: null });
            storage.delete(key);
        },
    }, electronAPI: {
        scanReadiveTransfer: async () => ({ id: 'snapshot', entries, summary: {} }),
        cancelReadiveTransfer: async () => undefined,
        requestReadiveDestinationPage: async value => { calls.requested.push(value); return options.requestPage ? options.requestPage(value, calls.requested.length) : page(value.parentId); },
        enqueueReadiveTransfer: async value => {
            calls.enqueued.push(value);
            const result = options.enqueue ? await options.enqueue(value, calls.enqueued.length) : { id: 'job' };
            status.jobs = [{ id: result.id, deviceId: value.deviceId, status: 'queued', summary: transferPolicy.summarizeReadiveEntries(entries), receivedEntryIds: [] }];
            return result;
        },
    } };
    const mocks = {
        react: renderer.react,
        '../hooks/useModalAccessibility': { useModalAccessibility: () => ({ current: null }) },
        '../readiveTransferPolicy': transferPolicy,
        '../readiveDestinationPolicy': destinationPolicy,
        './ReadiveConnectionPanel': { useReadiveStatus: () => statusState, ReadiveConnectionPanel: 'Connection', ReadiveJobs: 'Jobs' },
        './FaIcon': { FaIcon: 'Icon' },
        '../styles/ReadiveTransfer.css': {},
    };
    const compiled = transformSync(fs.readFileSync(new URL('./components/ReadiveTransferDialog.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => { assert.ok(name in mocks, name); return mocks[name]; });
    const props = { paths: ['/synthetic/Book.txt'], t: (key, values) => values?.path ? `${key}: ${values.path}` : values?.size ? `${key}: ${values.size}` : key, onClose() {}, onOpenSharing: () => { calls.openedSharing += 1; } };
    let tree;
    const render = () => tree = renderer.render(module.exports.ReadiveTransferDialog, props);
    const settle = async () => {
        for (let pass = 0; pass < 20; pass += 1) {
            render();
            await tick();
            if (!renderer.hasUpdates()) return;
        }
        assert.fail('Dialog did not settle after 20 renders');
    };
    const button = label => nodes(tree).find(node => node.type === 'button' && (textContent(node) === label || node.props['aria-label'] === label));
    const device = () => nodes(tree).find(node => node.type === 'select' && node.props.id === 'readive-device');
    const checkbox = (label = 'readive.confirm') => nodes(nodes(tree).find(node => node.type === 'label' && textContent(node) === label)).find(node => node.type === 'input' && node.props.type === 'checkbox');
    await settle();
    return { calls, storage, status, statusState, render, settle, button, device, checkbox, tree: () => tree, close: () => { renderer.unmount(); globalThis.window = originalWindow; } };
}

test('the visible folder is used immediately without a destination confirmation button', async () => {
    const value = await fixture();
    try {
        assert.equal(value.device().props.value, '', 'Multiple devices require a choice');
        assert.equal(value.button('readive.go_to_sharing'), undefined);
        assert.equal(textContent(value.tree()).includes('readive.destination_waiting'), true);
        assert.equal(textContent(value.tree()).includes('readive.open_app_hint'), true);
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        value.device().props.onChange({ target: { value: 'phone' } }); await value.settle();
        assert.equal(value.checkbox(), undefined);
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        assert.equal(value.button('readive.destination_choose'), undefined);
        assert.equal(value.button('readive.destination_change'), undefined);
        assert.equal(textContent(value.tree()).includes('readive.destination_description'), false);
        const folder = nodes(value.tree()).find(node => node.type === 'button' && textContent(node).includes('Shelf'));
        assert.ok(folder, 'The destination browser stays visible after loading the current folder');
        folder.props.onClick(); await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        assert.ok(nodes(value.tree()).some(node => node.props?.children === 'Existing.txt'));
        assert.equal(nodes(value.tree()).some(node => node.type === 'button' && textContent(node).includes('Existing.txt')), false, 'Existing files cannot be chosen as folders');
        await value.button('readive.start_transfer').props.onClick(); value.render();
        assert.deepEqual(value.calls.enqueued[0].destination, { collectionId: 'shelf', name: 'Phone / shelf', revision: 'rev-1' });
        assert.equal(value.calls.enqueued[0].confirmed, true);
        assert.equal(value.calls.enqueued[0].deviceId, 'phone');
    } finally { value.close(); }
});

test('a single device automatically uses its root only after the destination page loads', async () => {
    const request = deferred();
    const value = await fixture({ devices: [], statusLoaded: false, requestPage: () => request.promise });
    try {
        assert.equal(value.calls.requested.length, 0);
        assert.equal(value.calls.openedSharing, 0, 'Loading status must not redirect to connection setup');
        value.status.devices = [{ id: 'phone', name: 'Phone' }];
        value.statusState.statusLoaded = true;
        await value.settle();
        assert.equal(value.device().props.value, 'phone');
        assert.deepEqual(value.calls.requested.map(request => request.deviceId), ['phone']);
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 0, 'A pending root page cannot become a destination');
        request.resolve({ parentId: null, name: 'Phone library', entries: [], revision: 'phone-root', nextCursor: null });
        await value.settle();
        assert.equal(value.checkbox(), undefined);
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.deepEqual(value.calls.enqueued[0].destination, { collectionId: null, name: 'Phone library', revision: 'phone-root' });
    } finally { value.close(); }
});

test('unlinked dialogs return to the sharing tab without rendering connection controls', async () => {
    for (const options of [{ running: false }, { devices: [] }]) {
        const value = await fixture(options);
        try {
            assert.equal(value.calls.openedSharing, 1);
            assert.equal(nodes(value.tree()).some(node => node.type === 'Connection'), false);
            assert.equal(value.button('readive.start'), undefined);
            assert.equal(value.button('readive.pair'), undefined);
            assert.equal(value.button('readive.go_to_sharing'), undefined);
            assert.equal(value.button('readive.start_transfer').props.disabled, true);
        } finally { value.close(); }
    }
});

test('status errors keep destination guidance without a sharing settings button or automatic navigation', async () => {
    const value = await fixture({ running: false, statusError: true });
    try {
        assert.equal(value.calls.openedSharing, 0);
        assert.equal(value.button('readive.go_to_sharing'), undefined);
        assert.equal(textContent(value.tree()).includes('readive.destination_waiting'), true);
        assert.equal(textContent(value.tree()).includes('readive.open_app_hint'), true);
        assert.equal(nodes(value.tree()).some(node => node.type === 'Connection'), false);
    } finally { value.close(); }
});

test('reopening a transfer restores the last device and later status polls preserve manual changes', async () => {
    const storage = new Map();
    const first = await fixture({ storage });
    try {
        first.device().props.onChange({ target: { value: 'tablet' } }); await first.settle();
        assert.equal(storage.get(LAST_DEVICE_KEY), 'tablet');
    } finally { first.close(); }
    const reopened = await fixture({ storage });
    try {
        assert.equal(reopened.device().props.value, 'tablet');
        assert.deepEqual(reopened.calls.requested.map(request => request.deviceId), ['tablet']);
        assert.equal(reopened.button('readive.start_transfer').props.disabled, false);
        reopened.device().props.onChange({ target: { value: 'phone' } }); await reopened.settle();
        reopened.status.devices = reopened.status.devices.map(device => ({ ...device }));
        await reopened.settle();
        assert.equal(reopened.device().props.value, 'phone');
        assert.equal(storage.get(LAST_DEVICE_KEY), 'phone');
        await reopened.button('readive.start_transfer').props.onClick(); await reopened.settle();
        assert.equal(reopened.calls.enqueued[0].deviceId, 'phone');
    } finally { reopened.close(); }
});

test('the remembered device is preserved until status loads and then restored from registered devices', async () => {
    const storage = new Map([[LAST_DEVICE_KEY, 'tablet']]);
    const value = await fixture({ storage, devices: [], statusLoaded: false });
    try {
        assert.equal(storage.get(LAST_DEVICE_KEY), 'tablet');
        assert.deepEqual(value.calls.storageWrites, []);
        assert.deepEqual(value.calls.requested, []);
        assert.equal(value.calls.openedSharing, 0);
        value.status.devices = [{ id: 'phone', name: 'Phone' }, { id: 'tablet', name: 'Tablet' }];
        value.statusState.statusLoaded = true;
        await value.settle();
        assert.equal(value.device().props.value, 'tablet');
        assert.deepEqual(value.calls.requested.map(request => request.deviceId), ['tablet']);
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
    } finally { value.close(); }
});

test('an unregistered remembered device falls back to a single device or waits for a new choice', async () => {
    for (const devices of [[{ id: 'phone', name: 'Phone' }], [{ id: 'phone', name: 'Phone' }, { id: 'tablet', name: 'Tablet' }]]) {
        const value = await fixture({ storage: new Map([[LAST_DEVICE_KEY, 'removed']]), devices });
        try {
            assert.equal(value.device().props.value, devices.length === 1 ? 'phone' : '');
            assert.equal(value.calls.requested.some(request => request.deviceId === 'removed'), false);
            assert.equal(value.button('readive.start_transfer').props.disabled, devices.length !== 1);
            await value.button('readive.start_transfer').props.onClick(); await value.settle();
            assert.equal(value.calls.enqueued.length, devices.length === 1 ? 1 : 0);
            assert.equal(value.calls.enqueued.some(request => request.deviceId === 'removed'), false);
        } finally { value.close(); }
    }
});

test('removing the current device prevents its remembered selection from enabling transfer', async () => {
    const value = await fixture({ storage: new Map([[LAST_DEVICE_KEY, 'tablet']]) });
    try {
        assert.equal(value.device().props.value, 'tablet');
        value.status.devices = [{ id: 'phone', name: 'Phone' }, { id: 'reader', name: 'Reader' }];
        await value.settle();
        assert.equal(value.device().props.value, '');
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 0);
    } finally { value.close(); }
});

test('storage read and write failures leave device selection and transfer usable', async () => {
    const unreadable = await fixture({ devices: [{ id: 'phone', name: 'Phone' }], storageReadError: true });
    try {
        assert.equal(unreadable.device().props.value, 'phone');
        assert.equal(unreadable.button('readive.start_transfer').props.disabled, false);
        await unreadable.button('readive.start_transfer').props.onClick(); await unreadable.settle();
        assert.equal(unreadable.calls.enqueued[0].deviceId, 'phone');
    } finally { unreadable.close(); }
    const unwritable = await fixture({ storage: new Map([[LAST_DEVICE_KEY, 'phone']]), storageWriteError: true });
    try {
        assert.equal(unwritable.device().props.value, 'phone');
        unwritable.device().props.onChange({ target: { value: 'tablet' } }); await unwritable.settle();
        unwritable.status.devices = unwritable.status.devices.map(device => ({ ...device }));
        await unwritable.settle();
        assert.equal(unwritable.device().props.value, 'tablet');
        assert.equal(unwritable.button('readive.start_transfer').props.disabled, false);
        await unwritable.button('readive.start_transfer').props.onClick(); await unwritable.settle();
        assert.equal(unwritable.calls.enqueued[0].deviceId, 'tablet');
    } finally { unwritable.close(); }
});

test('asset details are hidden when the selected files have no metadata or cover bytes', async () => {
    const value = await fixture({ entries: [{ id: 'plain', kind: 'file', name: 'Plain.txt', size: 12, metadataBytes: 0, coverBytes: 0 }] });
    try {
        assert.equal(textContent(value.tree()).includes('readive.included_assets'), false);
    } finally { value.close(); }
});

test('cover-only and metadata-only details disappear when their file is excluded', async () => {
    for (const asset of [{ coverBytes: 32 }, { metadataBytes: 16 }]) {
        const value = await fixture({ devices: [{ id: 'phone', name: 'Phone' }], entries: [
            { id: 'plain', kind: 'file', name: 'Plain.txt', size: 12 },
            { id: 'asset', kind: 'file', name: 'WithAsset.txt', size: 24, ...asset },
        ] });
        try {
            assert.equal(textContent(value.tree()).includes(`readive.included_assets: ${asset.coverBytes ?? asset.metadataBytes} B`), true);
            const file = nodes(value.tree()).find(node => node.type === 'label' && textContent(node).includes('WithAsset.txt'));
            nodes(file).find(node => node.type === 'input').props.onChange(); value.render();
            assert.equal(textContent(value.tree()).includes('readive.included_assets'), false);
            assert.equal(value.button('readive.start_transfer').props.disabled, false, 'Plain files remain transferable after excluding the asset-bearing file');
        } finally { value.close(); }
    }
});

test('device changes discard the old destination and require large-transfer confirmation for the new device', async () => {
    const tabletRequest = deferred();
    const entries = Array.from({ length: 101 }, (_, index) => ({ id: `source-${index}`, kind: 'file', name: `Book-${index}.txt`, size: 1 }));
    const value = await fixture({
        entries,
        requestPage: ({ deviceId, parentId }) => deviceId === 'tablet' ? tabletRequest.promise : { parentId, name: 'Phone', entries: [], revision: 'phone-root', nextCursor: null },
    });
    try {
        value.device().props.onChange({ target: { value: 'phone' } }); await value.settle();
        value.checkbox('readive.confirm_large').props.onChange({ target: { checked: true } }); value.render();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        value.device().props.onChange({ target: { value: 'tablet' } }); await value.settle();
        assert.equal(value.checkbox(), undefined);
        assert.equal(value.checkbox('readive.confirm_large').props.checked, false);
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 0);
        assert.deepEqual(value.calls.requested.map(request => request.deviceId), ['phone', 'tablet']);
        tabletRequest.resolve({ parentId: null, name: 'Tablet', entries: [], revision: 'tablet-root', nextCursor: null });
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, true, 'The new destination does not preserve large-transfer confirmation');
        value.checkbox('readive.confirm_large').props.onChange({ target: { checked: true } }); value.render();
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.equal(value.calls.enqueued[0].deviceId, 'tablet');
        assert.deepEqual(value.calls.enqueued[0].destination, { collectionId: null, name: 'Tablet', revision: 'tablet-root' });
        assert.equal(value.calls.enqueued[0].confirmed, true);
        assert.equal(value.calls.enqueued[0].largeConfirmed, true);
    } finally { value.close(); }
});

test('late pages from the previous device cannot enable transfer while the current device is loading', async () => {
    const phoneRequest = deferred();
    const tabletRequest = deferred();
    const value = await fixture({ requestPage: ({ deviceId }) => deviceId === 'phone' ? phoneRequest.promise : tabletRequest.promise });
    try {
        value.device().props.onChange({ target: { value: 'phone' } }); await value.settle();
        value.device().props.onChange({ target: { value: 'tablet' } }); await value.settle();
        phoneRequest.resolve({ parentId: null, name: 'Old phone', entries: [], revision: 'old-root', nextCursor: null });
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        assert.equal(textContent(value.tree()).includes('Old phone'), false);
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 0);
        tabletRequest.resolve({ parentId: null, name: 'Current tablet', entries: [], revision: 'new-root', nextCursor: null });
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.equal(value.calls.enqueued[0].deviceId, 'tablet');
        assert.deepEqual(value.calls.enqueued[0].destination, { collectionId: null, name: 'Current tablet', revision: 'new-root' });
    } finally { value.close(); }
});

test('folder navigation, going back and refresh use only the latest successful page', async () => {
    const pending = [];
    const value = await fixture({
        devices: [{ id: 'phone', name: 'Phone' }],
        requestPage: (request, attempt) => {
            if (attempt === 1) return { parentId: null, name: 'Phone', entries: [{ id: 'shelf', name: 'Shelf', kind: 'directory', size: null }], revision: 'root-1', nextCursor: null };
            const response = deferred();
            pending.push({ ...response, request });
            return response.promise;
        },
    });
    try {
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        nodes(value.tree()).find(node => node.type === 'button' && textContent(node) === 'Shelf').props.onClick();
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 0, 'Opening a folder invalidates the previous root destination');
        pending[0].reject(new Error('folder unavailable'));
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        assert.ok(nodes(value.tree()).some(node => node.props?.role === 'alert' && textContent(node) === 'readive.destination_failed'));
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 0);
        value.button('readive.destination_refresh').props.onClick(); await value.settle();
        assert.equal(pending[1].request.parentId, 'shelf');
        pending[1].resolve({ parentId: 'shelf', name: 'Shelf', entries: [], revision: 'shelf-2', nextCursor: null });
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        assert.ok(textContent(value.tree()).includes('readive.destination_selected: Phone / Shelf'));
        value.button('readive.destination_parent').props.onClick(); await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        assert.equal(pending[2].request.parentId, null);
        pending[2].resolve({ parentId: null, name: 'Phone', entries: [], revision: 'root-3', nextCursor: null });
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        value.button('readive.destination_refresh').props.onClick(); await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 0, 'Refreshing invalidates the previous destination revision');
        pending[3].resolve({ parentId: null, name: 'Phone', entries: [], revision: 'root-4', nextCursor: null });
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.deepEqual(value.calls.enqueued[0].destination, { collectionId: null, name: 'Phone', revision: 'root-4' });
    } finally { value.close(); }
});

test('destination navigation and file exclusion reset large-transfer confirmation', async () => {
    const entries = Array.from({ length: 102 }, (_, index) => ({ id: `source-${index}`, kind: 'file', name: `Book-${index}.txt`, size: 1 }));
    const value = await fixture({ devices: [{ id: 'phone', name: 'Phone' }], entries });
    try {
        value.checkbox('readive.confirm_large').props.onChange({ target: { checked: true } }); value.render();
        const folder = nodes(value.tree()).find(node => node.type === 'button' && textContent(node).includes('Shelf'));
        folder.props.onClick(); await value.settle();
        assert.equal(value.checkbox('readive.confirm_large').props.checked, false);
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        value.checkbox('readive.confirm_large').props.onChange({ target: { checked: true } }); value.render();
        const file = nodes(value.tree()).find(node => node.type === 'label' && textContent(node).includes('Book-0.txt'));
        nodes(file).find(node => node.type === 'input').props.onChange(); value.render();
        assert.equal(value.checkbox('readive.confirm_large').props.checked, false);
        assert.equal(value.button('readive.start_transfer').props.disabled, true, 'The remaining 101 files still require large-transfer confirmation');
        value.checkbox('readive.confirm_large').props.onChange({ target: { checked: true } }); value.render();
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.deepEqual(value.calls.enqueued[0].excludedIds, ['source-0']);
        assert.equal(value.calls.enqueued[0].confirmed, true);
        assert.equal(value.calls.enqueued[0].largeConfirmed, true);
    } finally { value.close(); }
});

test('enqueue failure reloads the destination revision and only enables retry after the new page arrives', async () => {
    const refreshedPage = deferred();
    const value = await fixture({
        devices: [{ id: 'phone', name: 'Phone' }],
        enqueue: async (_, attempt) => { if (attempt === 1) throw new Error('device unavailable'); return { id: 'job' }; },
        requestPage: ({ parentId }, attempt) => attempt === 1 ? { parentId, name: 'Phone', entries: [], revision: 'rev-1', nextCursor: null } : refreshedPage.promise,
    });
    try {
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.ok(nodes(value.tree()).some(node => node.props?.role === 'alert' && textContent(node).includes('readive.enqueue_failed')));
        assert.equal(value.checkbox(), undefined);
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        assert.equal(value.calls.requested.length, 2, 'Failed enqueue refreshes the destination revision');
        await value.button('readive.start_transfer').props.onClick();
        assert.equal(value.calls.enqueued.length, 1, 'Retry cannot use the rejected destination revision');
        refreshedPage.resolve({ parentId: null, name: 'Phone', entries: [], revision: 'rev-2', nextCursor: null });
        await value.settle();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.equal(value.calls.enqueued.length, 2);
        assert.equal(value.calls.enqueued[1].destination.revision, 'rev-2');
        assert.equal(nodes(value.tree()).some(node => node.props?.role === 'alert' && textContent(node).includes('readive.enqueue_failed')), false);
    } finally { value.close(); }
});

test('a status refresh failure after enqueue preserves the registered job without offering another transfer', async () => {
    const value = await fixture({ devices: [{ id: 'phone', name: 'Phone' }] });
    try {
        value.statusState.refresh = async () => { throw new Error('status unavailable'); };
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.equal(nodes(value.tree()).find(node => node.type === 'Jobs').props.jobs[0].id, 'job');
        assert.equal(textContent(value.tree()).includes('readive.enqueue_failed'), false);
        assert.equal(value.button('readive.start_transfer'), undefined);
        assert.equal(value.button('readive.destination_refresh'), undefined);
        assert.equal(value.calls.requested.length, 1, 'An accepted enqueue must not refresh or invalidate its destination');
        assert.equal(value.calls.enqueued.length, 1);
    } finally { value.close(); }
});

test('queued, receiving and completed transfers show the current progress without editable transfer setup', async () => {
    const value = await fixture({ devices: [{ id: 'phone', name: 'Phone' }] });
    try {
        await value.button('readive.start_transfer').props.onClick(); await value.settle();
        assert.equal(value.device(), undefined);
        assert.equal(value.checkbox(), undefined);
        assert.equal(value.button('readive.start_transfer'), undefined);
        assert.equal(value.button('readive.destination_refresh'), undefined);
        assert.equal(nodes(value.tree()).some(node => node.type === 'input' && node.props.type === 'checkbox'), false);
        assert.equal(nodes(value.tree()).find(node => node.type === 'Jobs').props.jobs[0].status, 'queued');
        assert.equal(textContent(value.tree()).includes('readive.queued'), true);
        for (const status of ['accepted', 'receiving']) {
            value.status.jobs[0] = { ...value.status.jobs[0], status };
            await value.settle();
            assert.equal(nodes(value.tree()).find(node => node.type === 'Jobs').props.jobs[0].status, status);
            assert.ok(nodes(value.tree()).some(node => node.props?.role === 'status' && textContent(node).includes('readive.transfer_running')));
            assert.equal(textContent(value.tree()).includes('readive.queued'), false, 'Active transfers must not ask the user to accept a request again');
        }
        value.status.jobs[0] = { ...value.status.jobs[0], status: 'completed', receivedEntryIds: ['source'] };
        await value.settle();
        assert.equal(nodes(value.tree()).find(node => node.type === 'Jobs').props.jobs[0].status, 'completed');
        assert.ok(nodes(value.tree()).some(node => node.props?.role === 'status' && textContent(node).includes('readive.transfer_completed')));
        assert.equal(textContent(value.tree()).includes('readive.queued'), false);
        assert.equal(value.button('btn_close').props.disabled, false);
        assert.equal(value.calls.enqueued.length, 1);
        value.status.running = false;
        await value.settle();
        assert.equal(value.calls.openedSharing, 0, 'A finished transfer remains visible when the connection stops');
    } finally { value.close(); }
});

function folderEntryFixture(getStatus) {
    const source = fs.readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const openSharingBody = source.match(/const openReadiveSharing = useCallback\(\(\) => \{([\s\S]*?)\n    \}, \[/)?.[1];
    const actionBody = source.match(/const handleContextAction = useCallback\(async \(action\) => \{([\s\S]*?)\n  \}, \[/)?.[1];
    assert.ok(openSharingBody);
    assert.ok(actionBody);
    const calls = { paths: [], navigation: [], toasts: [] };
    const state = { visible: true };
    const scope = {
        window: {
            electronAPI: { getReadiveStatus: getStatus },
            dispatchEvent: event => calls.navigation.push({ type: event.type, detail: event.detail }),
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        setReadiveTransferPaths: paths => calls.paths.push(paths),
        isFolderTabVisible: () => state.visible,
    };
    scope.openReadiveSharing = new Function(...Object.keys(scope), `return () => {${openSharingBody}}`)(...Object.values(scope));
    Object.assign(scope, {
        contextMenu: { type: 'file', file: { path: '/synthetic/Book.txt' } },
        closeContextMenu() {},
        resolveReadivePaths: transferPolicy.resolveReadivePaths,
        selectedEntryObjects: [],
        showToast: message => calls.toasts.push(message),
        t: key => key,
    });
    const run = new Function(...Object.keys(scope), `return async action => {${actionBody}}`)(...Object.values(scope));
    return { calls, state, run, openSharing: scope.openReadiveSharing };
}

test('folder transfer opens a dialog only for a running server with registered devices', async () => {
    const connected = folderEntryFixture(async () => ({ running: true, devices: [{ id: 'phone' }] }));
    await connected.run('send-readive');
    assert.deepEqual(connected.calls.paths, [['/synthetic/Book.txt']]);
    assert.deepEqual(connected.calls.navigation, []);
    for (const status of [{ running: false, devices: [{ id: 'phone' }] }, { running: true, devices: [] }]) {
        const value = folderEntryFixture(async () => status);
        await value.run('send-readive');
        assert.deepEqual(value.calls.paths, [null], 'Connection setup must not open a transfer dialog');
        assert.deepEqual(value.calls.navigation, [{ type: 'bookmanager:navigate', detail: { tabId: 'sharing', focus: 'readive-connection' } }]);
    }
    const failed = folderEntryFixture(async () => { throw new Error('unavailable'); });
    await failed.run('send-readive');
    assert.deepEqual(failed.calls.navigation, [{ type: 'bookmanager:navigate', detail: { tabId: 'sharing', focus: 'readive-connection' } }]);
    assert.deepEqual(failed.calls.toasts, ['readive.status_failed']);
});

test('late transfer status responses do not interrupt a tab the user has switched to', async () => {
    for (const outcome of ['connected', 'disconnected', 'failed']) {
        let resolve;
        let reject;
        const pendingStatus = new Promise((done, fail) => { resolve = done; reject = fail; });
        const value = folderEntryFixture(() => pendingStatus);
        const pendingAction = value.run('send-readive');
        value.state.visible = false;
        if (outcome === 'failed') reject(new Error('unavailable'));
        else resolve({ running: outcome === 'connected', devices: [{ id: 'phone' }] });
        await pendingAction;
        assert.deepEqual(value.calls.paths, []);
        assert.deepEqual(value.calls.navigation, []);
        assert.deepEqual(value.calls.toasts, []);
    }
});

test('opening sharing from the transfer dialog closes it before navigating', () => {
    const value = folderEntryFixture(async () => ({}));
    value.openSharing();
    assert.deepEqual(value.calls.paths, [null]);
    assert.deepEqual(value.calls.navigation, [{ type: 'bookmanager:navigate', detail: { tabId: 'sharing', focus: 'readive-connection' } }]);
    value.state.visible = false;
    value.openSharing();
    assert.equal(value.calls.navigation.length, 1, 'Hidden folder tabs cannot take over navigation');
});

test('sharing attention survives the first lazy mount and resets on manual or ordinary navigation', () => {
    const source = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
    const navigateBody = source.match(/const handleNavigate = \(event\) => \{([\s\S]*?)\n    \};/)?.[1];
    const tabChangeBody = source.match(/const handleTabChange = useCallback\(\(tabId\) => \{([\s\S]*?)\n  \},/)?.[1];
    const sharingView = source.match(/<div className="app-tab-panel" hidden=\{activeTab !== 'sharing'\}>[\s\S]*?<\/div>/)?.[0];
    assert.ok(navigateBody);
    assert.ok(tabChangeBody);
    assert.ok(sharingView);
    const scope = {
        TABS, normalizeDroppedPaths, isAppLocked: false,
        activeTab: 'folder', loadedTabs: new Set(['folder']), readiveConnectionAttention: null,
        setActiveTab: value => { scope.activeTab = value; },
        setReadiveConnectionAttention: value => { scope.readiveConnectionAttention = value; },
        scheduleLastTabSave() {}, dispatchTabAction() {},
        React: { createElement: hooks().react.createElement, Suspense: 'Suspense' },
        MemoSharingTab: 'Sharing', TabLoading: 'Loading', config: {}, setConfig() {}, t: key => key, showToast() {},
    };
    const navigate = detail => new Function(...Object.keys(scope), 'event', navigateBody)(...Object.values(scope), { detail });
    const changeTab = tabId => new Function(...Object.keys(scope), 'tabId', tabChangeBody)(...Object.values(scope), tabId);
    const compiledView = transformSync(`module.exports = (${sharingView});`, { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;
    const renderSharing = () => {
        const module = { exports: {} };
        new Function(...Object.keys(scope), 'module', 'exports', compiledView)(...Object.values(scope), module, module.exports);
        return nodes(module.exports).find(node => node.type === 'Sharing');
    };
    assert.equal(renderSharing(), undefined);
    navigate({ tabId: 'sharing', focus: 'readive-connection' });
    const request = scope.readiveConnectionAttention;
    assert.ok(request && typeof request === 'object');
    assert.equal(renderSharing(), undefined, 'Attention is retained while the sharing tab has not mounted');
    scope.loadedTabs.add('sharing');
    assert.equal(renderSharing().props.attentionRequest, request);
    assert.equal(renderSharing().props.isActive, true);
    navigate({ tabId: 'sharing', focus: 'readive-connection' });
    assert.notEqual(scope.readiveConnectionAttention, request, 'Repeated requests receive a fresh attention identity');
    changeTab('folder');
    assert.equal(renderSharing().props.attentionRequest, null);
    assert.equal(renderSharing().props.isActive, false);
    changeTab('sharing');
    assert.equal(renderSharing().props.attentionRequest, null, 'Manually returning to sharing does not replay an old request');
    for (const tabId of ['sharing', 'organizer']) {
        navigate({ tabId: 'sharing', focus: 'readive-connection' });
        navigate({ tabId });
        assert.equal(renderSharing().props.attentionRequest, null);
    }
});

test('both preload formats expose the same destination request channel', () => {
    for (const name of ['preload.js', 'preload.cjs']) {
        assert.match(fs.readFileSync(new URL(`../electron/${name}`, import.meta.url), 'utf8'), /requestReadiveDestinationPage: options => ipcRenderer.invoke\('readive:requestDestinationPage', options\)/);
    }
});
