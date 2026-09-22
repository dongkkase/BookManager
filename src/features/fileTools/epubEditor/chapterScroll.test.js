import assert from 'node:assert/strict';
import test from 'node:test';
import { atScrollEdge, createChapterScrollGate, scrollPreviewBy, wheelPixels } from './chapterScroll.js';

test('wheel units support mice, trackpads and page scrolling without intercepting zoom or horizontal gestures', () => {
    assert.equal(wheelPixels({ deltaY: 40 }, 700), 40);
    assert.equal(wheelPixels({ deltaY: -3, deltaMode: 1 }, 700), -48);
    assert.equal(wheelPixels({ deltaY: 1, deltaMode: 2 }, 700), 700);
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) assert.equal(wheelPixels({ deltaY: 40, [modifier]: true }, 700), 0);
    assert.equal(wheelPixels({ deltaY: 3, deltaX: 80 }, 700), 0);
});

test('fractional scroll positions, overscroll and short chapters have stable edges', () => {
    const page = { scrollTop: 0, scrollHeight: 2000, clientHeight: 600 };
    assert.equal(atScrollEdge(page, -1), true);
    assert.equal(atScrollEdge(page, 1), false);
    assert.equal(atScrollEdge({ ...page, scrollTop: 1399.5 }, 1), true);
    assert.equal(atScrollEdge({ ...page, scrollTop: 1395 }, 1), false);
    assert.equal(atScrollEdge({ ...page, scrollTop: -12 }, -1), true);
    assert.equal(atScrollEdge({ ...page, scrollTop: 1406 }, 1), true);
    assert.equal(atScrollEdge({ ...page, scrollHeight: 600 }, 1), true);
});

test('scrolling preview margins moves the document at its visual zoom scale and clamps at both ends', () => {
    const page = { scrollTop: 300, scrollHeight: 2000, clientHeight: 600 };
    const frame = { contentDocument: { scrollingElement: page }, clientWidth: 400, getBoundingClientRect: () => ({ width: 800 }) };
    assert.equal(scrollPreviewBy(frame, 120), true);
    assert.equal(page.scrollTop, 360);
    scrollPreviewBy(frame, -120);
    assert.equal(page.scrollTop, 300);
    scrollPreviewBy(frame, 10000);
    assert.equal(page.scrollTop, 1400);
    scrollPreviewBy(frame, -10000);
    assert.equal(page.scrollTop, 0);
    frame.getBoundingClientRect = () => ({ width: 200 });
    scrollPreviewBy(frame, 120);
    assert.equal(page.scrollTop, 240);
});

test('preview margins and the document share the same edge pause before changing chapters', () => {
    const page = { scrollTop: 1300, scrollHeight: 2000, clientHeight: 600 };
    const frame = { contentDocument: { scrollingElement: page }, clientWidth: 400, getBoundingClientRect: () => ({ width: 400 }) };
    const gate = createChapterScrollGate();
    assert.equal(gate.push(200, 0, atScrollEdge(page, 1)), false);
    scrollPreviewBy(frame, 200);
    assert.equal(page.scrollTop, 1400);
    assert.equal(gate.push(100, 80, atScrollEdge(page, 1)), false);
    assert.equal(gate.push(100, 320, atScrollEdge(page, 1)), true);
    page.scrollTop = 50;
    assert.equal(gate.push(-100, 400, atScrollEdge(page, -1)), false);
    scrollPreviewBy(frame, -100);
    assert.equal(gate.push(-100, 480, atScrollEdge(page, -1)), false);
    assert.equal(gate.push(-100, 720, atScrollEdge(page, -1)), true);
});

test('an unloaded preview, invalid input and a short chapter do not create an outer scroll offset', () => {
    assert.equal(scrollPreviewBy(null, 100), false);
    assert.equal(scrollPreviewBy({ contentDocument: null }, 100), false);
    const page = { scrollTop: 0, scrollHeight: 500, clientHeight: 500 };
    const frame = { contentDocument: { scrollingElement: page }, clientWidth: 400, getBoundingClientRect: () => ({ width: 400 }) };
    scrollPreviewBy(frame, 100);
    assert.equal(page.scrollTop, 0);
    assert.equal(scrollPreviewBy(frame, NaN), false);
});

for (const direction of [-1, 1]) {
    test(`${direction}: reaching an edge stops the whole gesture until the user pauses and scrolls again`, () => {
        const gate = createChapterScrollGate();
        assert.equal(gate.push(direction * 2000, 0, false), false);
        for (let time = 16; time < 3000; time += 16) assert.equal(gate.push(direction * 100, time, true), false);
        assert.equal(gate.push(direction * 100, 3400, true), true);
        assert.equal(gate.push(direction * 100, 3420, true), false);
    });
}

test('a pause before reaching the edge does not authorize its trailing scroll events to change chapters', () => {
    const gate = createChapterScrollGate();
    assert.equal(gate.push(100, 0, false), false);
    assert.equal(gate.push(1000, 500, false), false);
    assert.equal(gate.push(100, 540, true), false);
    assert.equal(gate.push(100, 760, true), false);
    assert.equal(gate.push(100, 981, true), true);
});

test('small deltas at the edge after an interior scroll remain blocked until a fresh gesture', () => {
    const gate = createChapterScrollGate();
    assert.equal(gate.push(120, 0, false), false);
    for (let time = 50; time <= 1000; time += 50) assert.equal(gate.push(4, time, true), false);
    assert.equal(gate.push(30, 1300, true), false);
    assert.equal(gate.push(34, 1320, true), true);
});

test('scrolling during chapter loading keeps the gesture blocked when the next chapter is ready', () => {
    const gate = createChapterScrollGate();
    assert.equal(gate.push(100, 0, true), true);
    for (let time = 100; time <= 1000; time += 100) assert.equal(gate.push(100, time, false), false);
    assert.equal(gate.push(100, 1100, true), false);
    assert.equal(gate.push(100, 1500, true), true);
});

test('trackpad inertia cannot skip several short chapters in one continuous gesture', () => {
    const gate = createChapterScrollGate();
    assert.equal(gate.push(100, 0, true), true);
    for (let time = 16; time < 3000; time += 16) assert.equal(gate.push(80, time, time % 32 === 0), false);
    assert.equal(gate.push(100, 3400, true), true);
});

test('reversing direction immediately allows returning to the chapter just left', () => {
    const gate = createChapterScrollGate();
    assert.equal(gate.push(100, 0, true), true);
    assert.equal(gate.push(-100, 40, true), true);
    assert.equal(gate.push(-100, 70, true), false);
});

test('small trackpad noise does not accumulate across separate gestures or interior scrolls', () => {
    const gate = createChapterScrollGate();
    for (let time = 0; time < 2000; time += 300) assert.equal(gate.push(10, time, true), false);
    gate.reset();
    assert.equal(gate.push(50, 0, true), false);
    assert.equal(gate.push(-20, 10, false), false);
    assert.equal(gate.push(20, 20, true), false);
    assert.equal(gate.push(44, 30, true), true);
});

test('invalid or stationary events never trigger a chapter change', () => {
    const gate = createChapterScrollGate();
    for (const delta of [0, NaN, Infinity, -Infinity, undefined]) assert.equal(gate.push(delta, 0, true), false);
});
