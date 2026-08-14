import test from 'node:test';
import assert from 'node:assert/strict';
import {
    comicDownsamplePasses,
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

test('comicDownsamplePasses halves large reductions before the final target', () => {
    assert.deepEqual(comicDownsamplePasses({
        sourceWidth: 4000,
        sourceHeight: 6000,
        targetWidth: 625,
        targetHeight: 938,
    }), [
        { width: 2000, height: 3000 },
        { width: 1000, height: 1500 },
        { width: 625, height: 938 },
    ]);
});

test('comicDownsamplePasses keeps temporary Canvas allocations under the pixel limit', () => {
    const passes = comicDownsamplePasses({
        sourceWidth: 8000,
        sourceHeight: 12000,
        targetWidth: 1000,
        targetHeight: 1500,
        maxIntermediatePixelCount: 8_000_000,
    });

    assert.deepEqual(passes.at(-1), { width: 1000, height: 1500 });
    passes.slice(0, -1).forEach(pass => {
        assert.ok(pass.width * pass.height <= 8_000_000);
    });
    passes.slice(1).forEach((pass, index) => {
        assert.ok(pass.width < passes[index].width);
        assert.ok(pass.height < passes[index].height);
    });

    const mismatchedRatioPasses = comicDownsamplePasses({
        sourceWidth: 10000,
        sourceHeight: 10000,
        targetWidth: 4000,
        targetHeight: 100,
        maxIntermediatePixelCount: 8_000_000,
    });
    assert.deepEqual(mismatchedRatioPasses.at(-1), { width: 4000, height: 100 });
    mismatchedRatioPasses.slice(0, -1).forEach(pass => {
        assert.ok(pass.width * pass.height <= 8_000_000);
    });
});

test('paintComicDownsample uses medium intermediate passes and a high quality final pass', () => {
    const draws = [];
    let scratchSequence = 0;
    const makeCanvas = id => {
        const context = {
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            drawImage(input, ...args) {
                draws.push({
                    input: input.id,
                    output: id,
                    width: args.at(-2),
                    height: args.at(-1),
                    smoothingEnabled: this.imageSmoothingEnabled,
                    smoothingQuality: this.imageSmoothingQuality,
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
    const painted = paintComicDownsample({
        source: { id: 'source', naturalWidth: 4000, naturalHeight: 6000 },
        canvas: output,
        target: { width: 500, height: 750 },
        createCanvas: () => makeCanvas(`scratch-${scratchSequence += 1}`),
    });

    assert.equal(painted, true);
    assert.deepEqual(draws, [
        { input: 'source', output: 'scratch-1', width: 2000, height: 3000, smoothingEnabled: true, smoothingQuality: 'medium' },
        { input: 'scratch-1', output: 'scratch-2', width: 1000, height: 1500, smoothingEnabled: true, smoothingQuality: 'medium' },
        { input: 'scratch-2', output: 'output', width: 500, height: 750, smoothingEnabled: true, smoothingQuality: 'high' },
    ]);
    assert.equal(output.width, 500);
    assert.equal(output.height, 750);
});
