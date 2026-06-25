import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { normalizeLibraryScanStateForRenderer, scanArchivePaths } from './ipcHandlers.js';

test('원본 Python library.db schema와 데이터를 그대로 읽고 갱신한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-db-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const legacy = new Database(dbPath);
        legacy.exec(`
            CREATE TABLE files (
                path TEXT PRIMARY KEY, mtime REAL, size REAL, ext TEXT, resolution TEXT,
                title TEXT, series TEXT, series_group TEXT, volume TEXT, number TEXT,
                writer TEXT, creators TEXT, publisher TEXT, imprint TEXT, genre TEXT,
                volume_count TEXT, page_count TEXT, format TEXT, manga TEXT, language TEXT,
                rating TEXT, age_rating TEXT, publish_date TEXT, summary TEXT, characters TEXT,
                teams TEXT, locations TEXT, story_arc TEXT, tags TEXT, notes TEXT, web TEXT,
                thumb_path TEXT
            );
            CREATE TABLE dup_cache (a_path TEXT PRIMARY KEY, match_data TEXT);
            CREATE TABLE dup_target_index (
                full_path TEXT PRIMARY KEY, target_folder TEXT, name TEXT, size REAL
            );
        `);
        legacy.prepare(`
            INSERT INTO files (path, mtime, size, ext, title, series, volume, page_count, thumb_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('/Books/A.cbz', 10, 100, '.cbz', 'A 1권', 'A', '1', '20', '/thumb/a.jpg');
        legacy.close();

        const library = new LibraryDB({ dbPath });
        const existing = await library.getFileInfo('/Books/A.cbz');
        assert.equal(existing.series, 'A');
        assert.equal(existing.pages, '20');
        await library.upsertFileInfo({
            filepath: '/Books/A.cbz',
            mod_date: 11,
            file_size: 120,
            title: 'A 1권 수정',
            series: 'A',
            pages: 21,
            thumbnail: '/thumb/new.jpg',
        });
        const updated = await library.getFileInfo('/Books/A.cbz');
        assert.equal(updated.mtime, 11);
        assert.equal(updated.mod_date, 11);
        assert.equal(updated.filepath, '/Books/A.cbz');
        assert.equal(updated.file_size, 120);
        assert.equal(updated.title, 'A 1권 수정');
        assert.equal(updated.thumbnail, '/thumb/new.jpg');
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('files format 컬럼은 파일 확장자 값을 저장하지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-format-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const library = new LibraryDB({ dbPath });
        await library.upsertFileInfo({
            path: '/Books/Extension.cbz',
            ext: '.cbz',
            title: 'Extension',
            format: 'CBZ',
        });
        await library.upsertFileInfo({
            path: '/Books/Dotted.zip',
            ext: '.zip',
            title: 'Dotted',
            format: '.zip',
        });
        await library.upsertFileInfo({
            path: '/Books/Epub.epub',
            ext: '.epub',
            title: 'Epub',
            format: 'EPUB',
        });
        await library.upsertFileInfo({
            path: '/Books/WebComic.cbz',
            ext: '.cbz',
            title: 'WebComic',
            format: 'WebComic',
        });

        assert.equal((await library.getFileInfo('/Books/Extension.cbz')).format, '');
        assert.equal((await library.getFileInfo('/Books/Dotted.zip')).format, '');
        assert.equal((await library.getFileInfo('/Books/Epub.epub')).format, '');
        assert.equal((await library.getFileInfo('/Books/WebComic.cbz')).format, 'WebComic');
        await library.close();

        const raw = new Database(dbPath);
        raw.prepare('UPDATE files SET format = ? WHERE path = ?').run('RAR', '/Books/WebComic.cbz');
        raw.close();

        const reopened = new LibraryDB({ dbPath });
        assert.equal((await reopened.getFileInfo('/Books/WebComic.cbz')).format, '');
        await reopened.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 파일 검색은 등록된 라이브러리 안의 메타데이터와 경로만 조회한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-search-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const firstLibrary = path.join(root, 'LibraryA');
        const secondLibrary = path.join(root, 'LibraryB');
        const outsideLibrary = path.join(root, 'Outside');
        fs.mkdirSync(path.join(firstLibrary, '마법 폴더'), { recursive: true });
        fs.mkdirSync(secondLibrary, { recursive: true });
        fs.mkdirSync(outsideLibrary, { recursive: true });

        const insidePath = path.join(firstLibrary, '마법 폴더', 'Inside.cbz');
        const secondPath = path.join(secondLibrary, 'Other.cbz');
        const outsidePath = path.join(outsideLibrary, 'Outside.cbz');
        const library = new LibraryDB({ dbPath });
        await library.upsertFileInfo({
            path: insidePath,
            title: '검색 대상',
            series: '마법 시리즈',
            writer: '테스트 작가',
            summary: '등록 라이브러리 검색용 메타데이터',
        });
        await library.upsertFileInfo({
            path: secondPath,
            title: '검색 대상',
            series: '두 번째 라이브러리',
        });
        await library.upsertFileInfo({
            path: outsidePath,
            title: '검색 대상',
            series: '범위 밖',
        });

        const metadataRows = await library.searchFiles('검색용', [firstLibrary], { limit: 10 });
        assert.deepEqual(metadataRows.map(row => row.path), [insidePath]);

        const folderRows = await library.searchFiles('마법 폴더', [firstLibrary], { limit: 10 });
        assert.deepEqual(folderRows.map(row => row.path), [insidePath]);

        const scopedRows = await library.searchFiles('검색 대상', [firstLibrary, secondLibrary], { limit: 10 });
        assert.deepEqual(scopedRows.map(row => row.path).sort(), [insidePath, secondPath].sort());
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('과도기 file_info, target_index, dup_match schema를 원본 schema로 이관한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-migrate-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const old = new Database(dbPath);
        old.exec(`
            CREATE TABLE file_info (
                path TEXT PRIMARY KEY, size INTEGER, ext TEXT, mod_date REAL,
                meta_title TEXT, meta_volume TEXT, meta_chapter TEXT, meta_pages INTEGER,
                meta_creator TEXT, thumb_path TEXT, series_name TEXT
            );
            CREATE TABLE target_index (
                target_folder TEXT, file_path TEXT, UNIQUE(target_folder, file_path)
            );
            CREATE TABLE dup_match (
                a_path TEXT PRIMARY KEY, match_path TEXT, match_score REAL, match_time TEXT
            );
        `);
        old.prepare('INSERT INTO file_info VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            '/Books/B.cbz', 200, '.cbz', 20, 'B 2권', '2', '', 30, 'Writer', '/thumb/b.jpg', 'B',
        );
        old.prepare('INSERT INTO target_index VALUES (?, ?)').run('/Books', '/Books/B.cbz');
        old.prepare('INSERT INTO dup_match VALUES (?, ?, ?, ?)').run('/A.cbz', '/Books/B.cbz', 0.9, 'now');
        old.close();

        const library = new LibraryDB({ dbPath });
        assert.equal((await library.getFileInfo('/Books/B.cbz')).series, 'B');
        assert.equal((await library.getTargetIndex('/Books'))[0].full_path, '/Books/B.cbz');
        assert.equal((await library.getDupMatch('/A.cbz')).match_path, '/Books/B.cbz');
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('과도기 file_info filepath alias를 원본 files schema로 이관한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-filepath-migrate-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const old = new Database(dbPath);
        old.exec(`
            CREATE TABLE file_info (
                filepath TEXT PRIMARY KEY, file_size INTEGER, ext TEXT, mod_date REAL,
                meta_title TEXT, meta_volume TEXT, meta_chapter TEXT, meta_pages INTEGER,
                meta_creator TEXT, thumbnail TEXT, series_name TEXT
            );
        `);
        old.prepare('INSERT INTO file_info VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
            '/Books/Alias.cbz', 300, '.cbz', 30, 'Alias Title', '1', '', 42, 'Alias Writer', '/thumb/alias.jpg', 'Alias Series',
        );
        old.close();

        const library = new LibraryDB({ dbPath });
        const migrated = await library.getFileInfo('/Books/Alias.cbz');
        assert.equal(migrated.series, 'Alias Series');
        assert.equal(migrated.title, 'Alias Title');
        assert.equal(migrated.file_size, 300);
        assert.equal(migrated.thumbnail, '/thumb/alias.jpg');
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('대상 인덱스 교체는 신규·수정·삭제 파일 상태를 반영한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-index-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const folder = path.join(root, 'Books');
        fs.mkdirSync(folder);
        const first = path.join(folder, 'A.cbz');
        const removed = path.join(folder, 'Removed.cbz');
        fs.writeFileSync(first, 'a');
        fs.writeFileSync(removed, 'old');
        const library = new LibraryDB({ dbPath });
        await library.replaceTargetIndex(folder, [first, removed]);
        fs.writeFileSync(first, 'updated');
        fs.rmSync(removed);
        const added = path.join(folder, 'B.cbz');
        fs.writeFileSync(added, 'b');
        await library.replaceTargetIndex(folder, [first, added]);
        const rows = await library.getTargetIndex(folder);
        assert.deepEqual(rows.map(row => row.full_path).sort(), [first, added].sort());
        assert.equal(rows.find(row => row.full_path === first).size, 7);
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('대상 인덱스 증분 동기화는 추가·수정·삭제만 반영한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-sync-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const folder = path.join(root, 'Books');
        fs.mkdirSync(folder);
        const first = path.join(folder, 'A.cbz');
        const second = path.join(folder, 'B.cbz');
        fs.writeFileSync(first, 'a');
        fs.writeFileSync(second, 'b');
        const entryFor = filePath => {
            const stat = fs.statSync(filePath);
            return {
                full_path: filePath,
                target_folder: folder,
                name: path.basename(filePath),
                size: stat.size,
                mtime: stat.mtimeMs,
            };
        };

        const library = new LibraryDB({ dbPath });
        const initial = await library.syncTargetIndex(folder, [entryFor(first), entryFor(second)]);
        assert.equal(initial.addedCount, 2);
        assert.equal(initial.updatedCount, 0);
        assert.equal(initial.removedCount, 0);

        const unchanged = await library.syncTargetIndex(folder, [entryFor(first), entryFor(second)]);
        assert.equal(unchanged.addedCount, 0);
        assert.equal(unchanged.updatedCount, 0);
        assert.equal(unchanged.removedCount, 0);
        assert.equal(unchanged.unchangedCount, 2);

        fs.writeFileSync(first, 'updated');
        const third = path.join(folder, 'C.cbz');
        fs.writeFileSync(third, 'c');
        const changed = await library.syncTargetIndex(folder, [entryFor(first), entryFor(third)]);
        assert.equal(changed.addedCount, 1);
        assert.equal(changed.updatedCount, 1);
        assert.equal(changed.removedCount, 1);
        const rows = await library.getTargetIndex(folder);
        assert.deepEqual(rows.map(row => row.full_path).sort(), [first, third].sort());
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 이동 인덱스 반영은 전체 교체 없이 이동한 경로만 갱신한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-move-index-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const sourceDir = path.join(root, 'source');
        const libraryDir = path.join(root, 'library');
        const existing = path.join(libraryDir, 'Existing.cbz');
        const source = path.join(sourceDir, 'Moved.cbz');
        const dest = path.join(libraryDir, 'Moved.cbz');
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(existing, 'existing');
        fs.writeFileSync(source, 'moved');

        const library = new LibraryDB({ dbPath });
        const existingStat = fs.statSync(existing);
        await library.syncTargetIndex(libraryDir, [{
            full_path: existing,
            target_folder: libraryDir,
            name: path.basename(existing),
            size: existingStat.size,
            mtime: existingStat.mtimeMs,
        }]);
        await library.saveLibraryScanState({
            library_path: libraryDir,
            status: 'ready',
            fingerprint: 'sha1:1:existing',
            file_count: 1,
            indexed_count: 1,
            last_scanned_at: '2026-06-25T00:00:00.000Z',
            last_checked_at: '2026-06-25T00:00:00.000Z',
        });
        await library.upsertFileInfo({
            path: source,
            title: 'Moved Title',
            series: 'Moved Series',
        });

        fs.renameSync(source, dest);
        const movedStat = fs.statSync(dest);
        const result = await library.applyLibraryMoveIndexChanges({
            targetEntries: [{
                full_path: dest,
                target_folder: libraryDir,
                name: path.basename(dest),
                size: movedStat.size,
                mtime: movedStat.mtimeMs,
            }],
            fileInfoMoves: [{ src: source, dest }],
            touchedLibraries: [libraryDir],
        });

        assert.equal(result.savedTargetCount, 1);
        assert.equal(result.movedFileInfoCount, 1);
        const rows = await library.getTargetIndex(libraryDir);
        assert.deepEqual(rows.map(row => row.full_path).sort(), [existing, dest].sort());
        assert.equal((await library.getFileInfo(dest)).series, 'Moved Series');
        assert.equal(await library.getFileInfo(source), null);
        const state = await library.getLibraryScanState(libraryDir);
        assert.equal(state.status, 'ready');
        assert.equal(state.indexed_count, 2);
        assert.equal(state.scan_reason, 'move');
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 스캔 상태를 저장하고 기본 상태를 조회한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-state-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const folder = path.join(root, 'Books');
        const emptyFolder = path.join(root, 'Empty');
        fs.mkdirSync(folder);
        fs.mkdirSync(emptyFolder);
        const library = new LibraryDB({ dbPath });
        await library.saveLibraryScanState({
            library_path: folder,
            status: 'ready',
            fingerprint: 'abc',
            file_count: 3,
            indexed_count: 3,
            added_count: 1,
            updated_count: 2,
            removed_count: 0,
            last_scanned_at: '2026-06-21T00:00:00.000Z',
            last_checked_at: '2026-06-21T00:00:00.000Z',
        });

        const saved = await library.getLibraryScanState(folder);
        assert.equal(saved.status, 'ready');
        assert.equal(saved.file_count, 3);
        assert.equal(saved.added_count, 1);

        const states = await library.getLibraryScanStates([folder, emptyFolder]);
        assert.equal(states.find(state => state.library_path === folder).fingerprint, 'abc');
        assert.equal(states.find(state => state.library_path === emptyFolder).status, 'idle');
        await library.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 인덱싱 경로 수집은 dot-folder 안의 책 파일을 제외한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-hidden-folder-'));
    const libraryDir = path.join(root, 'library');
    const hiddenDir = path.join(libraryDir, '.yacreaderlibrary');

    try {
        fs.mkdirSync(hiddenDir, { recursive: true });
        const visiblePath = path.join(libraryDir, 'Visible Book.cbz');
        const hiddenPath = path.join(hiddenDir, 'Hidden Book.cbz');
        fs.writeFileSync(visiblePath, '');
        fs.writeFileSync(hiddenPath, '');

        const paths = await scanArchivePaths(libraryDir);

        assert.deepEqual(paths, [visiblePath]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 인덱싱 경로 수집은 폴더 스캔과 같은 대상 확장자를 사용한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-target-exts-'));
    const libraryDir = path.join(root, 'library');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        const expected = [
            'Book.cbz',
            'Comic.cbr',
            'Archive.zip',
            'Bundle.7z',
            'Pack.cb7',
            'Document.pdf',
            'Novel.epub',
            'Notes.txt',
        ].map(name => path.join(libraryDir, name));
        for (const filePath of expected) fs.writeFileSync(filePath, '');
        fs.writeFileSync(path.join(libraryDir, 'Ignored.md'), '');

        const paths = await scanArchivePaths(libraryDir);

        assert.deepEqual(paths.sort(), expected.sort());
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 인덱싱 경로 수집 완료 콜백은 대상 파일에만 호출된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-match-callback-'));
    const libraryDir = path.join(root, 'library');
    const hiddenDir = path.join(libraryDir, '.yacreaderlibrary');

    try {
        fs.mkdirSync(hiddenDir, { recursive: true });
        const visiblePath = path.join(libraryDir, 'Visible Book.cbz');
        const textPath = path.join(libraryDir, 'Notes.txt');
        fs.writeFileSync(visiblePath, '');
        fs.writeFileSync(textPath, '');
        fs.writeFileSync(path.join(libraryDir, 'Ignored.md'), '');
        fs.writeFileSync(path.join(hiddenDir, 'Hidden Book.cbz'), '');
        const matched = [];

        const paths = await scanArchivePaths(libraryDir, '', null, null, filePath => {
            matched.push(filePath);
        });

        assert.deepEqual(paths.sort(), [visiblePath, textPath].sort());
        assert.deepEqual(matched.sort(), [visiblePath, textPath].sort());
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 렌더러 상태는 fingerprint가 있으면 루트 mtime만으로 업데이트 필요 처리하지 않는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-render-state-'));
    const libraryDir = path.join(root, 'library');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        const state = normalizeLibraryScanStateForRenderer(libraryDir, {
            status: 'ready',
            fingerprint: 'stable',
            root_mtime: 0,
            last_scanned_at: '2026-06-21T00:00:00.000Z',
            last_checked_at: '2026-06-21T00:00:00.000Z',
        }, true);

        assert.equal(state.changedSinceScan, false);
        assert.equal(state.needsScan, false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 렌더러 상태는 중단된 스캔을 수동 갱신 대상으로 표시한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-cancel-state-'));
    const libraryDir = path.join(root, 'library');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        const state = normalizeLibraryScanStateForRenderer(libraryDir, {
            status: 'cancelled',
            fingerprint: 'stable',
            root_mtime: 0,
            last_scanned_at: '2026-06-21T00:00:00.000Z',
            last_checked_at: '2026-06-21T00:01:00.000Z',
        }, true);

        assert.equal(state.status, 'cancelled');
        assert.equal(state.needsScan, true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
