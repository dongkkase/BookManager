import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ContentIndexDB } from './database/content_index_db.js';

function createTestIndex(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return {
        root,
        dbPath: path.join(root, 'content-index.db'),
        index: new ContentIndexDB({ dbPath: path.join(root, 'content-index.db') }),
    };
}

async function closeAndRemove(index, root) {
    await index?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
}

test('content index는 contentless unicode61 FTS와 문서 상태 schema를 만든다', async () => {
    const { root, dbPath, index } = createTestIndex('bookmanager-content-schema-');
    try {
        const libraryPath = path.join(root, 'Library');
        const filePath = path.join(libraryPath, 'Book.txt');
        const saved = await index.upsertDocumentTokens({
            path: filePath,
            library_path: libraryPath,
            size: 123,
            mtime: 456,
            ext: '.txt',
            status: 'ok',
            extractor_version: 2,
        }, 'alpha beta');

        assert.equal(saved.path, path.resolve(filePath));
        assert.equal(saved.library_path, path.resolve(libraryPath));
        assert.equal(saved.token_count, 2);
        assert.equal(saved.status, 'ok');

        const raw = new Database(dbPath, { readonly: true });
        try {
            const columns = raw.prepare('PRAGMA table_info(documents)').all().map(row => row.name);
            assert.deepEqual(columns, [
                'document_id',
                'path',
                'library_path',
                'size',
                'mtime',
                'ext',
                'status',
                'error',
                'token_count',
                'indexed_at',
                'extractor_version',
            ]);
            const ftsSql = raw.prepare(`
                SELECT sql FROM sqlite_master
                WHERE type = 'table' AND name = 'document_terms_fts'
            `).get().sql;
            assert.match(ftsSql, /content\s*=\s*''/i);
            assert.match(ftsSql, /contentless_delete\s*=\s*1/i);
            assert.match(ftsSql, /detail\s*=\s*none/i);
            assert.match(ftsSql, /tokenize\s*=\s*'unicode61'/i);
            assert.equal(
                raw.prepare('SELECT tokens FROM document_terms_fts WHERE rowid = ?').get(saved.document_id).tokens,
                null,
            );
        } finally {
            raw.close();
        }
    } finally {
        await closeAndRemove(index, root);
    }
});

test('content index 검색은 모든 literal word token과 library scope를 적용한다', async () => {
    const { root, index } = createTestIndex('bookmanager-content-search-');
    try {
        const firstLibrary = path.join(root, 'LibraryA');
        const secondLibrary = path.join(root, 'LibraryB');
        const firstPath = path.join(firstLibrary, 'First.txt');
        const secondPath = path.join(firstLibrary, 'Second.txt');
        const otherPath = path.join(secondLibrary, 'Other.txt');
        await index.upsertDocumentTokens({
            path: firstPath,
            library_path: firstLibrary,
            status: 'ok',
        }, 'alpha beta or 책 go magic 마법은 학교에서');
        await index.upsertDocumentTokens({
            path: secondPath,
            library_path: firstLibrary,
            status: 'ready',
        }, ['alpha', 'beta', 'beta']);
        await index.upsertDocumentTokens({
            path: otherPath,
            library_path: secondLibrary,
            status: 'truncated',
        }, 'alpha beta or');

        assert.deepEqual(
            (await index.search('alpha beta', [firstLibrary, firstLibrary])).map(row => row.path),
            [path.resolve(firstPath), path.resolve(secondPath)],
        );
        assert.deepEqual(
            (await index.search('alpha OR beta', [firstLibrary])).map(row => row.path),
            [path.resolve(firstPath)],
        );
        assert.deepEqual(
            (await index.search('책', [firstLibrary])).map(row => row.path),
            [path.resolve(firstPath)],
        );
        assert.deepEqual(
            (await index.search('go', [firstLibrary])).map(row => row.path),
            [path.resolve(firstPath)],
        );
        assert.deepEqual(
            (await index.search('mag', [firstLibrary])).map(row => row.path),
            [path.resolve(firstPath)],
        );
        assert.deepEqual(
            (await index.search('마법 학', [firstLibrary])).map(row => row.path),
            [path.resolve(firstPath)],
        );
        assert.deepEqual(await index.search('agic', [firstLibrary]), []);
        assert.deepEqual(await index.search('%_"', [firstLibrary]), []);
        assert.deepEqual(await index.search('alpha', []), []);
        assert.equal((await index.search('alpha', [firstLibrary], { limit: 1 })).length, 1);
        assert.deepEqual(
            (await index.search(['alpha', 'beta'], [secondLibrary])).map(row => row.path),
            [path.resolve(otherPath)],
        );
    } finally {
        await closeAndRemove(index, root);
    }
});

test('문서 token 교체와 실패 처리는 이전 posting을 원자적으로 제거한다', async () => {
    const { root, index } = createTestIndex('bookmanager-content-update-');
    try {
        const libraryPath = path.join(root, 'Library');
        const filePath = path.join(libraryPath, 'Changing.txt');
        const first = await index.upsertDocumentTokens({
            path: filePath,
            library_path: libraryPath,
            status: 'ready',
            mtime: 1,
        }, 'oldword common');
        const updated = await index.upsertDocumentTokens({
            path: filePath,
            library_path: libraryPath,
            status: 'truncated',
            mtime: 2,
            error: 'size limit',
        }, 'newword common');

        assert.equal(updated.document_id, first.document_id);
        assert.equal(updated.status, 'truncated');
        assert.deepEqual(await index.search('oldword', [libraryPath]), []);
        assert.deepEqual(
            (await index.search('newword', [libraryPath])).map(row => row.path),
            [path.resolve(filePath)],
        );

        const failed = await index.markDocumentFailed({
            path: filePath,
            status: 'ready',
            mtime: 3,
        }, new Error('decode failed'));
        assert.equal(failed.document_id, first.document_id);
        assert.equal(failed.status, 'failed');
        assert.equal(failed.error, 'decode failed');
        assert.equal(failed.token_count, 0);
        assert.deepEqual(await index.search('newword', [libraryPath]), []);

        const status = await index.getStatus([libraryPath]);
        assert.equal(status.totalCount, 1);
        assert.equal(status.failedCount, 1);
        assert.equal(status.readyCount, 0);
        assert.deepEqual(status.statusCounts, { failed: 1 });

        const restored = await index.upsertDocumentTokens({
            path: filePath,
            library_path: libraryPath,
            status: 'ok',
            mtime: 4,
        }, 'restored');
        assert.equal(restored.document_id, first.document_id);
        assert.equal(restored.error, '');
        assert.deepEqual(
            (await index.search('restored', [libraryPath])).map(row => row.path),
            [path.resolve(filePath)],
        );
    } finally {
        await closeAndRemove(index, root);
    }
});

test('library 재조정은 현재 파일과 active root만 남긴다', async () => {
    const { root, index } = createTestIndex('bookmanager-content-reconcile-');
    try {
        const firstLibrary = path.join(root, 'LibraryA');
        const secondLibrary = path.join(root, 'LibraryB');
        const keepPath = path.join(firstLibrary, 'Keep.txt');
        const stalePath = path.join(firstLibrary, 'Stale.txt');
        const secondPath = path.join(secondLibrary, 'Second.txt');
        await index.upsertDocumentTokens({
            path: keepPath,
            library_path: firstLibrary,
            status: 'ready',
        }, 'keep');
        await index.upsertDocumentTokens({
            path: stalePath,
            library_path: firstLibrary,
            status: 'ready',
        }, 'stale');
        await index.upsertDocumentTokens({
            path: secondPath,
            library_path: secondLibrary,
            status: 'ready',
        }, 'second');

        assert.deepEqual(
            await index.removeDocumentsNotInLibrary(firstLibrary, [keepPath, keepPath]),
            { removedCount: 1 },
        );
        assert.equal((await index.getDocument(stalePath)), null);
        assert.deepEqual(await index.search('stale', [firstLibrary]), []);
        assert.notEqual(await index.getDocument(secondPath), null);

        assert.deepEqual(
            await index.removeMissingRoots([firstLibrary, firstLibrary]),
            { removedCount: 1 },
        );
        assert.equal(await index.getDocument(secondPath), null);
        assert.notEqual(await index.getDocument(keepPath), null);
        assert.deepEqual(await index.removeDocuments([keepPath]), { removedCount: 1 });
        assert.deepEqual(await index.removeDocuments([keepPath]), { removedCount: 0 });
    } finally {
        await closeAndRemove(index, root);
    }
});

test('status, DB 크기, clear와 close API가 일관된 결과를 반환한다', async () => {
    const { root, index } = createTestIndex('bookmanager-content-status-');
    try {
        const firstLibrary = path.join(root, 'LibraryA');
        const secondLibrary = path.join(root, 'LibraryB');
        const records = [
            ['ready', 'one', firstLibrary, '2026-01-01T00:00:00.000Z'],
            ['ok', 'two', firstLibrary, '2026-01-02T00:00:00.000Z'],
            ['truncated', 'three', firstLibrary, '2026-01-03T00:00:00.000Z'],
            ['empty', '', firstLibrary, '2026-01-04T00:00:00.000Z'],
            ['pending', '', firstLibrary, '2026-01-05T00:00:00.000Z'],
            ['encrypted', '', secondLibrary, '2026-01-06T00:00:00.000Z'],
        ];
        for (const [status, tokens, libraryPath, indexedAt] of records) {
            await index.upsertDocumentTokens({
                path: path.join(libraryPath, `${status}.txt`),
                library_path: libraryPath,
                status,
                indexed_at: indexedAt,
            }, tokens);
        }
        await index.markDocumentFailed({
            path: path.join(firstLibrary, 'failed.txt'),
            library_path: firstLibrary,
            indexed_at: '2026-01-07T00:00:00.000Z',
        }, 'failed');

        const scoped = await index.getStatus([firstLibrary, firstLibrary]);
        assert.equal(scoped.totalCount, 6);
        assert.equal(scoped.readyCount, 4);
        assert.equal(scoped.pendingCount, 1);
        assert.equal(scoped.failedCount, 1);
        assert.equal(scoped.tokenCount, 3);
        assert.equal(scoped.lastIndexedAt, '2026-01-07T00:00:00.000Z');
        assert.deepEqual(scoped.statusCounts, {
            empty: 1,
            failed: 1,
            ok: 1,
            pending: 1,
            ready: 1,
            truncated: 1,
        });

        const all = await index.getStatus();
        assert.equal(all.totalCount, 7);
        assert.equal(all.statusCounts.encrypted, 1);
        const size = await index.getDatabaseSize();
        assert.equal(size.databaseBytes > 0, true);
        assert.equal(size.totalBytes >= size.databaseBytes, true);
        assert.equal(size.totalBytes, size.databaseBytes + size.walBytes + size.sharedMemoryBytes);

        assert.deepEqual(await index.clear(), { removedCount: 7 });
        assert.deepEqual(await index.getStatus(), {
            totalCount: 0,
            readyCount: 0,
            pendingCount: 0,
            failedCount: 0,
            tokenCount: 0,
            lastIndexedAt: '',
            statusCounts: {},
        });
        assert.deepEqual(await index.search('one', [firstLibrary]), []);

        const pendingWrite = index.upsertDocumentTokens({
            path: path.join(firstLibrary, 'last.txt'),
            library_path: firstLibrary,
            status: 'ready',
        }, 'last');
        const closePromise = index.close();
        assert.equal((await pendingWrite).status, 'ready');
        await closePromise;
        await index.close();
        await assert.rejects(
            index.getDocument(path.join(firstLibrary, 'ready.txt')),
            error => error?.code === 'ERR_CONTENT_INDEX_CLOSED',
        );
    } finally {
        await closeAndRemove(index, root);
    }
});
