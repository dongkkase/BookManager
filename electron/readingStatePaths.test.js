import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-paths-'));
    const library = new LibraryDB({ dbPath: path.join(root, 'library.db'), platform: 'darwin' });
    const readers = [];
    t.after(async () => {
        for (const reader of readers) await reader.close();
        await library.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    return { root, library, readers };
}

test('path lookup returns old reading progress beyond recent-list limits without requiring source files', async t => {
    const { root, library } = fixture(t);
    const oldestPath = path.join(root, 'oldest.txt');
    const oldest = await library.upsertReadingState(oldestPath, {
        format: 'text', pageIndex: 37, pageCount: 100, scrollPercent: 37.5,
        locator: { kind: 'normalized', normalizedPosition: 0.375, pageIndex: 37, pageCount: 100 },
        status: 'reading', lastReadAt: '2026-01-01T00:00:00.000Z',
    });
    for (let index = 0; index < 205; index += 1) {
        await library.upsertReadingState(path.join(root, `recent-${index}.pdf`), { format: 'pdf', pageIndex: 1, pageCount: 10 });
    }
    assert.equal((await library.listRecentReadingStates(200)).some(row => row.filePath === oldestPath), false);
    assert.equal(fs.existsSync(oldestPath), false);
    const before = library.getConnection().prepare('SELECT * FROM reading_states ORDER BY file_path').all();
    const rows = await library.listReadingStatesByPaths([oldestPath, path.join(root, 'unknown.txt')]);
    assert.deepEqual(rows, [oldest]);
    assert.equal(rows[0].scrollPercent, 37.5);
    assert.deepEqual(library.getConnection().prepare('SELECT * FROM reading_states ORDER BY file_path').all(), before, 'lookup changes no timestamps, revisions or deletion state');
});

test('path lookup normalizes unicode, deduplicates aliases and preserves request order while excluding soft deletion', async t => {
    const { root, library } = fixture(t);
    const firstPath = path.join(root, '첫번째.pdf');
    const secondPath = path.join(root, '두번째.mp3');
    const deletedPath = path.join(root, '삭제.pdf');
    const first = await library.upsertReadingState(firstPath, { format: 'pdf', status: 'unread', pageIndex: 0 });
    const second = await library.upsertReadingState(secondPath, { format: 'audio', positionSeconds: 45, durationSeconds: 90 });
    await library.upsertReadingState(deletedPath, { format: 'pdf' });
    await library.removeReadingState(deletedPath);
    const rows = await library.listReadingStatesByPaths([secondPath, firstPath.normalize('NFC'), firstPath.normalize('NFD'), deletedPath]);
    assert.deepEqual(rows, [second, first]);
    assert.equal(rows[1].status, 'unread');
    assert.equal(rows[0].positionSeconds, 45);
});

test('path lookup rejects invalid or oversized queries before opening SQLite', async t => {
    const { root, library } = fixture(t);
    const good = path.join(root, 'book.txt');
    let opens = 0;
    const original = library.getConnection.bind(library);
    library.getConnection = () => { opens += 1; return original(); };
    for (const invalid of [null, undefined, {}, good, [null], [23], [''], ['relative.txt'], [good + '\u0000x'], ['/' + 'a'.repeat(32768)], Array.from({ length: 501 }, () => good)]) {
        await assert.rejects(library.listReadingStatesByPaths(invalid), /invalid_reading_paths/);
    }
    assert.deepEqual(await library.listReadingStatesByPaths([]), []);
    assert.equal(opens, 0);
    assert.deepEqual(await library.listReadingStatesByPaths(Array.from({ length: 500 }, () => good)), []);
    assert.equal(opens, 1);
});

test('read-only reading lookup skips legacy migration and preserves the complete SQLite contents', async t => {
    const { root, library, readers } = fixture(t);
    const filePath = path.join(root, 'book.txt');
    const stored = await library.upsertReadingState(filePath, { format: 'text', scrollPercent: 43, locator: { kind: 'normalized', normalizedPosition: 0.43 } });
    const connection = library.getConnection();
    connection.exec("CREATE TABLE file_info (path TEXT, title TEXT); INSERT INTO file_info VALUES ('/synthetic/legacy.txt', 'legacy');");
    const before = connection.serialize();
    const reader = new LibraryDB({ dbPath: path.join(root, 'library.db'), platform: 'darwin', readOnly: true });
    readers.push(reader);
    assert.deepEqual(await reader.listReadingStatesByPaths([filePath]), [stored]);
    assert.equal(reader.getConnection().readonly, true);
    assert.throws(() => reader.getConnection().prepare("DELETE FROM reading_states").run(), /readonly/i);
    assert.deepEqual(connection.serialize(), before);
    assert.equal(connection.prepare("SELECT COUNT(*) AS count FROM files WHERE path = '/synthetic/legacy.txt'").get().count, 0);
});

test('read-only lookup never creates a missing DB or adds tables to a legacy database', async t => {
    const { root, library, readers } = fixture(t);
    const missing = path.join(root, 'missing', 'library.db');
    const absentReader = new LibraryDB({ dbPath: missing, readOnly: true });
    readers.push(absentReader);
    await assert.rejects(absentReader.listReadingStatesByPaths([path.join(root, 'book.pdf')]));
    assert.equal(fs.existsSync(path.dirname(missing)), false);
    const connection = library.getConnection();
    connection.exec('DROP TABLE reading_states');
    const before = connection.serialize();
    const reader = new LibraryDB({ dbPath: path.join(root, 'library.db'), readOnly: true });
    readers.push(reader);
    assert.deepEqual(await reader.listReadingStatesByPaths([path.join(root, 'book.pdf')]), []);
    assert.deepEqual(connection.serialize(), before);
});
