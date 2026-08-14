import test from 'node:test';
import assert from 'node:assert/strict';
import {
    comicDownsampleTarget,
    paintComicDownsample,
} from './comicImageDownsample.js';

test('comicDownsampleTarget uses the actual device pixel ratio and preserves the source ratio', () => {
    assert.deepEqual(comicDownsampleTarget({
        naturalWidth: 4000,
        naturalHeight: 3000,
        displayWidth: 1000,
        displayHeight: 750,
        devicePixelRatio: 3,
    }), {
        width: 3000,
        height: 2250,
    });

    assert.deepEqual(comicDownsampleTarget({
        naturalWidth: 4000,
        naturalHeight: 2000,
        displayWidth: 900,
        displayHeight: 900,
        devicePixelRatio: 1,
    }), {
        width: 900,
        height: 450,
    });

    assert.deepEqual(comicDownsampleTarget({
        naturalWidth: 4000,
        naturalHeight: 2000,
        displayWidth: 900,
        displayHeight: 900,
        devicePixelRatio: 1,
        fitMode: 'cover',
    }), {
        width: 1800,
        height: 900,
    });
});

test('comicDownsampleTarget falls back to the source image instead of upscaling a capped Canvas', () => {
    assert.equal(comicDownsampleTarget({
        naturalWidth: 8000,
        naturalHeight: 4000,
        displayWidth: 3000,
        displayHeight: 1500,
        devicePixelRatio: 2,
        maxPixelCount: 8_000_000,
    }), null);

    const target = comicDownsampleTarget({
        naturalWidth: 8000,
        naturalHeight: 4000,
        displayWidth: 2000,
        displayHeight: 1000,
        devicePixelRatio: 2,
        maxPixelCount: 8_000_000,
    });

    assert.deepEqual(target, { width: 4000, height: 2000 });
    assert.ok(target.width * target.height <= 8_000_000);
    assert.equal(target.width / target.height, 2);
});

test('comicDownsampleTarget skips invalid dimensions and images that would be enlarged', () => {
    assert.equal(comicDownsampleTarget({
        naturalWidth: 1000,
        naturalHeight: 1500,
        displayWidth: 500,
        displayHeight: 750,
        devicePixelRatio: 2,
    }), null);
    assert.equal(comicDownsampleTarget({
        naturalWidth: 1000,
        naturalHeight: 1500,
        displayWidth: 800,
        displayHeight: 1200,
        devicePixelRatio: 2,
    }), null);
    assert.equal(comicDownsampleTarget({
        naturalWidth: 0,
        naturalHeight: 1500,
        displayWidth: 500,
        displayHeight: 750,
        devicePixelRatio: 1,
    }), null);
});

test('paintComicDownsample uses Lanczos3 in a staging Canvas and commits the completed result', async () => {
    const draws = [];
    const resizeCalls = [];
    const makeCanvas = id => {
        const context = {
            drawImage(input, ...args) {
                draws.push({
                    input: input.id,
                    output: id,
                    args,
                    compositeOperation: this.globalCompositeOperation,
                });
            },
        };
        return {
            id,
            width: 0,
            height: 0,
            getContext: () => context,
        };
    };
    const output = makeCanvas('output');
    const staging = makeCanvas('staging');
    const cancelToken = new Promise(() => {});
    const painted = await paintComicDownsample({
        source: { id: 'source', naturalWidth: 4000, naturalHeight: 6000 },
        canvas: output,
        target: { width: 500, height: 750 },
        createCanvas: () => staging,
        cancelToken,
        resizer: {
            async resize(source, destination, options) {
                resizeCalls.push({ source, destination, options });
            },
        },
    });

    assert.equal(painted, true);
    assert.equal(resizeCalls.length, 1);
    assert.equal(resizeCalls[0].source.id, 'source');
    assert.equal(resizeCalls[0].destination.id, 'staging');
    assert.deepEqual(resizeCalls[0].options, {
        cancelToken,
        filter: 'lanczos3',
        unsharpAmount: 0,
    });
    assert.deepEqual(draws, [{
        input: 'staging',
        output: 'output',
        args: [0, 0],
        compositeOperation: 'copy',
    }]);
    assert.equal(output.width, 500);
    assert.equal(output.height, 750);
    assert.equal(staging.width, 1);
    assert.equal(staging.height, 1);
});

test('paintComicDownsample keeps the previous Canvas when resizing fails and releases staging memory', async () => {
    const output = {
        width: 320,
        height: 480,
        getContext: () => ({ drawImage() {} }),
    };
    const staging = { width: 0, height: 0 };
    const resizeError = new Error('resize failed');

    await assert.rejects(paintComicDownsample({
        source: { naturalWidth: 1600, naturalHeight: 2400 },
        canvas: output,
        target: { width: 400, height: 600 },
        createCanvas: () => staging,
        resizer: {
            async resize() {
                throw resizeError;
            },
        },
    }), resizeError);

    assert.equal(output.width, 320);
    assert.equal(output.height, 480);
    assert.equal(staging.width, 1);
    assert.equal(staging.height, 1);
});

test('paintComicDownsample handles cancellation during resizer initialization', async () => {
    let finishInitialization = null;
    let rejectCancellation = null;
    let resizeCalled = false;
    const initialization = new Promise(resolve => {
        finishInitialization = resolve;
    });
    const cancelToken = new Promise((_resolve, reject) => {
        rejectCancellation = reject;
    });
    const abortError = new Error('canceled');
    abortError.name = 'AbortError';
    const staging = { width: 0, height: 0 };
    const rendering = paintComicDownsample({
        source: { naturalWidth: 1600, naturalHeight: 2400 },
        canvas: { width: 320, height: 480 },
        target: { width: 400, height: 600 },
        createCanvas: () => staging,
        cancelToken,
        resizer: {
            init: () => initialization,
            async resize() {
                resizeCalled = true;
            },
        },
    });

    rejectCancellation(abortError);
    finishInitialization();

    await assert.rejects(rendering, abortError);
    assert.equal(resizeCalled, false);
    assert.equal(staging.width, 1);
    assert.equal(staging.height, 1);
});
