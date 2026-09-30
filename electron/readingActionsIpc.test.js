import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const start = source.indexOf("ipcMain.handle('reading:updateProgress'");
const end = source.indexOf("ipcMain.handle('reading:remove'", start);
assert.ok(start >= 0 && end > start);

function fixture() {
    const mainFrame = {};
    const webContents = { mainFrame };
    const window = { isDestroyed: () => false, webContents };
    const calls = [];
    const result = { states: [{ filePath: '/books/book.txt', status: 'completed' }], errors: [] };
    let handler;
    let failure;
    vm.runInNewContext(source.slice(start, end), {
        ipcMain: { handle: (name, callback) => { assert.equal(name, 'reading:updateProgress'); handler = callback; } },
        hooks: { getMainWindow: () => window, getOpenViewerPaths: () => ['/books/open.txt'] },
        libraryDbPath: () => '/fixture/library.db',
        LibraryDB: class {
            constructor(options) { calls.push(['open', options.dbPath]); }
            async close() { calls.push(['close']); }
        },
        updateReadingProgress: async (_db, paths, action, options) => {
            calls.push(['update', paths, action, options.getOpenViewerPaths()]);
            if (failure) throw failure;
            return result;
        },
        broadcastReadingChanged: event => { calls.push(['changed', event.progressChanged]); },
    });
    return { handler, window, result, calls, event: { sender: webContents, senderFrame: mainFrame }, fail: error => { failure = error; } };
}

test('읽기 상태 변경 IPC는 메인 프레임만 허용하고 변경 알림과 DB 정리를 수행한다', async () => {
    const { handler, event, result, calls, window } = fixture();
    for (const invalid of [{ sender: {} }, { ...event, senderFrame: {} }]) {
        await assert.rejects(handler(invalid, [], 'mark-read'), /reading_untrusted_sender/);
    }
    window.isDestroyed = () => true;
    await assert.rejects(handler(event, [], 'mark-read'), /reading_untrusted_sender/);
    assert.deepEqual(calls, []);
    window.isDestroyed = () => false;
    const paths = ['/books'];
    assert.equal(await handler(event, paths, 'mark-read'), result);
    assert.deepEqual(calls, [
        ['open', '/fixture/library.db'], ['update', paths, 'mark-read', ['/books/open.txt']], ['changed', true], ['close'],
    ]);
});

test('실패하거나 변경 항목이 없으면 잘못된 알림을 보내지 않고 DB를 닫는다', async () => {
    const { handler, event, calls, result, fail } = fixture();
    result.states = [];
    await handler(event, [], 'reset-progress');
    assert.equal(calls.some(call => call[0] === 'changed'), false);
    fail(new Error('database failure'));
    await assert.rejects(handler(event, [], 'reset-progress'), /database failure/);
    assert.deepEqual(calls.at(-1), ['close']);
});

test('두 preload는 같은 읽기 상태 변경 인자를 전달한다', async () => {
    for (const name of ['preload.js', 'preload.cjs']) {
        const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
        const match = source.match(/updateReadingProgress:\s*([^\n]+)/);
        assert.ok(match, name);
        const calls = [];
        const bridge = vm.runInNewContext(`({ updateReadingProgress: ${match[1]} }).updateReadingProgress`, {
            ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ states: [], errors: [] }); } },
        });
        const paths = ['/books'];
        await bridge(paths, 'reset-progress');
        assert.deepEqual(calls, [['reading:updateProgress', paths, 'reset-progress']]);
    }
});
