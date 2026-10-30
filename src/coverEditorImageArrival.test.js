import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { animateCoverEditorImageArrival } from './coverEditorImageArrival.js';
import { applyMotionPreference } from './motionPolicy.js';
import * as motionPolicy from './motionPolicy.js';
import { coverResamplingTarget } from './coverImageResampling.js';

const compiled = transformSync(fs.readFileSync(new URL('./coverEditorImageArrival.js', import.meta.url), 'utf8'), { format: 'cjs', target: 'es2022' }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
};

function arrivalWithResampler(acquireResampledCover) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(name => {
        if (name === './motionPolicy.js') return motionPolicy;
        if (name === './coverImageResampling.js') return { acquireResampledCover, coverResamplingTarget };
        throw new Error(`Unexpected import: ${name}`);
    }, module, module.exports);
    return module.exports.animateCoverEditorImageArrival;
}

function eventTarget() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(name, listener, options) { listeners.set(name, { listener, options }); },
        removeEventListener(name, listener, options) {
            assert.equal(listeners.get(name)?.listener, listener);
            assert.equal(listeners.get(name)?.options, options);
            listeners.delete(name);
        },
        emit(name) { listeners.get(name)?.listener(); },
    };
}

function harness({ reduced = false, preference = 'system', hidden = false, animationSupported = true, decodeSupported = true,
    devicePixelRatio = 2, naturalWidth = 600, naturalHeight = 800, arrival = animateCoverEditorImageArrival, image = {},
    targetRect = { left: 20, top: 300, width: 240, height: 300 } } = {}) {
    let resolveDecode;
    let rejectDecode;
    const decoded = new Promise((resolve, reject) => { resolveDecode = resolve; rejectDecode = reject; });
    const resampledDecode = deferred();
    const media = { ...eventTarget(), matches: reduced };
    const timers = new Map();
    const timerDurations = [];
    const animations = [];
    const created = [];
    const observers = [];
    const view = {
        ...eventTarget(), innerWidth: 1100, innerHeight: 900, devicePixelRatio,
        Event,
        dispatchEvent(event) { this.emit(event.type); },
        getComputedStyle(element) { return element.style; },
        matchMedia: () => media,
        setTimeout(callback, duration) { const token = {}; timers.set(token, callback); timerDurations.push(duration); return token; },
        clearTimeout(token) { timers.delete(token); },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.targets = []; this.connected = true; observers.push(this); }
            observe(element, options) { this.targets.push({ element, options }); }
            disconnect() { this.connected = false; }
        },
    };
    const document = { ...eventTarget(), defaultView: view, hidden };
    const attributes = new Map();
    document.documentElement = {
        getAttribute: name => attributes.get(name),
        setAttribute: (name, value) => attributes.set(name, value),
    };
    view.document = document;
    applyMotionPreference(preference, view);
    const element = (rect = { left: 0, top: 0, width: 1100, height: 900 }) => ({
        style: {}, attributes: {}, children: [], ownerDocument: document, isConnected: true,
        getClientRects() { return this.style.display === 'none' ? [] : [rect]; },
        getBoundingClientRect() { return rect; },
        closest() { return this.inert ? this : null; },
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); child.parentElement = this; },
        remove() {
            this.isConnected = false;
            if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        },
    });
    document.createElement = tag => {
        const node = element();
        node.tag = tag;
        if (tag === 'div' && animationSupported) {
            node.animate = (keyframes, options) => {
                const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
                animations.push(animation);
                return animation;
            };
        }
        if (tag === 'img') {
            node.naturalWidth = naturalWidth;
            node.naturalHeight = naturalHeight;
            if (decodeSupported) node.decode = () => node.src?.startsWith('blob:') ? resampledDecode.promise : decoded;
        }
        created.push(node);
        return node;
    };
    const container = element();
    const sourceElement = element({ left: 400, top: 100, width: 500, height: 600 });
    const targetElement = element(targetRect);
    let finishes = 0;
    const cancel = arrival({
        sourceElement, targetElement, container,
        image: { width: 600, height: 800, dataUrl: 'data:image/png;base64,aW1hZ2U=', ...image },
        onFinish: () => { finishes += 1; },
    });
    return {
        view, document, media, timers, timerDurations, animations, observers, container, sourceElement, targetElement, created, cancel,
        get finishes() { return finishes; },
        async decoded() { resolveDecode(); await decoded; await Promise.resolve(); },
        async decodeFailed() { rejectDecode(new Error('Cannot decode image')); await decoded.catch(() => {}); await Promise.resolve(); },
        async resampledDecoded() { resampledDecode.resolve(); await tick(); },
        async resampledDecodeFailed() { resampledDecode.reject(new Error('Cannot decode resampled image')); await tick(); },
        mutations() { observers.filter(observer => observer.connected).forEach(observer => observer.callback()); },
        timeout() { [...timers.values()].forEach(callback => callback()); },
        assertClean() {
            assert.equal(container.children.length, 0);
            assert.equal(timers.size, 0);
            assert.equal(view.listeners.size, 0);
            assert.equal(document.listeners.size, 0);
            assert.equal(media.listeners.size, 0);
            assert.ok(observers.every(observer => !observer.connected));
        },
    };
}

test('decoded image appears at the panel center and shrinks toward the new cover without affecting input', async () => {
    const value = harness();
    const [flyer, image] = value.created;
    assert.equal(value.animations.length, 0, 'do not animate an undecoded thumbnail');
    assert.equal(flyer.attributes['aria-hidden'], 'true');
    assert.equal(image.alt, '');
    assert.equal(image.draggable, false);
    assert.equal(flyer.style.pointerEvents, 'none');
    await value.decoded();
    assert.equal(flyer.style.left, '425px');
    assert.equal(flyer.style.top, '100px');
    assert.equal(flyer.style.width, '450px');
    assert.equal(flyer.style.height, '600px');
    const animation = value.animations[0];
    assert.equal(animation.keyframes.at(-1).transform, 'translate(-510px, 50px) scale(0.32)');
    assert.equal(animation.keyframes.at(-1).opacity, 0);
    assert.equal(animation.options.duration, 800);
    const finish = animation.onfinish;
    finish();
    finish();
    value.cancel();
    assert.equal(value.finishes, 1);
    assert.equal(animation.cancelled, true);
    value.assertClean();
});

test('images without metadata dimensions use their decoded size for the same arrival geometry', async () => {
    const value = harness({ image: { width: undefined, height: undefined } });
    assert.equal(value.animations.length, 0);
    await value.decoded();
    const flyer = value.created[0];
    assert.equal(flyer.style.width, '450px');
    assert.equal(flyer.style.height, '600px');
    assert.equal(value.animations[0].keyframes.at(-1).transform, 'translate(-510px, 50px) scale(0.32)');
    value.animations[0].onfinish();
    assert.equal(value.finishes, 1);
    value.assertClean();
});

test('missing dimensions still finish safely when decoding provides no usable size', async () => {
    const value = harness({ image: { width: undefined, height: undefined } });
    value.created.find(node => node.tag === 'img').naturalWidth = 0;
    await value.decoded();
    assert.equal(value.animations.length, 0);
    assert.equal(value.finishes, 1);
    value.assertClean();
});

test('new selection or unmount cancels pending decode and suppresses stale completion', async () => {
    const value = harness();
    value.cancel();
    value.cancel();
    await value.decoded();
    assert.equal(value.animations.length, 0);
    assert.equal(value.finishes, 0);
    value.assertClean();
});

test('cancelling a flying thumbnail clears everything without completing an obsolete selection', async () => {
    const value = harness();
    await value.decoded();
    const staleFinish = value.animations[0].onfinish;
    value.cancel();
    staleFinish();
    assert.equal(value.finishes, 0);
    value.assertClean();
});

test('reduced motion applies the selected cover immediately without waiting for decode or animation', async () => {
    const value = harness({ reduced: true });
    assert.equal(value.finishes, 1);
    assert.equal(value.created.length, 0);
    await value.decoded();
    assert.equal(value.animations.length, 0);
    assert.equal(value.finishes, 1);
    value.assertClean();
});

test('app motion overrides the system and switching to reduced completes pending or running arrivals', async () => {
    for (const started of [false, true]) {
        const value = harness({ reduced: true, preference: 'full' });
        if (started) await value.decoded();
        assert.equal(value.finishes, 0);
        applyMotionPreference('reduced', value.view);
        assert.equal(value.finishes, 1);
        await value.decoded();
        assert.equal(value.animations.length, started ? 1 : 0);
        assert.ok(value.animations.every(animation => animation.cancelled));
        value.assertClean();
    }
});

test('system preference changes complete an in-flight cover arrival once', async () => {
    const value = harness();
    await value.decoded();
    const staleFinish = value.animations[0].onfinish;
    value.media.matches = true;
    value.media.emit('change');
    staleFinish();
    assert.equal(value.finishes, 1);
    value.assertClean();
});

test('hidden document, missing animation API and non-raster sources complete without animation', () => {
    for (const options of [
        { hidden: true }, { animationSupported: false },
        { image: { dataUrl: 'https://example.com/cover.png' } },
        { image: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } },
        { image: { width: 0 } },
    ]) {
        const value = harness(options);
        assert.equal(value.finishes, 1);
        assert.equal(value.animations.length, 0);
        assert.equal(value.created.some(node => node.src), false, 'unsupported input never loads an image');
        value.cancel();
        value.assertClean();
    }
});

test('scroll and resize finish cleanly when the measured destination moves', async () => {
    for (const name of ['scroll', 'resize']) {
        const value = harness();
        await value.decoded();
        if (name === 'scroll') assert.equal(value.view.listeners.get(name).options, true);
        value.view.emit(name);
        assert.equal(value.finishes, 1);
        value.assertClean();
    }
});

test('hidden or inert UI and backgrounding remove the flying thumbnail', async () => {
    for (const hide of [
        value => { value.sourceElement.style.display = 'none'; value.mutations(); },
        value => { value.container.inert = true; value.mutations(); },
        value => { value.targetElement.isConnected = false; value.mutations(); },
        value => { value.document.hidden = true; value.document.emit('visibilitychange'); },
    ]) {
        const value = harness();
        await value.decoded();
        hide(value);
        assert.equal(value.finishes, 1);
        value.assertClean();
    }
});

test('decode failures and stalled decoding or animation cannot leave the old cover visible indefinitely', async () => {
    const failed = harness();
    await failed.decodeFailed();
    assert.equal(failed.finishes, 1);
    failed.assertClean();
    for (const animate of [false, true]) {
        const value = harness();
        if (animate) await value.decoded();
        value.timeout();
        await value.decoded();
        assert.equal(value.finishes, 1);
        value.assertClean();
    }
});

test('load events support environments without decode and cannot start the same animation twice', () => {
    const value = harness({ decodeSupported: false });
    const image = value.created.find(node => node.tag === 'img');
    image.onload();
    image.onload();
    assert.equal(value.animations.length, 1);
    value.animations[0].onfinish();
    assert.equal(value.finishes, 1);
    value.assertClean();
});

function resamplingHarness(options = {}) {
    const pending = deferred();
    const calls = [];
    let releases = 0;
    const arrival = arrivalWithResampler((source, target, request) => {
        calls.push({ source, target, signal: request.signal });
        return pending.promise;
    });
    const value = harness({
        naturalWidth: 2400, naturalHeight: 3200,
        image: { width: 2400, height: 3200 },
        targetRect: { left: 20, top: 300, width: 180, height: 240 },
        arrival, ...options,
    });
    return {
        value, calls, pending,
        get releases() { return releases; },
        async resolve() {
            pending.resolve({ url: 'blob:arrival-thumbnail', release() { releases += 1; } });
            await tick();
        },
    };
}

test('arrival samples the decoded source once at its largest visible size and device resolution before motion', async () => {
    const state = resamplingHarness();
    const { value, calls } = state;
    const [flyer, thumbnail] = value.created;
    assert.equal(calls.length, 0);
    await value.decoded();
    assert.equal(flyer.style.width, '360px');
    assert.equal(flyer.style.height, '480px');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, thumbnail);
    assert.deepEqual(calls[0].target, { width: 720, height: 960 });
    assert.equal(calls[0].signal.aborted, false);
    assert.deepEqual(value.timerDurations, [1800]);
    assert.equal(value.animations.length, 0);
    await state.resolve();
    assert.equal(thumbnail.src, 'blob:arrival-thumbnail');
    assert.equal(value.animations.length, 0, 'the resized bitmap must also decode before it is animated');
    await value.resampledDecoded();
    assert.equal(calls.length, 1, 'motion frames must not create more resized bitmaps');
    assert.equal(value.animations.length, 1);
    assert.deepEqual(value.timerDurations, [1800, 1000]);
    value.animations[0].onfinish();
    assert.equal(value.finishes, 1);
    assert.equal(state.releases, 1);
    assert.equal(calls[0].signal.aborted, true);
    value.assertClean();
});

test('a failed resize uses the original decoded image and still finishes the arrival', async () => {
    const state = resamplingHarness();
    const { value } = state;
    await value.decoded();
    state.pending.reject(new Error('Resize failed'));
    await tick();
    assert.equal(value.created[1].src, 'data:image/png;base64,aW1hZ2U=');
    assert.equal(value.animations.length, 1);
    value.animations[0].onfinish();
    assert.equal(value.finishes, 1);
    assert.equal(state.releases, 0);
    value.assertClean();
});

test('cancellation, reduced motion and the preparation timeout release late resized images without starting motion', async () => {
    for (const kind of ['cancel', 'reduced', 'timeout']) {
        const state = resamplingHarness();
        const { value } = state;
        await value.decoded();
        assert.equal(value.timerDurations[0], 1800);
        if (kind === 'cancel') value.cancel();
        else if (kind === 'reduced') applyMotionPreference('reduced', value.view);
        else value.timeout();
        assert.equal(state.calls[0].signal.aborted, true);
        await state.resolve();
        assert.equal(state.releases, 1);
        assert.equal(value.animations.length, 0);
        assert.equal(value.finishes, kind === 'cancel' ? 0 : 1);
        value.cancel();
        assert.equal(state.releases, 1);
        value.assertClean();
    }
});

test('canceling or failing the resized image decode releases its lease and never leaves an invisible flyer', async () => {
    for (const kind of ['cancel', 'decode-failed']) {
        const state = resamplingHarness();
        const { value } = state;
        await value.decoded();
        await state.resolve();
        if (kind === 'cancel') {
            value.cancel();
            await value.resampledDecoded();
        } else {
            await value.resampledDecodeFailed();
        }
        assert.equal(state.releases, 1);
        assert.equal(value.animations.length, 0);
        assert.equal(value.finishes, kind === 'cancel' ? 0 : 1);
        value.assertClean();
    }
});

test('resampled thumbnails also support load-event fallback without duplicate animation or lease release', async () => {
    const state = resamplingHarness({ decodeSupported: false });
    const { value } = state;
    const thumbnail = value.created[1];
    thumbnail.onload();
    thumbnail.onload();
    assert.equal(state.calls.length, 1);
    await state.resolve();
    thumbnail.onload();
    thumbnail.onload();
    assert.equal(value.animations.length, 1);
    value.animations[0].onfinish();
    value.cancel();
    assert.equal(state.releases, 1);
    assert.equal(value.finishes, 1);
    value.assertClean();
});
