import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { moveReadingActivityPaths, readingActivityDate, recordReadingCompletion } from './readingActivity.js';
import { readingListsRequest, registerReadingListsIpc } from './readingLists.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-reading-activity-'));
    const dbPath = path.join(root, 'library.db');
    const library = new LibraryDB({ dbPath });
    const folder = path.join(root, 'books_%[a]');
    const files = [path.join(folder, 'first.epub'), path.join(folder, 'nested', 'second.cbz')];
    await library.upsertFileInfoBulk(files.map((filePath, index) => ({
        path: filePath, title: `Book ${index + 1}`, thumb_path: path.join(root, `${index}.jpg`),
    })));
    t.after(async () => {
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, folder, files, dbPath, library };
}

const dashboard = (value, month, libraries = [value.folder]) => readingListsRequest(
    value.library, { operation: 'dashboard', month }, libraries,
);

test('기존 DB에는 수집 시작 시점만 추가하고 과거 완독일과 독서 시간을 추정하지 않는다', async t => {
    const value = await fixture(t);
    await value.library.upsertReadingState(value.files[0], {
        status: 'completed', lastReadAt: '2020-01-01T00:00:00.000Z',
    });
    const before = await value.library.listReadingStatesByPaths(value.files);
    value.library.getConnection().exec(`
        DROP TABLE reading_activity_events;
        DROP TABLE reading_daily_activity;
        DROP TABLE reading_completions;
        DROP TABLE reading_monthly_goals;
        DROP INDEX idx_reading_states_completed;
        DELETE FROM library_meta WHERE key = 'reading_activity_started_at';
    `);
    await value.library.close();
    const reopened = new LibraryDB({ dbPath: value.dbPath });
    try {
        const month = readingActivityDate().slice(0, 7);
        const result = await readingListsRequest(reopened, { operation: 'dashboard', month }, [value.folder]);
        assert.deepEqual(await reopened.listReadingStatesByPaths(value.files), before);
        assert.ok(Number.isFinite(Date.parse(result.trackingStartedAt)));
        assert.deepEqual(result.totals, { seconds: 0, readingDays: 0, completedBooks: 0 });
        assert.equal(result.completedCount, 1);
        assert.equal(result.completedRows[0].completed_at, null);
        await reopened.upsertReadingState(value.files[0], { status: 'completed' });
        await reopened.removeReadingState(value.files[0]);
        await reopened.upsertReadingState(value.files[0], { status: 'completed' });
        const refreshed = await readingListsRequest(reopened, { operation: 'dashboard', month }, [value.folder]);
        assert.equal(refreshed.totals.completedBooks, 0, 'Reopening an already completed book is not a new completion');
        await reopened.close();
        assert.equal((await readingListsRequest(reopened, { operation: 'dashboard', month }, [value.folder])).trackingStartedAt, result.trackingStartedAt);
    } finally {
        await reopened.close();
    }
});

test('독서 시간은 로컬 자정에 나누고 중복 이벤트와 겹친 구간을 한 번만 누적한다', async t => {
    const value = await fixture(t);
    const start = new Date(2026, 9, 25, 23, 59, 45, 250).getTime();
    const event = { eventId: 'midnight', startedAt: start, endedAt: start + 30500 };
    assert.deepEqual(await value.library.recordReadingActivity(value.files[0], event), { changes: 1, seconds: 30.5 });
    assert.deepEqual(await value.library.recordReadingActivity(value.files[0], event), { changes: 0, seconds: 0 });
    assert.deepEqual(await value.library.recordReadingActivity(value.files[0], {
        eventId: 'overlap', startedAt: start + 15000, endedAt: start + 45000,
    }), { changes: 1, seconds: 14.5 });
    assert.deepEqual(await value.library.recordReadingActivity(value.files[0], {
        eventId: 'contained', startedAt: start + 16000, endedAt: start + 17000,
    }), { changes: 1, seconds: 0 });
    const result = await dashboard(value, '2026-10');
    assert.equal(result.days.find(day => day.date === '2026-10-25').seconds, 14);
    assert.equal(result.days.find(day => day.date === '2026-10-26').seconds, 30);
    assert.equal(result.totals.readingDays, 2);
    const rows = value.library.getConnection().prepare('SELECT date, seconds FROM reading_daily_activity ORDER BY date').all();
    assert.deepEqual(rows, [{ date: '2026-10-25', seconds: 14.75 }, { date: '2026-10-26', seconds: 30.25 }]);
    for (const invalid of [
        { eventId: '', startedAt: start, endedAt: start + 1 },
        { eventId: 'zero', startedAt: start, endedAt: start },
        { eventId: 'backwards', startedAt: start, endedAt: start - 1 },
        { eventId: 'long', startedAt: start, endedAt: start + 60001 },
        { eventId: 'invalid', startedAt: 'not-a-date', endedAt: start + 10 },
        { eventId: 'infinite', startedAt: start, endedAt: Infinity },
    ]) await assert.rejects(value.library.recordReadingActivity(value.files[0], invalid), /invalid_reading_activity/);
    await assert.rejects(value.library.recordReadingActivity('relative.epub', event), /invalid_reading_paths/);
    await value.library.close();
    assert.deepEqual((await dashboard(value, '2026-10')).totals, result.totals);
});

test('월별 시간은 리디브처럼 전체 독서 이력을 집계하고 일별 도서 상한과 전체 도서 수를 함께 반환한다', async t => {
    const value = await fixture(t);
    const start = new Date(2026, 1, 10, 12).getTime();
    const paths = [
        ...Array.from({ length: 22 }, (_, index) => path.join(value.folder, `${index}.epub`)),
        path.join(`${value.folder}-other`, 'sibling.epub'), path.join(value.root, 'outside.epub'),
    ];
    for (const [index, filePath] of paths.entries()) {
        await value.library.recordReadingActivity(filePath, { eventId: `scope-${index}`, startedAt: start, endedAt: start + 10000 });
    }
    const result = await dashboard(value, '2026-02', [value.folder, value.folder, path.join(value.folder, 'nested')]);
    assert.equal(result.days.length, 28);
    assert.deepEqual(result.totals, { seconds: 240, readingDays: 1, completedBooks: 0 });
    assert.equal(result.days[9].bookCount, 24);
    assert.equal(result.days[9].books.length, 20);
    assert.ok(result.days[9].books.every(book => paths.includes(book.path)));
    assert.equal((await dashboard(value, '2028-02')).days.length, 29);
    assert.equal((await dashboard(value, '2026-03')).totals.seconds, 0);
    assert.equal((await dashboard(value, '2026-02', [])).totals.seconds, 240);
    assert.equal((await dashboard(value, '2026-02', ['', 'relative', null])).totals.seconds, 240);
});

test('실제 완독 전이 날짜를 기록하며 같은 달 같은 책을 중복 계산하지 않는다', async t => {
    const value = await fixture(t);
    const today = readingActivityDate();
    const month = today.slice(0, 7);
    await value.library.upsertReadingState(value.files[0], { status: 'reading', pageIndex: 3, pageCount: 10 });
    await value.library.upsertReadingState(value.files[0], { pageIndex: 9, pageCount: 10, lastReadAt: '2020-01-01T00:00:00.000Z' });
    await value.library.upsertReadingState(value.files[0], { status: 'completed' });
    await value.library.upsertReadingState(value.files[0], { status: 'unread' });
    await value.library.upsertReadingState(value.files[0], { status: 'completed' });
    await value.library.upsertReadingState(value.files[1], { status: 'completed' });
    await value.library.upsertReadingState(path.join(value.root, 'outside.epub'), { status: 'completed' });
    const result = await dashboard(value, month);
    assert.equal(result.totals.completedBooks, 2);
    assert.equal(result.totals.seconds, 0, 'Completion never invents reading time');
    assert.equal(result.days.find(day => day.date === today).completedCount, 2);
    assert.equal(result.completedCount, 2);
    assert.deepEqual(result.completedRows.map(file => file.path).sort(), [...value.files].sort());
    assert.equal((await dashboard(value, '2020-01')).totals.completedBooks, 0);
    const db = value.library.getConnection();
    const next = { file_path: value.files[0], status: 'completed' };
    const later = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 5, 12).toISOString();
    recordReadingCompletion(db, { status: 'reading' }, next, later);
    recordReadingCompletion(db, { status: 'reading' }, next, later);
    assert.equal((await dashboard(value, readingActivityDate(later).slice(0, 7))).totals.completedBooks, 1);
    await value.library.upsertReadingState(value.files[0], { status: 'unread', pageIndex: 0 });
    assert.equal((await dashboard(value, month)).completedCount, 1, 'The shelf reflects current completed status');
    assert.equal((await dashboard(value, month)).totals.completedBooks, 2, 'Past completion remains in the calendar');
});

test('완독 상태와 완료 이력은 한 트랜잭션으로 저장된다', async t => {
    const value = await fixture(t);
    const before = await value.library.upsertReadingState(value.files[0], { status: 'reading' });
    value.library.getConnection().exec(`CREATE TRIGGER reject_completion BEFORE INSERT ON reading_completions
        BEGIN SELECT RAISE(ABORT, 'completion failure'); END;`);
    await assert.rejects(value.library.upsertReadingState(value.files[0], { status: 'completed' }), /completion failure/);
    assert.deepEqual((await value.library.listReadingStatesByPaths([value.files[0]]))[0], before);
});

test('월간 목표는 월별 저장·복원되며 잘못된 월과 목표를 거절한다', async t => {
    const value = await fixture(t);
    const save = (month, goal) => readingListsRequest(value.library, { operation: 'dashboard-goal', month, goal });
    assert.deepEqual((await dashboard(value, '2026-10')).goal, { books: 0, minutes: 0 });
    assert.deepEqual(await save('2026-10', { books: 4, minutes: 600 }), { month: '2026-10', goal: { books: 4, minutes: 600 } });
    await save('2026-11', { books: 2, minutes: 300 });
    await value.library.close();
    assert.deepEqual((await dashboard(value, '2026-10')).goal, { books: 4, minutes: 600 });
    assert.deepEqual((await dashboard(value, '2026-11')).goal, { books: 2, minutes: 300 });
    for (const month of ['', '2026-1', '2026-00', '2026-13', '0000-01', "2026-10'", null]) {
        await assert.rejects(dashboard(value, month), /invalid_reading_month/);
        await assert.rejects(save(month, { books: 1, minutes: 1 }), /invalid_reading_month/);
    }
    for (const goal of [{ books: -1, minutes: 0 }, { books: 1.5, minutes: 30 }, { books: 1001, minutes: 0 },
        { books: 1, minutes: 50001 }, { books: 1, minutes: '30' }, {}]) {
        await assert.rejects(save('2026-10', goal), /invalid_reading_goal/);
    }
    await save('2026-10', { books: 0, minutes: 0 });
    assert.deepEqual((await dashboard(value, '2026-10')).goal, { books: 0, minutes: 0 });
});

test('폴더 이동은 독서 이력과 이벤트 중복 방지 정보를 함께 이동한다', async t => {
    const value = await fixture(t);
    const start = new Date(2026, 9, 25, 12).getTime();
    const event = { eventId: 'move', startedAt: start, endedAt: start + 20000 };
    await value.library.recordReadingActivity(value.files[0], event);
    recordReadingCompletion(value.library.getConnection(), {}, { file_path: value.files[0], status: 'completed' }, new Date(start).toISOString());
    const destination = path.join(value.root, 'moved');
    moveReadingActivityPaths(value.library.getConnection(), { src: value.folder, dest: destination, recursive: true });
    assert.equal((await dashboard(value, '2026-10')).totals.seconds, 20);
    const result = await dashboard(value, '2026-10', [destination]);
    assert.deepEqual(result.totals, { seconds: 20, readingDays: 1, completedBooks: 1 });
    const movedPath = path.join(destination, 'first.epub');
    assert.equal(result.days[24].books[0].path, movedPath);
    assert.deepEqual(await value.library.recordReadingActivity(movedPath, event), { changes: 0, seconds: 0 });
});

test('실제 파일 이동은 완독 책장과 읽기 위치를 보존하고 최근 읽음 순서를 바꾸지 않는다', async t => {
    const value = await fixture(t);
    const source = value.files[0];
    const target = path.join(value.folder, 'renamed.epub');
    await value.library.upsertReadingState(source, {
        format: 'epub', pageIndex: 9, pageCount: 10, status: 'completed',
        locator: { kind: 'epub-text', sectionHref: 'chapter.xhtml', sourceOffset: 430 },
        lastReadAt: '2020-01-01T00:00:00.000Z',
    });
    await value.library.upsertReadingState(value.files[1], { status: 'reading', lastReadAt: '2025-01-01T00:00:00.000Z' });
    const db = value.library.getConnection();
    const before = db.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(source);
    const recentBefore = await value.library.listRecentReadingStates();
    const startedAt = Date.now() - 30000;
    const event = { eventId: 'actual-move', startedAt, endedAt: startedAt + 20000 };
    await value.library.recordReadingActivity(source, event);
    const month = readingActivityDate().slice(0, 7);
    const dashboardBefore = await dashboard(value, month);
    await value.library.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: source, dest: target }] });
    assert.equal(db.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(source), undefined);
    assert.deepEqual(db.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(target), { ...before, file_path: target });
    assert.deepEqual(await value.library.listRecentReadingStates(), recentBefore.map(row => ({ ...row, filePath: row.filePath === source ? target : row.filePath })));
    const result = await dashboard(value, month);
    assert.equal(result.completedCount, 1);
    assert.equal(result.completedRows[0].path, target);
    assert.deepEqual(result.totals, dashboardBefore.totals);
    assert.ok(result.days.flatMap(day => day.books).some(book => book.path === target && book.completed));
    assert.deepEqual(await value.library.recordReadingActivity(target, event), { changes: 0, seconds: 0 });
});

test('폴더 이동은 하위 경로와 삭제 표식을 옮기고 이름이 비슷한 다른 폴더는 유지한다', async t => {
    const value = await fixture(t);
    const sibling = path.join(`${value.folder}-other`, 'untouched.epub');
    await value.library.upsertFileInfo({ path: sibling, title: 'Other folder' });
    await value.library.upsertReadingState(value.files[0], { status: 'completed', retainOutsideLibrary: true });
    await value.library.upsertReadingState(value.files[1], { status: 'reading', pageIndex: 3, pageCount: 20 });
    await value.library.removeReadingState(value.files[1]);
    await value.library.upsertReadingState(sibling, { status: 'completed' });
    const db = value.library.getConnection();
    const before = db.prepare('SELECT * FROM reading_states ORDER BY item_id').all();
    const target = path.join(value.root, 'new_%[a]');
    await value.library.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: value.folder, dest: target, recursive: true }] });
    assert.deepEqual(db.prepare('SELECT * FROM reading_states ORDER BY item_id').all(), before.map(row => ({
        ...row,
        file_path: row.file_path === sibling ? sibling : path.join(target, path.relative(value.folder, row.file_path)),
    })));
    const result = await dashboard(value, readingActivityDate().slice(0, 7), [target]);
    assert.equal(result.completedCount, 1);
    assert.equal(result.completedRows[0].path, path.join(target, 'first.epub'));
    const unchanged = db.prepare('SELECT * FROM reading_states ORDER BY item_id').all();
    await value.library.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: target, dest: target, recursive: true }] });
    assert.deepEqual(db.prepare('SELECT * FROM reading_states ORDER BY item_id').all(), unchanged);
});

test('목적지 읽기 기록 충돌은 이동한 책의 상태를 유지하고 외부 보존 표식은 잃지 않는다', async t => {
    const value = await fixture(t);
    const source = value.files[0];
    const target = value.files[1];
    await value.library.upsertReadingState(source, { status: 'completed', pageIndex: 9, pageCount: 10, lastReadAt: '2020-01-01T00:00:00.000Z' });
    await value.library.upsertReadingState(target, { status: 'reading', pageIndex: 50, pageCount: 100, retainOutsideLibrary: true });
    const db = value.library.getConnection();
    const before = db.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(source);
    await value.library.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: source, dest: target }] });
    assert.deepEqual(db.prepare('SELECT * FROM reading_states').all(), [{ ...before, file_path: target, retain_outside_library: 1 }]);
    assert.equal((await dashboard(value, readingActivityDate().slice(0, 7))).completedCount, 1);
    const unknown = path.join(value.folder, 'no-reading.epub');
    const saved = db.prepare('SELECT * FROM reading_states').all();
    await value.library.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: unknown, dest: target }] });
    assert.deepEqual(db.prepare('SELECT * FROM reading_states').all(), saved);
});

test('읽기 경로 이동 실패는 파일과 독서 이력 이동도 함께 롤백한다', async t => {
    const value = await fixture(t);
    const source = value.files[0];
    const target = path.join(value.folder, 'renamed.epub');
    await value.library.upsertReadingState(source, { status: 'completed' });
    await value.library.recordReadingActivity(source, { eventId: 'rollback', startedAt: 1800000000000, endedAt: 1800000010000 });
    const db = value.library.getConnection();
    const tables = ['files', 'reading_states', 'reading_daily_activity', 'reading_activity_events', 'reading_completions'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    db.exec(`CREATE TRIGGER reject_reading_move BEFORE UPDATE OF file_path ON reading_states
        BEGIN SELECT RAISE(ABORT, 'reading move failed'); END;`);
    await assert.rejects(value.library.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: source, dest: target }] }), /reading move failed/);
    assert.deepEqual(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()), before);
});

test('대시보드 IPC는 현재 등록 범위와 캐시 표지를 사용하며 목표 저장만 변경 알림을 보낸다', async t => {
    const value = await fixture(t);
    await value.library.upsertReadingState(value.files[0], { status: 'completed' });
    const handlers = new Map();
    const sender = { mainFrame: {} };
    let libraryPaths = [value.folder];
    let broadcasts = 0;
    const controller = registerReadingListsIpc({
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
        createLibrary: () => value.library,
        getLibraryPaths: () => libraryPaths,
        normalizeFile: row => ({ ...row, full_path: row.path, cover: `cached:${row.thumb_path}` }),
        broadcast: () => { broadcasts += 1; },
    });
    const request = payload => handlers.get('reading:lists')({ sender, senderFrame: sender.mainFrame }, payload);
    t.mock.method(fs, 'stat', () => assert.fail('Dashboard must not access original files'));
    try {
        const month = readingActivityDate().slice(0, 7);
        const result = await request({ operation: 'dashboard', month });
        assert.equal(result.success, true);
        assert.equal(result.completedFiles[0].path, value.files[0]);
        assert.equal(result.completedFiles[0].cover, `cached:${path.join(value.root, '0.jpg')}`);
        assert.equal(Object.hasOwn(result, 'completedRows'), false);
        assert.equal(broadcasts, 0);
        libraryPaths = [];
        assert.equal((await request({ operation: 'dashboard', month, libraryPaths: [value.folder] })).completedCount, 0);
        const saved = await request({ operation: 'dashboard-goal', month, goal: { books: 3, minutes: 120 } });
        assert.equal(saved.success, true);
        assert.equal(broadcasts, 1);
        assert.deepEqual(await request({ operation: 'dashboard', month: 'invalid' }), { success: false, error: 'invalid_reading_month' });
    } finally {
        await controller.dispose();
    }
});
