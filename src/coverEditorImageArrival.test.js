import assert from 'node:assert/strict';
import test from 'node:test';
import { animateCoverEditorImageArrival } from './coverEditorImageArrival.js';

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

function harness({ reduced = false, hidden = false, animationSupported = true, decodeSupported = true, image = {} } = {}) {
    let resolveDecode;
    let rejectDecode;
    const decoded = new Promise((resolve, reject) => { resolveDecode = resolve; rejectDecode = reject; });
    const media = { ...eventTarget(), matches: reduced };
    const timers = new Map();
    const animations = [];
    const created = [];
    const observers = [];
    const view = {
        ...eventTarget(), innerWidth: 1100, innerHeight: 900,
        getComputedStyle(element) { return element.style; },
        matchMedia: () => media,
        setTimeout(callback) { const token = {}; timers.set(token, callback); return token; },
        clearTimeout(token) { timers.delete(token); },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.targets = []; this.connected = true; observers.push(this); }
            observe(element, options) { this.targets.push({ element, options }); }
            disconnect() { this.connected = false; }
        },
    };
    const document = { ...eventTarget(), defaultView: view, hidden };
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
        if (tag === 'img' && decodeSupported) node.decode = () => decoded;
        created.push(node);
        return node;
    };
    const container = element();
    const sourceElement = element({ left: 400, top: 100, width: 500, height: 600 });
    const targetElement = element({ left: 20, top: 300, width: 240, height: 300 });
    let finishes = 0;
    const cancel = animateCoverEditorImageArrival({
        sourceElement, targetElement, container,
        image: { width: 600, height: 800, dataUrl: 'data:image/png;base64,aW1hZ2U=', ...image },
        onFinish: () => { finishes += 1; },
    });
    return {
        view, document, media, timers, animations, observers, container, sourceElement, targetElement, created, cancel,
        get finishes() { return finishes; },
        async decoded() { resolveDecode(); await decoded; await Promise.resolve(); },
        async decodeFailed() { rejectDecode(new Error('Cannot decode image')); await decoded.catch(() => {}); await Promise.resolve(); },
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

test('explicit cover selection feedback remains visible with reduced motion enabled', async () => {
    const value = harness({ reduced: true });
    await value.decoded();
    assert.equal(value.animations.length, 1);
    assert.equal(value.finishes, 0);
    assert.equal(value.container.children.length, 1);
    value.media.emit('change');
    assert.equal(value.finishes, 0);
    value.animations[0].onfinish();
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
