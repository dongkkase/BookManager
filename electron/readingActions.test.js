import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { updateReadingProgress } from './readingActions.js';

async function fixture(run) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-reading-actions-'));
    const db = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    const folder = path.join(root, 'books');
    await fs.mkdir(path.join(folder, 'nested'), { recursive: true });
    const files = ['book.cbz', 'book.pdf', 'nested/book.epub', 'nested/book.txt', 'nested/book.m4b']
        .map(name => path.join(folder, name));
    for (const filePath of files) await fs.writeFile(filePath, 'fixture');
    try { await run({ root, db, folder, files }); } finally {
        await db.close();
        await fs.rm(root, { recursive: true, force: true });
    }
}

test('폴더 읽음 표시는 하위 지원 파일을 중복 없이 처리하고 링크와 숨김 폴더를 제외한다', async () => {
    await fixture(async ({ db, root, folder, files }) => {
        await fs.mkdir(path.join(folder, '.hidden'));
        await fs.writeFile(path.join(folder, '.hidden', 'book.txt'), 'hidden');
        await fs.writeFile(path.join(folder, 'cover.jpg'), 'image');
        await fs.writeFile(path.join(root, 'outside.txt'), 'outside');
        await fs.symlink(root, path.join(folder, 'link'));
        const result = await updateReadingProgress(db, [folder, ...files], 'mark-read');
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.states.map(state => state.filePath).sort(), files.sort());
        assert.ok(result.states.every(state => state.status === 'completed' && state.revision === 1));
        assert.ok(result.states.filter(state => state.format !== 'audio')
            .every(state => state.locator.normalizedPosition === 1 && state.scrollPercent === 100));
        assert.equal((await db.listRecentReadingStates()).length, files.length);
    });
});

test('읽음 표시와 초기화는 형식별 위치를 바꾸고 식별자, 전체 분량, 최근 읽은 시각을 유지한다', async () => {
    await fixture(async ({ db, files }) => {
        const before = new Map();
        for (const filePath of files) {
            before.set(filePath, await db.upsertReadingState(filePath, {
                pageIndex: 7, pageCount: 20, scrollPercent: 35,
                positionSeconds: 30, durationSeconds: 100,
                locator: { kind: 'epub-text', sectionHref: 'chapter.xhtml', sourceOffset: 40 },
                lastReadAt: '2026-09-01T10:00:00.000Z',
            }));
        }
        const marked = await updateReadingProgress(db, files, 'mark-read');
        assert.equal(marked.states.length, files.length);
        for (const state of marked.states) {
            assert.equal(state.pageIndex, 19);
            assert.equal(state.positionSeconds, 100);
            assert.equal(state.itemId, before.get(state.filePath).itemId);
            assert.equal(state.revision, 2);
            assert.equal(state.status, 'completed');
        }
        const reset = await updateReadingProgress(db, files, 'reset-progress');
        for (const state of reset.states) {
            assert.equal(state.status, 'unread');
            assert.equal(state.pageIndex, 0);
            assert.equal(state.scrollPercent, 0);
            assert.equal(state.positionSeconds, 0);
            assert.equal(state.pageCount, 20);
            assert.equal(state.durationSeconds, 100);
            assert.equal(state.itemId, before.get(state.filePath).itemId);
            assert.equal(state.revision, 3);
            assert.equal(state.lastReadAt, before.get(state.filePath).lastReadAt);
            assert.deepEqual(state.locator, state.format === 'audio'
                ? { kind: 'audio-time', positionSeconds: 0 } : { kind: 'normalized', normalizedPosition: 0 });
        }
    });
});

test('잘못된 요청은 쓰기 전에 거부하고 누락 파일은 정상 파일의 처리를 막지 않는다', async () => {
    await fixture(async ({ db, root, files }) => {
        await assert.rejects(updateReadingProgress(db, files, 'delete'), /invalid_reading_action/);
        for (const paths of [null, ['relative.txt'], ['\0'], [false]]) {
            await assert.rejects(updateReadingProgress(db, paths, 'mark-read'), /invalid_reading_paths/);
        }
        assert.deepEqual(await db.listRecentReadingStates(), []);
        const missing = path.join(root, 'missing.txt');
        const result = await updateReadingProgress(db, [files[0], missing], 'reset-progress');
        assert.equal(result.states.length, 1);
        assert.equal(result.states[0].status, 'unread');
        assert.equal(result.errors.length, 1);
        assert.equal(result.errors[0].filePath, missing);
    });
});

test('열려 있는 뷰어의 자동 저장과 충돌하는 파일만 건너뛴다', async () => {
    await fixture(async ({ db, folder, files }) => {
        const before = await db.upsertReadingState(files[0], { pageIndex: 5, pageCount: 20 });
        const result = await updateReadingProgress(db, [folder], 'reset-progress', {
            getOpenViewerPaths: () => [files[0]],
        });
        assert.equal(result.states.length, files.length - 1);
        assert.deepEqual(result.errors, [{ filePath: files[0], code: 'READING_VIEWER_OPEN' }]);
        assert.deepEqual(await db.listReadingStatesByPaths([files[0]]), [before]);
        const retry = await updateReadingProgress(db, [files[0]], 'reset-progress');
        assert.equal(retry.states[0].status, 'unread');
        assert.deepEqual(retry.errors, []);
    });
});
