import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
const start = source.lastIndexOf('  useEffect(() => {', source.indexOf('    const listMetadataEpubImages ='));
const effect = source.slice(start, source.indexOf('  useEffect(() => {', start + 1));
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
    let state = {};
    let dependencies;
    let cleanup;
    const requests = [];
    const context = vm.createContext({
        activeBookType: 'book',
        activeIsEpub: true,
        activeItem: { filepath: '/A.epub' },
        activeEpubImageState: {},
        epubImagesByFilePathRef: { current: state },
        text: (key, fallback) => fallback,
        setEpubImagesByFilePath: update => { state = typeof update === 'function' ? update(state) : update; },
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
    const render = (filepath = context.activeItem?.filepath, isEpub = true) => {
        context.activeItem = { filepath };
        context.activeIsEpub = isEpub;
        context.activeEpubImageState = state[filepath] || {};
        context.epubImagesByFilePathRef.current = state;
        vm.runInContext(effect, context);
    };
    return { render, requests, state: () => state, dispose: () => cleanup?.() };
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
