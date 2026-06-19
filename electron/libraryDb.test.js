import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';

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
        assert.equal(updated.title, 'A 1권 수정');
        assert.equal(updated.thumbnail, '/thumb/new.jpg');
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
