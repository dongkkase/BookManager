import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { LibraryDB } from './database/library_db.js';

class ObservedLibraryDB extends LibraryDB {
    sanitizeFormatColumn() {
        this.formatStatements = [];
        const prepare = this.db.prepare;
        this.db.prepare = sql => {
            this.formatStatements.push(sql);
            return prepare.call(this.db, sql);
        };
        try {
            return super.sanitizeFormatColumn();
        } finally {
            this.db.prepare = prepare;
        }
    }
}

test('format migration skips full-table updates on repeated connections and detects external invalid writes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-format-migration-'));
    const dbPath = path.join(root, 'library.db');
    let library;
    let external;
    try {
        library = new ObservedLibraryDB({ dbPath });
        await library.upsertFileInfo({ path: '/books/one.cbz', format: 'WebComic', title: 'First' });
        assert.equal(library.formatStatements.some(sql => /UPDATE files SET format/.test(sql)), true);
        await library.close();
        library = new ObservedLibraryDB({ dbPath });
        await library.initDB();
        assert.equal(library.formatStatements.some(sql => /UPDATE files SET format/.test(sql)), false);
        await library.close();

        external = new Database(dbPath);
        external.prepare("UPDATE files SET format = '.rAr' WHERE path = ?").run('/books/one.cbz');
        external.close();
        external = null;
        library = new ObservedLibraryDB({ dbPath });
        const db = library.getConnection();
        assert.equal(db.prepare('SELECT format FROM files').get().format, '');
        assert.equal(library.formatStatements.some(sql => /UPDATE files SET format/.test(sql)), true);
        await library.close();

        external = new Database(dbPath);
        external.prepare('INSERT INTO files(path, format) VALUES (?, ?)').run('/books/two.epub', 'EPUB');
        external.close();
        external = null;
        library = new ObservedLibraryDB({ dbPath });
        assert.equal(library.getConnection().prepare('SELECT format FROM files WHERE path = ?').get('/books/two.epub').format, '');
        await library.close();

        external = new Database(dbPath);
        external.exec('DROP TRIGGER files_format_dirty_ai');
        external.prepare('INSERT INTO files(path, format) VALUES (?, ?)').run('/books/three.cbz', 'ZIP');
        external.close();
        external = null;
        library = new ObservedLibraryDB({ dbPath });
        assert.equal(library.getConnection().prepare('SELECT format FROM files WHERE path = ?').get('/books/three.cbz').format, '');
    } finally {
        external?.close();
        await library?.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
