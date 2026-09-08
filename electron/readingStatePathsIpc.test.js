import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const start = source.indexOf("ipcMain.handle('reading:getStates'");
const end = source.indexOf("ipcMain.handle('reading:listRecent'", start);
assert.ok(start >= 0 && end > start);
const registration = source.slice(start, end).trim();

function fixture() {
    const mainFrame = {};
    const webContents = { mainFrame };
    const window = { isDestroyed: () => false, webContents };
    const calls = [];
    let failure;
    let handler;
    const rows = [{ filePath: '/synthetic/book.txt', pageIndex: 2, pageCount: 10, scrollPercent: 20 }];
    vm.runInNewContext(registration, {
        ipcMain: { handle: (name, callback) => { assert.equal(name, 'reading:getStates'); handler = callback; } },
        hooks: { getMainWindow: () => window },
        libraryDbPath: () => '/synthetic/library.db',
        LibraryDB: class {
            constructor(options) { assert.equal(options.readOnly, true); calls.push(['open', options.dbPath]); }
            async listReadingStatesByPaths(paths) { calls.push(['read', paths]); if (failure) throw failure; return rows; }
            async close() { calls.push(['close']); }
        },
    });
    return { handler, window, rows, calls, event: { sender: webContents, senderFrame: mainFrame }, fail: error => { failure = error; } };
}

test('reading path IPC accepts only the trusted main renderer and returns the exact bounded DB projection', async () => {
    const { handler, event, rows, calls, window } = fixture();
    for (const invalid of [{ sender: {} }, { ...event, senderFrame: {} }]) await assert.rejects(handler(invalid, []), /reading_untrusted_sender/);
    window.isDestroyed = () => true;
    await assert.rejects(handler(event, []), /reading_untrusted_sender/);
    assert.deepEqual(calls, []);
    window.isDestroyed = () => false;
    const paths = ['/synthetic/book.txt'];
    assert.equal(await handler(event, paths), rows);
    assert.deepEqual(calls, [['open', '/synthetic/library.db'], ['read', paths], ['close']]);
});

test('reading path IPC closes its DB when validation or query fails', async () => {
    const { handler, event, calls, fail } = fixture();
    fail(new Error('invalid_reading_paths'));
    await assert.rejects(handler(event, null), /invalid_reading_paths/);
    assert.deepEqual(calls, [['open', '/synthetic/library.db'], ['read', null], ['close']]);
});

test('both preload variants forward the same path query contract', async () => {
    for (const name of ['preload.js', 'preload.cjs']) {
        const preload = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
        const match = preload.match(/getReadingStates:\s*([^\n]+)/);
        assert.ok(match, name);
        const calls = [];
        const bridge = vm.runInNewContext(`({ getReadingStates: ${match[1]} }).getReadingStates`, {
            ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve([]); } },
        });
        const paths = ['/synthetic/book.txt'];
        await bridge(paths);
        assert.deepEqual(calls, [['reading:getStates', paths]]);
    }
});
