import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePreviewDimension, previewFitScale } from './previewViewport.js';

test('custom dimensions accept numeric text and round to whole viewport pixels', () => {
    assert.equal(normalizePreviewDimension('817', 768), 817);
    assert.equal(normalizePreviewDimension(' 961 ', 1024), 961);
    assert.equal(normalizePreviewDimension(817.49, 768), 817);
    assert.equal(normalizePreviewDimension('960.5', 1024), 961);
});

test('invalid or temporarily empty dimension input keeps the previous dimension', () => {
    for (const value of ['', '   ', 'invalid', '817px', NaN, Infinity, -Infinity, 'Infinity', null, undefined, true, {}]) {
        assert.equal(normalizePreviewDimension(value, 817), 817);
    }
});

test('out-of-range dimensions clamp to supported viewport limits', () => {
    assert.equal(normalizePreviewDimension(-200, 817), 240);
    assert.equal(normalizePreviewDimension('0', 817), 240);
    assert.equal(normalizePreviewDimension('240', 817), 240);
    assert.equal(normalizePreviewDimension(3840, 817), 3840);
    assert.equal(normalizePreviewDimension('12000', 817), 3840);
});

test('fitting respects whichever available dimension is more restrictive', () => {
    assert.equal(previewFitScale({ width: 1000, height: 500 }, { width: 600, height: 400 }), 0.6);
    assert.equal(previewFitScale({ width: 500, height: 1000 }, { width: 400, height: 600 }), 0.6);
    assert.equal(previewFitScale({ width: 375, height: 667 }, { width: 1200, height: 900 }), 1);
});

test('fitting an exact custom viewport preserves its dimensions without rounding the scale', () => {
    const viewport = { width: 817, height: 961 };
    const available = { width: 601, height: 733 };
    const scale = previewFitScale(viewport, available);
    assert.equal(scale, 601 / 817);
    assert.deepEqual(viewport, { width: 817, height: 961 });
    assert.deepEqual(available, { width: 601, height: 733 });
    assert.ok(viewport.width * scale <= available.width);
    assert.ok(viewport.height * scale <= available.height);
});

test('rotating a viewport recalculates fitting against both dimensions', () => {
    const portrait = { width: 375, height: 667 };
    const landscape = { width: portrait.height, height: portrait.width };
    const available = { width: 500, height: 500 };
    assert.equal(previewFitScale(portrait, available), 500 / 667);
    assert.equal(previewFitScale(landscape, available), 500 / 667);
    assert.equal(previewFitScale(portrait, { width: 600, height: 400 }), 400 / 667);
    assert.equal(previewFitScale(landscape, { width: 600, height: 400 }), 600 / 667);
});

test('an unmeasured or collapsed preview area retains a usable default scale', () => {
    const viewport = { width: 817, height: 961 };
    for (const available of [{ width: 0, height: 600 }, { width: 800, height: 0 }, { width: -1, height: 600 }, { width: NaN, height: 600 }]) {
        assert.equal(previewFitScale(viewport, available), 1);
    }
});
