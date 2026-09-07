import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreFolderNavigationViewport } from './hooks/useFolderNavigationRestore.js';

function createViewport({ headerHeight = 0, maxScrollTop = 5000 } = {}) {
    let scrollTop = 0;
    let scrollLeft = 0;
    const items = [];
    const container = {
        style: { scrollBehavior: 'smooth' },
        clientWidth: 800,
        clientHeight: 400,
        clientTop: 1,
        get scrollTop() { return scrollTop; },
        set scrollTop(value) { scrollTop = Math.min(maxScrollTop, Math.max(0, value)); },
        get scrollLeft() { return scrollLeft; },
        set scrollLeft(value) { scrollLeft = Math.min(1500, Math.max(0, value)); },
        querySelectorAll: () => items,
        querySelector: () => headerHeight ? { offsetHeight: headerHeight } : null,
        getBoundingClientRect: () => ({ top: 100 }),
    };
    const addItem = (path, top, height) => items.push({
        dataset: { filePath: path },
        getBoundingClientRect: () => ({ top: 101 + top - container.scrollTop, height }),
    });
    return { container, addItem };
}

function createFrames() {
    let nextId = 0;
    const pending = new Map();
    return {
        scheduleFrame: callback => {
            const id = ++nextId;
            pending.set(id, callback);
            return id;
        },
        cancelFrame: id => pending.delete(id),
        flush: () => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach(callback => callback());
        },
    };
}

test('history restoration preserves both axes without moving to a selected item', () => {
    const { container, addItem } = createViewport();
    const frames = createFrames();
    const positions = [];
    const completed = [];
    addItem('/selected-folder', 3500, 50);
    restoreFolderNavigationViewport({
        container,
        request: { id: 1, scrollTop: 1200, scrollLeft: 620, revealPath: '' },
        onScrollPositionChange: position => positions.push(position),
        onComplete: id => completed.push(id),
        ...frames,
    });
    assert.deepEqual(positions[0], { scrollTop: 1200, scrollLeft: 620 });
    assert.equal(container.style.scrollBehavior, 'auto');
    frames.flush();
    assert.deepEqual(completed, []);
    frames.flush();
    assert.deepEqual(completed, [1]);
    assert.deepEqual(positions.at(-1), { scrollTop: 1200, scrollLeft: 620 });
    assert.equal(container.style.scrollBehavior, 'smooth');
});

test('Up reveals a mounted folder while accounting for the sticky table header', () => {
    const { container, addItem } = createViewport({ headerHeight: 40 });
    const frames = createFrames();
    addItem('/parent/child["folder"]', 140, 50);
    restoreFolderNavigationViewport({
        container,
        request: { id: 2, scrollTop: 180, scrollLeft: 0, revealPath: '/parent/child["folder"]' },
        ...frames,
    });
    assert.equal(container.scrollTop, 100);
    frames.flush();
    frames.flush();
    assert.equal(container.scrollTop, 100);
});

test('virtual folder bounds reveal an unmounted item and settle on its actual DOM position', () => {
    const { container, addItem } = createViewport();
    const frames = createFrames();
    const completed = [];
    let mounted = false;
    restoreFolderNavigationViewport({
        container,
        request: { id: 3, scrollTop: 0, scrollLeft: 0, revealPath: '/parent/folder-600' },
        revealBounds: { top: 3000, height: 170 },
        onScrollPositionChange: () => {
            if (!mounted) {
                mounted = true;
                addItem('/parent/folder-600', 3010, 155);
            }
        },
        onComplete: id => completed.push(id),
        ...frames,
    });
    assert.equal(container.scrollTop, 2770);
    frames.flush();
    frames.flush();
    assert.equal(container.scrollTop, 2765);
    assert.deepEqual(completed, [3]);
});

test('cancelling a superseded request prevents its later scroll and completion', () => {
    const { container } = createViewport();
    const frames = createFrames();
    const completed = [];
    const cancel = restoreFolderNavigationViewport({
        container,
        request: { id: 4, scrollTop: 1500, scrollLeft: 100 },
        onComplete: id => completed.push(id),
        ...frames,
    });
    frames.flush();
    cancel();
    container.scrollTop = 75;
    container.scrollLeft = 10;
    frames.flush();
    assert.deepEqual(completed, []);
    assert.equal(container.scrollTop, 75);
    assert.equal(container.scrollLeft, 10);
    assert.equal(container.style.scrollBehavior, 'smooth');
});

test('a missing Up target completes at the requested fallback position', () => {
    const { container } = createViewport();
    const frames = createFrames();
    const completed = [];
    restoreFolderNavigationViewport({
        container,
        request: { id: 5, scrollTop: 300, scrollLeft: 50, revealPath: '/deleted-folder' },
        onComplete: id => completed.push(id),
        ...frames,
    });
    frames.flush();
    frames.flush();
    assert.equal(container.scrollTop, 300);
    assert.equal(container.scrollLeft, 50);
    assert.deepEqual(completed, [5]);
});

test('a shorter folder synchronizes the clamped browser position', () => {
    const { container } = createViewport({ maxScrollTop: 100 });
    const frames = createFrames();
    const positions = [];
    restoreFolderNavigationViewport({
        container,
        request: { id: 6, scrollTop: 10000, scrollLeft: -20 },
        onScrollPositionChange: position => positions.push(position),
        ...frames,
    });
    frames.flush();
    frames.flush();
    assert.deepEqual(positions.at(-1), { scrollTop: 100, scrollLeft: 0 });
});
