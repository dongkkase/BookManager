import path from 'node:path';
import { createLibraryPathScope } from './libraryPathScope.js';
import { INITIAL_READING_ACTIVITY_EPOCH, initializeReadiveReadingActivity, readingActivityIdentity, synchronizedReadingActivity } from './readive/readingActivity.js';

const TRACKING_STARTED_KEY = 'reading_activity_started_at';
const MAX_INTERVAL_MS = 60000;

export function readingActivityDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validateReadingActivityMonth(month) {
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) {
        throw new Error('invalid_reading_month');
    }
    return month;
}

export function initializeReadingActivity(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS reading_activity_events (
            event_id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reading_activity_events_interval ON reading_activity_events(path, ended_at, started_at);
        CREATE TABLE IF NOT EXISTS reading_daily_activity (
            date TEXT NOT NULL,
            path TEXT NOT NULL,
            seconds REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (date, path)
        );
        CREATE INDEX IF NOT EXISTS idx_reading_daily_activity_path ON reading_daily_activity(path);
        CREATE TABLE IF NOT EXISTS reading_completions (
            month TEXT NOT NULL,
            path TEXT NOT NULL,
            date TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            PRIMARY KEY (month, path)
        );
        CREATE INDEX IF NOT EXISTS idx_reading_completions_path ON reading_completions(path);
        CREATE TABLE IF NOT EXISTS reading_monthly_goals (
            month TEXT PRIMARY KEY,
            books INTEGER NOT NULL DEFAULT 0,
            minutes INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_reading_states_completed ON reading_states(status, deleted_at, updated_at DESC);
    `);
    initializeReadiveReadingActivity(db);
    db.transaction(() => {
        if (!db.prepare('PRAGMA table_info(reading_activity_events)').all().some(column => column.name === 'reading_epoch_id')) {
            db.exec(`ALTER TABLE reading_activity_events ADD COLUMN reading_epoch_id TEXT NOT NULL DEFAULT '${INITIAL_READING_ACTIVITY_EPOCH}'`);
        }
        if (!db.prepare('PRAGMA table_info(reading_daily_activity)').all().some(column => column.name === 'reading_epoch_id')) {
            db.exec(`
                ALTER TABLE reading_daily_activity RENAME TO reading_daily_activity_legacy;
                CREATE TABLE reading_daily_activity (
                    date TEXT NOT NULL, path TEXT NOT NULL, seconds REAL NOT NULL DEFAULT 0,
                    reading_epoch_id TEXT NOT NULL DEFAULT '${INITIAL_READING_ACTIVITY_EPOCH}',
                    PRIMARY KEY(date, path, reading_epoch_id)
                );
                INSERT INTO reading_daily_activity (date, path, seconds) SELECT date, path, seconds FROM reading_daily_activity_legacy;
                DROP TABLE reading_daily_activity_legacy;
                CREATE INDEX idx_reading_daily_activity_path ON reading_daily_activity(path);
            `);
        }
        if (!db.prepare('PRAGMA table_info(reading_completions)').all().some(column => column.name === 'reading_epoch_id')) {
            db.exec(`
                ALTER TABLE reading_completions RENAME TO reading_completions_legacy;
                CREATE TABLE reading_completions (
                    month TEXT NOT NULL, path TEXT NOT NULL, date TEXT NOT NULL, completed_at TEXT NOT NULL,
                    reading_epoch_id TEXT NOT NULL DEFAULT '${INITIAL_READING_ACTIVITY_EPOCH}',
                    PRIMARY KEY(month, path, reading_epoch_id)
                );
                INSERT INTO reading_completions (month, path, date, completed_at)
                    SELECT month, path, date, completed_at FROM reading_completions_legacy;
                DROP TABLE reading_completions_legacy;
                CREATE INDEX idx_reading_completions_path ON reading_completions(path);
            `);
        }
    })();
    db.prepare('INSERT OR IGNORE INTO library_meta (key, value) VALUES (?, ?)')
        .run(TRACKING_STARTED_KEY, new Date().toISOString());
}

export function recordReadingActivity(db, filePath, activity = {}) {
    const eventId = activity?.eventId;
    const timestamp = value => typeof value === 'number' ? value : Date.parse(value);
    const startedAt = timestamp(activity?.startedAt);
    const endedAt = timestamp(activity?.endedAt);
    if (typeof eventId !== 'string' || !eventId || eventId.length > 200 || eventId.includes('\0')
        || !Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt
        || endedAt - startedAt > MAX_INTERVAL_MS || !Number.isFinite(new Date(startedAt).getTime())
        || !Number.isFinite(new Date(endedAt).getTime())) throw new Error('invalid_reading_activity');
    return db.transaction(() => {
        const epochId = readingActivityIdentity(db).current_epoch_id;
        const overlaps = db.prepare(`SELECT started_at, ended_at FROM reading_activity_events
            WHERE path = ? AND reading_epoch_id = ? AND ended_at > ? AND started_at < ? ORDER BY started_at`)
            .all(filePath, epochId, startedAt, endedAt);
        const inserted = db.prepare(`INSERT OR IGNORE INTO reading_activity_events
            (event_id, path, started_at, ended_at, reading_epoch_id) VALUES (?, ?, ?, ?, ?)`)
            .run(eventId, filePath, startedAt, endedAt, epochId);
        if (!inserted.changes) return { changes: 0, seconds: 0 };
        const add = db.prepare(`INSERT INTO reading_daily_activity (date, path, seconds, reading_epoch_id) VALUES (?, ?, ?, ?)
            ON CONFLICT(date, path, reading_epoch_id) DO UPDATE SET seconds = seconds + excluded.seconds`);
        const intervals = [];
        let cursor = startedAt;
        for (const overlap of overlaps) {
            if (overlap.started_at > cursor) intervals.push([cursor, overlap.started_at]);
            cursor = Math.max(cursor, overlap.ended_at);
            if (cursor >= endedAt) break;
        }
        if (cursor < endedAt) intervals.push([cursor, endedAt]);
        let seconds = 0;
        for (const [start, end] of intervals) {
            cursor = start;
            while (cursor < end) {
                const day = new Date(cursor);
                const midnight = new Date(cursor).setHours(24, 0, 0, 0);
                const segmentEnd = Math.min(end, midnight);
                const duration = (segmentEnd - cursor) / 1000;
                add.run(readingActivityDate(day), filePath, duration, epochId);
                seconds += duration;
                cursor = segmentEnd;
            }
        }
        return { changes: 1, seconds };
    })();
}

export function recordReadingCompletion(db, previous, next, now) {
    if (next.status !== 'completed' || previous.status === 'completed') return;
    const date = readingActivityDate(now);
    db.prepare('INSERT OR IGNORE INTO reading_completions (month, path, date, completed_at, reading_epoch_id) VALUES (?, ?, ?, ?, ?)')
        .run(date.slice(0, 7), next.file_path, date, now, readingActivityIdentity(db).current_epoch_id);
}

export function saveReadingMonthlyGoal(db, month, goal) {
    validateReadingActivityMonth(month);
    const books = goal?.books;
    const minutes = goal?.minutes;
    if (!Number.isInteger(books) || books < 0 || books > 1000
        || !Number.isInteger(minutes) || minutes < 0 || minutes > 50000) throw new Error('invalid_reading_goal');
    db.prepare(`INSERT INTO reading_monthly_goals (month, books, minutes) VALUES (?, ?, ?)
        ON CONFLICT(month) DO UPDATE SET books = excluded.books, minutes = excluded.minutes`).run(month, books, minutes);
    return { month, goal: { books, minutes } };
}

export function readingActivityDashboard(library, db, month, libraryPaths) {
    validateReadingActivityMonth(month);
    const identity = readingActivityIdentity(db);
    const scope = createLibraryPathScope(library, libraryPaths, 'path');
    const activity = db.prepare(`SELECT date, path, seconds FROM reading_daily_activity
        WHERE date >= ? AND date <= ? AND reading_epoch_id = ? ORDER BY date, seconds DESC, path`)
        .all(`${month}-01`, `${month}-31` < readingActivityDate() ? `${month}-31` : readingActivityDate(), identity.current_epoch_id);
    const completions = db.prepare(`SELECT date, path FROM reading_completions
        WHERE month = ? AND reading_epoch_id = ? AND (${scope.where}) ORDER BY date, path`).all(month, identity.current_epoch_id, ...scope.params);
    const synchronized = synchronizedReadingActivity(db, month).filter(record => record.localDate <= readingActivityDate());
    const dayCount = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    const days = Array.from({ length: dayCount }, (_, index) => ({
        date: `${month}-${String(index + 1).padStart(2, '0')}`, seconds: 0, completedCount: 0, books: new Map(),
        hasActivity: false, hasSyncedActivity: false, syncedSeconds: 0, syncedBookKeys: new Set(), pageTurnCount: 0,
    }));
    const byDate = new Map(days.map(day => [day.date, day]));
    for (const item of activity) {
        const day = byDate.get(item.date);
        if (!day) continue;
        day.seconds += item.seconds;
        day.hasActivity = true;
        day.books.set(item.path, { path: item.path, seconds: Math.floor(item.seconds), completed: false });
    }
    for (const record of synchronized) {
        const day = byDate.get(record.localDate);
        if (!day) continue;
        day.seconds = Math.min(Number.MAX_SAFE_INTEGER, day.seconds + record.durationSeconds);
        day.syncedSeconds = Math.min(Number.MAX_SAFE_INTEGER, day.syncedSeconds + record.durationSeconds);
        day.pageTurnCount = Math.min(Number.MAX_SAFE_INTEGER, day.pageTurnCount + record.pageTurnCount);
        day.hasActivity = true;
        day.hasSyncedActivity = true;
        for (const key of record.bookKeys) day.syncedBookKeys.add(key);
    }
    for (const item of completions) {
        const day = byDate.get(item.date);
        if (!day) continue;
        day.completedCount += 1;
        day.books.set(item.path, { path: item.path, seconds: 0, ...day.books.get(item.path), completed: true });
    }
    const shelfScope = createLibraryPathScope(library, libraryPaths, 'files.path');
    const completedWhere = `states.status = 'completed' AND states.deleted_at = '' AND (${shelfScope.where})`;
    const completedCount = db.prepare(`SELECT COUNT(*) AS count FROM reading_states states
        JOIN files ON files.path = states.file_path WHERE ${completedWhere}`).get(...shelfScope.params).count;
    const completedRows = db.prepare(`SELECT files.*, states.updated_at AS reading_state_updated_at,
        (SELECT MAX(completed_at) FROM reading_completions WHERE path = files.path) AS completed_at
        FROM reading_states states JOIN files ON files.path = states.file_path WHERE ${completedWhere}
        ORDER BY COALESCE(completed_at, states.updated_at) DESC, files.path LIMIT 12`).all(...shelfScope.params);
    return {
        month,
        sync: {
            source: 'readive',
            lastSyncedAt: db.prepare('SELECT value FROM library_meta WHERE key = ?').get('readive_reading_activity_synced_at')?.value || '',
            syncedDevices: new Set(synchronized.map(record => record.deviceId)).size,
        },
        trackingStartedAt: db.prepare('SELECT value FROM library_meta WHERE key = ?').get(TRACKING_STARTED_KEY)?.value || '',
        days: days.map(({ syncedBookKeys, ...day }) => ({
            ...day, seconds: Math.floor(day.seconds), bookCount: day.books.size, books: [...day.books.values()].slice(0, 20),
            syncedBookCount: syncedBookKeys.size,
        })),
        totals: {
            seconds: days.reduce((total, day) => total + Math.floor(day.seconds), 0),
            readingDays: days.filter(day => day.hasActivity).length,
            completedBooks: completions.length,
        },
        goal: db.prepare('SELECT books, minutes FROM reading_monthly_goals WHERE month = ?').get(month) || { books: 0, minutes: 0 },
        completedRows,
        completedCount,
    };
}

export function moveReadingActivityPaths(db, move) {
    const pattern = `${`${move.src}${path.sep}`.replace(/[\\%_]/g, '\\$&')}%`;
    const where = move.recursive ? "path = ? OR path LIKE ? ESCAPE '\\'" : 'path = ?';
    const params = move.recursive ? [move.src, pattern] : [move.src];
    const destination = source => move.recursive ? path.resolve(move.dest, path.relative(move.src, source)) : move.dest;
    const readingWhere = move.recursive ? "file_path = ? OR file_path LIKE ? ESCAPE '\\'" : 'file_path = ?';
    const readingRows = db.prepare(`SELECT item_id, file_path, retain_outside_library FROM reading_states WHERE ${readingWhere}`).all(...params);
    const existingReading = db.prepare('SELECT retain_outside_library FROM reading_states WHERE file_path = ?');
    const removeReading = db.prepare('DELETE FROM reading_states WHERE file_path = ?');
    const moveReading = db.prepare('UPDATE reading_states SET file_path = ?, retain_outside_library = ? WHERE item_id = ?');
    for (const row of readingRows) {
        const target = destination(row.file_path);
        if (target === row.file_path) continue;
        const existing = existingReading.get(target);
        // File moves replace destination metadata; keep the moved book's matching reading position and identity.
        if (existing) removeReading.run(target);
        moveReading.run(target, Math.max(row.retain_outside_library, existing?.retain_outside_library || 0), row.item_id);
    }
    for (const row of db.prepare(`SELECT * FROM reading_daily_activity WHERE ${where}`).all(...params)) {
        const target = destination(row.path);
        if (target === row.path) continue;
        db.prepare(`INSERT INTO reading_daily_activity (date, path, seconds, reading_epoch_id) VALUES (?, ?, ?, ?)
            ON CONFLICT(date, path, reading_epoch_id) DO UPDATE SET seconds = seconds + excluded.seconds`).run(row.date, target, row.seconds, row.reading_epoch_id);
        db.prepare('DELETE FROM reading_daily_activity WHERE date = ? AND path = ? AND reading_epoch_id = ?').run(row.date, row.path, row.reading_epoch_id);
    }
    for (const row of db.prepare(`SELECT * FROM reading_completions WHERE ${where}`).all(...params)) {
        const target = destination(row.path);
        if (target === row.path) continue;
        db.prepare(`INSERT INTO reading_completions (month, path, date, completed_at, reading_epoch_id) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(month, path, reading_epoch_id) DO UPDATE SET date = MIN(date, excluded.date), completed_at = MIN(completed_at, excluded.completed_at)`)
            .run(row.month, target, row.date, row.completed_at, row.reading_epoch_id);
        db.prepare('DELETE FROM reading_completions WHERE month = ? AND path = ? AND reading_epoch_id = ?').run(row.month, row.path, row.reading_epoch_id);
    }
    for (const row of db.prepare(`SELECT event_id, path FROM reading_activity_events WHERE ${where}`).all(...params)) {
        db.prepare('UPDATE reading_activity_events SET path = ? WHERE event_id = ?').run(destination(row.path), row.event_id);
    }
}
