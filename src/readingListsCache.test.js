import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const compiled = transformSync(fs.readFileSync(new URL('./hooks/useReadingLists.js', import.meta.url), 'utf8'), { format: 'cjs', target: 'es2022' }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));

async function fixture(initial = {}) {
    const slots = [];
    const listeners = new Map();
    const subscriptions = [];
    const calls = [];
    const pending = [];
    const timers = new Map();
    let cursor = 0;
    let dirty = false;
    let effects = [];
    let hold = false;
    let revision = 1;
    let timerId = 0;
    let props = { listId: 'recent-added', libraries: ['/books'], localFiles: null, ...initial };
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        useState(initialValue) {
            const index = cursor++;
            slots[index] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue };
            return [slots[index].value, update => {
                const next = typeof update === 'function' ? update(slots[index].value) : update;
                if (!Object.is(slots[index].value, next)) dirty = true;
                slots[index].value = next;
            }];
        },
        useRef(initialValue) { return slots[cursor++] ??= { current: initialValue }; },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: callback, dependencies };
            return slots[index].value;
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
                const previous = slots[index];
                const current = { dependencies };
                slots[index] = current;
                effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
            }
        },
    };
    const listen = name => callback => {
        subscriptions.push(name);
        listeners.set(name, callback);
        return () => listeners.delete(name);
    };
    const module = { exports: {} };
    const context = vm.createContext({
        module, exports: module.exports,
        window: {
            electronAPI: {
                readingLists(request) {
                    calls.push(copy(request));
                    const files = request.id?.startsWith('recent-')
                        ? [...new Set(props.libraries)].map(root => ({ path: `${root}/${request.id}.epub`, title: `Revision ${revision}` }))
                        : [{ path: '/outside/saved.epub', title: `Revision ${revision}` }];
                    const result = request.operation === 'overview'
                        ? { success: true, collections: [], wishlistCount: 1, recentAddedCount: props.libraries.length, recentUpdatedCount: props.libraries.length }
                        : { success: true, files };
                    return hold && ['overview', 'list'].includes(request.operation)
                        ? new Promise(resolve => pending.push({ request, release: () => resolve(result) }))
                        : Promise.resolve(result);
                },
                onReadingListsChanged: listen('lists'),
                onScanComplete: listen('scan'),
            },
            addEventListener: (name, callback) => { listeners.set(name, callback); },
            removeEventListener: name => listeners.delete(name),
            setInterval: callback => { timers.set(++timerId, callback); return timerId; },
            clearInterval: id => timers.delete(id),
        },
        require(name) {
            if (name === 'react') return react;
            assert.equal(name, './useFolderScan.js');
            return { mergeFolderFileCacheUpdate: (entry, update) => ({ ...entry, ...update }) };
        },
    });
    vm.runInContext(compiled, context);
    const t = key => key;
    let result;
    const render = () => {
        cursor = 0;
        dirty = false;
        result = module.exports.useReadingLists(props.listId, t, props.localFiles, props.libraries);
        const nextEffects = effects;
        effects = [];
        nextEffects.forEach(effect => effect());
        return result;
    };
    const settle = async () => {
        for (let pass = 0; pass < 20; pass += 1) {
            render();
            await tick();
            if (!dirty) return result;
        }
        assert.fail('Reading list hook did not settle');
    };
    await settle();
    return {
        calls, subscriptions, pending, timers, settle,
        result: () => result,
        update(update) { props = { ...props, ...update }; return render(); },
        hold(value) { hold = value; },
        revision(value) { revision = value; },
        emit(name) { listeners.get(name)?.(); },
        close() { slots.forEach(slot => slot.cleanup?.()); },
    };
}

test('recent list revisits display cached books immediately while refreshing without refetching the overview', async () => {
    const app = await fixture();
    try {
        assert.equal(app.result().files[0].title, 'Revision 1');
        app.update({ listId: 'recent-updated' });
        await app.settle();
        app.revision(2);
        app.hold(true);
        const visible = app.update({ listId: 'recent-added' });
        assert.equal(visible.files[0].path, '/books/recent-added.epub');
        assert.equal(visible.files[0].title, 'Revision 1');
        await app.settle();
        assert.equal(app.result().loading, true);
        assert.equal(app.result().files.length, 1);
        assert.equal(app.calls.filter(call => call.operation === 'overview').length, 1);
        assert.deepEqual(app.subscriptions, ['lists', 'scan']);
        app.pending.shift().release();
        await app.settle();
        assert.equal(app.result().files[0].title, 'Revision 2');
        assert.equal(app.result().loading, false);
    } finally { app.close(); }
});

test('library changes immediately hide cached books and counts and discard previous scope responses', async () => {
    const app = await fixture({ libraries: ['/A', '/B'] });
    try {
        const count = app.calls.length;
        app.update({ libraries: ['/B', '/A', '/A'] });
        await app.settle();
        assert.equal(app.calls.length, count);
        app.hold(true);
        void app.result().refresh();
        const changed = app.update({ libraries: ['/B'] });
        assert.equal(changed.files.length, 0);
        assert.equal(changed.recentAddedCount, 0);
        assert.equal(changed.recentUpdatedCount, 0);
        app.pending.shift().release();
        await app.settle();
        assert.equal(app.result().files.length, 0);
        while (app.pending.length) app.pending.shift().release();
        await app.settle();
        assert.deepEqual(copy(app.result().files).map(file => file.path), ['/B/recent-added.epub']);
        const empty = app.update({ libraries: [] });
        assert.equal(empty.files.length, 0);
        while (app.pending.length) app.pending.shift().release();
        await app.settle();
        assert.equal(app.result().files.length, 0);
    } finally { app.close(); }
});

for (const event of ['lists', 'scan', 'focus', 'bookmanager:metadata-saved', 'timer']) {
    test(`${event} refreshes the selected list and invalidates inactive recent snapshots`, async () => {
        const app = await fixture();
        try {
            app.update({ listId: 'recent-updated' });
            await app.settle();
            app.hold(true);
            if (event === 'timer') [...app.timers.values()][0]();
            else app.emit(event);
            await app.settle();
            assert.equal(app.pending.filter(item => item.request.operation === 'list').length, 1);
            assert.equal(app.pending.find(item => item.request.operation === 'list').request.id, 'recent-updated');
            assert.equal(app.result().files[0].path, '/books/recent-updated.epub');
            const changed = app.update({ listId: 'recent-added' });
            assert.equal(changed.files.length, 0, 'Inactive cached data must not survive an invalidation');
            app.pending.find(item => item.request.id === 'recent-updated').release();
            await app.settle();
            assert.equal(app.result().files.length, 0, 'A late response must not restore invalidated cache');
            app.pending.find(item => item.request.id === 'recent-added').release();
            await app.settle();
            assert.equal(app.result().files[0].path, '/books/recent-added.epub');
        } finally { app.close(); }
    });
}

test('successful mutations invalidate inactive recent lists and refresh the active manual list', async () => {
    const app = await fixture();
    try {
        app.update({ listId: 'want-to-read' });
        await app.settle();
        app.revision(2);
        await app.result().mutate({ operation: 'remove', id: 'want-to-read', paths: ['/outside/book.epub'] });
        await app.settle();
        assert.equal(app.result().files[0].title, 'Revision 2');
        app.hold(true);
        assert.equal(app.update({ listId: 'recent-added' }).files.length, 0);
    } finally { app.close(); }
});

test('local favorites keep their preview updates without causing repeated overview requests', async () => {
    const favorite = { path: '/outside/favorite.epub', title: 'Favorite' };
    const app = await fixture({ listId: 'favorites', localFiles: [favorite] });
    try {
        assert.equal(app.calls.filter(call => call.operation === 'list').length, 0);
        app.result().updateFilePreview({ ...favorite, title: 'Extracted title', cover: 'cached-cover' });
        await app.settle();
        assert.equal(app.result().files[0].title, 'Favorite');
        assert.equal(app.result().files[0].cover, 'cached-cover');
        app.update({ localFiles: [favorite, { path: '/other.epub' }] });
        await app.settle();
        assert.equal(app.result().files.length, 2);
        assert.equal(app.calls.filter(call => call.operation === 'overview').length, 1);
    } finally { app.close(); }
});

test('a delayed preview from an earlier list snapshot cannot replace its refreshed cover', async () => {
    const app = await fixture({ listId: 'want-to-read' });
    try {
        const previousPreview = app.result().updateFilePreview;
        await app.result().refresh();
        await app.settle();
        const currentFile = app.result().files[0];
        app.result().updateFilePreview({ ...currentFile, cover: 'current-cover' });
        previousPreview({ ...currentFile, cover: 'outdated-cover' });
        await app.settle();
        assert.equal(app.result().files[0].cover, 'current-cover');
    } finally { app.close(); }
});
