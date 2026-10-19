import assert from 'node:assert/strict';
import test from 'node:test';
import { attachCoverEditorSearchScroll } from './coverEditorSearchScroll.js';
import { applyMotionPreference } from './motionPolicy.js';

function harness({ top = 0, height = 500, contentHeight = 2500, reduced = false, roundPixels = false } = {}) {
    let time = 0;
    let nextFrame = 0;
    const frames = new Map();
    const listeners = new Map();
    const mediaListeners = new Set();
    const motionListeners = new Map();
    const attributes = new Map();
    const positions = [];
    const media = {
        matches: reduced,
        addEventListener(name, listener) { assert.equal(name, 'change'); mediaListeners.add(listener); },
        removeEventListener(name, listener) { assert.equal(name, 'change'); mediaListeners.delete(listener); },
    };
    const view = {
        document: { documentElement: {
            getAttribute: name => attributes.get(name),
            setAttribute: (name, value) => attributes.set(name, value),
        } },
        Event,
        addEventListener(name, listener) { motionListeners.set(name, listener); },
        removeEventListener(name) { motionListeners.delete(name); },
        dispatchEvent(event) { motionListeners.get(event.type)?.(); },
        matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; },
        performance: { now: () => time },
        requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
    };
    const element = {
        ownerDocument: { defaultView: view },
        isConnected: true,
        clientHeight: height,
        clientWidth: 700,
        scrollHeight: contentHeight,
        scrollTop: top,
        scrollLeft: 0,
        addEventListener(name, listener, options) { listeners.set(name, { listener, options }); },
        removeEventListener(name, listener, options) {
            assert.equal(listeners.get(name)?.listener, listener);
            assert.equal(listeners.get(name)?.options, options);
            listeners.delete(name);
        },
        scrollTo({ top: destination, behavior }) {
            assert.equal(behavior, 'instant');
            this.scrollTop = roundPixels ? Math.round(destination) : destination;
            positions.push(this.scrollTop);
        },
    };
    const cleanup = attachCoverEditorSearchScroll(element);
    const emit = (name, event = {}) => listeners.get(name)?.listener(event);
    const wheel = (deltaY, extra = {}) => {
        const event = { deltaY, deltaX: 0, deltaMode: 0, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
        emit('wheel', event);
        return event;
    };
    const step = (milliseconds = 16) => {
        time += milliseconds;
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback(time);
        emit('scroll');
    };
    return {
        element, frames, listeners, mediaListeners, positions, cleanup, wheel, emit, step,
        setPreference(preference) { applyMotionPreference(preference, view); },
        setReduced(matches) { media.matches = matches; for (const listener of mediaListeners) listener({ matches }); },
        settle() {
            for (let index = 0; index < 200 && frames.size; index += 1) step();
            assert.equal(frames.size, 0, 'scroll motion must finish');
        },
    };
}

test('coarse wheel input progresses across animation frames and accumulates rapid destinations', () => {
    const value = harness();
    assert.equal(value.listeners.get('wheel').options.passive, false);
    assert.equal(value.wheel(100).defaultPrevented, true);
    assert.equal(value.element.scrollTop, 0);
    value.step();
    assert.ok(value.element.scrollTop > 0 && value.element.scrollTop < 100);
    assert.equal(value.wheel(150).defaultPrevented, true);
    assert.equal(value.frames.size, 1);
    value.settle();
    assert.equal(value.element.scrollTop, 250);
    assert.ok(value.positions.every((position, index) => !index || position >= value.positions[index - 1]));
    value.cleanup();
});

test('pixel, line and page wheel units preserve their total movement', () => {
    for (const [deltaY, deltaMode, expected] of [[80, 0, 80], [3, 1, 48], [1, 2, 500]]) {
        const value = harness({ roundPixels: true });
        assert.equal(value.wheel(deltaY, { deltaMode }).defaultPrevented, true);
        value.settle();
        assert.equal(value.element.scrollTop, expected);
        value.cleanup();
    }
});

test('smooth motion clamps to content boundaries and outward edge input remains native', () => {
    const value = harness({ top: 450, contentHeight: 1000 });
    value.wheel(500);
    value.settle();
    assert.equal(value.element.scrollTop, 500);
    assert.equal(value.wheel(100).defaultPrevented, false);
    value.wheel(-1000);
    value.settle();
    assert.equal(value.element.scrollTop, 0);
    assert.equal(value.wheel(-100).defaultPrevented, false);
    value.cleanup();
    const short = harness({ contentHeight: 300 });
    assert.equal(short.wheel(100).defaultPrevented, false);
    assert.equal(short.frames.size, 0);
    short.cleanup();
});

test('reduced motion uses native wheel behavior and changing the preference stops an active animation', () => {
    const value = harness({ reduced: true });
    assert.equal(value.wheel(100).defaultPrevented, false);
    assert.equal(value.frames.size, 0);
    value.setReduced(false);
    value.wheel(200);
    value.step();
    const top = value.element.scrollTop;
    value.setReduced(true);
    assert.equal(value.frames.size, 0);
    value.step();
    assert.equal(value.element.scrollTop, top);
    value.cleanup();
});

test('app motion preference overrides the system and stops existing scroll motion on change', () => {
    const value = harness({ reduced: true });
    value.setPreference('full');
    assert.equal(value.wheel(200).defaultPrevented, true);
    value.step();
    const top = value.element.scrollTop;
    value.setPreference('reduced');
    assert.equal(value.frames.size, 0);
    assert.equal(value.wheel(200).defaultPrevented, false);
    value.step();
    assert.equal(value.element.scrollTop, top);
    value.setPreference('system');
    assert.equal(value.wheel(200).defaultPrevented, false);
    value.cleanup();
});

test('fine trackpad movement, zoom, horizontal input and uncancelable events retain native behavior', () => {
    for (const event of [
        { deltaY: 2.5 }, { deltaY: 16 }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
        { shiftKey: true }, { deltaX: 150 }, { cancelable: false }, { defaultPrevented: true }, { deltaY: Infinity },
    ]) {
        const value = harness();
        value.wheel(200);
        value.step();
        const top = value.element.scrollTop;
        const wheel = value.wheel(100, event);
        assert.equal(wheel.defaultPrevented, Boolean(event.defaultPrevented));
        assert.equal(value.frames.size, 0);
        value.step();
        assert.equal(value.element.scrollTop, top);
        value.cleanup();
    }
});

test('touch, scrollbar pointer input and keyboard actions cancel motion without preventing native input', () => {
    for (const name of ['pointerdown', 'touchstart', 'keydown']) {
        const value = harness();
        value.wheel(400);
        value.step();
        value.emit(name, { preventDefault() { assert.fail('native input must be preserved'); } });
        const top = value.element.scrollTop;
        assert.equal(value.frames.size, 0);
        value.step();
        assert.equal(value.element.scrollTop, top);
        value.cleanup();
    }
});

test('external scroll changes cancel stale targets before the next frame, with or without a scroll event', () => {
    for (const emitScroll of [false, true]) {
        const value = harness();
        value.wheel(400);
        value.step();
        value.element.scrollTop = 800;
        if (emitScroll) value.emit('scroll');
        value.step();
        assert.equal(value.element.scrollTop, 800);
        assert.equal(value.frames.size, 0);
        value.wheel(100);
        value.settle();
        assert.equal(value.element.scrollTop, 900);
        value.cleanup();
    }
});

test('cleanup is idempotent and removes frame, element and media-query listeners', () => {
    const value = harness();
    value.wheel(200);
    value.cleanup();
    value.cleanup();
    assert.equal(value.frames.size, 0);
    assert.equal(value.listeners.size, 0);
    assert.equal(value.mediaListeners.size, 0);
    value.step();
    assert.equal(value.element.scrollTop, 0);
    assert.doesNotThrow(() => attachCoverEditorSearchScroll(null)());
});
