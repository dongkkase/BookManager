import assert from 'node:assert/strict';
import test from 'node:test';
import { clampZoom, createZoomWheel, zoomWheelPixels } from './editorZoom.js';
import { wheelPixels } from './chapterScroll.js';

test('Command and Control wheel gestures zoom without triggering chapter scrolling', () => {
    for (const modifier of ['metaKey', 'ctrlKey']) {
        const event = { [modifier]: true, deltaY: -120, deltaX: 0 };
        assert.equal(zoomWheelPixels(event, 700), -120);
        assert.equal(wheelPixels(event, 700), 0);
    }
});

test('ordinary, horizontal and other modified scroll gestures do not zoom', () => {
    for (const event of [{ deltaY: 120 }, { metaKey: true, deltaX: 200, deltaY: 20 }, { metaKey: true, altKey: true, deltaY: 120 }, { metaKey: true, shiftKey: true, deltaY: 120 }, { metaKey: true, deltaY: NaN }]) assert.equal(zoomWheelPixels(event, 700), null);
    assert.equal(wheelPixels({ deltaY: 120 }, 700), 120);
});

test('line and page wheel units match pixel scrolling', () => {
    assert.equal(zoomWheelPixels({ ctrlKey: true, deltaY: -3, deltaMode: 1 }, 700), -48);
    assert.equal(zoomWheelPixels({ metaKey: true, deltaY: 1, deltaMode: 2 }, 700), 700);
});

test('small trackpad inputs accumulate into stable zoom steps', () => {
    const wheel = createZoomWheel();
    for (let time = 0; time < 7; time++) assert.equal(wheel.next(100, -5, time * 16), 100);
    assert.equal(wheel.next(100, -5, 112), 105);
    assert.equal(wheel.next(105, 40, 128), 100);
});

test('idle gaps, reversed direction and manual zoom do not reuse old scroll remainder', () => {
    const wheel = createZoomWheel();
    assert.equal(wheel.next(100, -35, 0), 100);
    assert.equal(wheel.next(100, -10, 500), 100);
    assert.equal(wheel.next(100, 35, 510), 100);
    wheel.reset();
    assert.equal(wheel.next(125, 10, 520), 125);
});

test('zoom remains bounded and a large wheel event cannot jump across the entire range', () => {
    const wheel = createZoomWheel();
    assert.equal(wheel.next(100, -10000, 0), 120);
    assert.equal(wheel.next(195, -120, 20), 200);
    assert.equal(wheel.next(200, -120, 40), 200);
    assert.equal(wheel.next(55, 120, 60), 50);
    assert.equal(wheel.next(50, 120, 80), 50);
    assert.equal(wheel.next(50, -40, 100), 55);
    assert.equal(clampZoom(250), 200);
    assert.equal(clampZoom(25), 50);
});

test('device previews zoom from a small fit scale without jumping to the editing minimum', () => {
    const wheel = createZoomWheel(5);
    assert.equal(wheel.next(17.25, -5, 0), 17.25);
    assert.equal(wheel.next(17.25, -35, 16), 22);
    assert.equal(wheel.next(10, 80, 32), 5);
    assert.equal(wheel.next(5, 40, 48), 5);
    assert.equal(clampZoom(2, 5), 5);
    assert.equal(clampZoom(250, 5), 200);
});
