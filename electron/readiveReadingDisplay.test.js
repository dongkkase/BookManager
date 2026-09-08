import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { exchangeReading } from './readive/reading.js';
import { createViewerStatusReader, readViewerFileStatus, viewerReadingProgressParts } from '../src/viewerStatusState.js';

async function fixture(t, format = 'text') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'readive-reading-display-'));
    const libraryDb = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    t.after(async () => {
        await libraryDb.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const filePath = path.join(root, format === 'audio' ? 'book.mp3' : 'book.txt');
    const contentHash = 'b'.repeat(64);
    const device = { id: 'phone-display-fixture' };
    const state = {
        serverId: 'pc-display-fixture',
        items: {
            [contentHash]: { itemId: 'display-book', contentHash, sourcePath: filePath, format, deviceIds: [device.id] },
        },
        reading: {},
        appliedReadings: {},
    };
    const timestamp = new Date(Date.now() - 60000).toISOString();
    const record = {
        itemId: 'display-book', contentHash, deviceId: device.id, revision: 1,
        updatedAt: timestamp, lastReadAt: timestamp, readStatus: 'reading',
        locator: { kind: 'normalized', normalizedPosition: 8 / 197, pageIndex: 8, pageCount: 198 },
    };
    return { libraryDb, filePath, device, state, record };
}

function storageWith(entries) {
    const values = new Map(entries);
    return {
        length: values.size,
        key: index => Array.from(values.keys())[index] ?? null,
        getItem: key => values.get(key) ?? null,
        setItem: () => assert.fail('display must not rewrite local viewer settings or bookmarks'),
    };
}

test('a synced mobile position appears equally in recent reading and ordinary folder badges without changing stored records', async t => {
    const { libraryDb, filePath, device, state, record } = await fixture(t);
    await exchangeReading(state, device, [record], libraryDb);
    const db = libraryDb.getConnection();
    const before = db.prepare('SELECT * FROM reading_states ORDER BY file_path').all();
    const [folderReading] = await libraryDb.listReadingStatesByPaths([filePath]);
    const [recentReading] = await libraryDb.listRecentReadingStates();
    const emptyStorage = storageWith([]);
    const reader = createViewerStatusReader(emptyStorage);
    const folderFile = { path: filePath, type: 'file', page_count: 1, readingState: folderReading };
    const folderStatus = reader(folderFile);
    const recentStatus = readViewerFileStatus({ ...folderFile, readingState: recentReading }, emptyStorage);
    assert.deepEqual(folderStatus, recentStatus);
    assert.equal(folderStatus.hasReadingProgress, true);
    assert.equal(folderStatus.isAudio, false, 'SQLite audio defaults must not turn a text book into audio');
    assert.equal(folderStatus.isCompleted, false, 'PC text pagination must not mark mobile progress as complete');
    assert.deepEqual(viewerReadingProgressParts(folderStatus), { percentText: '4%', pageText: '' });
    assert.deepEqual(db.prepare('SELECT * FROM reading_states ORDER BY file_path').all(), before);

    const next = {
        ...record, revision: 2,
        updatedAt: new Date(Date.now() - 30000).toISOString(),
        locator: { kind: 'normalized', normalizedPosition: 4 / 165, pageIndex: 4, pageCount: 166 },
    };
    await exchangeReading(state, device, [next], libraryDb);
    const [nextReading] = await libraryDb.listReadingStatesByPaths([filePath]);
    assert.equal(reader({ ...folderFile, readingState: nextReading }).percent, 2, 'the next refresh displays the latest position even when the reader is reused');
});

test('synced display retains PC bookmarks and respects a newer PC viewer position without modifying either source', async t => {
    const { libraryDb, filePath, device, state, record } = await fixture(t);
    await exchangeReading(state, device, [record], libraryDb);
    const [readingState] = await libraryDb.listReadingStatesByPaths([filePath]);
    const file = { path: filePath, type: 'file', page_count: 100, readingState };
    const databaseTime = Date.parse(readingState.updatedAt);
    const makeStorage = offset => storageWith([
        [`bookmanager-viewer-state:${filePath}`, JSON.stringify({ pageIndex: 49, pageCount: 100, updatedAt: databaseTime + offset, theme: 'dark' })],
        [`bookmanager-viewer-bookmarks:${filePath}`, JSON.stringify([{ pageIndex: 3 }, { pageIndex: 20 }])],
    ]);
    const older = createViewerStatusReader(makeStorage(-1000))(file);
    const newer = createViewerStatusReader(makeStorage(1000))(file);
    assert.equal(older.percent, 4);
    assert.equal(newer.percent, 50);
    assert.equal(older.bookmarkCount, 2);
    assert.equal(newer.bookmarkCount, 2);
    assert.equal(newer.hasBookmarks, true);
    assert.deepEqual(await libraryDb.listReadingStatesByPaths([filePath]), [readingState]);
});

test('synced explicit unread, completed and audio positions retain their meaning in the displayed status', async t => {
    const { libraryDb, filePath, device, state, record } = await fixture(t, 'audio');
    const cases = [
        { readStatus: 'reading', position: 90, progress: true, completed: false, percent: 50 },
        { readStatus: 'unread', position: 0, progress: false, completed: false, percent: 0 },
        { readStatus: 'completed', position: 180, progress: true, completed: true, percent: 100 },
    ];
    for (const [index, entry] of cases.entries()) {
        const timestamp = new Date(Date.now() - 50000 + index * 1000).toISOString();
        await exchangeReading(state, device, [{
            ...record, revision: index + 1, updatedAt: timestamp, lastReadAt: timestamp,
            readStatus: entry.readStatus,
            locator: { kind: 'audio-time', positionSeconds: entry.position, durationSeconds: 180 },
        }], libraryDb);
        const [readingState] = await libraryDb.listReadingStatesByPaths([filePath]);
        const status = readViewerFileStatus({ path: filePath, readingState }, storageWith([]));
        assert.equal(status.isAudio, true);
        assert.equal(status.hasReadingProgress, entry.progress);
        assert.equal(status.isCompleted, entry.completed);
        assert.equal(status.percent, entry.percent);
        if (!entry.progress) assert.deepEqual(viewerReadingProgressParts(status), { percentText: '', pageText: '' });
    }
});
