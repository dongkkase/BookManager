import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeLibraryMoveAsync, findLibraryMoveConflicts, removeTreeIfNoFilesAsync } from '../electron/fsOperations.js';
import { applyConflictChoice, createLibraryMovePlans, expandLibraryMovePlans, libraryMoveFolderSources } from './libraryMovePolicy.js';
import { normalizeLibraryKey } from './folderLibraryStatus.js';
import { createLibraryMoveProgress } from './libraryMoveProgress.js';

const source = fs.readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const callback = (name, next) => {
    const start = source.indexOf(`  const ${name} = useCallback(`);
    const end = source.indexOf(`\n  const ${next} =`, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
};

function fixture(t, choices, withProgress = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-move-ui-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const library = path.join(root, 'library');
    fs.mkdirSync(library);
    const calls = { prompts: [], previews: [], errors: [], indexed: [], navigation: [], requests: [], progress: [] };
    const progressListeners = new Set();
    const api = {
        exists: async target => fs.existsSync(target),
        findLibraryMoveConflicts,
        executeLibraryMove: (plans, options = {}) => executeLibraryMoveAsync(plans, withProgress ? {
            onProgress: progress => {
                for (const listener of progressListeners) listener({ task: 'folder:libraryMove', requestId: options.requestId, libraryPhase: 'moving', ...progress });
            },
        } : {}),
        onTaskProgress: listener => {
            progressListeners.add(listener);
            return () => progressListeners.delete(listener);
        },
        getFilePreview: async target => { calls.previews.push(target); return { file: { path: target } }; },
        expandFolderMove: async (src, dest) => {
            const plans = [];
            const walk = directory => {
                for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                    const file = path.join(directory, entry.name);
                    if (entry.isDirectory()) walk(file);
                    else plans.push({ src: file, dest: path.join(dest, path.relative(src, file)) });
                }
            };
            walk(src);
            return { success: true, plans };
        },
        removeEmptyTree: removeTreeIfNoFilesAsync,
        applyLibraryMoveIndex: async request => { calls.indexed.push(request); return { success: true }; },
        showMessage: async message => calls.errors.push(message),
    };
    const selectedEntryObjects = ['A', 'B', 'C'].map(name => ({ path: path.join(root, 'source', name), isDirectory: true }));
    const values = {
        window: { electronAPI: api }, useCallback: fn => fn,
        requestConflictChoice: async conflict => { calls.prompts.push(conflict); return choices[calls.prompts.length - 1] || choices[0]; },
        runInternalFileAction: action => action(),
        applyConflictChoice, expandLibraryMovePlans, libraryMoveFolderSources, normalizeLibraryKey, createLibraryMoveProgress,
        basename: path.basename, parentPath: path.dirname,
        libraries: [library], config: {}, t: key => key,
        emitLibraryMoveProgress: (...args) => calls.progress.push(args), clearLibraryMoveProgress: () => {},
        saveConfig: async () => {}, setLibraryMoveRequest: request => calls.requests.push(request),
        clearSelection: () => {}, handleRefresh: async () => {},
        handleFolderChange: async target => calls.navigation.push(target),
        refreshLibraryScanStates: async () => {}, showToast: () => {},
        selectedFolderPath: path.join(root, 'source'), selectedEntryObjects,
        setTreeRefreshToken: () => {}, isPathInsideLibrary: (file, directory) => file === directory || file.startsWith(`${directory}/`),
    };
    const code = [
        callback('executeLibraryMovePlans', 'moveSelectedToLibrary'),
        callback('moveSelectedToLibrary', 'openLibraryMoveDialog'),
        callback('moveContextFolderToLibrary', 'sendFolderToTab'),
        'return { executeLibraryMovePlans, moveSelectedToLibrary, moveContextFolderToLibrary };',
    ].join('\n');
    const methods = new Function(...Object.keys(values), code)(...Object.values(values));
    const write = (relative, content) => {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        return target;
    };
    return { ...methods, root, library, calls, write, selectedEntryObjects, progressListeners };
}

for (const action of ['overwrite', 'rename', 'skip']) {
    test(`multiple folders move together with ${action} applied across all their conflicts`, async t => {
        const f = fixture(t, [{ action, applyToAll: true }]);
        for (const name of ['A', 'B']) {
            f.write(`source/${name}/book.cbz`, `new ${name}`);
            f.write(`library/${name}/book.cbz`, `old ${name}`);
        }
        f.write('source/C/unique.cbz', 'unique');
        await f.moveContextFolderToLibrary({ source: 'list', folderPath: f.selectedEntryObjects[1].path });
        const request = f.calls.requests[0];
        assert.equal(request.sources.length, 3);
        await f.moveSelectedToLibrary(createLibraryMovePlans(request.sources, f.library, request));
        assert.deepEqual(f.calls.errors, []);
        assert.equal(f.calls.prompts.length, 1);
        assert.equal(f.calls.previews.length, 2);
        assert.equal(fs.readFileSync(path.join(f.library, 'C/unique.cbz'), 'utf8'), 'unique');
        assert.equal(fs.existsSync(path.join(f.root, 'source/C')), false);
        for (const name of ['A', 'B']) {
            assert.equal(fs.readFileSync(path.join(f.library, name, 'book.cbz'), 'utf8'), action === 'overwrite' ? `new ${name}` : `old ${name}`);
            assert.equal(fs.existsSync(path.join(f.root, 'source', name, 'book.cbz')), action === 'skip');
            if (action === 'rename') assert.equal(fs.readFileSync(path.join(f.library, name, 'book_1.cbz'), 'utf8'), `new ${name}`);
        }
        assert.equal(f.calls.indexed[0].completedMoves.length, action === 'skip' ? 1 : 3);
        assert.deepEqual(f.calls.navigation, [f.library]);
    });
}

test('individual choices prompt per conflict and apply-to-all resets on the next move', async t => {
    const f = fixture(t, [{ action: 'skip', applyToAll: false }, { action: 'rename', applyToAll: true }]);
    const plans = ['A', 'B'].map(name => ({ src: f.write(`source/${name}.cbz`, name), dest: f.write(`library/${name}.cbz`, 'old') }));
    await f.executeLibraryMovePlans(plans);
    assert.equal(f.calls.prompts.length, 2);
    await f.executeLibraryMovePlans([plans[0]]);
    assert.equal(f.calls.prompts.length, 3);
});

test('files headed for the same new destination are compared before moving', async t => {
    const f = fixture(t, [{ action: 'rename', applyToAll: true }]);
    const plans = ['A', 'B'].map(name => ({ src: f.write(`source/${name}/book.cbz`, name), dest: path.join(f.library, 'book.cbz') }));
    const result = await f.executeLibraryMovePlans(plans);
    assert.equal(result.successCount, 2);
    assert.equal(f.calls.prompts[0].plannedDestination, true);
    assert.equal(f.calls.prompts[0].destination.path, plans[0].src);
    assert.equal(fs.readFileSync(path.join(f.library, 'book.cbz'), 'utf8'), 'A');
    assert.equal(fs.readFileSync(path.join(f.library, 'book_1.cbz'), 'utf8'), 'B');
});

test('apply-to-all also covers conflicts created by an earlier automatic rename', async t => {
    const f = fixture(t, [{ action: 'rename', applyToAll: true }]);
    const plans = [
        { src: f.write('source/book.cbz', 'first'), dest: f.write('library/book.cbz', 'existing') },
        { src: f.write('source/book_1.cbz', 'second'), dest: path.join(f.library, 'book_1.cbz') },
    ];
    const result = await f.executeLibraryMovePlans(plans);
    assert.equal(result.successCount, 2);
    assert.equal(f.calls.prompts.length, 1);
    assert.equal(fs.readFileSync(path.join(f.library, 'book_1.cbz'), 'utf8'), 'first');
    assert.equal(fs.readFileSync(path.join(f.library, 'book_1_1.cbz'), 'utf8'), 'second');
});

test('later overwrite conflicts preview the file that will actually occupy the destination', async t => {
    const f = fixture(t, [{ action: 'overwrite', applyToAll: false }, { action: 'skip', applyToAll: false }]);
    const dest = f.write('library/book.cbz', 'existing');
    const plans = ['A', 'B'].map(name => ({ src: f.write(`source/${name}/book.cbz`, name), dest }));
    await f.executeLibraryMovePlans(plans);
    assert.equal(f.calls.prompts[1].destination.path, plans[0].src);
    assert.equal(f.calls.prompts[1].plannedDestination, true);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'A');
    assert.equal(fs.readFileSync(plans[1].src, 'utf8'), 'B');
});

test('폴더 탭은 실행 중인 이동의 실제 진행률과 선택 항목의 표지를 전달하고 구독을 정리한다', async t => {
    const f = fixture(t, [], true);
    f.write('source/A/book.cbz', 'A');
    f.write('source/B/book.cbz', 'B');
    f.selectedEntryObjects[0].cover = 'cached-folder-cover';
    await f.moveSelectedToLibrary(createLibraryMovePlans(f.selectedEntryObjects.slice(0, 2), f.library, { folderMode: true }));
    assert.deepEqual(f.calls.errors, []);
    const moving = f.calls.progress.filter(call => call[0] === 'library_move_status_moving_progress');
    assert.ok(moving.some(call => call[1] === 47.5));
    assert.ok(moving.some(call => call[1] === 70));
    assert.ok(moving.some(call => call[3].currentItemCover === 'cached-folder-cover'));
    assert.equal(f.progressListeners.size, 0);
});
