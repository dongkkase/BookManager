import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, normalizeSettings, resourceSettings, resourceRemovalSelected, estimateOptimization } from './epubOptimizer/model.js';

const image = { name: 'images/page.jpg', kind: 'image', mediaType: 'image/jpeg', compressedSize: 1000000, originalSize: 1000000, width: 4000, height: 3000, canOptimize: true };
const analysis = { size: 1200000, resources: [image] };

test('optimizer estimates update with settings while staying within the original byte budget', () => {
    const keep = estimateOptimization(analysis, { images: false, fonts: false, recompress: false });
    const balanced = estimateOptimization(analysis, defaultSettings());
    const smaller = estimateOptimization(analysis, { jpegQuality: 60, maxDimension: 1024 });
    assert.equal(keep.savedBytes, 0);
    assert.ok(balanced.savedBytes > 0);
    assert.ok(smaller.savedBytes > balanced.savedBytes);
    for (const estimate of [keep, balanced, smaller]) {
        assert.equal(estimate.minSavedBytes, 0);
        assert.equal(estimate.maxSize, analysis.size);
        assert.ok(estimate.minSize >= 0 && estimate.minSize <= estimate.estimatedSize);
        assert.ok(estimate.estimatedSize <= estimate.maxSize);
    }
});

test('manual exclusions and overrides remain independent and auto mode ignores them', () => {
    const settings = normalizeSettings({ mode: 'manual', resources: { [image.name]: { enabled: false, quality: 95, maxDimension: 0 } } });
    assert.deepEqual(resourceSettings(image, settings), { enabled: false, quality: 95, maxDimension: 0 });
    assert.equal(estimateOptimization(analysis, settings).savedBytes, 0);
    assert.equal(resourceSettings(image, { ...settings, mode: 'auto' }).enabled, true);
    assert.deepEqual(defaultSettings().resources, {});
});

test('cover, unsupported resources and fixed layouts are protected in automatic settings', () => {
    assert.equal(resourceSettings({ ...image, isCover: true }, defaultSettings()).enabled, false);
    assert.equal(resourceSettings({ ...image, canOptimize: false }, defaultSettings()).enabled, false);
    assert.equal(resourceSettings(image, defaultSettings(), { fixedLayout: true }).maxDimension, 0);
    assert.equal(resourceSettings(image, normalizeSettings({ mode: 'manual', maxDimension: 1024 }), { fixedLayout: true }).maxDimension, 1024);
});

test('malformed settings are bounded and cannot introduce prototype entries', () => {
    const settings = normalizeSettings(JSON.parse('{"mode":"other","jpegQuality":-200,"maxDimension":999999,"resources":{"__proto__":{"enabled":false},"test":{"quality":500,"maxDimension":-1}}}'));
    assert.equal(settings.mode, 'auto');
    assert.equal(settings.jpegQuality, 40);
    assert.equal(settings.maxDimension, 8192);
    assert.equal(settings.resources.test.quality, 100);
    assert.equal(settings.resources.test.maxDimension, 256);
    assert.equal({}.enabled, undefined);
    assert.equal(normalizeSettings(null).images, true);
});

test('unused resource deletion requires an enabled category or an explicit manual selection', () => {
    const unused = { ...image, canRemove: true, usage: 'unused' };
    assert.equal(resourceRemovalSelected(unused, defaultSettings()), false);
    const automatic = normalizeSettings({ removeUnusedImages: true, resources: { [unused.name]: { remove: false } } });
    assert.equal(resourceRemovalSelected(unused, automatic), true);
    assert.equal(resourceSettings(unused, automatic).enabled, false);
    assert.equal(resourceRemovalSelected(unused, { ...automatic, mode: 'manual' }), false);
    const manual = normalizeSettings({ mode: 'manual', resources: { [unused.name]: { remove: true } } });
    assert.equal(resourceRemovalSelected(unused, manual), true);
    for (const protectedResource of [
        { ...unused, canRemove: false }, { ...unused, isCover: true }, { ...unused, encrypted: true },
        { ...unused, name: 'META-INF/private.png' }, { ...unused, kind: 'text' },
    ]) assert.equal(resourceRemovalSelected(protectedResource, { ...manual, removeUnusedImages: true }), false);
    assert.equal(normalizeSettings({ removeUnusedAudio: 'true' }).removeUnusedAudio, false);
    assert.equal(normalizeSettings({ resources: { [unused.name]: { remove: 'true' } } }).resources[unused.name].remove, undefined);
});

test('deletion estimates count compressed resource bytes once and update with manual exclusions', () => {
    const unused = { ...image, canRemove: true };
    const font = { name: 'unused.ttf', kind: 'font', compressedSize: 500, originalSize: 5000, canRemove: true, canOptimize: true };
    const audio = { name: 'unused.mp3', kind: 'audio', compressedSize: 2000, originalSize: 2000, canRemove: true };
    const source = { size: 1200000, resources: [unused, font, audio] };
    const settings = { removeUnusedImages: true, removeUnusedFonts: true, removeUnusedAudio: true };
    const estimate = estimateOptimization(source, settings);
    assert.equal(estimate.savedBytes, 1002500);
    assert.equal(estimate.maxSavedBytes, 1002500);
    const excluded = estimateOptimization(source, { ...settings, images: false, mode: 'manual', resources: { [unused.name]: { remove: false } } });
    assert.equal(excluded.savedBytes, 2500);
    assert.equal(source.resources.length, 3);
});
