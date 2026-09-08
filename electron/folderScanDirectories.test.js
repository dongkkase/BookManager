import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanFolder } from './tasks/folderScanTask.js';

function createFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-folder-rows-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'Empty folder'));
    fs.mkdirSync(path.join(root, 'Books.cbz', 'Nested folder'), { recursive: true });
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(root, 'Root book.cbz'), '');
    fs.writeFileSync(path.join(root, 'Books.cbz', 'Nested book.cbz'), '');
    fs.writeFileSync(path.join(root, '.hidden', 'Hidden book.cbz'), '');
    return root;
}

for (const quickListOnly of [false, true]) {
    for (const includeSubfolders of [false, true]) {
        test(`폴더 표시 옵션은 직계 폴더와 기존 파일 범위를 반환한다 (quick=${quickListOnly}, recursive=${includeSubfolders})`, async t => {
            const root = createFixture(t);
            const options = { quickListOnly, includeSubfolders, skipArchiveExtraction: true };
            const filesOnly = await scanFolder(root, options);
            const rows = await scanFolder(root, { ...options, includeDirectories: true });

            assert.deepEqual(
                rows.filter(row => !row.isDirectory).map(row => row.path),
                filesOnly.map(row => row.path),
            );
            assert.equal(filesOnly.length, includeSubfolders ? 2 : 1);
            assert.equal(filesOnly.some(row => row.isDirectory), false);
            const directories = rows.filter(row => row.isDirectory);
            assert.deepEqual(directories.map(row => row.name), ['Books.cbz', 'Empty folder']);
            for (const directory of directories) {
                assert.equal(directory.folder_path, root);
                assert.equal(directory.full_path, path.join(root, directory.name));
                assert.equal(directory.title, directory.name);
                assert.equal(directory.is_folder, true);
                assert.equal(directory.ext, '');
                assert.equal(directory.has_metadata, false);
                assert.equal(directory.cover, '');
                assert.equal(directory.size, 0);
                const stats = fs.statSync(directory.path);
                assert.equal(directory.mtime, stats.mtimeMs);
                assert.equal(directory.ctime, stats.ctimeMs);
                assert.equal(directory.created, new Date(stats.birthtimeMs).toISOString());
                assert.equal(directory.modified, new Date(stats.mtimeMs).toISOString());
            }
        });
    }
}

test('폴더 행은 파일 메타데이터 조회와 중복 비교에서 제외하고 이벤트 캐시 키를 분리한다', async t => {
    const root = createFixture(t);
    const lookupPaths = [];
    const events = [];
    const rows = await scanFolder(root, {
        includeDirectories: true,
        includeSubfolders: false,
        skipArchiveExtraction: true,
        enableDupCheck: true,
        dupFolders: ['/indexed-books'],
        reportFileReady: true,
        requestId: 7,
        libraryDb: {
            async getFileInfo(filePath) {
                lookupPaths.push(filePath);
                return null;
            },
            async getTargetIndex() {
                return [{
                    name: 'Books.cbz',
                    full_path: '/indexed-books/Books.cbz',
                    path: '/indexed-books',
                }];
            },
        },
    }, {
        sender: {
            isDestroyed: () => false,
            send: (channel, data) => events.push({ channel, data }),
        },
    });

    assert.deepEqual(lookupPaths, [path.join(root, 'Root book.cbz')]);
    assert.equal(rows.find(row => row.name === 'Books.cbz').dup_count, 0);
    const completeEvent = events.find(event => event.channel === 'scan-complete').data;
    assert.deepEqual(completeEvent.files, rows);
    assert.equal(JSON.parse(completeEvent.cacheKey).includeDirectories, true);
    assert.equal(completeEvent.requestId, 7);
    const readyEvents = events.filter(event => event.channel === 'folder:fileReady');
    assert.equal(readyEvents.length, rows.length);
    assert.equal(readyEvents.every(event => event.data.cacheKey === completeEvent.cacheKey), true);
});

test('빈 폴더만 있는 빠른 스캔도 폴더 행을 스트리밍한다', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-empty-folder-rows-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'Empty folder'));
    const batches = [];
    const rows = await scanFolder(root, {
        includeDirectories: true,
        includeSubfolders: true,
        quickListOnly: true,
        suppressEvents: true,
        reportQuickFiles: true,
        resultCacheKey: 'folder-row-cache',
        requestId: 8,
    }, {
        sender: {
            isDestroyed: () => false,
            send: (channel, data) => {
                if (channel === 'folder:quickFiles') batches.push(data);
            },
        },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].isDirectory, true);
    assert.ok(rows[0].mtime > 0);
    assert.ok(rows[0].created);
    assert.ok(rows[0].modified);
    assert.deepEqual(batches.flatMap(batch => batch.files), rows);
    assert.equal(batches[0].cacheKey, 'folder-row-cache');
    assert.equal(batches[0].requestId, 8);
    assert.equal(batches[0].matchedCount, 0);
});

for (const quickListOnly of [false, true]) {
    for (const includeSubfolders of [false, true]) {
        test(`중복 디렉터리 엔트리는 한 번만 표시하고 탐색한다 (quick=${quickListOnly}, recursive=${includeSubfolders})`, async t => {
            const root = createFixture(t);
            const originalReaddir = fs.promises.readdir;
            const directoryReads = new Map();
            t.mock.method(fs.promises, 'readdir', async function (directoryPath, ...args) {
                directoryReads.set(directoryPath, (directoryReads.get(directoryPath) || 0) + 1);
                const entries = await originalReaddir.call(this, directoryPath, ...args);
                return Array.from({ length: 7 }, () => entries).flat();
            });
            const events = [];
            const rows = await scanFolder(root, {
                quickListOnly,
                includeSubfolders,
                includeDirectories: true,
                skipArchiveExtraction: true,
                reportQuickFiles: true,
                reportFileReady: true,
                resultCacheKey: 'duplicate-directory-entries',
            }, {
                sender: {
                    isDestroyed: () => false,
                    send: (channel, data) => events.push({ channel, data }),
                },
            });

            const expectedPaths = [
                path.join(root, 'Books.cbz'),
                path.join(root, 'Empty folder'),
                path.join(root, 'Root book.cbz'),
                ...(includeSubfolders ? [path.join(root, 'Books.cbz', 'Nested book.cbz')] : []),
            ].sort();
            assert.deepEqual(rows.map(row => row.path).sort(), expectedPaths);
            const streamedRows = quickListOnly
                ? events.filter(event => event.channel === 'folder:quickFiles').flatMap(event => event.data.files)
                : events.filter(event => event.channel === 'folder:fileReady').map(event => event.data.file);
            assert.deepEqual(streamedRows.map(row => row.path).sort(), expectedPaths);
            assert.deepEqual(events.find(event => event.channel === 'scan-complete').data.files, rows);
            const expectedDirectories = [
                root,
                ...(includeSubfolders ? [
                    path.join(root, 'Books.cbz'),
                    path.join(root, 'Books.cbz', 'Nested folder'),
                    path.join(root, 'Empty folder'),
                ] : []),
            ].sort();
            assert.deepEqual([...directoryReads.keys()].sort(), expectedDirectories);
            assert.equal([...directoryReads.values()].every(count => count === 1), true);
        });
    }
}
