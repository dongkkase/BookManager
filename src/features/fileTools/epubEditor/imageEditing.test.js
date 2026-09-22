import assert from 'node:assert/strict';
import test from 'node:test';
import {
    IMAGE_EDIT_LIMITS, IMAGE_CROP_PRESETS, IMAGE_FILTER_PRESETS, IMAGE_BORDER_PRESETS,
    clampImageRect, fitImageCrop, createImageEditSettings, normalizeImageEditSettings,
    getTransformedImageDimensions, getImageEditDimensions, transformImageEditSettings, createImageEditRenderer,
} from './imageEditing.js';

function close(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 0.00000001, `${actual} differs from ${expected}`);
}

function equalRect(actual, expected) {
    for (const key of ['x', 'y', 'width', 'height']) close(actual[key], expected[key]);
}

test('image edit settings preserve normal source dimensions and allocate independent state', () => {
    const first = createImageEditSettings(1200, 800);
    const second = createImageEditSettings(1200, 800);
    assert.deepEqual(getImageEditDimensions(first, 1200, 800), { width: 1200, height: 800 });
    assert.deepEqual(first.crop, { x: 0, y: 0, width: 1, height: 1 });
    first.regions.push({ id: 'one' });
    first.border.preset = 'white';
    first.crop.x = 0.2;
    assert.equal(second.regions.length, 0);
    assert.equal(second.border.preset, 'none');
    assert.equal(second.border.radius, 24);
    assert.equal(second.crop.x, 0);
});

test('requested dimensions are bounded by both edge and pixel limits while retaining aspect', () => {
    for (const [width, height] of [[20000, 20000], [30000, 1000], [1000, 30000], [8192, 8192]]) {
        const output = getImageEditDimensions({ width, height }, 100, 100);
        assert.ok(output.width <= IMAGE_EDIT_LIMITS.maxDimension);
        assert.ok(output.height <= IMAGE_EDIT_LIMITS.maxDimension);
        assert.ok(output.width * output.height <= IMAGE_EDIT_LIMITS.maxPixels);
        assert.ok(Math.abs(output.width / output.height - width / height) < 0.15);
    }
    assert.deepEqual(getImageEditDimensions({ width: 8192, height: 4096 }, 100, 100), { width: 8192, height: 4096 });
});

test('invalid and extreme settings normalize without NaN or unbounded allocations', () => {
    const settings = normalizeImageEditSettings({
        rotation: -450, flipX: 'true', flipY: true, width: Infinity, height: -200,
        crop: null, filter: 'external-filter', brightness: 500, contrast: -500, saturation: NaN,
        temperature: '25', vignette: -80, regions: [null, { id: 'one', x: 2, y: -1, width: 2, height: 0, strength: 800, mode: 'script', shape: 'script' }],
        border: { preset: 'script', color: 'url(evil)', width: 100000, radius: -1 },
    }, 1200, 800);
    assert.equal(settings.rotation, 270);
    assert.equal(settings.flipX, false);
    assert.equal(settings.flipY, true);
    assert.equal(settings.width, 800);
    assert.equal(settings.height, 1);
    assert.equal(settings.filter, 'original');
    assert.equal(settings.brightness, 100);
    assert.equal(settings.contrast, -100);
    assert.equal(settings.saturation, 0);
    assert.equal(settings.temperature, 25);
    assert.equal(settings.vignette, 0);
    assert.deepEqual(settings.border, { preset: 'none', color: '#ffffff', width: 512, radius: 0 });
    assert.equal(settings.regions.length, 1);
    assert.equal(settings.regions[0].strength, 100);
    assert.equal(settings.regions[0].shape, 'rectangle');
    assert.equal(settings.regions[0].mode, 'mosaic');
    assert.deepEqual(normalizeImageEditSettings(null, 640, 480), createImageEditSettings(640, 480));
});

test('privacy regions have bounded count and retain region type, IDs, and strength', () => {
    const regions = Array.from({ length: 150 }, (_, index) => ({ id: `region-${index}`, x: 0.1, y: 0.2, width: 0.3, height: 0.4, shape: 'ellipse', mode: 'blur', strength: 0 }));
    const output = normalizeImageEditSettings({ regions }, 1200, 800);
    assert.equal(output.regions.length, IMAGE_EDIT_LIMITS.maxRegions);
    assert.deepEqual(output.regions[0], { id: 'region-0', x: 0.1, y: 0.2, width: 0.3, height: 0.4, shape: 'ellipse', mode: 'blur', strength: 1 });
});

test('crop rectangles stay within the image while moving oversized coordinates back inside', () => {
    assert.deepEqual(clampImageRect({ x: 0.9, y: -2, width: 0.4, height: 0.2 }), { x: 0.6, y: 0, width: 0.4, height: 0.2 });
    assert.deepEqual(clampImageRect({ x: NaN, y: Infinity, width: 4, height: 4 }), { x: 0, y: 0, width: 1, height: 1 });
    assert.deepEqual(clampImageRect(null), { x: 0, y: 0, width: 1, height: 1 });
    for (const rect of [clampImageRect({ width: 0, height: -3 }), clampImageRect({ x: 1, y: 1, width: 0.01, height: 0.01 })]) {
        assert.ok(rect.width > 0 && rect.height > 0);
        assert.ok(rect.x + rect.width <= 1 && rect.y + rect.height <= 1);
    }
});

test('crop presets include the requested 16:8 ratio and fit in physical rather than normalized pixels', () => {
    assert.deepEqual(IMAGE_CROP_PRESETS.map(preset => preset.id), ['original', 'free', '1:1', '4:3', '3:2', '16:8', '2:3', '3:4']);
    for (const preset of IMAGE_CROP_PRESETS.filter(item => item.ratio)) {
        const original = { x: 0.1, y: 0.2, width: 0.7, height: 0.5 };
        const rect = fitImageCrop(original, preset.ratio, 1600, 900);
        close(rect.width * 1600 / (rect.height * 900), preset.ratio);
        close(rect.x + rect.width / 2, original.x + original.width / 2);
        close(rect.y + rect.height / 2, original.y + original.height / 2);
        assert.ok(rect.width <= original.width && rect.height <= original.height);
    }
    equalRect(fitImageCrop({ width: 1, height: 1 }, 1, 1600, 800), { x: 0.25, y: 0, width: 0.5, height: 1 });
    equalRect(fitImageCrop({ x: 0.1, width: 0.5, height: 0.6 }, null, 1600, 800), { x: 0.1, y: 0, width: 0.5, height: 0.6 });
});

test('clockwise rotation keeps cropped and masked pixels associated with the rotated image', () => {
    const original = {
        ...createImageEditSettings(1200, 800), flipX: true,
        crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        regions: [{ id: 'mask', x: 0.2, y: 0.1, width: 0.4, height: 0.3, shape: 'ellipse', mode: 'blur', strength: 70 }],
    };
    const rotated = transformImageEditSettings(original, 'rotate');
    assert.equal(rotated.rotation, 90);
    assert.equal(rotated.flipX, false);
    assert.equal(rotated.flipY, true);
    assert.equal(rotated.width, 800);
    assert.equal(rotated.height, 1200);
    equalRect(rotated.crop, { x: 0.4, y: 0.1, width: 0.4, height: 0.3 });
    equalRect(rotated.regions[0], { x: 0.6, y: 0.2, width: 0.3, height: 0.4 });
    assert.equal(rotated.regions[0].mode, 'blur');
    assert.equal(rotated.regions[0].strength, 70);
    assert.equal(original.rotation, 0);
    assert.equal(original.regions[0].x, 0.2);
});

test('four rotations and pairs of flips return geometry and orientation to the original', () => {
    const initial = {
        ...createImageEditSettings(1200, 800), rotation: 90, flipY: true,
        crop: { x: 0.13, y: 0.27, width: 0.38, height: 0.45 },
        regions: [{ id: 'mask', x: 0.4, y: 0.5, width: 0.1, height: 0.2 }],
    };
    for (const operations of [['rotate', 'rotate', 'rotate', 'rotate'], ['flipX', 'flipX'], ['flipY', 'flipY']]) {
        const final = operations.reduce(transformImageEditSettings, initial);
        equalRect(final.crop, initial.crop);
        equalRect(final.regions[0], initial.regions[0]);
        for (const key of ['rotation', 'flipX', 'flipY', 'width', 'height']) assert.equal(final[key], initial[key]);
    }
});

test('flip transforms affect full-image coordinates and quarter turns swap natural dimensions', () => {
    const value = { ...createImageEditSettings(1200, 800), crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } };
    equalRect(transformImageEditSettings(value, 'flipX').crop, { x: 0.6, y: 0.2, width: 0.3, height: 0.4 });
    equalRect(transformImageEditSettings(value, 'flipY').crop, { x: 0.1, y: 0.4, width: 0.3, height: 0.4 });
    assert.deepEqual(getTransformedImageDimensions(1200, 800, 90), { width: 800, height: 1200 });
    assert.deepEqual(getTransformedImageDimensions(1200, 800, -90), { width: 800, height: 1200 });
    assert.deepEqual(getTransformedImageDimensions(1200, 800, 180), { width: 1200, height: 800 });
    assert.equal(transformImageEditSettings(value, 'unknown'), value);
});

test('all filter and border presets survive normalization and filters provide thumbnail styles', () => {
    assert.equal(new Set(IMAGE_FILTER_PRESETS.map(preset => preset.id)).size, IMAGE_FILTER_PRESETS.length);
    for (const preset of IMAGE_FILTER_PRESETS) {
        assert.equal(normalizeImageEditSettings({ filter: preset.id }, 10, 10).filter, preset.id);
        assert.ok(preset.cssFilter.includes('saturate('));
    }
    for (const preset of IMAGE_BORDER_PRESETS) assert.equal(normalizeImageEditSettings({ border: { preset: preset.id } }, 10, 10).border.preset, preset.id);
    assert.equal(normalizeImageEditSettings({ border: { preset: 'rounded' } }, 100, 100).border.radius, 24);
    assert.equal(normalizeImageEditSettings({ border: { preset: 'rounded', radius: 0 } }, 100, 100).border.radius, 0);
});

function installWorker(context) {
    const instances = [];
    class FakeWorker {
        constructor() { instances.push(this); this.messages = []; }
        postMessage(message) {
            this.messages.push(message);
            if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { id: message.id, result: { width: 200, height: 100 } } }));
        }
        terminate() { this.terminated = true; }
    }
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    Object.defineProperty(globalThis, 'Worker', { value: FakeWorker, configurable: true, writable: true });
    context.after(() => {
        if (previous) Object.defineProperty(globalThis, 'Worker', previous);
        else delete globalThis.Worker;
    });
    return instances;
}

test('renderer serializes final renders and rejects pending work when destroyed', async context => {
    const instances = installWorker(context);
    const renderer = await createImageEditRenderer(new Blob(['image']));
    assert.equal(renderer.width, 200);
    const first = renderer.render({ filter: 'soft' });
    const second = renderer.render({ filter: 'grayscale' });
    const worker = instances[0];
    assert.equal(worker.messages.length, 2);
    const firstId = worker.messages[1].id;
    worker.onmessage({ data: { id: firstId, result: { width: 1 } } });
    const secondId = worker.messages[2].id;
    worker.onmessage({ data: { id: secondId, result: { width: 2 } } });
    assert.deepEqual(await first, { width: 1 });
    assert.deepEqual(await second, { width: 2 });
    const pending = renderer.render({});
    renderer.destroy();
    await assert.rejects(pending, { code: 'IMAGE_EDIT_CLOSED' });
    await assert.rejects(renderer.render({}), { code: 'IMAGE_EDIT_CLOSED' });
    assert.equal(worker.terminated, true);
    renderer.destroy();
});

test('renderer keeps one active and only the latest queued preview and prioritizes final output', async context => {
    const instances = installWorker(context);
    const renderer = await createImageEditRenderer(new Blob(['image']));
    const worker = instances[0];
    const active = renderer.render({ brightness: 1 }, { maxDimension: 1000 });
    const previewPromises = [];
    for (let value = 2; value <= 10; value++) {
        const queued = renderer.render({ brightness: value }, { maxDimension: 1000 });
        previewPromises.push(queued.then(result => result, error => error.code));
    }
    const final = renderer.render({ brightness: 20 });
    assert.equal(worker.messages.length, 2);
    worker.onmessage({ data: { id: worker.messages[1].id, result: { brightness: 1 } } });
    assert.equal(worker.messages[2].settings.brightness, 20);
    worker.onmessage({ data: { id: worker.messages[2].id, result: { brightness: 20 } } });
    assert.equal(worker.messages[3].settings.brightness, 10);
    worker.onmessage({ data: { id: worker.messages[3].id, result: { brightness: 10 } } });
    assert.deepEqual(await active, { brightness: 1 });
    assert.deepEqual(await final, { brightness: 20 });
    assert.deepEqual(await Promise.all(previewPromises), [...Array(8).fill('IMAGE_EDIT_SUPERSEDED'), { brightness: 10 }]);
    renderer.destroy();
});

test('worker failures release queued rendering and destroy rejects every remaining request', async context => {
    const instances = installWorker(context);
    const renderer = await createImageEditRenderer(new Blob(['image']));
    const worker = instances[0];
    const failed = renderer.render({});
    const second = renderer.render({});
    const third = renderer.render({}, { maxDimension: 1000 });
    worker.onmessage({ data: { id: worker.messages[1].id, error: { code: 'IMAGE_EDIT_RENDER', message: 'Failure' } } });
    await assert.rejects(failed, { code: 'IMAGE_EDIT_RENDER' });
    assert.equal(worker.messages.length, 3);
    renderer.destroy();
    await assert.rejects(second, { code: 'IMAGE_EDIT_CLOSED' });
    await assert.rejects(third, { code: 'IMAGE_EDIT_CLOSED' });
});

test('unsupported worker environments reject image editing without starting work', async () => {
    await assert.rejects(createImageEditRenderer(new Blob(['image'])), { code: 'IMAGE_EDIT_UNSUPPORTED' });
    await assert.rejects(createImageEditRenderer('not a blob'), { code: 'IMAGE_EDIT_UNSUPPORTED' });
});
