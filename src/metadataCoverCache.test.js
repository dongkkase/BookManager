import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
const constants = source.match(/^const METADATA_COVER_CACHE(?:_BYTE)?_LIMIT = .+;$/gm).join('\n');
const helperStart = source.indexOf('function trimMetadataCoverCache(');
const helper = source.slice(helperStart, source.indexOf('function fileNameFromPath(', helperStart));
const effectStart = source.lastIndexOf('  useEffect(() => {', source.indexOf('    const loadMetadataCover ='));
const effect = source.slice(effectStart, source.indexOf('  const groupedItems', effectStart));
const context = vm.createContext({});
vm.runInContext(`${constants}\n${helper}`, context);
const trim = context.trimMetadataCoverCache;
const MIB = 1024 * 1024;
const cover = (filepath, bytes, coverLoadedAt = 0) => ({
    id: filepath, filepath, coverDataUrl: 'x'.repeat(bytes / 2), coverLoadedAt,
});
const retainedBytes = items => items.reduce((sum, item) => sum + (item.coverDataUrl?.length || 0) * 2, 0);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cover cache enforces its byte budget before reaching the 50-cover count limit', () => {
    const items = [cover('/old.epub', 24 * MIB, 1), cover('/recent.epub', 24 * MIB, 2), cover('/active.epub', 24 * MIB, 0)];
    const result = trim(items, '/active.epub');
    assert.equal(result[0].coverDataUrl, undefined);
    assert.equal(result[1], items[1]);
    assert.equal(result[2], items[2]);
    assert.equal(retainedBytes(result), 48 * MIB);
    assert.ok(items[0].coverDataUrl);
});

test('cover cache retains the active preview as the only exception to the byte budget', () => {
    const items = [cover('/other.epub', MIB, 2), cover('/active.epub', 80 * MIB, 1)];
    const result = trim(items, '/active.epub');
    assert.equal(result[0].coverDataUrl, undefined);
    assert.equal(result[1], items[1]);
    assert.equal(retainedBytes(result), 80 * MIB);
    assert.equal(trim(items, '/other.epub')[1].coverDataUrl, undefined);
});

test('cover cache still limits small covers to 50 and preserves unchanged items below both limits', () => {
    const items = Array.from({ length: 51 }, (_, index) => cover(`/${index}.epub`, 100, index));
    const result = trim(items, '/0.epub');
    assert.equal(result.filter(item => item.coverDataUrl).length, 50);
    assert.equal(result[0], items[0]);
    assert.equal(result[1].coverDataUrl, undefined);
    const small = items.slice(0, 3);
    assert.equal(trim(small, '/0.epub'), small);
});

test('evicting a cover removes preview data without losing pending edits or source paths', () => {
    for (const [key, change] of [
        ['epubCoverChange', { type: 'entry', entryName: 'images/chosen.png' }],
        ['epubCoverChange', { type: 'file', filePath: '/covers/chosen.png' }],
        ['audioCoverChange', { type: 'file', filePath: '/covers/chosen.png' }],
        ['txtCoverChange', { type: 'file', filePath: '/covers/chosen.png' }],
    ]) {
        const draft = { ...cover('/draft', MIB), [key]: change, metadata: { Title: 'Edited' }, coverOverridePath: '/covers/original.png', epubCoverResolution: '1000x1000' };
        const result = trim([draft, cover('/active', 64 * MIB)], '/active')[0];
        assert.equal(result.coverDataUrl, undefined);
        assert.equal(result.epubCoverResolution, undefined);
        assert.equal(result[key], change);
        assert.equal(result.metadata, draft.metadata);
        assert.equal(result.coverOverridePath, draft.coverOverridePath);
    }
});

function loaderHarness(initialItems) {
    let items = initialItems;
    let dependencies;
    let cleanup;
    const requests = [];
    const request = (type, ...args) => new Promise((resolve, reject) => requests.push({ type, args, resolve, reject }));
    const scope = vm.createContext({
        activeItem: null,
        coverLoadRequestsRef: { current: new Set() },
        isTxtMetadataItem: item => item.filepath.endsWith('.txt'),
        window: { electronAPI: {
            loadMetadataCover: (...args) => request('original', ...args),
            loadMetadataImageFile: (...args) => request('file', ...args),
            loadMetadataEpubImage: (...args) => request('entry', ...args),
        } },
        setFileList: update => { items = update(items); },
        useEffect: (fn, nextDependencies) => {
            if (dependencies && nextDependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
            cleanup?.();
            dependencies = nextDependencies;
            cleanup = fn();
        },
    });
    vm.runInContext(`${constants}\n${helper}`, scope);
    return {
        requests,
        items: () => items,
        render(filepath) {
            scope.activeItem = items.find(item => item.filepath === filepath) || null;
            vm.runInContext(effect, scope);
        },
        evict(filepath) {
            items = trim([...items, cover('/budget-owner', 64 * MIB)], '/budget-owner').filter(item => item.filepath !== '/budget-owner');
            assert.equal(items.find(item => item.filepath === filepath).coverDataUrl, undefined);
        },
        dispose: () => cleanup?.(),
    };
}

test('revisiting evicted pending covers reloads the selected file or EPUB entry without an active fetch loop', async () => {
    for (const [filepath, key, change, requestType, args] of [
        ['/book.epub', 'epubCoverChange', { type: 'entry', entryName: 'chosen.jpg' }, 'entry', ['/book.epub', 'chosen.jpg']],
        ['/book.epub', 'epubCoverChange', { type: 'file', filePath: '/chosen.jpg' }, 'file', ['/chosen.jpg']],
        ['/book.m4b', 'audioCoverChange', { type: 'file', filePath: '/chosen.jpg' }, 'file', ['/chosen.jpg']],
        ['/book.txt', 'txtCoverChange', { type: 'file', filePath: '/chosen.jpg' }, 'file', ['/chosen.jpg']],
    ]) {
        const h = loaderHarness([{ ...cover(filepath, MIB), [key]: change }]);
        h.evict(filepath);
        h.render(filepath);
        assert.equal(h.requests[0].type, requestType);
        assert.deepEqual(h.requests[0].args, args);
        h.requests[0].resolve('selected-preview');
        await tick();
        h.render(filepath);
        h.render(filepath);
        assert.equal(h.requests.length, 1);
        assert.equal(h.items()[0][key], change);
        h.render(null);
        h.evict(filepath);
        h.render(filepath);
        assert.equal(h.requests.length, 2);
        assert.equal(h.requests[1].type, requestType);
        h.dispose();
    }
});

test('a failed pending-cover reload keeps the edit and does not fall back to the original or retry each render', async () => {
    const change = { type: 'entry', entryName: 'missing.jpg' };
    const h = loaderHarness([{ id: 'book', filepath: '/book.epub', epubCoverChange: change }]);
    h.render('/book.epub');
    h.requests[0].reject(new Error('image unavailable'));
    await tick();
    h.render('/book.epub');
    h.render('/book.epub');
    assert.equal(h.requests.length, 1);
    assert.equal(h.items()[0].epubCoverChange, change);
    assert.equal(h.items()[0].coverDataUrl, undefined);
    h.dispose();
});
