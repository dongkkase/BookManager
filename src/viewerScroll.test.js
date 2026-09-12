import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerScrollController, DEFAULT_SCROLL_SETTINGS, normalizeScrollSettings, viewerWheelDelta } from './viewerScroll.js';

function createHarness({ initialSettings = {}, height = 600, contentHeight = 10000, initialTop = 0, roundPixels = false } = {}) {
    let clock = 0;
    let frameId = 0;
    let settings = { ...DEFAULT_SCROLL_SETTINGS, ...initialSettings };
    let enabled = true;
    let blocked = false;
    const pending = new Map();
    const autoChanges = [];
    const positions = [];
    const element = {
        clientHeight: height,
        clientWidth: 800,
        scrollHeight: contentHeight,
        scrollTop: initialTop,
        scrollLeft: 0,
        scrollTo({ top }) {
            assert.ok(Number.isFinite(top));
            this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, roundPixels ? Math.round(top) : top));
            positions.push(this.scrollTop);
        },
    };
    const controller = createViewerScrollController({
        getElement: () => element,
        getSettings: () => settings,
        isEnabled: () => enabled,
        isBlocked: () => blocked,
        onAutoScrollChange: value => autoChanges.push(value),
        requestFrame(callback) {
            const id = ++frameId;
            pending.set(id, callback);
            return id;
        },
        cancelFrame: id => pending.delete(id),
        now: () => clock,
    });
    const step = (milliseconds = 16) => {
        clock += milliseconds;
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach(callback => callback(clock));
    };
    return {
        controller,
        element,
        autoChanges,
        positions,
        pending,
        step,
        setSettings: next => { settings = { ...settings, ...next }; },
        setEnabled: value => { enabled = value; },
        setBlocked: value => { blocked = value; },
        settle() {
            for (let index = 0; index < 200 && pending.size; index += 1) step();
            assert.equal(pending.size, 0, 'animation should finish');
        },
    };
}

function wheel(deltaY, overrides = {}) {
    return {
        deltaY,
        deltaX: 0,
        deltaMode: 0,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...overrides,
    };
}

test('normalization restores supported options and bounded five-percent keyboard steps', () => {
    assert.deepEqual(normalizeScrollSettings(null), DEFAULT_SCROLL_SETTINGS);
    assert.deepEqual(normalizeScrollSettings({ behavior: 'other', wheelAmount: '__proto__', keyboardPercent: '88', autoSeconds: 25 }), {
        ...DEFAULT_SCROLL_SETTINGS,
        keyboardPercent: 90,
    });
    assert.equal(normalizeScrollSettings({ keyboardPercent: 500 }).keyboardPercent, 100);
    assert.equal(normalizeScrollSettings({ keyboardPercent: 1 }).keyboardPercent, 10);
    assert.equal(normalizeScrollSettings({ keyboardPercent: 'NaN' }).keyboardPercent, 85);
    assert.equal(normalizeScrollSettings({ autoSeconds: '12' }).autoSeconds, 12);
});

test('native system wheel preserves the operating system movement without interception', () => {
    const fixture = createHarness();
    const event = wheel(75);
    assert.equal(fixture.controller.handleScrollWheel(event), false);
    assert.equal(event.defaultPrevented, false);
    assert.equal(fixture.element.scrollTop, 0);
    assert.equal(fixture.pending.size, 0);
});

test('custom wheel amounts scale pixel, line, and page units', () => {
    for (const [amount, multiplier] of [['slow', 0.5], ['fast', 1.5], ['faster', 2]]) {
        for (const [mode, delta, pixels] of [[0, 100, 100], [1, 3, 48], [2, 1, 600]]) {
            const fixture = createHarness({ initialSettings: { wheelAmount: amount } });
            const event = wheel(delta, { deltaMode: mode });
            assert.equal(fixture.controller.handleScrollWheel(event), true);
            assert.equal(event.defaultPrevented, true);
            assert.equal(fixture.element.scrollTop, pixels * multiplier);
        }
    }
});

test('horizontal wheel and shift wheel keep native behavior; mixed vertical input retains its horizontal distance', () => {
    const fixture = createHarness({ initialSettings: { wheelAmount: 'faster' }, initialTop: 100 });
    for (const event of [wheel(0, { deltaX: 100 }), wheel(10, { deltaX: 100 }), wheel(100, { shiftKey: true })]) {
        assert.equal(fixture.controller.handleScrollWheel(event), false);
        assert.equal(event.defaultPrevented, false);
    }
    assert.equal(fixture.controller.handleScrollWheel(wheel(100, { deltaX: 25 })), true);
    assert.equal(fixture.element.scrollLeft, 25);
    assert.equal(fixture.element.scrollTop, 300);
    assert.deepEqual(viewerWheelDelta(wheel(1, { deltaX: 1, deltaMode: 2 }), fixture.element), { x: 800, y: 600 });
});

test('zoom gestures and noncancelable events are never also scrolled by the controller', () => {
    const fixture = createHarness({ initialSettings: { wheelAmount: 'faster' } });
    for (const flags of [{ ctrlKey: true }, { metaKey: true }, { buttons: 1 }, { buttons: 2 }, { cancelable: false }, { defaultPrevented: true }]) {
        assert.equal(fixture.controller.handleScrollWheel(wheel(100, flags)), false);
    }
    assert.equal(fixture.element.scrollTop, 0);
});

test('keyboard scrolling moves a percentage of the viewport and clamps at both ends', () => {
    const fixture = createHarness({ initialSettings: { keyboardPercent: 35 }, height: 800, contentHeight: 2000 });
    assert.equal(fixture.controller.scrollByKeyboard(1), true);
    assert.equal(fixture.element.scrollTop, 280);
    fixture.controller.scrollByKeyboard(-1);
    fixture.controller.scrollByKeyboard(-1);
    assert.equal(fixture.element.scrollTop, 0);
    for (let index = 0; index < 10; index += 1) fixture.controller.scrollByKeyboard(1);
    assert.equal(fixture.element.scrollTop, 1200);
    fixture.setSettings({ keyboardPercent: 50 });
    fixture.controller.scrollByKeyboard(-1);
    assert.equal(fixture.element.scrollTop, 800);
});

test('smooth wheel input accumulates destinations while an animation is in progress', () => {
    const fixture = createHarness({ initialSettings: { behavior: 'smooth' } });
    fixture.controller.handleScrollWheel(wheel(100));
    fixture.step(16);
    assert.ok(fixture.element.scrollTop > 0 && fixture.element.scrollTop < 100);
    fixture.controller.handleScrollWheel(wheel(150));
    assert.equal(fixture.pending.size, 1);
    fixture.settle();
    assert.equal(fixture.element.scrollTop, 250);
    assert.ok(fixture.positions.every((value, index) => index === 0 || value >= fixture.positions[index - 1]));
});

test('smooth interpolation uses elapsed time rather than frame count', () => {
    const fixtures = [8, 16].map(milliseconds => {
        const fixture = createHarness({ initialSettings: { behavior: 'smooth' } });
        fixture.controller.handleScrollWheel(wheel(500));
        for (let index = 0; index < 160 / milliseconds; index += 1) fixture.step(milliseconds);
        return fixture;
    });
    assert.ok(Math.abs(fixtures[0].element.scrollTop - fixtures[1].element.scrollTop) < 0.000001);
    fixtures.forEach(fixture => fixture.controller.cancelMotion());
});

test('smooth motion finishes even when the browser rounds fractional scroll positions', () => {
    const fixture = createHarness({ initialSettings: { behavior: 'smooth' }, roundPixels: true });
    fixture.controller.handleScrollWheel(wheel(93));
    fixture.settle();
    assert.equal(fixture.element.scrollTop, 93);
});

test('manual native wheel cancels a prior smooth destination immediately', () => {
    const fixture = createHarness({ initialSettings: { behavior: 'smooth' } });
    fixture.controller.handleScrollWheel(wheel(300));
    fixture.step();
    fixture.setSettings({ behavior: 'default' });
    assert.equal(fixture.controller.handleScrollWheel(wheel(100)), false);
    const position = fixture.element.scrollTop;
    fixture.step(200);
    assert.equal(fixture.element.scrollTop, position);
    assert.equal(fixture.pending.size, 0);
});

test('automatic scrolling retains fractional distance at slow speeds', () => {
    const fixture = createHarness({ initialSettings: { autoSeconds: 40 }, roundPixels: true });
    assert.equal(fixture.controller.startAutoScroll(), true);
    for (let index = 0; index < 1000; index += 1) fixture.step(16);
    assert.equal(fixture.element.scrollTop, 240);
    assert.deepEqual(fixture.autoChanges, [true]);
    fixture.controller.stopAutoScroll();
    assert.deepEqual(fixture.autoChanges, [true, false]);
    assert.equal(fixture.pending.size, 0);
});

test('automatic speed changes apply on the next frame without restarting', () => {
    const fixture = createHarness({ initialSettings: { autoSeconds: 20 } });
    fixture.controller.startAutoScroll();
    for (let index = 0; index < 20; index += 1) fixture.step(50);
    assert.ok(Math.abs(fixture.element.scrollTop - 30) < 0.000001);
    fixture.setSettings({ autoSeconds: 8 });
    for (let index = 0; index < 20; index += 1) fixture.step(50);
    assert.ok(Math.abs(fixture.element.scrollTop - 105) < 0.000001);
    assert.deepEqual(fixture.autoChanges, [true]);
    fixture.controller.cancelMotion();
});

test('automatic scrolling stops at the document end and never starts on a non-scrollable page', () => {
    const fixture = createHarness({ initialTop: 390, height: 600, contentHeight: 1000, initialSettings: { autoSeconds: 8 } });
    fixture.controller.startAutoScroll();
    for (let index = 0; index < 10; index += 1) fixture.step(50);
    assert.equal(fixture.element.scrollTop, 400);
    assert.equal(fixture.controller.getAutoScrolling(), false);
    assert.equal(fixture.pending.size, 0);
    assert.equal(fixture.controller.startAutoScroll(), false);
    assert.equal(createHarness({ height: 600, contentHeight: 500 }).controller.startAutoScroll(), false);
});

test('stalled frames cannot jump through pages on automatic or smooth motion', () => {
    const fixture = createHarness();
    fixture.controller.startAutoScroll();
    fixture.step(30000);
    assert.equal(fixture.element.scrollTop, 1.5);
    fixture.controller.cancelMotion();
    fixture.element.scrollTop = 0;
    fixture.setSettings({ behavior: 'smooth' });
    fixture.controller.handleScrollWheel(wheel(600));
    fixture.step(30000);
    assert.ok(fixture.element.scrollTop > 0 && fixture.element.scrollTop < 300);
    fixture.controller.cancelMotion();
});

test('manual wheel, keyboard and cancellation stop automatic scrolling', () => {
    for (const action of [
        controller => controller.handleScrollWheel(wheel(50)),
        controller => controller.handleScrollWheel(wheel(0, { deltaX: 40 })),
        controller => controller.scrollByKeyboard(1),
        controller => controller.cancelMotion(),
    ]) {
        const fixture = createHarness();
        fixture.controller.startAutoScroll();
        action(fixture.controller);
        assert.equal(fixture.controller.getAutoScrolling(), false);
        assert.equal(fixture.pending.size, 0);
        assert.deepEqual(fixture.autoChanges, [true, false]);
    }
});

test('disabled modes stop all animation while blocking stops auto only', () => {
    const fixture = createHarness({ initialSettings: { wheelAmount: 'fast' } });
    fixture.setBlocked(true);
    assert.equal(fixture.controller.startAutoScroll(), false);
    assert.equal(fixture.controller.handleScrollWheel(wheel(100)), true);
    assert.equal(fixture.element.scrollTop, 150);
    fixture.setBlocked(false);
    fixture.controller.startAutoScroll();
    fixture.setBlocked(true);
    fixture.step();
    assert.equal(fixture.controller.getAutoScrolling(), false);
    fixture.setBlocked(false);
    fixture.controller.startAutoScroll();
    fixture.setEnabled(false);
    fixture.step();
    assert.equal(fixture.controller.getAutoScrolling(), false);
    assert.equal(fixture.controller.handleScrollWheel(wheel(100)), false);
    assert.equal(fixture.controller.scrollByKeyboard(1), false);
    assert.equal(fixture.pending.size, 0);
});

test('external scroll-position adjustment becomes the new automatic origin', () => {
    const fixture = createHarness();
    fixture.controller.startAutoScroll();
    fixture.step(50);
    fixture.element.scrollTop = 800;
    fixture.step(50);
    assert.equal(fixture.element.scrollTop, 801.5);
    fixture.controller.cancelMotion();
});

test('toggle and cancel are idempotent and do not leave animation callbacks queued', () => {
    const fixture = createHarness();
    assert.equal(fixture.controller.toggleAutoScroll(), true);
    assert.equal(fixture.controller.toggleAutoScroll(), false);
    fixture.controller.stopAutoScroll();
    fixture.controller.cancelMotion();
    assert.deepEqual(fixture.autoChanges, [true, false]);
    assert.equal(fixture.pending.size, 0);
});
