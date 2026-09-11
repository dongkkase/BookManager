import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { filterLibrarySearchFilesByPresence } from './librarySearchFilePresence.js';

const rowsFor = paths => paths.map(path => ({ path, title: 'Indexed title' }));
const failure = code => Object.assign(new Error(code), { code });

test('검색 결과의 부모 폴더를 한 번씩 읽고 사라진 파일만 순서와 메타데이터를 유지하며 제외한다', async () => {
    const rows = rowsFor(['/NAS/Books/04.cbz', '/NAS/Books/004.cbz', '/NAS/Other/Keep.epub', '/NAS/Books/05.cbz']);
    const calls = [];
    const result = await filterLibrarySearchFilesByPresence(rows, {
        readdir: async parent => {
            calls.push(parent);
            return parent === '/NAS/Books' ? ['004.cbz', '006.cbz'] : ['Keep.epub'];
        },
    });
    assert.deepEqual(calls.sort(), ['/NAS/Books', '/NAS/Other']);
    assert.deepEqual(result, [rows[1], rows[2]]);
    assert.equal(result[0], rows[1]);
    assert.equal(rows.length, 4);
});

test('부모 폴더가 없어진 결과는 숨기고 권한이나 네트워크 오류가 난 결과는 보존한다', async () => {
    const codes = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'ENOTCONN', 'ETIMEDOUT'];
    const rows = rowsFor(codes.map(code => `/NAS/${code}/Book.cbz`));
    const result = await filterLibrarySearchFilesByPresence(rows, {
        readdir: async parent => { throw failure(parent.split('/').at(-1)); },
    });
    assert.deepEqual(result, rows.slice(2));
});

test('macOS 검색 DB의 NFD 경로는 NAS에서 읽은 NFC 이름과 일치한다', async () => {
    const nfc = '/NAS/한글 책/선택한 책.cbz';
    const rows = rowsFor([nfc.normalize('NFD'), '/NAS/한글 책/남은 책.cbz', '/NAS/한글 책/삭제한 책.cbz']);
    const calls = [];
    const result = await filterLibrarySearchFilesByPresence(rows, {
        platform: 'darwin',
        readdir: async parent => { calls.push(parent); return ['선택한 책.cbz', '남은 책.cbz']; },
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(result, rows.slice(0, 2));
});

test('Windows 경로 대소문자는 일치시키고 Linux의 다른 이름은 합치지 않는다', async () => {
    const windows = rowsFor(['C:\\NAS\\Books\\Keep.cbz', 'c:\\nas\\books\\other.cbz']);
    let reads = 0;
    assert.deepEqual(await filterLibrarySearchFilesByPresence(windows, {
        platform: 'win32',
        readdir: async () => { reads += 1; return ['KEEP.CBZ', 'OTHER.CBZ']; },
    }), windows);
    assert.equal(reads, 1);
    const linux = rowsFor(['/NAS/Books/Keep.cbz', '/NAS/Books/keep.cbz']);
    assert.deepEqual(await filterLibrarySearchFilesByPresence(linux, {
        platform: 'linux', readdir: async () => ['Keep.cbz'],
    }), [linux[0]]);
});

test('폴더 읽기는 지정한 동시 실행 수를 넘지 않는다', async () => {
    const rows = rowsFor(Array.from({ length: 9 }, (_, index) => `/NAS/${index}/Book.cbz`));
    let active = 0;
    let peak = 0;
    const result = await filterLibrarySearchFilesByPresence(rows, {
        concurrency: 2,
        readdir: async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise(resolve => setImmediate(resolve));
            active -= 1;
            return ['Book.cbz'];
        },
    });
    assert.equal(peak, 2);
    assert.deepEqual(result, rows);
});

test('느린 NAS 조회는 제한 시간 후 기존 결과를 반환하고 추가 폴더 읽기를 중단한다', async () => {
    const rows = rowsFor(['/NAS/fast/Gone.cbz', '/NAS/slow/Book.cbz', '/NAS/queued/Book.cbz']);
    const calls = [];
    let finishSlow;
    const result = await filterLibrarySearchFilesByPresence(rows, {
        concurrency: 1,
        timeoutMs: 15,
        readdir: parent => {
            calls.push(parent);
            return parent === '/NAS/fast' ? Promise.resolve([]) : new Promise(resolve => { finishSlow = resolve; });
        },
    });
    assert.deepEqual(result, rows.slice(1));
    assert.deepEqual(calls, ['/NAS/fast', '/NAS/slow']);
    finishSlow([]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(result, rows.slice(1));
    assert.deepEqual(calls, ['/NAS/fast', '/NAS/slow']);
});

test('메타데이터·태그·내용 검색 IPC는 기존 DB 문서가 있어도 실제 폴더에 없는 결과를 반환하지 않는다', async () => {
    const source = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
    const sections = [
        ['folder:searchLibraryFiles', 'const broadcastReadingChanged'],
        ['folder:searchLibraryTags', "ipcMain.handle('folder:searchLibraryContent'"],
        ['folder:searchLibraryContent', "ipcMain.handle('folder:getContentIndexStatus'"],
    ];
    const handlers = new Map();
    const rows = rowsFor(['/NAS/Books/Gone.cbz', '/NAS/Books/Keep.cbz']);
    const calls = { filtered: 0, metadataPaths: [], closed: 0 };
    const context = {
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        configManager: { getConfig: () => ({ libraries: ['/NAS/Books'] }) },
        path,
        librarySearchService: { search: async () => rows, searchTags: async () => rows },
        contentIndexService: { search: async () => rows },
        isRetryableLibrarySearchWorkerError: () => false,
        normalizeLibrarySearchFileForRenderer: row => ({ ...row, normalized: true }),
        filterLibrarySearchFilesByPresence: async values => {
            calls.filtered += 1;
            return filterLibrarySearchFilesByPresence(values, { readdir: async () => ['Keep.cbz'] });
        },
        libraryDbPath: () => '/unused/test.db',
        LibraryDB: class {
            async getFilesByPaths(paths) { calls.metadataPaths.push(paths); return []; }
            async close() { calls.closed += 1; }
        },
    };
    for (const [name, next] of sections) {
        const start = source.indexOf(`ipcMain.handle('${name}'`);
        const end = source.indexOf(next, start + 1);
        assert.ok(start >= 0 && end > start, name);
        new Function(...Object.keys(context), source.slice(start, end))(...Object.values(context));
        const result = await handlers.get(name)({}, { query: 'Indexed', libraries: ['/NAS/Books'] });
        assert.deepEqual(result.map(row => row.path), ['/NAS/Books/Keep.cbz'], name);
        assert.equal(result[0].normalized, true);
    }
    assert.equal(calls.filtered, 3);
    assert.deepEqual(calls.metadataPaths, [['/NAS/Books/Keep.cbz']]);
    assert.equal(calls.closed, 1);
});
