import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { registerFolderDuplicateCheckIpc } from './folderDuplicateCheck.js';
import { TaskCancellationRegistry } from './taskCancellation.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-duplicate-ipc-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const library = path.join(root, 'library');
    const current = path.join(root, 'collection');
    await fs.mkdir(library);
    await fs.mkdir(current);
    const filePath = path.join(current, '도서 01.cbz');
    await fs.writeFile(filePath, 'current');
    await fs.writeFile(path.join(library, '도서 01.cbz'), 'candidate');
    const handlers = new Map();
    const cancellationRegistry = new TaskCancellationRegistry();
    registerFolderDuplicateCheckIpc({
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        cancellationRegistry,
        getConfig: () => ({ dup_check_folders: [library] }),
    });
    return {
        library, filePath, cancellationRegistry,
        run: (files, options) => handlers.get('folder:checkDuplicates')({ sender: { id: 1 } }, files, options),
    };
}

test('목록 중복 검사는 전달한 파일만 검사하며 설정의 라이브러리와 비교한다', async t => {
    const { filePath, library, run } = await fixture(t);
    const result = await run([{ path: filePath, name: 'outdated name.cbz' }]);
    assert.equal(result.cancelled, false);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, filePath);
    assert.equal(result.files[0].dup_count, 1);
    assert.equal(result.files[0].duplicate_matches[0].path, path.join(library, '도서 01.cbz'));
});

test('목록 검사는 폴더와 가상 경로를 제외하고 같은 파일을 한 번만 처리한다', async t => {
    const { filePath, library, run } = await fixture(t);
    const result = await run([
        { path: filePath }, { full_path: filePath },
        { path: library, isDirectory: true },
        { path: 'collection://one' }, { path: 'relative.cbz' },
        { path: path.join(library, 'cover.jpg') },
        { path: path.join(library, 'missing.cbz'), exists: false },
        null,
    ]);
    assert.deepEqual(result.files.map(file => file.path), [filePath]);
    assert.equal(result.files[0].dup_count, 1);
});

test('비교 라이브러리가 없는 요청은 이전 중복 결과를 비운다', async t => {
    const { filePath, run } = await fixture(t);
    const result = await run([{ path: filePath, dup_count: 3 }], { dupFolders: [] });
    assert.equal(result.files[0].dup_count, 0);
    assert.deepEqual(result.files[0].duplicate_matches, []);
    assert.deepEqual(await run(null), { files: [], cancelled: false });
});

test('목록 검사 취소는 폴더 스캔에 영향을 주지 않고 다음 요청을 실행할 수 있다', async t => {
    const { filePath, library, run, cancellationRegistry } = await fixture(t);
    const folderScan = cancellationRegistry.start(1, 'folder:scan');
    let release;
    let notifyStarted;
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const readdir = fs.readdir;
    let delayed = false;
    t.mock.method(fs, 'readdir', async (folder, ...args) => {
        if (folder === library && !delayed) {
            delayed = true;
            notifyStarted();
            await waiting;
        }
        return readdir(folder, ...args);
    });
    const pending = run([{ path: filePath }]);
    await started;
    assert.equal(cancellationRegistry.cancel(1, 'folder:checkDuplicates'), true);
    release();
    assert.deepEqual(await pending, { files: [], cancelled: true });
    assert.equal(folderScan.shouldCancel(), false);
    const next = await run([{ path: filePath }]);
    assert.equal(next.cancelled, false);
    assert.equal(next.files[0].dup_count, 1);
    cancellationRegistry.finish(1, 'folder:scan', folderScan);
    assert.equal(cancellationRegistry.hasActive(1), false);
});
