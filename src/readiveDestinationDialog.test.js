import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as transferPolicy from './readiveTransferPolicy.js';
import * as destinationPolicy from './readiveDestinationPolicy.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...Object.values(tree.props ?? {}).flatMap(nodes)];
function hooks() {
    const slots = [];
    let cursor = 0;
    let effects = [];
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }];
        },
        useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useMemo(compute, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: compute(), deps }; return slots[index].value; },
        useEffect(effect, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); }); } },
    };
    return { react, render: (component, props) => { cursor = 0; const tree = component(props); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; }, unmount: () => slots.forEach(slot => slot.cleanup?.()) };
}

async function fixture() {
    const renderer = hooks();
    const calls = { requested: [], enqueued: [] };
    const status = { running: true, devices: [{ id: 'phone', name: 'Phone' }, { id: 'tablet', name: 'Tablet' }], jobs: [] };
    const originalWindow = globalThis.window;
    const page = parentId => ({ parentId, name: parentId ?? 'Phone', entries: parentId ? [{ id: 'book', name: 'Existing.txt', kind: 'file', size: 12 }] : [{ id: 'shelf', name: 'Shelf', kind: 'directory', size: null }], revision: 'rev-1', nextCursor: null });
    globalThis.window = { electronAPI: {
        scanReadiveTransfer: async () => ({ id: 'snapshot', entries: [{ id: 'source', kind: 'file', name: 'Book.txt', relativePath: 'Book.txt', size: 1 }], summary: {} }),
        cancelReadiveTransfer: async () => undefined,
        requestReadiveDestinationPage: async value => { calls.requested.push(value); return page(value.parentId); },
        enqueueReadiveTransfer: async value => { calls.enqueued.push(value); return { id: 'job' }; },
    } };
    const mocks = {
        react: renderer.react,
        '../hooks/useModalAccessibility': { useModalAccessibility: () => ({ current: null }) },
        '../readiveTransferPolicy': transferPolicy,
        '../readiveDestinationPolicy': destinationPolicy,
        './ReadiveConnectionPanel': { useReadiveStatus: () => ({ status, refresh: async () => undefined, statusError: false }), ReadiveConnectionPanel: 'Connection', ReadiveJobs: 'Jobs' },
        '../styles/ReadiveTransfer.css': {},
    };
    const compiled = transformSync(fs.readFileSync(new URL('./components/ReadiveTransferDialog.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => { assert.ok(name in mocks, name); return mocks[name]; });
    const props = { paths: ['/synthetic/Book.txt'], t: (key, values) => values?.path ? `${key}: ${values.path}` : key, showToast() {}, onClose() {} };
    let tree;
    const render = () => tree = renderer.render(module.exports.ReadiveTransferDialog, props);
    const button = label => nodes(tree).find(node => node.type === 'button' && node.props.children === label);
    const device = () => nodes(tree).find(node => node.type === 'select' && node.props.id === 'readive-device');
    const checkbox = () => nodes(tree).find(node => node.type === 'label' && Array.isArray(node.props.children) && node.props.children.includes('readive.confirm'))?.props.children[0];
    render(); await tick(); render();
    return { calls, status, render, button, device, checkbox, tree: () => tree, close: () => { renderer.unmount(); globalThis.window = originalWindow; } };
}

test('actual transfer dialog requires destination selection and sends the chosen folder in the enqueue payload', async () => {
    const value = await fixture();
    try {
        value.device().props.onChange({ target: { value: 'phone' } }); value.render(); await tick(); value.render();
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        value.checkbox().props.onChange({ target: { checked: true } }); value.render();
        assert.equal(value.button('readive.start_transfer').props.disabled, true, 'General confirmation cannot substitute for choosing a destination');
        value.button('readive.destination_choose').props.onClick(); value.render();
        assert.equal(value.checkbox().props.checked, false, 'Choosing a location resets scope confirmation');
        const folder = nodes(value.tree()).find(node => node.type === 'button' && node.props.className === 'readive-destination-entry');
        folder.props.onClick(); value.render(); await tick(); value.render();
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        assert.ok(nodes(value.tree()).some(node => node.props?.children === 'Existing.txt'));
        value.button('readive.destination_choose').props.onClick(); value.render();
        value.checkbox().props.onChange({ target: { checked: true } }); value.render();
        assert.equal(value.button('readive.start_transfer').props.disabled, false);
        await value.button('readive.start_transfer').props.onClick(); value.render();
        assert.deepEqual(value.calls.enqueued[0].destination, { collectionId: 'shelf', name: 'Phone / shelf', revision: 'rev-1' });
        assert.equal(value.calls.enqueued[0].confirmed, true);
        assert.equal(value.calls.enqueued[0].deviceId, 'phone');
    } finally { value.close(); }
});

test('device changes clear the previous chosen destination and both preload formats expose the same request channel', async () => {
    const value = await fixture();
    try {
        value.device().props.onChange({ target: { value: 'phone' } }); value.render(); await tick(); value.render();
        value.button('readive.destination_choose').props.onClick(); value.render();
        value.checkbox().props.onChange({ target: { checked: true } }); value.render();
        value.device().props.onChange({ target: { value: 'tablet' } }); value.render(); await tick(); value.render();
        assert.equal(value.checkbox().props.checked, false);
        assert.equal(value.button('readive.start_transfer').props.disabled, true);
        assert.equal(value.calls.enqueued.length, 0);
        assert.deepEqual(value.calls.requested.map(request => request.deviceId), ['phone', 'tablet']);
        for (const name of ['preload.js', 'preload.cjs']) {
            assert.match(fs.readFileSync(new URL(`../electron/${name}`, import.meta.url), 'utf8'), /requestReadiveDestinationPage: options => ipcRenderer.invoke\('readive:requestDestinationPage', options\)/);
        }
    } finally { value.close(); }
});
