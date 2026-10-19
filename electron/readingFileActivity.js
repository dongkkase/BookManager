const ACTIVITY_VERSION_KEY = 'reading_file_activity_dates_version';
const ACTIVITY_VERSION = '2';

export function fileActivityTimestamp(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value <= 0) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function fileActivityDates(entry = {}) {
    const modifiedAt = fileActivityTimestamp(entry.mtimeMs ?? entry.mtime);
    return {
        addedAt: fileActivityTimestamp(entry.birthtimeMs) || modifiedAt,
        modifiedAt,
    };
}

export function initializeReadingFileActivity(db) {
    db.transaction(() => {
        if (!db.pragma('table_info(reading_file_activity)').some(column => column.name === 'metadata_updated_at')) {
            db.exec("ALTER TABLE reading_file_activity ADD COLUMN metadata_updated_at TEXT NOT NULL DEFAULT ''");
        }
        const version = db.prepare('SELECT value FROM library_meta WHERE key = ?').get(ACTIVITY_VERSION_KEY)?.value;
        if (version === ACTIVITY_VERSION) return;
        db.exec(`
            DROP TRIGGER IF EXISTS reading_activity_insert;
            DROP TRIGGER IF EXISTS reading_activity_update;
            INSERT INTO reading_file_activity(path, added_at, updated_at, metadata_updated_at)
            SELECT path,
                CASE WHEN mtime > 0 THEN COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', mtime, 'unixepoch'), '') ELSE '' END,
                CASE WHEN mtime > 0 THEN COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', mtime, 'unixepoch'), '') ELSE '' END,
                ''
            FROM files WHERE 1
            ON CONFLICT(path) DO UPDATE SET
                added_at = excluded.added_at,
                updated_at = excluded.updated_at,
                metadata_updated_at = '';
            CREATE TRIGGER reading_activity_insert AFTER INSERT ON files BEGIN
                INSERT OR IGNORE INTO reading_file_activity(path, added_at, updated_at)
                VALUES (new.path,
                    CASE WHEN new.mtime > 0 THEN COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', new.mtime, 'unixepoch'), '') ELSE '' END,
                    CASE WHEN new.mtime > 0 THEN COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', new.mtime, 'unixepoch'), '') ELSE '' END);
            END;
            CREATE TRIGGER reading_activity_update AFTER UPDATE OF mtime ON files
            WHEN old.mtime IS NOT new.mtime BEGIN
                INSERT INTO reading_file_activity(path, added_at, updated_at)
                VALUES (new.path, '',
                    CASE WHEN new.mtime > 0 THEN COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', new.mtime, 'unixepoch'), '') ELSE '' END)
                ON CONFLICT(path) DO UPDATE SET updated_at = MAX(excluded.updated_at, metadata_updated_at);
            END;
        `);
        db.prepare('INSERT INTO library_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(ACTIVITY_VERSION_KEY, ACTIVITY_VERSION);
    })();
}

export function markReadingFileMetadataUpdated(db, filePath) {
    const updatedAt = new Date().toISOString();
    db.prepare(`
        INSERT INTO reading_file_activity(path, metadata_updated_at, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            metadata_updated_at = excluded.metadata_updated_at,
            updated_at = MAX(updated_at, excluded.metadata_updated_at)
    `).run(filePath, updatedAt, updatedAt);
}
