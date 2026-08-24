import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';

test('읽기 상태는 동기화 식별자와 리비전을 유지하며 최근 순서로 조회된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-reading-state-'));
    const library = new LibraryDB({ dbPath: path.join(root, 'library.db'), platform: 'linux' });
    try {
        const firstPath = path.join(root, '첫 번째.epub');
        const secondPath = path.join(root, '두 번째.cbz');
        const first = await library.upsertReadingState(firstPath, {
            format: 'epub',
            pageIndex: 3,
            pageCount: 100,
            lastReadAt: '2026-08-22T10:00:00.000Z',
        });
        const second = await library.upsertReadingState(secondPath, {
            format: 'comic',
            pageIndex: 8,
            pageCount: 10,
            lastReadAt: '2026-08-23T10:00:00.000Z',
        });

        assert.match(first.itemId, /^[0-9a-f-]{36}$/i);
        assert.match(first.deviceId, /^[0-9a-f-]{36}$/i);
        assert.equal(first.revision, 1);
        assert.equal(first.status, 'reading');
        assert.equal(second.status, 'reading');
        assert.deepEqual(
            (await library.listRecentReadingStates()).map(state => state.filePath),
            [secondPath, firstPath],
        );

        const updated = await library.upsertReadingState(firstPath, {
            pageIndex: 99,
            pageCount: 100,
            lastReadAt: '2026-08-24T10:00:00.000Z',
            locator: { kind: 'epub', href: 'chapter-3.xhtml', offset: 12 },
        });
        assert.equal(updated.itemId, first.itemId);
        assert.equal(updated.deviceId, first.deviceId);
        assert.equal(updated.revision, 2);
        assert.equal(updated.status, 'completed');
        assert.deepEqual(updated.locator, { kind: 'epub', href: 'chapter-3.xhtml', offset: 12 });
        assert.equal((await library.listRecentReadingStates())[0].filePath, firstPath);
    } finally {
        await library.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('최근 읽음 삭제는 소프트 삭제되고 다시 열면 같은 항목으로 복원된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-reading-state-delete-'));
    const library = new LibraryDB({ dbPath: path.join(root, 'library.db'), platform: 'linux' });
    try {
        const firstPath = path.join(root, '첫 번째.pdf');
        const secondPath = path.join(root, '두 번째.mp3');
        const first = await library.upsertReadingState(firstPath, { format: 'pdf' });
        await library.upsertReadingState(secondPath, {
            format: 'audio',
            positionSeconds: 30,
            durationSeconds: 60,
        });

        assert.equal((await library.removeReadingState(firstPath)).changes, 1);
        assert.deepEqual(
            (await library.listRecentReadingStates()).map(state => state.filePath),
            [secondPath],
        );
        const restored = await library.upsertReadingState(firstPath, { format: 'pdf' });
        assert.equal(restored.itemId, first.itemId);
        assert.equal(restored.revision, 3);

        assert.equal((await library.clearReadingStates()).changes, 2);
        assert.deepEqual(await library.listRecentReadingStates(), []);
        const deletedRows = library.getConnection().prepare(`
            SELECT item_id, deleted_at, revision
            FROM reading_states
            ORDER BY file_path
        `).all();
        assert.equal(deletedRows.length, 2);
        assert.equal(deletedRows.every(row => Boolean(row.deleted_at)), true);
    } finally {
        await library.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
