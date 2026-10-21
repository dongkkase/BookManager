import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { adjacentSelectionAfterRemoval } from './metadataPolicy.js';

const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
const start = source.lastIndexOf('  useEffect(() => {', source.indexOf('    const listMetadataEpubImages ='));
const effect = source.slice(start, source.indexOf('  useEffect(() => {', start + 1));
const removeStart = source.indexOf('  const handleRemoveChecked = useCallback(');
const removeHandler = source.slice(removeStart, source.indexOf('  const handleToggleAllChecked', removeStart));
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
    let state = {};
    let dependencies;
    let cleanup;
    let files = [];
    const requests = [];
    const context = vm.createContext({
        activeBookType: 'book',
        activeIsEpub: true,
        activeItem: { filepath: '/A.epub' },
        activeEpubImageState: {},
        epubImagesByFilePathRef: { current: state },
        text: (key, fallback) => fallback,
        setEpubImagesByFilePath: update => { state = typeof update === 'function' ? update(state) : update; },
        setFileList: update => { files = update(files); },
        setSelectedFileId: value => { context.selectedFileId = value; },
        setSelectedGroup: () => {},
        setBatchMetadataByFileId: update => update({}),
        selectedFileId: null,
        adjacentSelectionAfterRemoval,
        useCallback: callback => callback,
        window: {
            electronAPI: {
                listMetadataEpubImages: filepath => new Promise((resolve, reject) => {
                    requests.push({ filepath, resolve, reject });
                }),
            },
        },
        useEffect: (fn, nextDependencies) => {
            if (dependencies && nextDependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
            cleanup?.();
            dependencies = nextDependencies;
            cleanup = fn();
        },
    });
    vm.runInContext(removeHandler, context);
    const render = (filepath = context.activeItem?.filepath, isEpub = true) => {
        if (filepath && !files.some(item => item.filepath === filepath)) files.push({ id: filepath, filepath });
        context.selectedFileId = filepath;
        context.activeItem = { filepath };
        context.activeIsEpub = isEpub;
        context.activeEpubImageState = state[filepath] || {};
        context.epubImagesByFilePathRef.current = state;
        vm.runInContext(effect, context);
    };
    return {
        render, requests, state: () => state, dispose: () => cleanup?.(),
        files: () => files,
        selected: () => context.selectedFileId,
        remove(paths) {
            files = files.map(item => ({ ...item, checked: paths.includes(item.filepath) }));
            vm.runInContext('handleRemoveChecked()', context);
        },
    };
}

test('EPUB image loading survives its own loading-state render and publishes the dropdown entries', async () => {
    const h = harness();
    h.render();
    assert.equal(h.state()['/A.epub'].loading, true);
    h.render();
    h.requests[0].resolve({ images: [{ name: 'cover.jpg' }], coverEntryName: 'cover.jpg' });
    await tick();
    h.render();
    assert.equal(h.requests.length, 1);
    assert.equal(h.state()['/A.epub'].loading, false);
    assert.equal(h.state()['/A.epub'].loaded, true);
    assert.equal(h.state()['/A.epub'].images[0].name, 'cover.jpg');
});

test('switching EPUBs ignores the old response and revisiting an interrupted file starts a fresh request', async () => {
    const h = harness();
    h.render('/A.epub');
    h.render('/B.epub');
    assert.equal(h.state()['/A.epub'].loading, false);
    h.render('/A.epub');
    assert.deepEqual(h.requests.map(request => request.filepath), ['/A.epub', '/B.epub', '/A.epub']);
    h.requests[0].resolve({ images: [{ name: 'old.jpg' }] });
    h.requests[1].resolve({ images: [{ name: 'B.jpg' }] });
    await tick();
    assert.equal(h.state()['/A.epub'].loading, true);
    assert.equal(h.state()['/B.epub'].loaded, undefined);
    h.requests[2].resolve({ images: [{ name: 'new.jpg' }] });
    await tick();
    assert.equal(h.state()['/A.epub'].images[0].name, 'new.jpg');
});

test('EPUB errors release loading and non-EPUB files never request an EPUB image list', async () => {
    const h = harness();
    h.render('/book.txt', false);
    assert.equal(h.requests.length, 0);
    h.render('/A.epub');
    h.render();
    h.requests[0].reject(new Error('unavailable'));
    await tick();
    assert.equal(h.state()['/A.epub'].loading, false);
    assert.equal(h.state()['/A.epub'].error, 'unavailable');
    h.render('/B.epub');
    h.dispose();
    h.requests[1].resolve({ images: [{ name: 'late.jpg' }] });
    await tick();
    assert.equal(h.state()['/B.epub'].loaded, undefined);
});

test('a completed EPUB image list is reused when returning to the same file', async () => {
    const h = harness();
    h.render('/A.epub');
    h.requests[0].resolve({ images: [{ name: 'cover.jpg' }] });
    await tick();
    h.render('/B.epub');
    h.render('/A.epub');
    assert.equal(h.requests.length, 2);
    assert.equal(h.state()['/A.epub'].images[0].name, 'cover.jpg');
});

test('removing EPUBs releases their completed lists while preserving retained files and selection', async () => {
    const h = harness();
    h.render('/A.epub');
    h.requests[0].resolve({ images: [{ name: 'A.jpg' }] });
    await tick();
    h.render('/B.epub');
    h.requests[1].resolve({ images: [{ name: 'B.jpg' }] });
    await tick();
    const kept = h.state()['/B.epub'];
    h.remove(['/A.epub']);
    assert.equal(h.state()['/A.epub'], undefined);
    assert.equal(h.state()['/B.epub'], kept);
    assert.deepEqual(h.files().map(item => item.filepath), ['/B.epub']);
    assert.equal(h.selected(), '/B.epub');
    h.render('/B.epub');
    assert.equal(h.requests.length, 2);
    h.dispose();
});

test('late EPUB success and failure cannot restore a removed path before effect cleanup runs', async () => {
    for (const fail of [false, true]) {
        const h = harness();
        h.render('/A.epub');
        h.remove(['/A.epub']);
        if (fail) h.requests[0].reject(new Error('late failure'));
        else h.requests[0].resolve({ images: [{ name: 'late.jpg' }] });
        await tick();
        assert.deepEqual(Object.keys(h.state()), []);
        assert.equal(h.files().length, 0);
        h.dispose();
    }
});

test('removing and readding the same EPUB cannot reuse an earlier request or its cached list', async () => {
    const h = harness();
    h.render('/A.epub');
    h.remove(['/A.epub']);
    h.render(null, false);
    h.render('/A.epub');
    assert.equal(h.requests.length, 2);
    h.requests[0].resolve({ images: [{ name: 'old.jpg' }] });
    await tick();
    assert.equal(h.state()['/A.epub'].loading, true);
    h.requests[1].resolve({ images: [{ name: 'new.jpg' }] });
    await tick();
    assert.equal(h.state()['/A.epub'].images[0].name, 'new.jpg');
    h.dispose();
});
