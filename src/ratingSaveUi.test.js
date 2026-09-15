import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const start = source.indexOf('    const executeRatingEdit = useCallback(');
const end = source.indexOf('\n    const executeCoverEdit =', start);
assert.ok(start >= 0 && end > start);
const callbackSource = source.slice(start, end);

function fixture(result) {
    const selectedFile = {
        path: '/books/book.cbz', full_path: '/books/book.cbz', rating: '2',
        cover: 'bookmanager-thumbnail://cache/cover.jpg?v=123', thumb_path: '/cache/cover.jpg',
        mtime: 123, size: 456,
    };
    const otherFile = { path: '/books/other.cbz', rating: '3', cover: 'other-cover' };
    const initialFiles = [selectedFile, otherFile];
    const state = { library: initialFiles, tags: initialFiles, recent: initialFiles, folder: initialFiles };
    const calls = { refreshEvents: [], reloads: 0, saves: 0, toasts: [] };
    const values = {
        useCallback: callback => callback,
        runInternalFileAction: action => action(),
        window: {
            electronAPI: { saveRating: async () => { calls.saves += 1; return result; } },
            dispatchEvent: event => calls.refreshEvents.push(event),
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        setLibrarySearchResults: update => { state.library = update(state.library); },
        setFolderTagSearchResults: update => { state.tags = update(state.tags); },
        setRecentReadingFiles: update => { state.recent = update(state.recent); },
        updateCachedFiles: (_path, _options, updates) => {
            state.folder = state.folder.map(file => ({ ...file, ...updates.find(update => update.path === file.path) }));
        },
        selectedFolderPath: '/books',
        scanOptions: {},
        ratingEditorTarget: selectedFile,
        setTreeRefreshToken: () => { calls.reloads += 1; },
        setSearchSubmitToken: () => { calls.reloads += 1; },
        isLibrarySearchActive: true,
        isRecentReading: true,
        loadRecentReading: async () => { calls.reloads += 1; },
        showToast: message => calls.toasts.push(message),
        t: key => key,
    };
    const execute = new Function(...Object.keys(values), `${callbackSource}\nreturn executeRatingEdit;`)(...Object.values(values));
    return { execute, state, calls, selectedFile, otherFile };
}

for (const storage of ['file', 'database']) {
    test(`${storage} rating save preserves thumbnails in every view without launching a folder rescan`, async () => {
        const result = { success: true, filePath: '/books/book.cbz', rating: 7, storage };
        const f = fixture(result);
        assert.equal(await f.execute({ filePath: result.filePath, rating: 7 }), result);
        for (const files of Object.values(f.state)) {
            assert.deepEqual(files[0], { ...f.selectedFile, rating: '7' });
            assert.deepEqual(files[1], f.otherFile);
        }
        assert.deepEqual(f.calls.refreshEvents, [], 'A rating-only save must not invalidate or rebuild cover images');
        assert.equal(f.calls.reloads, 0);
        assert.equal(f.calls.saves, 1);
    });
}

test('failed rating save leaves the displayed rating and thumbnail intact', async () => {
    const f = fixture({ success: false, error: 'Save failed' });
    await f.execute({ filePath: '/books/book.cbz', rating: 9 });
    for (const files of Object.values(f.state)) assert.deepEqual(files[0], f.selectedFile);
    assert.deepEqual(f.calls.refreshEvents, []);
    assert.equal(f.calls.reloads, 0);
    assert.deepEqual(f.calls.toasts, []);
});
