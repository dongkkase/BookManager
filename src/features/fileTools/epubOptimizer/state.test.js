import assert from 'node:assert/strict';
import test from 'node:test';
import { checkedEstimate, copyGeneralSettings, createFile, createResultLog, filterResources, isCancelled, isEpub, presetSettings, resourceProcessing, sortResources } from './state.js';
import { estimateOptimization, resourceSettings } from '../../../../electron/epubOptimizer/model.js';

const analysis = {
    size: 100000,
    resources: [{ name: 'images/page.jpg', kind: 'image', canOptimize: true, mediaType: 'image/jpeg', width: 3000, height: 4000, originalSize: 90000, compressedSize: 85000 }],
};
const readyFile = path => ({ ...createFile(path), analysis });

test('each EPUB owns independent settings and only checked general settings are copied', () => {
    const first = readyFile('/a.epub');
    const second = readyFile('/b.epub');
    const third = { ...readyFile('/c.epub'), checked: false };
    first.settings.mode = 'manual';
    first.settings.jpegQuality = 60;
    first.settings.removeUnusedFonts = true;
    first.settings.resources['images/page.jpg'] = { enabled: false };
    second.settings.resources['images/other.jpg'] = { quality: 95, remove: false };
    second.outcome = { status: 'saved' };
    assert.equal(second.settings.jpegQuality, 82);
    assert.notEqual(first.settings.resources, second.settings.resources);

    const result = copyGeneralSettings([first, second, third], first.path);
    assert.equal(result[1].settings.jpegQuality, 60);
    assert.equal(result[1].settings.mode, 'manual');
    assert.equal(result[1].settings.removeUnusedFonts, true);
    assert.deepEqual(result[1].settings.resources, { 'images/other.jpg': { quality: 95, remove: false } });
    assert.equal(result[1].settingsChanged, true);
    assert.equal(result[2], third);
    assert.equal(second.settings.jpegQuality, 82);
    assert.notEqual(result[1].settings.resources, second.settings.resources);
});

test('live batch estimates exclude unchecked and failed files and update without a processor', () => {
    const first = readyFile('/a.epub');
    const second = { ...readyFile('/b.epub'), checked: false };
    const failed = { ...readyFile('/bad.epub'), error: 'Invalid EPUB' };
    const pending = createFile('/pending.epub');
    const before = checkedEstimate([first, second, failed, pending]);
    assert.equal(before.count, 1);
    assert.equal(before.originalSize, analysis.size);
    first.settings.jpegQuality = 40;
    const after = checkedEstimate([first, second, failed, pending]);
    assert.ok(after.estimatedSize < before.estimatedSize);
    assert.equal(after.maxSize, analysis.size);
    assert.equal(after.minSavedBytes, 0);
    assert.equal(after.estimatedSize, estimateOptimization(analysis, first.settings).estimatedSize);
});

test('automatic presets reset overrides and quality preservation leaves images unchanged', () => {
    assert.equal(presetSettings('compact').jpegQuality, 72);
    assert.equal(presetSettings('balanced').jpegQuality, 82);
    const lossless = presetSettings('lossless');
    assert.equal(lossless.images, false);
    assert.equal(lossless.fonts, true);
    assert.equal(lossless.recompress, true);
    assert.equal(lossless.removeUnusedFonts, false);
    assert.equal(lossless.removeUnusedImages, false);
    assert.equal(lossless.removeUnusedAudio, false);
    assert.deepEqual(lossless.resources, {});
    assert.equal(estimateOptimization(analysis, lossless).savedBytes, 0);
});

test('resource overrides apply only to manual mode and fixed layouts keep automatic dimensions', () => {
    const file = readyFile('/a.epub');
    const image = analysis.resources[0];
    file.settings.resources[image.name] = { enabled: false, quality: 50, maxDimension: 1024 };
    assert.equal(resourceSettings(image, file.settings, { fixedLayout: true }).maxDimension, 0);
    assert.equal(resourceSettings(image, file.settings, analysis).enabled, true);
    file.settings.mode = 'manual';
    assert.equal(resourceSettings(image, file.settings, analysis).enabled, false);
    assert.equal(resourceSettings(image, file.settings, analysis).quality, 50);
    assert.equal(resourceSettings(image, file.settings, { fixedLayout: true }).maxDimension, 1024);
});

test('saved, unchanged, cancelled and failed results are separately reported with actual output paths', () => {
    const files = ['saved', 'unchanged', 'cancelled', 'failed', 'unattempted'].map(name => createFile(`/${name}.epub`));
    const outcomes = new Map([
        ['/saved.epub', { status: 'saved', originalSize: 1000, outputSize: 800, savedBytes: 200, outputPath: '/saved.optimized.epub', backupPath: '/bak/saved.epub', warnings: ['FIXED_LAYOUT'] }],
        ['/unchanged.epub', { status: 'unchanged', warnings: ['IMAGE_OPTIMIZATION_FAILED'] }],
        ['/cancelled.epub', { error: 'TASK_CANCELLED', code: 'TASK_CANCELLED' }],
        ['/failed.epub', { error: 'broken' }],
    ]);
    const log = createResultLog(files, outcomes, key => key, value => value.error);
    assert.equal(log.stats.success.length, 1);
    assert.equal(log.stats.skip.length, 2);
    assert.equal(log.stats.error.length, 1);
    assert.equal(log.cancelled, true);
    assert.deepEqual(log.outputFiles, ['/saved.optimized.epub']);
    assert.match(log.stats.success[0], /saved\.optimized\.epub/);
    assert.match(log.stats.success[0], /backupPath: \/bak\/saved\.epub/);
    assert.ok(log.stats.skip.every(entry => !entry.includes('backupPath')));
    assert.match(log.stats.success[0], /200 B/);
    assert.match(log.stats.skip[0], /IMAGE_OPTIMIZATION_FAILED/);
    assert.equal(isCancelled({ code: 'TASK_CANCELLED' }), true);
});

test('resource search combines type and name filters without changing the source list', () => {
    const resources = [analysis.resources[0], { name: 'Fonts/Body.otf', kind: 'font' }];
    assert.deepEqual(filterResources(resources, 'font', 'BODY'), [resources[1]]);
    assert.deepEqual(filterResources(resources, 'image', 'body'), []);
    assert.deepEqual(filterResources(resources, 'all', ''), resources);
    assert.equal(isEpub('/books/Title.EPUB'), true);
    assert.equal(isEpub('/books/Title.epub.zip'), false);
});

test('failed saves report a retained backup without marking the file as saved', () => {
    const file = createFile('/books/book.epub');
    const outcome = { error: 'Save result could not be verified', backupPath: '/books/bak/book_1.epub' };
    const log = createResultLog([file], new Map([[file.path, outcome]]), key => key, value => value.error);
    assert.equal(log.stats.success.length, 0);
    assert.equal(log.stats.skip.length, 0);
    assert.equal(log.stats.error.length, 1);
    assert.deepEqual(log.outputFiles, []);
    assert.match(log.stats.error[0], /backupPath: \/books\/bak\/book_1\.epub/);
    assert.match(log.stats.error[0], /Save result could not be verified/);
});

test('unused filtering includes only removable resources and combines with name search', () => {
    const resources = [
        { name: 'Fonts/unused.ttf', kind: 'font', canRemove: true, usage: 'unused' },
        { name: 'Images/cover.jpg', kind: 'image', canRemove: false, usage: 'protected' },
        { name: 'Audio/unused.mp3', kind: 'audio', canRemove: true, usage: 'unused' },
        { name: 'Images/dynamic.jpg', kind: 'image', canRemove: false, usage: 'unknown' },
    ];
    assert.deepEqual(filterResources(resources, 'unused', ''), [resources[0], resources[2]]);
    assert.deepEqual(filterResources(resources, 'unused', 'FONTS'), [resources[0]]);
    assert.equal(filterResources(resources, 'all', '').length, 4);
});

test('processing follows conversion settings while ZIP recompression remains independent', () => {
    const image = { ...analysis.resources[0], canRecompress: true };
    const font = { name: 'Fonts/body.ttf', kind: 'font', canOptimize: true, canRecompress: true };
    const settings = { ...presetSettings('balanced'), resources: { [image.name]: { enabled: false } } };
    const before = structuredClone(settings);
    assert.equal(resourceProcessing(image, settings), 'image');
    assert.equal(resourceProcessing(font, settings), 'font');
    assert.equal(resourceProcessing(image, { ...settings, mode: 'manual' }), 'recompress');
    assert.equal(resourceProcessing(image, { ...settings, images: false }), 'recompress');
    assert.equal(resourceProcessing(font, { ...settings, fonts: false }), 'recompress');
    assert.equal(resourceProcessing(image, { ...settings, mode: 'manual', recompress: false }), 'keep');
    assert.equal(resourceProcessing({ ...image, isCover: true }, settings), 'recompress');
    assert.equal(resourceProcessing({ ...image, isCover: true }, { ...settings, excludeCover: false }), 'image');
    assert.deepEqual(settings, before);
});

test('deletion takes priority over conversion and per-resource removal overrides require manual mode', () => {
    const image = { ...analysis.resources[0], canRemove: true, canRecompress: true };
    const settings = { ...presetSettings('balanced'), removeUnusedImages: true, resources: { [image.name]: { remove: false } } };
    assert.equal(resourceProcessing(image, settings), 'remove');
    assert.equal(resourceProcessing(image, { ...settings, mode: 'manual' }), 'image');
    const manuallyRemoved = { ...settings, mode: 'manual', images: false, removeUnusedImages: false,
        resources: { [image.name]: { enabled: false, remove: true } } };
    assert.equal(resourceProcessing(image, manuallyRemoved), 'remove');
    assert.equal(resourceProcessing({ ...image, isCover: true }, manuallyRemoved), 'recompress');
    assert.equal(resourceProcessing({ ...image, canRemove: false }, manuallyRemoved), 'recompress');
});

test('processing exposes required EPUB structure corrections and never recompresses encrypted data', () => {
    const settings = { ...presetSettings('balanced'), images: false, fonts: false, recompress: false };
    const mimetype = { name: 'mimetype', kind: 'other', canRecompress: false };
    assert.equal(resourceProcessing(mimetype, settings), 'keep');
    assert.equal(resourceProcessing(mimetype, settings, { warnings: ['NONSTANDARD_MIMETYPE'] }), 'structure');
    assert.equal(resourceProcessing(mimetype, settings, { warnings: [{ code: 'NONSTANDARD_MIMETYPE' }] }), 'structure');
    const encrypted = { name: 'Fonts/obfuscated.ttf', kind: 'font', canOptimize: false, encrypted: true, canRecompress: true };
    assert.equal(resourceProcessing(encrypted, { ...settings, fonts: true, recompress: true }), 'keep');
    assert.equal(resourceProcessing({ name: 'Text/chapter.xhtml', kind: 'text', canRecompress: false }, { ...settings, recompress: true }), 'keep');
});

test('processing filters distinguish removable candidates from current conversion and deletion choices', () => {
    const resources = [
        { name: 'Images/unused.jpg', kind: 'image', canOptimize: true, canRemove: true },
        { name: 'Fonts/body.ttf', kind: 'font', canOptimize: true, canRemove: false },
        { name: 'Audio/unused.mp3', kind: 'audio', canRemove: true },
        { name: 'Images/cover.jpg', kind: 'image', canOptimize: true, canRemove: true, isCover: true },
        { name: 'Fonts/encrypted.ttf', kind: 'font', canOptimize: false, canRemove: true, encrypted: true },
        { name: 'META-INF/thumbnail.jpg', kind: 'image', canRemove: true },
    ];
    const settings = { ...presetSettings('balanced'), removeUnusedImages: true,
        resources: { 'Images/unused.jpg': { remove: false }, 'Audio/unused.mp3': { remove: true } } };
    const before = structuredClone(resources);
    assert.deepEqual(filterResources(resources, 'unused', '', settings), [resources[0], resources[2]]);
    assert.deepEqual(filterResources(resources, 'remove', '', settings), [resources[0]]);
    assert.deepEqual(filterResources(resources, 'convert', '', settings), [resources[1]]);
    assert.deepEqual(filterResources(resources, 'convert', ' BODY ', settings), [resources[1]]);
    const manual = { ...settings, mode: 'manual' };
    assert.deepEqual(filterResources(resources, 'remove', '', manual), [resources[2]]);
    assert.deepEqual(filterResources(resources, 'convert', '', manual), [resources[0], resources[1]]);
    assert.deepEqual(filterResources(resources, 'image', 'UNUSED', manual), [resources[0]]);
    assert.deepEqual(resources, before);
});

test('resource sorting uses current EPUB size and natural full paths without changing archive order', () => {
    const resources = [
        { name: 'Text/chapter10.xhtml', originalSize: 9000, compressedSize: 100 },
        { name: 'Images/page10.jpg', originalSize: 300, compressedSize: 300 },
        { name: 'Images/page2.jpg', originalSize: 400, compressedSize: 300 },
        { name: 'Text/chapter2.xhtml', originalSize: 7000, compressedSize: 100 },
    ];
    const before = structuredClone(resources);
    assert.deepEqual(sortResources(resources), [resources[2], resources[1], resources[3], resources[0]]);
    assert.deepEqual(sortResources(resources, 'name'), [resources[2], resources[1], resources[3], resources[0]]);
    assert.deepEqual(sortResources(resources, 'archive'), resources);
    assert.notEqual(sortResources(resources, 'archive'), resources);
    assert.deepEqual(resources, before);
    const sizeOrder = [{ name: 'A.xhtml', compressedSize: 100 }, { name: 'Z.jpg', compressedSize: 1000 }];
    assert.deepEqual(sortResources(sizeOrder), [sizeOrder[1], sizeOrder[0]]);
    assert.deepEqual(sortResources(sizeOrder, 'name'), sizeOrder);
});

test('saved removal results list each removed resource with compressed size total', () => {
    const file = createFile('/book.epub');
    const removedResources = [
        { name: 'Fonts/unused.ttf', kind: 'font', compressedSize: 1024 },
        { name: 'Audio/unused.mp3', kind: 'audio', compressedSize: 2048 },
    ];
    const outcome = { status: 'saved', originalSize: 10000, outputSize: 6928, savedBytes: 3072, outputPath: '/book.optimized.epub', removedResources };
    const text = (key, values) => values ? `${key}: ${values.count}, ${values.size}` : key;
    const log = createResultLog([file], new Map([[file.path, outcome]]), text, value => value.error);
    assert.match(log.stats.success[0], /removedResources: 2, 3\.0 KB/);
    assert.match(log.stats.success[0], /- Fonts\/unused\.ttf/);
    assert.match(log.stats.success[0], /- Audio\/unused\.mp3/);
    assert.doesNotMatch(log.stats.success[0], /backupPath/);
});
