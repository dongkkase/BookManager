import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { pruneUnregisteredLibraryData } from './libraryDataCleanup.js';
import { readingListsRequest } from './readingLists.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'external-reading-state-'));
    const dbPath = path.join(root, 'library.db');
    const libraryPath = path.join(root, 'books');
    const db = new LibraryDB({ dbPath });
    await fs.mkdir(libraryPath);
    t.after(async () => {
        await db.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, dbPath, libraryPath, db };
}

function retained(db, filePath) {
    return db.getConnection().prepare('SELECT retain_outside_library FROM reading_states WHERE file_path = ?')
        .get(db.normalizeFilePath(filePath))?.retain_outside_library;
}

test('직접 연 외부 도서의 읽기 기록만 주기 정리와 재실행 뒤에도 유지한다', async t => {
    const { root, dbPath, libraryPath, db } = await fixture(t);
    const inside = path.join(libraryPath, 'inside.epub');
    const external = path.join(root, 'dropped.epub');
    const oldExternal = path.join(root, 'old-library.epub');
    for (const filePath of [inside, external, oldExternal]) {
        await fs.writeFile(filePath, 'original');
        await db.upsertFileInfo({ path: filePath, title: path.basename(filePath) });
        await db.upsertReadingState(filePath, { format: 'epub', pageIndex: 4, pageCount: 20 });
    }
    const externalState = await db.upsertReadingState(external, { pageIndex: 7, retainOutsideLibrary: true });
    assert.equal(Object.hasOwn(externalState, 'retainOutsideLibrary'), false);
    const result = await pruneUnregisteredLibraryData(db, [libraryPath]);
    assert.equal(result.deletedReadingStateCount, 1);
    assert.equal(result.deletedFileCount, 2);
    assert.equal((await db.listRecentReadingStates()).some(state => state.filePath === oldExternal), false);
    assert.deepEqual(await db.listReadingStatesByPaths([external]), [externalState]);
    assert.equal(await db.getFileInfo(external), null);
    const catalog = await readingListsRequest(db, { operation: 'list', id: 'library-catalog' }, [libraryPath]);
    assert.deepEqual(catalog.rows.map(row => row.path), [inside]);
    assert.equal(await fs.readFile(external, 'utf8'), 'original');

    await db.close();
    const reopened = new LibraryDB({ dbPath });
    try {
        assert.deepEqual(await reopened.listReadingStatesByPaths([external]), [externalState]);
        assert.equal(retained(reopened, external), 1);
        const emptyScopeResult = await pruneUnregisteredLibraryData(reopened, []);
        assert.equal(emptyScopeResult.deletedReadingStateCount, 1);
        assert.deepEqual(await reopened.listRecentReadingStates(), [externalState]);
        assert.equal((await pruneUnregisteredLibraryData(reopened, [])).changes, 0);
    } finally {
        await reopened.close();
    }
});

test('외부 읽기 보존 표식은 진행률 갱신과 기록 삭제 후 다시 열기에서도 유지된다', async t => {
    const { root, db } = await fixture(t);
    const filePath = path.join(root, 'dropped.pdf');
    const first = await db.upsertReadingState(filePath, { format: 'pdf', retainOutsideLibrary: true });
    await db.upsertReadingState(filePath, { pageIndex: 9, pageCount: 100 });
    await db.upsertReadingState(filePath, { retainOutsideLibrary: false });
    assert.equal(retained(db, filePath), 1);
    await db.removeReadingState(filePath);
    await pruneUnregisteredLibraryData(db, []);
    assert.deepEqual(await db.listRecentReadingStates(), []);
    const reopened = await db.upsertReadingState(filePath, { pageIndex: 12 });
    assert.equal(reopened.itemId, first.itemId);
    assert.equal(reopened.pageIndex, 12);
    assert.equal(retained(db, filePath), 1);
    await db.clearReadingStates();
    assert.deepEqual(await db.listRecentReadingStates(), []);
    assert.equal(retained(db, filePath), 1);

    const unmarked = path.join(root, 'ordinary.pdf');
    await db.upsertReadingState(unmarked, { retainOutsideLibrary: 'true' });
    assert.equal(retained(db, unmarked), 0);
    await pruneUnregisteredLibraryData(db, []);
    assert.equal(retained(db, unmarked), undefined);
});

test('기존 읽기 DB는 보존 표식을 기본 0으로 추가하고 기존 기록을 바꾸지 않는다', async t => {
    const { root, dbPath, db } = await fixture(t);
    const filePath = path.join(root, 'legacy.epub');
    const state = await db.upsertReadingState(filePath, { format: 'epub', pageIndex: 8 });
    db.getConnection().exec('ALTER TABLE reading_states DROP COLUMN retain_outside_library');
    await db.close();
    const reopened = new LibraryDB({ dbPath });
    try {
        assert.deepEqual(await reopened.listReadingStatesByPaths([filePath]), [state]);
        assert.equal(retained(reopened, filePath), 0);
        const column = reopened.getConnection().pragma('table_info(reading_states)')
            .find(value => value.name === 'retain_outside_library');
        assert.equal(column.notnull, 1);
        assert.equal(column.dflt_value, '0');
        assert.equal((await pruneUnregisteredLibraryData(reopened, [])).deletedReadingStateCount, 1);
    } finally {
        await reopened.close();
    }
});

test('표지 편집으로 읽기 위치를 보정하거나 새 파일로 복사해도 외부 보존 표식을 유지한다', async t => {
    const { root, db } = await fixture(t);
    const original = path.join(root, 'original.cbr');
    const converted = path.join(root, 'converted.cbz');
    await db.upsertReadingState(original, {
        format: 'comic', pageIndex: 1, pageCount: 2, retainOutsideLibrary: true,
    });
    const readingAdjustment = {
        format: 'comic', sourcePath: original, pageCount: 3, pageIndexMap: [1, 2],
    };
    const edited = await db.commitCoverFileEdit(original, { mtime: 1, size: 1, readingAdjustment });
    assert.equal(edited.readingState.pageIndex, 2);
    assert.equal(retained(db, original), 1);
    const copied = await db.commitCoverFileEdit(converted, { mtime: 1, size: 1, readingAdjustment });
    assert.notEqual(copied.readingState.itemId, edited.readingState.itemId);
    assert.equal(retained(db, converted), 1);
    const ordinary = path.join(root, 'ordinary.cbr');
    await db.upsertReadingState(ordinary, { format: 'comic', pageIndex: 0, pageCount: 2 });
    await db.commitCoverFileEdit(converted, {
        mtime: 1, size: 1, readingAdjustment: { ...readingAdjustment, sourcePath: ordinary },
    });
    assert.equal(retained(db, converted), 1);
    assert.equal((await pruneUnregisteredLibraryData(db, [])).deletedReadingStateCount, 1);
    assert.equal((await db.listRecentReadingStates()).length, 2);
});
