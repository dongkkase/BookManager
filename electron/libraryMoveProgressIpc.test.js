import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const start = source.indexOf("ipcMain.handle('fs:executeLibraryMove'");
const end = source.indexOf('  // 9.', start);

test('이동과 인덱싱 IPC는 동일한 요청 ID로 실행 중 진행 상황을 전달한다', async () => {
    const handlers = new Map();
    const messages = [];
    const sender = { isDestroyed: () => false, send: (channel, data) => messages.push({ channel, data }) };
    let indexed = false;
    let closed = false;
    const result = { successCount: 2, completedMoves: [
        { src: '/source/a.cbz', dest: '/library/a.cbz' },
        { src: '/source/b.cbz', dest: '/library/b.cbz' },
    ] };
    vm.runInNewContext(source.slice(start, end), {
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        executeLibraryMoveAsync: async (_plans, { onProgress }) => {
            onProgress({ currentFile: '/source/a.cbz', processedCount: 0, totalCount: 2, progress: 10 });
            onProgress({ currentFile: '/source/b.cbz', processedCount: 1, totalCount: 2, progress: 60 });
            return result;
        },
        configManager: { getConfig: () => ({ libraries: ['/library'] }) },
        fs: { existsSync: () => true, statSync: () => ({ isDirectory: () => false, isFile: () => true }) },
        path,
        findContainingLibraryPath: filePath => filePath.startsWith('/library/') ? '/library' : '',
        INDEX_EXTENSIONS: new Set(['.cbz']),
        buildArchiveIndexEntries: async (paths, library, { onProgress }) => {
            assert.equal(indexed, false);
            onProgress({ currentPath: paths[0], completedCount: 1, totalCount: 1 });
            return [{ full_path: paths[0], target_folder: library }];
        },
        libraryDbPath: () => '/fixture/library.db',
        LibraryDB: class {
            async applyLibraryMoveIndexChanges(data) {
                indexed = true;
                assert.equal(data.targetEntries.length, 2);
                assert.ok(messages.some(message => message.data.libraryPhase === 'indexing'));
                return {};
            }
            async close() { closed = true; }
        },
    });
    const moved = await handlers.get('fs:executeLibraryMove')({ sender }, [], { requestId: 'move-42' });
    assert.equal(moved, result);
    assert.deepEqual(messages.map(message => message.data.progress), [10, 60]);
    await handlers.get('folder:applyLibraryMoveIndex')({ sender }, { completedMoves: result.completedMoves, requestId: 'move-42' });
    assert.ok(indexed && closed);
    assert.equal(messages.at(-1).data.progress, 100);
    assert.ok(messages.every(message => message.channel === 'task:progress' && message.data.requestId === 'move-42' && message.data.task === 'folder:libraryMove'));
    const count = messages.length;
    sender.isDestroyed = () => true;
    await handlers.get('fs:executeLibraryMove')({ sender }, [], { requestId: 'move-43' });
    assert.equal(messages.length, count);
});

test('두 preload는 이동 요청 ID를 메인 프로세스로 전달한다', async () => {
    for (const filename of ['preload.js', 'preload.cjs']) {
        const preload = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8');
        const match = preload.match(/executeLibraryMove:\s*([^\n]+)/);
        const calls = [];
        const invoke = vm.runInNewContext(`({ executeLibraryMove: ${match[1]} }).executeLibraryMove`, {
            ipcRenderer: { invoke: (...args) => calls.push(args) },
        });
        const plans = [{ src: '/source/a.cbz', dest: '/library/a.cbz' }];
        const options = { requestId: 'move-42' };
        await invoke(plans, options);
        assert.deepEqual(calls, [['fs:executeLibraryMove', plans, options]]);
    }
});
