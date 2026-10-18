import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { isRegisteredLibraryFile } from './libraryPathScope.js';

const mainSource = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const viewerSource = readFileSync(new URL('./viewerWindow.js', import.meta.url), 'utf8');

function section(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
    return source.slice(from, to);
}

function fixture() {
    const root = path.resolve('synthetic-library-scope');
    const inside = path.join(root, 'book.epub');
    const outside = path.join(`${root}-outside`, 'book.epub');
    let trusted = true;
    let libraries = [root];
    const writes = [];
    const notifications = [];
    const remoteReads = [];
    const lifecycle = [];
    const handlers = new Map();
    const sessions = new Map([
        ['inside', { id: 'inside', filePath: inside, type: 'epub' }],
        ['outside', { id: 'outside', filePath: outside, type: 'audio' }],
        ['preview', { id: 'preview', filePath: inside, type: 'epub', preview: true }],
    ]);
    const sender = {};
    const window = {
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => false,
            send: (channel, payload) => notifications.push({ channel, filePath: payload.filePath }),
        },
    };
    const context = vm.createContext({
        configManager: {
            canPruneLibraryData: () => trusted,
            getConfig: () => ({ libraries, language: 'ko', api_keys: {} }),
        },
        isRegisteredLibraryFile,
        LibraryDB: class {
            constructor() { lifecycle.push('open'); }
            async upsertReadingState(filePath, state) {
                const saved = { filePath, itemId: 'test-item', ...JSON.parse(JSON.stringify(state)) };
                writes.push(saved);
                return saved;
            }
            async close() { lifecycle.push('close'); }
        },
        getLibraryDbPath: () => path.join(root, 'data', 'library.db'),
        resolveLibraryDbPath: () => path.join(root, 'data', 'library.db'),
        getExecutableDir: () => root,
        mainAppWindow: () => window,
        mainWindow: window,
        sessions,
        viewerContextForSender: value => value === sender ? {} : null,
        viewerContextForCurrentSessionRequest: (event, id) => {
            if (event.sender !== sender || !sessions.has(id)) throw new Error('invalid_viewer_session');
        },
        getReadiveReadingState: async filePath => { remoteReads.push(filePath); return { filePath, pageIndex: 7 }; },
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        console: { warn: message => { throw new Error(message); } },
    });
    vm.runInContext(`
        let readingStateDb = null;
        ${section(viewerSource, 'const recordReadingState = async', 'const mainWindowForSender =')}
        ${section(mainSource, 'async function recordExternalViewerOpen(', 'function focusMainWindow(')}
        ${section(viewerSource, "ipcMain.handle('viewer:getReadiveReadingState'", "ipcMain.on('viewer:audio-track-state'")}
        ${section(viewerSource, "ipcMain.handle('viewer:getConfig'", "ipcMain.handle('viewer:openTtsSettings'")}
        globalThis.recordExternal = recordExternalViewerOpen;
    `, context);
    return {
        root, inside, outside, writes, notifications, remoteReads, lifecycle,
        recordExternal: context.recordExternal,
        save: (id, state = {}) => handlers.get('viewer:saveReadingState')({ sender }, id, state),
        readRemote: id => handlers.get('viewer:getReadiveReadingState')({ sender }, id),
        config: () => handlers.get('viewer:getConfig')(),
        update: (nextLibraries, nextTrusted = true) => { libraries = nextLibraries; trusted = nextTrusted; },
    };
}

test('viewer IPC saves inside trusted roots and blocks outside, preview and empty-scope sessions', async () => {
    const value = fixture();
    const saved = await value.save('inside', { pageIndex: 4, pageCount: 20 });
    assert.equal(saved.pageIndex, 4);
    assert.equal(saved.format, 'epub');
    assert.equal(saved.filePath, value.inside);
    assert.equal(await value.save('outside', { positionSeconds: 30 }), null);
    assert.equal(await value.save('preview', { pageIndex: 8 }), null);
    value.update([]);
    assert.equal(await value.save('inside', { pageIndex: 5 }), null);
    assert.deepEqual(value.writes.map(row => row.filePath), [value.inside]);
    assert.deepEqual(value.notifications, [{ channel: 'reading:changed', filePath: value.inside }]);
    assert.deepEqual(value.lifecycle, ['open']);
});

test('an already open viewer rechecks changed roots and unknown scope preserves saving', async () => {
    const value = fixture();
    await value.save('inside', { pageIndex: 1 });
    value.update([path.dirname(value.outside)]);
    assert.equal(await value.save('inside', { pageIndex: 2 }), null);
    assert.equal((await value.save('outside', { positionSeconds: 40 })).format, 'audio');
    value.update([], false);
    assert.equal((await value.save('inside', { pageIndex: 3 })).pageIndex, 3);
    assert.deepEqual(value.writes.map(row => row.filePath), [value.inside, value.outside, value.inside]);
    assert.equal(value.notifications.length, 3);
});

test('external viewer opens apply the latest trusted scope before opening the reading database', async () => {
    const value = fixture();
    await value.recordExternal(value.outside, 'audio');
    assert.deepEqual(value.lifecycle, []);
    await value.recordExternal(value.inside, 'epub');
    value.update([]);
    await value.recordExternal(value.inside, 'epub');
    assert.deepEqual(value.writes.map(row => row.filePath), [value.inside]);
    value.update([], false);
    await value.recordExternal(value.outside, 'audio');
    assert.deepEqual(value.writes.map(row => row.filePath), [value.inside, value.outside]);
    assert.deepEqual(value.lifecycle, ['open', 'close', 'open', 'close']);
    assert.equal(value.notifications.length, 2);
});

test('Readive resume IPC and viewer config use current scope while unknown roots remain unrestricted', async () => {
    const value = fixture();
    assert.deepEqual((await value.config()).readingLibraryPaths, [value.root]);
    assert.equal((await value.readRemote('inside')).pageIndex, 7);
    assert.equal(await value.readRemote('outside'), null);
    assert.equal(await value.readRemote('preview'), null);
    value.update([]);
    assert.deepEqual((await value.config()).readingLibraryPaths, []);
    assert.equal(await value.readRemote('inside'), null);
    value.update([], false);
    assert.equal((await value.config()).readingLibraryPaths, null);
    assert.equal((await value.readRemote('outside')).filePath, value.outside);
    assert.deepEqual(value.remoteReads, [value.inside, value.outside]);
    assert.deepEqual(value.writes, []);
});
