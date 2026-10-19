import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const handlerStart = source.indexOf("  ipcMain.handle('folder:updateIndex',");
const handlerEnd = source.indexOf("  ipcMain.handle('releases:list',", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handlerSource = source.slice(handlerStart, handlerEnd);

function fixture(options = {}) {
    const folder = path.resolve('/test-library');
    const files = ['unchanged.cbz', 'added.cbz', 'updated.cbz'].map(name => path.join(folder, name));
    const calls = {
        scans: [], syncs: [], activity: [], folderIndexes: [], metadata: [], configs: [], states: [],
        rootStats: 0, heartbeatRootStats: 0, progress: [], closed: 0, finished: 0,
    };
    let now = Date.parse('2026-01-01T00:00:00Z');
    let cancelled = false;
    let state = { library_path: folder, fingerprint: options.previousFingerprint || 'old', indexed_count: files.length };
    let handler;
    const controller = { shouldCancel: () => cancelled };
    const context = vm.createContext({
        path,
        fs: { existsSync: () => true },
        Date: class extends Date {
            constructor(value = now) { super(value); }
            static now() { return now; }
        },
        console: { log() {} },
        ipcMain: { handle(name, callback) {
            assert.equal(name, 'folder:updateIndex');
            handler = callback;
        } },
        cancellationRegistry: {
            start: () => controller,
            finish: (_senderId, taskId, finishedController) => {
                assert.equal(taskId, 'folder:updateIndex');
                assert.equal(finishedController, controller);
                calls.finished += 1;
            },
        },
        configManager: {
            getConfig: () => ({ libraries: [folder], language: 'ko', max_threads: 4 }),
            updateConfig: value => calls.configs.push(value),
        },
        setLanguage() {},
        libraryDbPath: () => '/virtual/library.db',
        LibraryDB: class {
            async getLibraryScanState() { return state; }
            async saveLibraryScanState(value) {
                state = { ...value };
                calls.states.push({ ...value });
            }
            async getTargetIndex() { return files.map(full_path => ({ full_path })); }
            async syncReadingFileActivity(entries) { calls.activity.push(entries); }
            async syncTargetIndex(root, entries) {
                calls.syncs.push({ root, entries });
                return {
                    indexedCount: files.length,
                    added: [files[1]], updated: [files[2]],
                    addedCount: 1, updatedCount: 1, removedCount: 1,
                };
            }
            async replaceLibraryFolders(root, records) { calls.folderIndexes.push({ root, records }); }
            async close() { calls.closed += 1; }
        },
        safeStatMtime: () => { calls.rootStats += 1; return 123; },
        nowIsoString: () => new Date(now).toISOString(),
        isPathInsideOrEqual: (target, root) => target === root || target.startsWith(`${root}${path.sep}`),
        getBinPath: async () => '/virtual/7za',
        i18nT: key => key,
        throwIfTaskCancelled: shouldCancel => {
            if (shouldCancel()) throw Object.assign(new Error('cancelled'), { code: 'TASK_CANCELLED' });
        },
        scanArchivePaths: async (root, _priority, onProgress, _shouldCancel, _onFile, onDirectory) => {
            calls.scans.push(root);
            onDirectory(root);
            onProgress({ scannedCount: files.length, matchedCount: files.length, currentPath: root });
            if (options.cancelAfterScan) cancelled = true;
            return files;
        },
        buildLibraryFolderIndexRecords: root => [{ library_path: root, folder_path: root }],
        buildArchiveIndexEntries: async (_files, root, settings) => {
            settings.onProgress({ completedCount: files.length, totalCount: files.length, currentPath: root });
            return files.map(full_path => ({ full_path, size: 123, mtime: 1, birthtimeMs: 2 }));
        },
        createArchiveFingerprint: () => 'current',
        optimizeMetadataForPaths: async (root, targets, settings) => {
            calls.metadata.push({ root, targets: [...targets], settings });
            const before = calls.rootStats;
            for (let i = 0; i < (options.heartbeatCount || 0); i += 1) {
                now += 60;
                settings.touchHeartbeat();
            }
            calls.heartbeatRootStats += calls.rootStats - before;
            return targets.map(filePath => ({ path: filePath }));
        },
    });
    vm.runInContext(handlerSource, context);
    return {
        folder, files, calls,
        run: settings => handler({ sender: { id: 1, isDestroyed: () => false, send: (_channel, progress) => calls.progress.push(progress) } }, [folder], settings),
    };
}

test('동일한 지문의 스마트 갱신은 메타데이터 추출과 대상 인덱스 쓰기를 생략한다', async () => {
    const value = fixture({ previousFingerprint: 'current' });
    const result = await value.run({ mode: 'smart' });
    assert.equal(result.success, true);
    assert.equal(result.skippedFolders, 1);
    assert.equal(result.total, value.files.length);
    assert.equal(result.changedTotal, 0);
    assert.equal(value.calls.scans.length, 1);
    assert.equal(value.calls.syncs.length, 0);
    assert.equal(value.calls.activity.length, 1);
    assert.deepEqual(value.calls.activity[0].map(entry => entry.full_path), value.files);
    assert.ok(value.calls.activity[0].every(entry => entry.mtime === 1 && entry.birthtimeMs === 2));
    assert.equal(value.calls.metadata.length, 0);
    assert.equal(value.calls.folderIndexes.length, 1);
    assert.equal(value.calls.states.at(-1).status, 'ready');
    assert.equal(value.calls.closed, 1);
    assert.equal(value.calls.finished, 1);
});

test('변경된 스마트 갱신은 추가·변경된 파일만 메타데이터 대상으로 전달한다', async () => {
    const value = fixture();
    const result = await value.run({ mode: 'smart', metadataConcurrency: 3 });
    assert.equal(result.changedTotal, 3);
    assert.equal(result.visualTotal, 2);
    assert.equal(value.calls.syncs.length, 1);
    assert.equal(value.calls.activity.length, 1);
    assert.deepEqual(value.calls.metadata[0].targets, value.files.slice(1));
    assert.equal(value.calls.metadata[0].settings.force, false);
    assert.equal(value.calls.metadata[0].settings.metadataConcurrency, 3);
    assert.equal(value.calls.states.at(-1).status, 'ready');
    assert.equal(value.calls.closed, 1);
});

test('전체 갱신은 모든 파일을 강제 처리하고 메타데이터 heartbeat가 루트 stat을 반복하지 않는다', async () => {
    const value = fixture({ previousFingerprint: 'current', heartbeatCount: 100 });
    const result = await value.run({ mode: 'force', skipCoverExtraction: true });
    assert.equal(result.skippedFolders, 0);
    assert.equal(result.visualTotal, value.files.length);
    assert.equal(value.calls.syncs.length, 1);
    assert.deepEqual(value.calls.metadata[0].targets, value.files);
    assert.equal(value.calls.metadata[0].settings.force, true);
    assert.equal(value.calls.metadata[0].settings.skipCoverExtraction, true);
    assert.equal(value.calls.heartbeatRootStats, 0);
    assert.ok(value.calls.rootStats <= 3, `root stat should be bounded per library, got ${value.calls.rootStats}`);
    assert.ok(value.calls.states.length <= 4);
    assert.equal(value.calls.closed, 1);
    assert.equal(value.calls.finished, 1);
});

test('취소된 인덱스 갱신은 메타데이터 추출 없이 취소 상태를 저장하고 DB를 닫는다', async () => {
    const value = fixture({ cancelAfterScan: true });
    const result = await value.run({ mode: 'smart' });
    assert.equal(result.cancelled, true);
    assert.equal(value.calls.syncs.length, 0);
    assert.equal(value.calls.activity.length, 0);
    assert.equal(value.calls.metadata.length, 0);
    assert.equal(value.calls.states.at(-1).status, 'cancelled');
    assert.equal(value.calls.closed, 1);
    assert.equal(value.calls.finished, 1);
});
