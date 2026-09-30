import assert from 'node:assert/strict';
import test from 'node:test';
import { attachPreviewAudio } from './previewAudio.js';

function events(properties = {}) {
    const handlers = new Map();
    return {
        ...properties,
        addEventListener(type, callback) {
            if (!handlers.has(type)) handlers.set(type, new Set());
            handlers.get(type).add(callback);
        },
        removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
        emit(type, event = {}) { handlers.get(type)?.forEach(callback => callback(event)); },
        listenerCount() { return [...handlers.values()].reduce((total, entries) => total + entries.size, 0); },
    };
}

function fixture({ y = 100, volume = '0.4', scale = 1 } = {}) {
    let focused = true;
    let anchorY = y;
    let playError = false;
    const frames = new Map();
    const viewport = events({
        innerWidth: 1000, innerHeight: 800,
        getComputedStyle: element => element.style,
        requestAnimationFrame(callback) { const id = frames.size + 1; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
    });
    const hostDocument = events({ defaultView: viewport, visibilityState: 'visible', hasFocus: () => focused });
    const anchor = {
        getBoundingClientRect: () => ({ top: anchorY, bottom: anchorY, left: 10, right: 490 }),
        getClientRects: () => [anchor.getBoundingClientRect()],
    };
    const audio = {
        volume: 1, paused: true, currentTime: 0, loop: true, plays: 0, pauses: 0,
        getAttribute: name => name === 'data-bookmanager-audio-volume' ? volume : null,
        closest: () => anchor,
        play() { this.plays += 1; if (playError) return Promise.reject(new Error('NotAllowedError')); this.paused = false; return Promise.resolve(); },
        pause() { this.pauses += 1; this.paused = true; },
    };
    const document = events({ body: {}, defaultView: events({ NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: element => element.style }), visibilityState: 'visible', querySelectorAll: selector => selector.startsWith('span') ? [] : [audio] });
    const canvas = {
        style: { overflowX: 'auto', overflowY: 'auto' },
        getBoundingClientRect: () => ({ top: 0, bottom: 800, left: 0, right: 1000 }),
    };
    const frame = {
        isConnected: true, contentDocument: document, ownerDocument: hostDocument, parentElement: canvas, clientWidth: 500, clientHeight: 600,
        getBoundingClientRect: () => ({ top: 0, bottom: 600 * scale, left: 0, right: 500 * scale, width: 500 * scale, height: 600 * scale }),
    };
    return {
        frame, audio, document, hostDocument, viewport, canvas,
        setFocus: value => { focused = value; },
        setPosition: value => { anchorY = value; },
        rejectPlay: value => { playError = value; },
        flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    };
}

function rangeFixture({ spans = [], id = 'range-one', ...options } = {}) {
    const state = fixture(options);
    const getAttribute = state.audio.getAttribute;
    state.audio.getAttribute = name => name === 'data-bookmanager-audio-range' ? id : getAttribute(name);
    state.audio.closest = () => null;
    state.document.querySelectorAll = selector => selector.startsWith('span') ? spans.map(span => ({
        getAttribute: () => span.id || id,
        texts: span.texts || [{ data: 'selected text', rects: span.rects }],
    })) : selector.includes('audio[data-bookmanager-audio-range]') ? [state.audio] : [];
    state.document.createTreeWalker = span => {
        let index = 0;
        for (const text of span.texts) text.parentElement ||= { style: {}, closest: () => null };
        return { nextNode: () => span.texts[index++] };
    };
    state.document.createRange = () => {
        let text;
        return { get startContainer() { return text; }, setStart: node => { text = node; }, setEnd: () => {}, getClientRects: () => text.rects };
    };
    return state;
}

const textRect = (top, bottom, left = 10, right = 490) => ({ top, bottom, left, right });

test('hidden zero-height audio starts at its visible figure and keeps volume and loop settings', () => {
    const state = fixture();
    const cleanup = attachPreviewAudio(state.frame);
    assert.equal(state.audio.plays, 1);
    assert.equal(state.audio.volume, 0.4);
    assert.equal(state.audio.loop, true);
    state.audio.currentTime = 2;
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    assert.equal(state.audio.currentTime, 2);
    cleanup();
});

test('entering and leaving an audio location starts and stops once without replaying a finished effect', () => {
    const state = fixture({ y: 700 });
    const cleanup = attachPreviewAudio(state.frame);
    assert.equal(state.audio.plays, 0);
    state.setPosition(400);
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    state.audio.paused = true;
    state.audio.currentTime = 10;
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    state.setPosition(-1);
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.currentTime, 0);
    state.setPosition(0);
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 2);
    cleanup();
});

test('scaled previews honor clipping by their parent scroll area', () => {
    const state = fixture({ y: 500, scale: 2 });
    const cleanup = attachPreviewAudio(state.frame);
    assert.equal(state.audio.plays, 0);
    state.frame.getBoundingClientRect = () => ({ top: -300, bottom: 900, left: 0, right: 1000, width: 1000, height: 1200 });
    state.hostDocument.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    state.canvas.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 1000 });
    state.hostDocument.emit('scroll');
    state.flush();
    assert.equal(state.audio.paused, true);
    cleanup();
});

test('autoplay rejection retries on a user gesture without retrying on every scroll', async () => {
    const state = fixture();
    state.rejectPlay(true);
    const cleanup = attachPreviewAudio(state.frame);
    await Promise.resolve();
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    state.rejectPlay(false);
    state.document.emit('pointerdown');
    assert.equal(state.audio.plays, 2);
    state.document.emit('pointerdown');
    assert.equal(state.audio.plays, 2);
    cleanup();
});

test('app blur and document hiding stop playback while iframe focus does not', () => {
    const state = fixture();
    const cleanup = attachPreviewAudio(state.frame);
    state.viewport.emit('blur');
    assert.equal(state.audio.paused, false);
    state.setFocus(false);
    state.viewport.emit('blur');
    assert.equal(state.audio.paused, true);
    state.setFocus(true);
    state.viewport.emit('focus');
    state.flush();
    assert.equal(state.audio.plays, 2);
    state.hostDocument.visibilityState = 'hidden';
    state.hostDocument.emit('visibilitychange');
    assert.equal(state.audio.paused, true);
    cleanup();
});

test('cleanup stops pending playback and removes listeners across mode and chapter changes', async () => {
    const state = fixture();
    let finish;
    state.audio.play = function () { this.plays += 1; return new Promise(resolve => { finish = () => { this.paused = false; resolve(); }; }); };
    const cleanup = attachPreviewAudio(state.frame);
    state.document.emit('scroll');
    cleanup();
    finish();
    await Promise.resolve();
    state.flush();
    assert.equal(state.audio.paused, true);
    assert.equal(state.audio.plays, 1);
    for (const target of [state.document, state.hostDocument, state.viewport, state.document.defaultView]) assert.equal(target.listenerCount(), 0);
});

test('leaving the app while the iframe owns focus stops playback without a parent blur event', () => {
    const state = fixture();
    const cleanup = attachPreviewAudio(state.frame);
    state.document.defaultView.emit('blur');
    assert.equal(state.audio.paused, false);
    state.audio.currentTime = 3;
    state.setFocus(false);
    state.document.defaultView.emit('blur');
    assert.equal(state.audio.paused, true);
    assert.equal(state.audio.currentTime, 0);
    state.setFocus(true);
    state.document.defaultView.emit('focus');
    state.flush();
    assert.equal(state.audio.plays, 2);
    cleanup();
});

test('volume handles silent, legacy and malformed documents safely', () => {
    for (const [volume, expected] of [['0', 0], [null, 1], ['', 1], ['invalid', 1], ['Infinity', 1], ['-0.5', 0], ['1.5', 1]]) {
        const state = fixture({ volume });
        const cleanup = attachPreviewAudio(state.frame);
        assert.equal(state.audio.volume, expected);
        cleanup();
    }
});

test('range audio keeps playing across visible text fragments without restarting at paragraph boundaries', () => {
    const first = { rects: [textRect(100, 120)] };
    const second = { rects: [textRect(700, 720)] };
    const state = rangeFixture({ spans: [first, second], volume: '0.35' });
    const cleanup = attachPreviewAudio(state.frame);
    assert.equal(state.audio.plays, 1);
    assert.equal(state.audio.volume, 0.35);
    assert.equal(state.audio.loop, true);
    state.audio.currentTime = 4;
    first.rects[0] = textRect(-100, -80);
    second.rects[0] = textRect(200, 220);
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    assert.equal(state.audio.currentTime, 4);
    assert.equal(state.audio.paused, false);
    second.rects[0] = textRect(-20, 0);
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.paused, true);
    assert.equal(state.audio.currentTime, 0);
    cleanup();
});

test('finished nonloop range audio does not replay while another part of its range is still visible', () => {
    const span = { rects: [textRect(100, 120), textRect(140, 160)] };
    const state = rangeFixture({ spans: [span] });
    state.audio.loop = false;
    const cleanup = attachPreviewAudio(state.frame);
    state.audio.paused = true;
    state.audio.currentTime = 10;
    span.rects[0] = textRect(-20, 0);
    state.document.emit('scroll');
    state.document.emit('pointerdown');
    state.flush();
    assert.equal(state.audio.plays, 1);
    assert.equal(state.audio.currentTime, 10);
    span.rects[1] = textRect(-40, -20);
    state.document.emit('scroll');
    state.flush();
    span.rects[1] = textRect(100, 120);
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 2);
    cleanup();
});

test('missing or blank range text never falls back to the visible storage audio position', () => {
    for (const spans of [[], [{ id: 'other-range', rects: [textRect(100, 120)] }], [{ texts: [{ data: '  \n  ', rects: [textRect(100, 120)] }] }]]) {
        const state = rangeFixture({ spans });
        state.audio.closest = () => ({ getClientRects: () => [textRect(100, 120)], getBoundingClientRect: () => textRect(100, 120) });
        const cleanup = attachPreviewAudio(state.frame);
        assert.equal(state.audio.plays, 0);
        state.document.emit('pointerdown');
        assert.equal(state.audio.plays, 0);
        cleanup();
    }
});

test('range visibility uses individual text line rectangles and excludes empty space between fragments', () => {
    const span = { texts: [{ data: 'formatted', rects: [textRect(-40, -20), textRect(620, 640)] }, { data: 'text', rects: [textRect(100, 120, 550, 590)] }] };
    const state = rangeFixture({ spans: [span] });
    const cleanup = attachPreviewAudio(state.frame);
    assert.equal(state.audio.plays, 0);
    span.texts[1].rects[0] = textRect(100, 120, 400, 490);
    state.document.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    cleanup();
});

test('range text observes preview scale and parent viewport clipping', () => {
    const span = { rects: [textRect(500, 520)] };
    const state = rangeFixture({ spans: [span], scale: 2 });
    const cleanup = attachPreviewAudio(state.frame);
    assert.equal(state.audio.plays, 0);
    state.frame.getBoundingClientRect = () => ({ top: -300, bottom: 900, left: 0, right: 1000, width: 1000, height: 1200 });
    state.hostDocument.emit('scroll');
    state.flush();
    assert.equal(state.audio.plays, 1);
    state.canvas.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 1000 });
    state.hostDocument.emit('scroll');
    state.flush();
    assert.equal(state.audio.paused, true);
    cleanup();
});

test('CSS-hidden range text stays silent until visible and stops when its ancestor becomes transparent', () => {
    for (const visibility of ['hidden', 'collapse']) {
        const ancestor = { style: { opacity: '1' } };
        const element = { style: { visibility, opacity: '1' }, parentElement: ancestor, closest: () => null };
        const state = rangeFixture({ spans: [{ texts: [{ data: 'hidden text', rects: [textRect(100, 120)], parentElement: element }] }] });
        const cleanup = attachPreviewAudio(state.frame);
        assert.equal(state.audio.plays, 0);
        element.style.visibility = 'visible';
        ancestor.style.opacity = '0';
        state.document.emit('scroll');
        state.flush();
        assert.equal(state.audio.plays, 0);
        ancestor.style.opacity = '1';
        state.document.emit('scroll');
        state.flush();
        assert.equal(state.audio.plays, 1);
        ancestor.style.opacity = '0';
        state.document.emit('scroll');
        state.flush();
        assert.equal(state.audio.paused, true);
        cleanup();
    }
});
