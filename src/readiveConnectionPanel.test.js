import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as transferPolicy from './readiveTransferPolicy.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...Object.values(tree.props ?? {}).flatMap(nodes)];
const textContent = tree => tree === null || tree === undefined || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(textContent).join('') : typeof tree === 'object' ? textContent(tree.props?.children) : String(tree);
const compiled = transformSync(fs.readFileSync(new URL('./components/ReadiveConnectionPanel.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;

function hooks(commit = () => {}) {
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
        useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
        useEffect(effect, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); }); } },
    };
    return {
        react,
        hasUpdates: () => dirty,
        render(component, props) {
            cursor = 0;
            dirty = false;
            const tree = component(props);
            commit(tree);
            const pending = effects;
            effects = [];
            pending.forEach(effect => effect());
            return tree;
        },
        unmount: () => slots.forEach(slot => slot.cleanup?.()),
    };
}

function pairingForSession(session) {
    return {
        ticket: `session-${session}`,
        qrPayload: `readive://bookmanager?ticket=session-${session}`,
        qrDataUrl: `data:image/png;base64,session-${session}`,
        expiresAt: '9999-12-31T23:59:59.999Z',
        sessionScoped: true,
    };
}

async function fixture(options = {}) {
    const originalWindow = globalThis.window;
    const timers = new Map();
    const scheduledDelays = [];
    const calls = { status: 0, starts: [], stops: 0, pairings: 0, revocations: [], scrolls: [], focus: 0 };
    let timerId = 0;
    let now = 0;
    let session = 1;
    let statusError = options.statusError ?? false;
    let renderer;
    let component;
    let tree;
    const props = { t: key => key, variant: options.variant ?? 'sharing', attentionRequest: options.attentionRequest ?? null, isActive: options.isActive ?? true };
    const panelElement = {
        scrollIntoView: options => calls.scrolls.push(options),
        focus: () => { calls.focus += 1; },
    };
    const state = {
        running: options.running ?? false,
        devices: options.devices ?? [],
        jobs: [],
        interfaces: [{ name: 'Wi-Fi', address: '192.168.0.2' }, { name: 'Ethernet', address: '192.168.0.3' }],
        address: options.running ? '192.168.0.2' : null,
        port: 27182,
        pairing: options.running ? pairingForSession(session) : null,
    };
    const schedule = (callback, delay, repeat = false) => {
        const id = ++timerId;
        scheduledDelays.push(delay);
        timers.set(id, { callback, delay, repeat, at: now + delay });
        return id;
    };
    globalThis.window = {
        setTimeout: (callback, delay) => schedule(callback, delay),
        clearTimeout: id => timers.delete(id),
        setInterval: (callback, delay) => schedule(callback, delay, true),
        clearInterval: id => timers.delete(id),
        requestAnimationFrame: callback => schedule(callback, 16),
        cancelAnimationFrame: id => timers.delete(id),
        matchMedia: () => ({ matches: options.reducedMotion ?? false }),
        electronAPI: {
            getReadiveStatus: async () => {
                calls.status += 1;
                if (options.statusGate) await options.statusGate;
                if (statusError) throw new Error('status unavailable');
                return structuredClone(state);
            },
            startReadiveServer: async value => {
                calls.starts.push(value);
                if (options.startGate) await options.startGate;
                state.running = true;
                state.address = value.address;
                state.pairing = pairingForSession(session++);
            },
            stopReadiveServer: async () => {
                calls.stops += 1;
                if (options.stopGate) await options.stopGate;
                state.running = false;
                state.pairing = null;
            },
            createReadivePairing: async () => {
                calls.pairings += 1;
                return pairingForSession(session++);
            },
            revokeReadiveDevice: async ({ deviceId }) => {
                calls.revocations.push(deviceId);
                state.devices = state.devices.filter(device => device.id !== deviceId);
            },
        },
    };
    const mount = () => {
        renderer = hooks(tree => { tree.props.ref.current = panelElement; });
        const mocks = {
            react: renderer.react,
            '../readiveTransferPolicy': transferPolicy,
            './FaIcon': { FaIcon: 'Icon' },
            '../styles/ReadiveTransfer.css': {},
        };
        const module = { exports: {} };
        new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
            assert.ok(name in mocks, name);
            return mocks[name];
        });
        component = module.exports.ReadiveConnectionPanel;
    };
    const render = () => tree = renderer.render(component, props);
    const settle = async () => {
        for (let pass = 0; pass < 20; pass += 1) {
            render();
            await tick();
            if (!renderer.hasUpdates()) return;
        }
        assert.fail('Connection panel did not settle after 20 renders');
    };
    const advance = async milliseconds => {
        const target = now + milliseconds;
        while (true) {
            const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at)[0];
            if (!next) break;
            const [id, timer] = next;
            now = timer.at;
            if (timer.repeat) timer.at += timer.delay;
            else timers.delete(id);
            await timer.callback();
            await settle();
        }
        now = target;
        await settle();
    };
    mount();
    await settle();
    return {
        state,
        calls,
        timers,
        scheduledDelays,
        settle,
        render,
        advance,
        updateProps: async updates => { Object.assign(props, updates); await settle(); },
        setStatusError: value => { statusError = value; },
        tree: () => tree,
        hasAttention: () => tree.props.className.split(' ').includes('is-connection-attention'),
        qr: () => nodes(tree).find(node => node.type === 'img' && node.props.alt === 'readive.qr_alt'),
        button: label => nodes(tree).find(node => node.type === 'button' && (textContent(node) === label || node.props['aria-label'] === label)),
        remount: async () => { renderer.unmount(); mount(); await settle(); },
        close: () => { renderer.unmount(); globalThis.window = originalWindow; },
    };
}

test('enabling the server displays its QR and disabling removes it without a separate pairing request', async () => {
    const value = await fixture();
    try {
        assert.equal(value.qr(), undefined);
        assert.equal(value.button('readive.start').props.disabled, false);
        const network = nodes(value.tree()).find(node => node.type === 'select');
        network.props.onChange({ target: { value: '192.168.0.3' } });
        value.render();
        await value.button('readive.start').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.starts, [{ address: '192.168.0.3' }]);
        assert.equal(value.qr().props.src, value.state.pairing.qrDataUrl);
        assert.equal(value.button('readive.stop').props.disabled, false);
        assert.equal(nodes(value.tree()).find(node => node.type === 'select').props.disabled, true);
        assert.equal(value.calls.pairings, 0);
        await value.button('readive.stop').props.onClick();
        await value.settle();
        assert.equal(value.calls.stops, 1);
        assert.equal(value.qr(), undefined);
        assert.equal(value.button('readive.start').props.disabled, false);
        assert.equal(nodes(value.tree()).find(node => node.type === 'select').props.disabled, false);
        await value.button('readive.start').props.onClick();
        await value.settle();
        assert.equal(value.qr().props.src, pairingForSession(2).qrDataUrl);
        assert.equal(value.calls.pairings, 0);
    } finally { value.close(); }
});

test('reopening a running server keeps its QR and shows no refresh or countdown controls', async () => {
    const value = await fixture({ running: true });
    try {
        const qr = value.qr().props.src;
        await value.advance(10000);
        await value.remount();
        assert.equal(value.qr().props.src, qr);
        assert.equal(value.calls.starts.length, 0);
        assert.equal(value.calls.stops, 0);
        assert.equal(value.calls.pairings, 0);
        for (const key of ['readive.pair', 'readive.pair_show', 'readive.remaining', 'readive.expires', 'readive.connection_ready', 'readive.connection_off']) {
            assert.equal(nodes(value.tree()).some(node => textContent(node) === key), false, `The panel must not show ${key}`);
        }
        assert.equal(value.scheduledDelays.some(delay => delay < 2000), false, 'A persistent QR does not need a per-second countdown');
        assert.equal(value.timers.size, 1, 'Remounting must clean up the previous status poll');
    } finally { value.close(); }
});

test('device registration changes and confirmed removal keep the server QR available', async () => {
    const value = await fixture({ running: true });
    try {
        const qr = value.qr().props.src;
        value.state.devices = [{ id: 'phone', name: 'Phone', pairedAt: '2026-09-09T00:00:00Z' }];
        await value.advance(2000);
        assert.equal(value.qr().props.src, qr);
        assert.ok(value.button('Phone readive.unlink'));
        value.state.devices[0].pairedAt = '2026-09-09T00:01:00Z';
        value.state.devices.push({ id: 'tablet', name: 'Tablet' });
        await value.advance(2000);
        assert.equal(value.qr().props.src, qr);
        value.button('Phone readive.unlink').props.onClick();
        value.render();
        assert.deepEqual(value.calls.revocations, [], 'Opening the removal confirmation does not unregister the device');
        value.button('btn_cancel').props.onClick();
        value.render();
        assert.deepEqual(value.calls.revocations, []);
        value.button('Phone readive.unlink').props.onClick();
        value.render();
        await value.button('readive.revoke').props.onClick();
        await value.settle();
        assert.deepEqual(value.calls.revocations, ['phone']);
        assert.equal(value.button('Phone readive.unlink'), undefined);
        assert.ok(value.button('Tablet readive.unlink'));
        assert.equal(value.qr().props.src, qr);
        assert.equal(value.calls.pairings, 0);
    } finally { value.close(); }
});

test('an unknown connection state hides the QR and recovery restores the same server QR', async () => {
    const value = await fixture({ running: true });
    try {
        const qr = value.qr().props.src;
        value.setStatusError(true);
        await value.advance(2000);
        assert.equal(value.qr(), undefined);
        assert.ok(nodes(value.tree()).some(node => node.props?.role === 'alert' && textContent(node) === 'readive.status_failed'));
        value.setStatusError(false);
        await value.advance(2000);
        assert.equal(value.qr().props.src, qr);
        assert.equal(nodes(value.tree()).some(node => node.props?.role === 'alert'), false);
        assert.equal(value.calls.pairings, 0);
        value.state.running = false;
        value.state.pairing = null;
        await value.advance(2000);
        assert.equal(value.qr(), undefined);
        assert.equal(value.button('readive.start').props.disabled, false);
    } finally { value.close(); }
});

test('initial status loading and pending server actions cannot trigger duplicate mutations', async () => {
    let resolveStatus;
    let resolveStart;
    let resolveStop;
    const statusGate = new Promise(resolve => { resolveStatus = resolve; });
    const startGate = new Promise(resolve => { resolveStart = resolve; });
    const stopGate = new Promise(resolve => { resolveStop = resolve; });
    const value = await fixture({ statusGate, startGate, stopGate });
    try {
        assert.equal(value.button('readive.start').props.disabled, true);
        resolveStatus();
        await value.settle();
        const start = value.button('readive.start').props.onClick;
        const pendingStart = start();
        await start();
        await value.settle();
        assert.equal(value.button('tab_sharing_processing').props.disabled, true);
        assert.equal(value.calls.starts.length, 1);
        assert.equal(value.qr(), undefined);
        resolveStart();
        await pendingStart;
        await value.settle();
        assert.equal(value.qr().props.src, value.state.pairing.qrDataUrl);
        const stop = value.button('readive.stop').props.onClick;
        const pendingStop = stop();
        await stop();
        await value.settle();
        assert.equal(value.button('tab_sharing_processing').props.disabled, true);
        assert.equal(value.calls.stops, 1);
        resolveStop();
        await pendingStop;
        await value.settle();
        assert.equal(value.qr(), undefined);
        assert.equal(value.calls.pairings, 0);
    } finally { value.close(); }
});

test('ordinary visits and requests for an already running connection do not highlight the panel', async () => {
    for (const options of [{}, { variant: 'default', attentionRequest: {} }, { running: true, attentionRequest: {} }]) {
        const value = await fixture(options);
        try {
            await value.advance(6000);
            assert.equal(value.hasAttention(), false);
            assert.deepEqual(value.calls.scrolls, []);
            if (options.running) {
                value.state.running = false;
                await value.advance(6000);
                assert.equal(value.hasAttention(), false, 'Stopping later must not replay an old navigation request');
                assert.deepEqual(value.calls.scrolls, []);
            }
        } finally { value.close(); }
    }
});

test('attention waits for the first status response, lasts three pulses and is not restarted by polling', async () => {
    let resolveStatus;
    const statusGate = new Promise(resolve => { resolveStatus = resolve; });
    const attentionRequest = {};
    const value = await fixture({ statusGate, attentionRequest });
    try {
        assert.equal(value.hasAttention(), false);
        assert.deepEqual(value.calls.scrolls, []);
        resolveStatus();
        await value.settle();
        await value.advance(32);
        assert.equal(value.hasAttention(), true);
        assert.deepEqual(value.calls.scrolls, [{ block: 'nearest', behavior: 'smooth' }]);
        assert.equal(value.calls.focus, 0);
        await value.advance(2000);
        assert.equal(value.hasAttention(), true);
        assert.equal(value.calls.scrolls.length, 1, 'Status polls must not restart the same navigation request');
        await value.advance(1600);
        assert.equal(value.hasAttention(), false);
        await value.updateProps({ attentionRequest });
        await value.advance(6000);
        assert.equal(value.hasAttention(), false);
        assert.equal(value.calls.scrolls.length, 1);
    } finally { value.close(); }
});

test('a fresh navigation request restarts attention and gets its own full display interval', async () => {
    const value = await fixture({ attentionRequest: {} });
    try {
        await value.advance(32);
        assert.equal(value.hasAttention(), true);
        await value.advance(1200);
        await value.updateProps({ attentionRequest: {} });
        assert.equal(value.hasAttention(), false, 'Remove the class before applying a fresh animation');
        await value.advance(32);
        assert.equal(value.hasAttention(), true);
        assert.equal(value.calls.scrolls.length, 2);
        await value.advance(2400);
        assert.equal(value.hasAttention(), true, 'The previous request timeout must not stop the new attention');
        await value.advance(1200);
        assert.equal(value.hasAttention(), false);
        await value.updateProps({ attentionRequest: {} });
        await value.advance(32);
        assert.equal(value.hasAttention(), true, 'A request after completion should highlight again');
    } finally { value.close(); }
});

test('leaving the sharing tab clears attention and a consumed request does not replay when returning', async () => {
    const attentionRequest = {};
    const value = await fixture({ attentionRequest, isActive: false });
    try {
        await value.advance(4000);
        assert.equal(value.hasAttention(), false);
        assert.deepEqual(value.calls.scrolls, []);
        await value.updateProps({ isActive: true });
        await value.advance(32);
        assert.equal(value.hasAttention(), true);
        await value.updateProps({ isActive: false });
        assert.equal(value.hasAttention(), false);
        await value.updateProps({ isActive: true });
        await value.advance(4000);
        assert.equal(value.hasAttention(), false);
        assert.equal(value.calls.scrolls.length, 1);
        await value.updateProps({ attentionRequest: {} });
        await value.advance(16);
        await value.updateProps({ attentionRequest: null, isActive: false });
        await value.advance(4000);
        assert.equal(value.hasAttention(), false, 'Leaving before the next frame must cancel the pending animation');
        assert.equal(value.calls.scrolls.length, 1);
        assert.equal(value.timers.size, 1, 'Only the status poll remains after cancelling attention');
    } finally { value.close(); }
});

test('starting the server clears attention immediately and stopping does not replay it', async () => {
    let resolveStart;
    const startGate = new Promise(resolve => { resolveStart = resolve; });
    const value = await fixture({ attentionRequest: {}, startGate });
    try {
        await value.advance(32);
        assert.equal(value.hasAttention(), true);
        const pendingStart = value.button('readive.start').props.onClick();
        await value.settle();
        assert.equal(value.hasAttention(), false, 'Attention ends before the enable request completes');
        await value.advance(4000);
        assert.equal(value.hasAttention(), false);
        resolveStart();
        await pendingStart;
        await value.settle();
        await value.button('readive.stop').props.onClick();
        await value.settle();
        await value.advance(4000);
        assert.equal(value.hasAttention(), false);
        assert.equal(value.calls.scrolls.length, 1);
    } finally { value.close(); }
});

test('attention waits for a known stopped state and respects reduced motion without moving focus', async () => {
    const value = await fixture({ attentionRequest: {}, statusError: true, reducedMotion: true });
    try {
        await value.advance(4000);
        assert.equal(value.hasAttention(), false);
        assert.deepEqual(value.calls.scrolls, []);
        value.setStatusError(false);
        await value.advance(2032);
        assert.equal(value.hasAttention(), true);
        assert.deepEqual(value.calls.scrolls, [{ block: 'nearest', behavior: 'auto' }]);
        assert.equal(value.calls.focus, 0);
        value.setStatusError(true);
        await value.advance(2000);
        assert.equal(value.hasAttention(), false);
        value.setStatusError(false);
        await value.advance(4000);
        assert.equal(value.hasAttention(), false, 'Status recovery must not repeat an already consumed request');
        assert.equal(value.calls.scrolls.length, 1);
    } finally { value.close(); }
});
