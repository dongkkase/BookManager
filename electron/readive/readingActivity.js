import crypto from 'node:crypto';
import { fail } from './policy.js';

export const INITIAL_READING_ACTIVITY_EPOCH = 'reading_statistics_epoch_initial_v1';
const IDENTITY_ID = 'reading_activity_source';
const RESET_ID = 'reading_statistics_reset';
const PAGE_SIZE = 50;
const DAY_KEYS = new Set(['bookKeys', 'deletedAt', 'deviceId', 'durationSeconds', 'epochId', 'localDate', 'pageTurnCount', 'revision', 'updatedAt', 'writerDeviceId']);
const RESET_KEYS = new Set(['deletedAt', 'epochId', 'id', 'resetAt', 'revision', 'updatedAt', 'writerDeviceId']);

export function initializeReadiveReadingActivity(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS local_reading_activity_identity (
            id TEXT PRIMARY KEY NOT NULL CHECK(id = 'reading_activity_source'),
            source_id TEXT NOT NULL,
            current_epoch_id TEXT NOT NULL,
            pending_reset_epoch_id TEXT
        );
        CREATE TABLE IF NOT EXISTS synced_reading_activity_days (
            device_id TEXT NOT NULL,
            local_date TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0),
            page_turn_count INTEGER NOT NULL CHECK(page_turn_count >= 0),
            book_keys_json TEXT NOT NULL,
            epoch_id TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK(revision > 0),
            writer_device_id TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            PRIMARY KEY(device_id, local_date),
            CHECK(writer_device_id = device_id)
        );
        CREATE INDEX IF NOT EXISTS idx_synced_reading_activity_days_epoch_date
            ON synced_reading_activity_days(epoch_id, local_date, deleted_at);
        CREATE TABLE IF NOT EXISTS synced_reading_statistics_resets (
            id TEXT PRIMARY KEY NOT NULL CHECK(id = 'reading_statistics_reset'),
            epoch_id TEXT NOT NULL,
            reset_at TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK(revision > 0),
            writer_device_id TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT CHECK(deleted_at IS NULL)
        );
    `);
    db.prepare(`INSERT OR IGNORE INTO local_reading_activity_identity
        (id, source_id, current_epoch_id, pending_reset_epoch_id) VALUES (?, ?, ?, NULL)`)
        .run(IDENTITY_ID, `reading_activity_source_${crypto.randomBytes(16).toString('hex')}`, INITIAL_READING_ACTIVITY_EPOCH);
}

export function readingActivityIdentity(db) {
    return db.prepare('SELECT * FROM local_reading_activity_identity WHERE id = ?').get(IDENTITY_ID);
}

function identifier(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\0')) throw fail('invalid_reading_activity');
    return value.trim().normalize('NFC');
}

function isoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
        || !Number.isFinite(Date.parse(value))) throw fail('invalid_reading_activity');
    return value;
}

function localDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
        || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw fail('invalid_reading_activity');
    return value;
}

function nonnegativeInteger(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw fail('invalid_reading_activity');
    return value;
}

function versioned(record, keys) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
        || Object.keys(record).some(key => !keys.has(key))) throw fail('invalid_reading_activity');
    const revision = nonnegativeInteger(record.revision);
    if (!revision) throw fail('invalid_reading_activity');
    return {
        revision, writerDeviceId: identifier(record.writerDeviceId), updatedAt: isoDate(record.updatedAt),
        deletedAt: record.deletedAt === null ? null : isoDate(record.deletedAt),
    };
}

export function validateReadiveActivityDay(record) {
    const version = versioned(record, DAY_KEYS);
    const deviceId = identifier(record.deviceId);
    if (version.writerDeviceId !== deviceId || !Array.isArray(record.bookKeys) || record.bookKeys.length > 256) throw fail('invalid_reading_activity');
    const bookKeys = record.bookKeys.map(identifier);
    if (bookKeys.some((key, index) => !/^reading_book_[0-9a-f]{64}$/.test(key) || (index > 0 && bookKeys[index - 1] >= key))) throw fail('invalid_reading_activity');
    return {
        ...version, bookKeys, deviceId, durationSeconds: nonnegativeInteger(record.durationSeconds),
        epochId: identifier(record.epochId), localDate: localDate(record.localDate), pageTurnCount: nonnegativeInteger(record.pageTurnCount),
    };
}

function validateReset(record) {
    if (record === null || record === undefined) return null;
    const version = versioned(record, RESET_KEYS);
    if (record.id !== RESET_ID || version.deletedAt !== null) throw fail('invalid_reading_activity');
    return { ...version, id: RESET_ID, epochId: identifier(record.epochId), resetAt: isoDate(record.resetAt) };
}

function newer(incoming, current) {
    if (!current) return true;
    if (incoming.revision !== current.revision) return incoming.revision > current.revision;
    if ((incoming.deletedAt !== null) !== (current.deletedAt !== null)) return incoming.deletedAt !== null;
    const writer = incoming.writerDeviceId.localeCompare(current.writerDeviceId);
    return writer ? writer > 0 : incoming.updatedAt.localeCompare(current.updatedAt) > 0;
}

function dayRecord(row) {
    return {
        bookKeys: JSON.parse(row.book_keys_json), deletedAt: row.deleted_at, deviceId: row.device_id,
        durationSeconds: row.duration_seconds, epochId: row.epoch_id, localDate: row.local_date,
        pageTurnCount: row.page_turn_count, revision: row.revision, updatedAt: row.updated_at, writerDeviceId: row.writer_device_id,
    };
}

function resetRecord(row) {
    return row ? {
        deletedAt: null, epochId: row.epoch_id, id: row.id, resetAt: row.reset_at,
        revision: row.revision, updatedAt: row.updated_at, writerDeviceId: row.writer_device_id,
    } : null;
}

function writeDay(db, record) {
    db.prepare(`INSERT INTO synced_reading_activity_days
        (device_id, local_date, duration_seconds, page_turn_count, book_keys_json, epoch_id, revision, writer_device_id, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id, local_date) DO UPDATE SET duration_seconds = excluded.duration_seconds,
        page_turn_count = excluded.page_turn_count, book_keys_json = excluded.book_keys_json, epoch_id = excluded.epoch_id,
        revision = excluded.revision, writer_device_id = excluded.writer_device_id, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`)
        .run(record.deviceId, record.localDate, record.durationSeconds, record.pageTurnCount, JSON.stringify(record.bookKeys),
            record.epochId, record.revision, record.writerDeviceId, record.updatedAt, record.deletedAt);
}

export function captureLocalReadingActivity(db, now = new Date().toISOString()) {
    const identity = readingActivityIdentity(db);
    const rows = db.prepare('SELECT date, path, seconds FROM reading_daily_activity WHERE reading_epoch_id = ? ORDER BY date, path')
        .all(identity.current_epoch_id);
    const dates = new Map();
    for (const row of rows) {
        const aggregate = dates.get(row.date) || { seconds: 0, bookKeys: new Set() };
        aggregate.seconds = Math.min(Number.MAX_SAFE_INTEGER, aggregate.seconds + row.seconds);
        const digest = crypto.createHash('sha256').update(`deviceBook\0${identity.source_id}\0${row.path}`).digest('hex');
        aggregate.bookKeys.add(`reading_book_${digest}`);
        dates.set(row.date, aggregate);
    }
    let changed = false;
    for (const [date, aggregate] of dates) {
        const row = db.prepare('SELECT * FROM synced_reading_activity_days WHERE device_id = ? AND local_date = ?').get(identity.source_id, date);
        const bookKeys = [...aggregate.bookKeys].sort().slice(0, 256);
        const seconds = Math.floor(aggregate.seconds);
        if (row?.epoch_id === identity.current_epoch_id && row.deleted_at === null && row.duration_seconds === seconds
            && row.page_turn_count === 0 && row.book_keys_json === JSON.stringify(bookKeys)) continue;
        writeDay(db, {
            bookKeys, deletedAt: null, deviceId: identity.source_id, durationSeconds: seconds, epochId: identity.current_epoch_id,
            localDate: date, pageTurnCount: 0, revision: (row?.revision || 0) + 1, updatedAt: now, writerDeviceId: identity.source_id,
        });
        changed = true;
    }
    return changed;
}

export function synchronizedReadingActivity(db, month) {
    const identity = readingActivityIdentity(db);
    return db.prepare(`SELECT * FROM synced_reading_activity_days
        WHERE device_id <> ? AND epoch_id = ? AND deleted_at IS NULL AND local_date BETWEEN ? AND ? ORDER BY local_date, device_id`)
        .all(identity.source_id, identity.current_epoch_id, `${month}-01`, `${month}-31`).map(dayRecord);
}

function decodeCursor(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw fail('invalid_reading_activity_cursor');
    try {
        const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (!Array.isArray(cursor) || cursor.length !== 2) throw new Error('invalid');
        return [identifier(cursor[0]), localDate(cursor[1])];
    } catch { throw fail('invalid_reading_activity_cursor'); }
}

export async function exchangeReadingActivity(body, libraryDb, validateActive = () => {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['records', 'reset', 'cursor'].includes(key))
        || !Array.isArray(body.records) || body.records.length > 200) throw fail('invalid_reading_activity');
    const records = body.records.map(validateReadiveActivityDay);
    const reset = validateReset(body.reset);
    const cursor = decodeCursor(body.cursor);
    if (!libraryDb || libraryDb.readOnly) throw fail('reading_activity_unavailable', 503);
    return libraryDb.withLock(() => {
        validateActive();
        const db = libraryDb.getConnection();
        return db.transaction(() => {
            const identity = readingActivityIdentity(db);
            const currentReset = resetRecord(db.prepare('SELECT * FROM synced_reading_statistics_resets WHERE id = ?').get(RESET_ID));
            let changed = !db.prepare('SELECT value FROM library_meta WHERE key = ?').get('readive_reading_activity_synced_at');
            if (reset && newer(reset, currentReset)) {
                db.prepare(`INSERT INTO synced_reading_statistics_resets
                    (id, epoch_id, reset_at, revision, writer_device_id, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)
                    ON CONFLICT(id) DO UPDATE SET epoch_id = excluded.epoch_id, reset_at = excluded.reset_at,
                    revision = excluded.revision, writer_device_id = excluded.writer_device_id, updated_at = excluded.updated_at`)
                    .run(reset.id, reset.epochId, reset.resetAt, reset.revision, reset.writerDeviceId, reset.updatedAt);
                db.prepare('UPDATE local_reading_activity_identity SET current_epoch_id = ? WHERE id = ?').run(reset.epochId, IDENTITY_ID);
                changed = true;
            }
            for (const record of records) {
                // A cloud relay may return our own snapshot; only this device writes its cumulative totals.
                if (record.deviceId === identity.source_id) continue;
                const row = db.prepare('SELECT * FROM synced_reading_activity_days WHERE device_id = ? AND local_date = ?').get(record.deviceId, record.localDate);
                if (newer(record, row ? dayRecord(row) : null)) {
                    writeDay(db, record);
                    changed = true;
                }
            }
            changed = captureLocalReadingActivity(db) || changed;
            const rows = db.prepare(`SELECT * FROM synced_reading_activity_days
                ${cursor ? 'WHERE device_id > ? OR (device_id = ? AND local_date > ?)' : ''}
                ORDER BY device_id, local_date LIMIT ?`)
                .all(...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), PAGE_SIZE + 1);
            const page = rows.slice(0, PAGE_SIZE);
            const last = page.at(-1);
            const now = new Date().toISOString();
            db.prepare('INSERT OR REPLACE INTO library_meta (key, value) VALUES (?, ?)').run('readive_reading_activity_synced_at', now);
            return {
                changed,
                records: page.map(dayRecord),
                reset: resetRecord(db.prepare('SELECT * FROM synced_reading_statistics_resets WHERE id = ?').get(RESET_ID)),
                epochId: readingActivityIdentity(db).current_epoch_id,
                nextCursor: rows.length > PAGE_SIZE ? Buffer.from(JSON.stringify([last.device_id, last.local_date])).toString('base64url') : null,
            };
        })();
    });
}
