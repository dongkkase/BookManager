import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const tick = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
const compiled = transformSync(fs.readFileSync(new URL('./hooks/useListDuplicateCheck.js', import.meta.url), 'utf8'), { format: 'cjs', target: 'es2022' }).code;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function hooks() {
    const slots = [];
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let mounted = true;
    let staleUpdates = 0;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, update => {
                if (!mounted) staleUpdates += 1;
                const next = typeof update === 'function' ? update(slots[index].value) : update;
                if (!Object.is(slots[index].value, next)) dirty = true;
                slots[index].value = next;
            }];
        },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useMemo(compute, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: compute(), dependencies };
            return slots[index].value;
        },
        useCallback(callback, dependencies) { return react.useMemo(() => callback, dependencies); },
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
    return {
        react,
        hasUpdates: () => dirty,
        staleUpdates: () => staleUpdates,
        render(hook, props) {
            cursor = 0;
            dirty = false;
            const result = hook(props);
            const pending = effects;
            effects = [];
            pending.forEach(effect => effect());
            return result;
        },
        unmount() {
            mounted = false;
            slots.forEach(slot => slot.cleanup?.());
        },
    };
}

async function fixture(options = {}) {
    const renderer = hooks();
    const calls = { checks: [], stops: [], errors: [] };
    const api = {
        checkFileDuplicates: async (files, settings) => {
            calls.checks.push({ files: copy(files), settings: copy(settings) });
            return options.check ? options.check(files, settings, calls.checks.length) : { files: files.map(file => ({ ...file, dup_count: 1, max_ratio: 95, duplicate_matches: [{ path: '/target/book.cbz', ratio: 95 }] })), cancelled: false };
        },
        stopTask: async task => {
            calls.stops.push(task);
            return options.stop?.(task);
        },
    };
    if (options.noApi) delete api.checkFileDuplicates;
    const module = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports, window: { electronAPI: api }, require(name) { assert.equal(name, 'react'); return renderer.react; } });
    vm.runInContext(compiled, context);
    let props = {
        files: [{ full_path: '/books/book.cbz', name: 'book.cbz', mtime: 10, size: 20 }],
        enabled: true,
        scopeKey: 'favorites',
        dupFolders: ['/target'],
        onError: error => calls.errors.push(error),
        ...options.props,
    };
    let result;
    const render = () => { result = renderer.render(module.exports.useListDuplicateCheck, props); return result; };
    const settle = async () => {
        for (let pass = 0; pass < 20; pass += 1) {
            render();
            await tick();
            if (!renderer.hasUpdates()) return result;
        }
        assert.fail('Duplicate hook did not settle');
    };
    await settle();
    return {
        calls,
        api,
        renderer,
        settle,
        result: () => result,
        update: async update => { props = { ...props, ...update }; return settle(); },
        close: async () => { renderer.unmount(); await tick(); },
    };
}

test('disabled, empty, virtual-folder-only and targetless lists clear duplicate results without checking', async () => {
    const stale = { full_path: '/books/book.cbz', cover: 'cover', duplicate_matches: [{ path: '/other' }], dup_count: 1, max_ratio: 90 };
    const value = await fixture({ props: { files: [stale], enabled: false } });
    try {
        assert.equal(value.calls.checks.length, 0);
        assert.deepEqual(copy(value.result().files[0]), { ...stale, duplicate_matches: [], dup_count: 0, max_ratio: 0 });
        assert.equal(stale.dup_count, 1);
        await value.update({ files: [], enabled: true });
        assert.equal(value.result().busy, false);
        await value.update({ files: [
            { full_path: 'collection://123', dup_count: 8 },
            { full_path: '/books/folder', isDirectory: true, dup_count: 4 },
            { path: 'relative.cbz', dup_count: 3 },
        ] });
        assert.equal(value.calls.checks.length, 0);
        assert.ok(value.result().files.every(file => file.dup_count === 0));
        await value.update({ files: [stale], dupFolders: [] });
        assert.equal(value.calls.checks.length, 0);
        assert.equal(value.result().busy, false);
    } finally { await value.close(); }
});

test('only real files are sent and only duplicate fields overlay the latest metadata', async () => {
    const request = deferred();
    const original = { full_path: '/books/book.cbz', name: 'book.cbz', mtime: 10, size: 20, title: 'Original', cover: 'old' };
    const directory = { path: '/books/folder', isDirectory: true, dup_count: 5 };
    const windows = { path: 'C:\\Books\\Other.cbz', name: 'Other.cbz', mtime: 1, size: 2 };
    const value = await fixture({ check: () => request.promise, props: { files: [original, directory, { path: 'collection://id' }, windows] } });
    try {
        assert.equal(value.result().busy, true);
        assert.equal(value.calls.checks[0].files.length, 2);
        assert.deepEqual(value.calls.checks[0].files.find(file => file.full_path === original.full_path), { full_path: original.full_path, name: 'book.cbz', mtime: 10, size: 20 });
        await value.update({ files: [{ ...original, title: 'Edited', cover: 'new' }, directory, { path: 'collection://id' }, windows] });
        assert.equal(value.calls.checks.length, 1);
        request.resolve({ files: [
            { ...original, title: 'Stale server title', cover: 'stale', dup_count: 2, max_ratio: 91, duplicate_matches: [{ path: '/target/copy.cbz', ratio: 91 }] },
            { full_path: '/books/folder', dup_count: 99, max_ratio: 100 },
            { full_path: 'c:/books/other.cbz', dup_count: 3, max_ratio: 80, duplicate_matches: [] },
        ] });
        await value.settle();
        assert.equal(value.result().busy, false);
        assert.equal(value.result().files[0].title, 'Edited');
        assert.equal(value.result().files[0].cover, 'new');
        assert.equal(value.result().files[0].dup_count, 2);
        assert.equal(value.result().files[0].max_ratio, 91);
        assert.equal(value.result().files[0].duplicate_matches[0].path, '/target/copy.cbz');
        assert.equal(value.result().files[1].dup_count, 0);
        assert.equal(value.result().files[3].dup_count, 3);
        assert.equal(original.cover, 'old');
    } finally { await value.close(); }
});

test('missing files are excluded, cleared and checked again only after they exist', async () => {
    const missing = { full_path: '/books/missing.cbz', name: 'missing.cbz', exists: false, dup_count: 9, max_ratio: 99, duplicate_matches: [{ path: '/old' }] };
    const present = { full_path: '/books/present.cbz', name: 'present.cbz', exists: true };
    const value = await fixture({ props: { files: [missing, present] } });
    try {
        assert.deepEqual(value.calls.checks[0].files.map(file => file.full_path), ['/books/present.cbz']);
        assert.equal(value.result().files[0].exists, false);
        assert.equal(value.result().files[0].dup_count, 0);
        assert.equal(value.result().files[0].max_ratio, 0);
        assert.deepEqual(copy(value.result().files[0].duplicate_matches), []);
        assert.equal(value.result().files[1].dup_count, 1);
        await value.update({ files: [{ ...missing, cover: 'updated' }, present] });
        assert.equal(value.calls.checks.length, 1);
        await value.update({ files: [{ ...missing, exists: true }, present] });
        assert.equal(value.calls.checks.length, 2);
        assert.ok(value.calls.checks[1].files.some(file => file.full_path === missing.full_path));
        assert.equal(value.result().files[0].dup_count, 1);
        await value.update({ files: [missing] });
        assert.equal(value.calls.checks.length, 2);
        assert.equal(value.result().files[0].dup_count, 0);
        assert.equal(value.result().busy, false);
    } finally { await value.close(); }
});

test('equivalent lists reuse results while file facts, scope, targets and refresh trigger a new check', async () => {
    let files = [{ path: '/books/b.cbz', name: 'b.cbz', mtime: 1, size: 2 }, { path: '/books/a.cbz', name: 'a.cbz', mtime: 3, size: 4 }];
    const value = await fixture({ props: { files, dupFolders: ['/target/b', '/target/a'] } });
    try {
        await value.update({ files: [...files].reverse().map(file => ({ ...file, cover: 'updated' })), dupFolders: ['/target/a', '/target/b', '/target/a'] });
        assert.equal(value.calls.checks.length, 1);
        for (const change of [{ name: 'renamed.cbz' }, { mtime: 20 }, { size: 30 }, { path: '/books/new.cbz' }]) {
            files = [{ ...files[0], ...change }, files[1]];
            await value.update({ files });
        }
        assert.equal(value.calls.checks.length, 5);
        await value.update({ scopeKey: 'collection:2' });
        await value.update({ dupFolders: ['/another'] });
        value.result().refresh();
        await value.settle();
        assert.equal(value.calls.checks.length, 8);
        assert.equal(value.calls.stops.length, 0);
    } finally { await value.close(); }
});

test('OFF clears immediately and ON waits for cancellation before starting a replacement request', async () => {
    const oldRequest = deferred();
    const newRequest = deferred();
    const cancellation = deferred();
    const value = await fixture({ check: (_files, _settings, index) => index === 1 ? oldRequest.promise : newRequest.promise, stop: () => cancellation.promise });
    try {
        await value.update({ enabled: false });
        assert.equal(value.result().busy, false);
        assert.equal(value.result().files[0].dup_count, 0);
        assert.deepEqual(value.calls.stops, ['folder:checkDuplicates']);
        await value.update({ enabled: true });
        assert.equal(value.result().busy, true);
        assert.equal(value.calls.checks.length, 1);
        cancellation.resolve();
        await value.settle();
        assert.equal(value.calls.checks.length, 2);
        oldRequest.resolve({ files: [{ full_path: '/books/book.cbz', dup_count: 99 }] });
        await value.settle();
        assert.equal(value.result().busy, true);
        assert.equal(value.result().files[0].dup_count, 0);
        newRequest.resolve({ files: [{ full_path: '/books/book.cbz', dup_count: 2, max_ratio: 80, duplicate_matches: [] }] });
        await value.settle();
        assert.equal(value.result().files[0].dup_count, 2);
        assert.equal(value.result().busy, false);
    } finally { await value.close(); }
});

test('rapid scope changes skip obsolete queued checks and discard errors from the old screen', async () => {
    const oldRequest = deferred();
    const cancellation = deferred();
    const value = await fixture({ check: (files, _settings, index) => index === 1 ? oldRequest.promise : { files }, stop: () => cancellation.promise });
    try {
        await value.update({ scopeKey: 'collection:B', files: [{ path: '/B.cbz' }] });
        await value.update({ scopeKey: 'search:C', files: [{ path: '/C.cbz', title: 'Current' }] });
        assert.equal(value.calls.checks.length, 1);
        cancellation.resolve();
        await value.settle();
        assert.equal(value.calls.checks.length, 2);
        assert.equal(value.calls.checks[1].files[0].full_path, '/C.cbz');
        oldRequest.reject(new Error('Old screen failed'));
        await value.settle();
        assert.equal(value.calls.errors.length, 0);
        assert.equal(value.result().files[0].title, 'Current');
        assert.equal(value.result().busy, false);
    } finally { await value.close(); }
});

test('current errors use the latest callback, refresh retries, and cancellation is not an error', async () => {
    const request = deferred();
    const errors = [];
    const value = await fixture({ check: (_files, _settings, index) => index === 1 ? request.promise : { cancelled: true } });
    try {
        await value.update({ onError: error => errors.push(error.message) });
        assert.equal(value.calls.checks.length, 1);
        request.reject(new Error('Cannot read library'));
        await value.settle();
        assert.deepEqual(errors, ['Cannot read library']);
        assert.equal(value.calls.errors.length, 0);
        assert.equal(value.result().busy, false);
        value.result().refresh();
        await value.settle();
        assert.equal(value.calls.checks.length, 2);
        assert.deepEqual(errors, ['Cannot read library']);
        assert.equal(value.result().busy, false);
        assert.equal(value.result().files[0].dup_count, 0);
    } finally { await value.close(); }
});

test('unmount cancels the active task and ignores its later rejection', async () => {
    const request = deferred();
    const value = await fixture({ check: () => request.promise });
    await value.close();
    assert.deepEqual(value.calls.stops, ['folder:checkDuplicates']);
    request.reject(new Error('Completed after unmount'));
    await tick();
    assert.equal(value.calls.errors.length, 0);
    assert.equal(value.renderer.staleUpdates(), 0);
});

test('missing or malformed APIs report failure and failed cancellation does not block the next screen', async () => {
    for (const options of [{ noApi: true }, { check: () => ({ message: 'Invalid result' }) }]) {
        const value = await fixture(options);
        try {
            assert.equal(value.calls.errors.length, 1);
            assert.equal(value.result().busy, false);
        } finally { await value.close(); }
    }
    const request = deferred();
    const value = await fixture({ check: (files, _settings, index) => index === 1 ? request.promise : { files }, stop: () => { throw new Error('Stop unavailable'); } });
    try {
        await value.update({ scopeKey: 'another' });
        assert.equal(value.calls.checks.length, 2);
        assert.equal(value.result().busy, false);
        request.resolve({ files: [{ full_path: '/books/book.cbz', dup_count: 99 }] });
        await value.settle();
        assert.equal(value.result().files[0].dup_count, 0);
    } finally { await value.close(); }
});
