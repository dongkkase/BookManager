import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { readingActivityDashboard, recordReadingCompletion, saveReadingMonthlyGoal } from './readingActivity.js';
import { exchangeReadingActivity, INITIAL_READING_ACTIVITY_EPOCH, readingActivityIdentity } from './readive/readingActivity.js';
import { ReadiveService } from './readive/service.js';

const bookKey = `reading_book_${'a'.repeat(64)}`;
const timestamp = '2026-02-10T12:00:00.000Z';
const activity = (patch = {}) => ({
    bookKeys: [bookKey], deletedAt: null, deviceId: 'reading_activity_source_phone', durationSeconds: 120,
    epochId: INITIAL_READING_ACTIVITY_EPOCH, localDate: '2026-02-10', pageTurnCount: 3, revision: 1,
    updatedAt: timestamp, writerDeviceId: 'reading_activity_source_phone', ...patch,
});
const reset = (patch = {}) => ({
    deletedAt: null, epochId: 'reading_statistics_epoch_reset', id: 'reading_statistics_reset', resetAt: timestamp,
    revision: 1, updatedAt: timestamp, writerDeviceId: 'readive-phone', ...patch,
});

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'readive-reading-activity-'));
    const dbPath = path.join(directory, 'library.db');
    const library = new LibraryDB({ dbPath });
    const file = path.join(directory, 'book.epub');
    await library.upsertFileInfo({ path: file, title: 'Book' });
    t.after(async () => {
        await library.close();
        await fs.rm(directory, { recursive: true, force: true });
    });
    const exchange = (records = [], options = {}) => exchangeReadingActivity({ records, reset: null, cursor: null, ...options }, library);
    const dashboard = () => readingActivityDashboard(library, library.getConnection(), '2026-02', [directory]);
    const record = async (eventId = 'desktop', duration = 10000) => {
        const start = new Date(2026, 1, 10, 12).getTime();
        return library.recordReadingActivity(file, { eventId, startedAt: start, endedAt: start + duration });
    };
    return { directory, dbPath, library, file, exchange, dashboard, record };
}

test('Readive day snapshots replace revisions, preserve source identity and never add a replay twice', async t => {
    const value = await fixture(t);
    await value.record();
    const source = readingActivityIdentity(value.library.getConnection()).source_id;
    const first = await value.exchange([activity()]);
    assert.equal(first.records.find(record => record.deviceId === source).durationSeconds, 10);
    assert.deepEqual(value.dashboard().totals, { seconds: 130, readingDays: 1, completedBooks: 0 });
    assert.equal((await value.exchange([activity()])).changed, false);
    await value.exchange([activity({ revision: 2, durationSeconds: 150 })]);
    await value.exchange([activity({ durationSeconds: 600 })]);
    await value.exchange([activity({ deviceId: source, writerDeviceId: source, revision: 999, durationSeconds: 500 })]);
    assert.equal(value.dashboard().totals.seconds, 160);
    const result = value.dashboard();
    assert.equal(result.days[9].syncedSeconds, 150);
    assert.equal(result.days[9].syncedBookCount, 1);
    assert.equal(result.days[9].pageTurnCount, 3);
    assert.equal(result.days[9].books[0].seconds, 10);
    assert.equal(result.sync.syncedDevices, 1);
    assert.ok(result.sync.lastSyncedAt);
    await value.library.close();
    assert.equal(value.dashboard().totals.seconds, 160);
    assert.equal(readingActivityIdentity(value.library.getConnection()).source_id, source);
});

test('cloud-relayed devices are counted once and book keys remain a set without inventing per-book time', async t => {
    const value = await fixture(t);
    const second = activity({ deviceId: 'tablet', writerDeviceId: 'tablet', durationSeconds: 30 });
    await value.exchange([activity(), second]);
    await value.exchange([second, activity()]);
    const day = value.dashboard().days[9];
    assert.equal(day.seconds, 150);
    assert.equal(day.syncedBookCount, 1);
    assert.equal(day.bookCount, 0);
    assert.deepEqual(day.books, []);
    await value.exchange([activity({ deletedAt: timestamp })]);
    assert.equal(value.dashboard().totals.seconds, 30, 'A same-revision tombstone wins over its live version');
    await value.exchange([activity()]);
    assert.equal(value.dashboard().totals.seconds, 30);
    await value.exchange([activity({ revision: 2 })]);
    assert.equal(value.dashboard().totals.seconds, 150);
});

test('Readive resets switch epochs while keeping existing desktop rows, completed books and local goals', async t => {
    const value = await fixture(t);
    const db = value.library.getConnection();
    await value.record();
    await value.library.upsertReadingState(value.file, { status: 'completed' });
    recordReadingCompletion(db, {}, { file_path: value.file, status: 'completed' }, timestamp);
    saveReadingMonthlyGoal(db, '2026-02', { books: 5, minutes: 60 });
    await value.exchange([activity()]);
    assert.equal(value.dashboard().totals.seconds, 130);
    await value.exchange([activity({ revision: 2, epochId: reset().epochId, durationSeconds: 20 })], { reset: reset() });
    assert.deepEqual(value.dashboard().totals, { seconds: 20, readingDays: 1, completedBooks: 0 });
    assert.equal(value.dashboard().completedCount, 1);
    assert.deepEqual(value.dashboard().goal, { books: 5, minutes: 60 });
    assert.equal(db.prepare('SELECT SUM(seconds) AS seconds FROM reading_daily_activity').get().seconds, 10);
    await value.record('after-reset', 5000);
    assert.equal(value.dashboard().totals.seconds, 25);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM reading_daily_activity').get().count, 2);
    await value.exchange([activity()], { reset: reset({ revision: 1, updatedAt: '2025-01-01T00:00:00.000Z', epochId: 'old-epoch' }) });
    assert.equal(value.dashboard().totals.seconds, 25);
    assert.equal(readingActivityIdentity(db).current_epoch_id, reset().epochId);
    assert.equal((await value.exchange()).records.find(record => record.deviceId === readingActivityIdentity(db).source_id).durationSeconds, 5);
});

test('incoming validation and database failures cannot partly apply an activity batch or statistics reset', async t => {
    const value = await fixture(t);
    const invalid = [
        { durationSeconds: -1 }, { durationSeconds: 0.1 }, { revision: 0 }, { pageTurnCount: Infinity },
        { writerDeviceId: 'other' }, { localDate: '2026-02-30' }, { bookKeys: [bookKey, bookKey] },
        { path: value.file }, { title: 'Private title' }, { startedAt: timestamp }, { bookKeys: Array(257).fill(bookKey) },
    ];
    for (const patch of invalid) await assert.rejects(value.exchange([activity(), activity(patch)]), /invalid_reading_activity/);
    assert.equal(value.library.getConnection().prepare('SELECT COUNT(*) AS count FROM synced_reading_activity_days').get().count, 0);
    await assert.rejects(value.exchange([], { cursor: 'not-json' }), /invalid_reading_activity_cursor/);
    const db = value.library.getConnection();
    db.exec(`CREATE TRIGGER reject_day BEFORE INSERT ON synced_reading_activity_days BEGIN SELECT RAISE(ABORT, 'day failure'); END;`);
    await assert.rejects(value.exchange([activity()], { reset: reset() }), /day failure/);
    assert.equal(readingActivityIdentity(db).current_epoch_id, INITIAL_READING_ACTIVITY_EPOCH);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM synced_reading_statistics_resets').get().count, 0);
    assert.equal(db.prepare("SELECT value FROM library_meta WHERE key = 'readive_reading_activity_synced_at'").get(), undefined);
});

test('activity exchange pages complete historical snapshots without leaking paths or source titles', async t => {
    const value = await fixture(t);
    const records = Array.from({ length: 123 }, (_, index) => activity({
        localDate: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    }));
    let response = await value.exchange(records);
    const received = [...response.records];
    assert.equal(response.records.length, 50);
    assert.ok(response.nextCursor);
    while (response.nextCursor) {
        response = await value.exchange([], { cursor: response.nextCursor });
        received.push(...response.records);
    }
    assert.equal(received.length, 123);
    assert.equal(new Set(received.map(record => `${record.deviceId}:${record.localDate}`)).size, 123);
    assert.equal(JSON.stringify(received).includes(value.directory), false);
    assert.equal(response.epochId, INITIAL_READING_ACTIVITY_EPOCH);
    assert.equal(response.reset, null);
});

test('reading days use Readive activity-row semantics and future mobile dates stay out of totals', async t => {
    const value = await fixture(t);
    await value.exchange([activity({ durationSeconds: 0, pageTurnCount: 0, bookKeys: [] })]);
    assert.deepEqual(value.dashboard().totals, { seconds: 0, readingDays: 1, completedBooks: 0 });
    assert.equal(value.dashboard().days[9].hasSyncedActivity, true);
    assert.equal(value.dashboard().days[9].hasActivity, true);
    await value.exchange([activity({ localDate: '9999-01-01' })]);
    const start = new Date(9999, 0, 1, 12).getTime();
    await value.library.recordReadingActivity(value.file, { eventId: 'future-desktop', startedAt: start, endedAt: start + 10000 });
    assert.equal(readingActivityDashboard(value.library, value.library.getConnection(), '9999-01', [value.directory]).totals.seconds, 0);
});

test('legacy dashboard activity migrates to Readive epochs without changing elapsed seconds or monthly targets', async t => {
    const value = await fixture(t);
    const db = value.library.getConnection();
    db.exec(`
        DROP TABLE reading_activity_events;
        DROP TABLE reading_daily_activity;
        DROP TABLE reading_completions;
        CREATE TABLE reading_activity_events (event_id TEXT PRIMARY KEY, path TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL);
        CREATE TABLE reading_daily_activity (date TEXT NOT NULL, path TEXT NOT NULL, seconds REAL NOT NULL DEFAULT 0, PRIMARY KEY(date, path));
        CREATE TABLE reading_completions (month TEXT NOT NULL, path TEXT NOT NULL, date TEXT NOT NULL, completed_at TEXT NOT NULL, PRIMARY KEY(month, path));
    `);
    db.prepare('INSERT INTO reading_daily_activity VALUES (?, ?, ?)').run('2026-02-10', value.file, 42.5);
    db.prepare('INSERT INTO reading_completions VALUES (?, ?, ?, ?)').run('2026-02', value.file, '2026-02-10', timestamp);
    saveReadingMonthlyGoal(db, '2026-02', { books: 3, minutes: 60 });
    await value.library.close();
    assert.deepEqual(value.dashboard().totals, { seconds: 42, readingDays: 1, completedBooks: 1 });
    assert.deepEqual(value.dashboard().goal, { books: 3, minutes: 60 });
    assert.equal(value.library.getConnection().prepare('SELECT seconds FROM reading_daily_activity').get().seconds, 42.5);
    assert.equal((await value.exchange()).records[0].durationSeconds, 42);
});

test('only an active paired device may exchange statistics and successful imports notify the dashboard', async t => {
    const value = await fixture(t);
    const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
    const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };
    let notifications = 0;
    const service = new ReadiveService({
        directory: path.join(value.directory, 'state'), interfaces: () => [local], getLibraryDb: () => value.library,
        onReadingChanged: () => { notifications += 1; },
    });
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    service.certificateSha256 = 'a'.repeat(64);
    const ticket = JSON.parse((await service.pairing()).ticket);
    const { json: { token } } = await service.dispatch({ ...remote, method: 'POST', pathname: '/readive/v1/pair', body: {
        secret: ticket.secret, deviceId: 'phone-123', deviceName: 'Phone',
    } });
    const request = { ...remote, method: 'POST', pathname: '/readive/v1/reading-activity', body: { records: [activity()], reset: null, cursor: null } };
    await assert.rejects(service.dispatch({ ...request, token: 'invalid' }), /unauthorized/);
    const response = await service.dispatch({ ...request, token });
    assert.equal(response.json.records[0].durationSeconds, 120);
    assert.equal(notifications, 1);
    assert.equal('changed' in response.json, false);
    await service.dispatch({ ...request, token });
    assert.equal(notifications, 1);
    await service.revoke({ deviceId: 'phone-123' });
    await assert.rejects(service.dispatch({ ...request, token }), /unauthorized/);
    await assert.rejects(exchangeReadingActivity(request.body, value.library, () => { throw Error('cancelled'); }), /cancelled/);
});
