import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { detectImageMimeType } from '../imageMagic.js';
import { assertNoSymlinks, openFrozenAsset } from './manifest.js';
import { resolveReadiveLibraryPath } from './catalog.js';
import { fail } from './policy.js';

const MAX_THUMBNAIL_BYTES = 512 * 1024;
const MAX_THUMBNAIL_DIMENSION = 2048;
const MAX_FOLDER_CANDIDATES = 32;
const MAX_METADATA_BYTES = 64 * 1024;
const METADATA_FIELDS = {
    Title: 'title', Series: 'series', SeriesGroup: 'series_group', Volume: 'volume',
    Number: 'number', Writer: 'writer', Creator: 'creators', Penciller: 'penciller',
    Inker: 'inker', Colorist: 'colorist', Letterer: 'letterer', CoverArtist: 'cover_artist',
    Editor: 'editor', Publisher: 'publisher', Imprint: 'imprint', Genre: 'genre',
    Count: 'volume_count', PageCount: 'page_count', Format: 'format', Manga: 'manga',
    LanguageISO: 'language', CommunityRating: 'rating', AgeRating: 'age_rating',
    Summary: 'summary', Characters: 'characters', Teams: 'teams', Locations: 'locations',
    StoryArc: 'story_arc', Tags: 'tags', Notes: 'notes', Web: 'web', ISBN: 'isbn', Resolution: 'resolution',
};
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const identity = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, birthtimeMs: stat.birthtimeMs });
const unchanged = (before, after) => Object.entries(identity(before)).every(([key, value]) => after[key] === value);
const cancelled = signal => { if (signal?.aborted) throw fail('catalog_cancelled', 409); };

export class ReadivePreviewRequests {
    constructor() {
        this.active = new Set();
    }

    clear() {
        for (const controller of this.active) controller.abort();
    }

    async run(operation, signal) {
        cancelled(signal);
        if (this.active.size >= 4) throw fail('catalog_busy', 429);
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        this.active.add(controller);
        try {
            const result = await operation(controller.signal);
            cancelled(controller.signal);
            return result;
        } finally {
            signal?.removeEventListener('abort', abort);
            this.active.delete(controller);
        }
    }
}

function metadataFromRecord(record) {
    if (!record) return null;
    const metadata = {};
    for (const [name, column] of Object.entries(METADATA_FIELDS)) {
        const value = record[column];
        if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) continue;
        const bounded = typeof value === 'string' ? value.trim().slice(0, name === 'Summary' || name === 'Notes' ? 8192 : 2048) : value;
        if (bounded !== '') metadata[name] = bounded;
    }
    const date = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(String(record.publish_date || '').trim());
    if (date) {
        metadata.Year = date[1];
        if (date[2] && Number(date[2]) >= 1 && Number(date[2]) <= 12) metadata.Month = date[2];
        if (metadata.Month && date[3] && Number(date[3]) >= 1 && Number(date[3]) <= 31) metadata.Day = date[3];
    }
    // Each field is independently optional; keep the total JSON response bounded too.
    while (Buffer.byteLength(JSON.stringify(metadata)) > MAX_METADATA_BYTES) delete metadata[Object.keys(metadata).at(-1)];
    return Object.keys(metadata).length ? metadata : null;
}

function recordMatches(record, stat) {
    const mtime = Number(record?.mtime);
    return record && Number(record.size) === stat.size && mtime > 0
        && (Math.abs(mtime - stat.mtimeMs) < 1 || Math.abs(mtime * 1000 - stat.mtimeMs) < 1);
}

function dimensions(bytes, mimeType) {
    let width;
    let height;
    if (mimeType === 'image/png' && bytes.length >= 33 && bytes.toString('ascii', 12, 16) === 'IHDR') {
        width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
    } else if (mimeType === 'image/gif' && bytes.length >= 13) {
        width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
    } else if (mimeType === 'image/bmp' && bytes.length >= 26) {
        const headerSize = bytes.readUInt32LE(14);
        if (headerSize === 12) { width = bytes.readUInt16LE(18); height = bytes.readUInt16LE(20); }
        else if (headerSize >= 40 && bytes.length >= 54) { width = bytes.readInt32LE(18); height = Math.abs(bytes.readInt32LE(22)); }
    } else if (mimeType === 'image/webp' && bytes.length >= 25 && bytes.readUInt32LE(4) + 8 === bytes.length) {
        const chunk = bytes.toString('ascii', 12, 16);
        if (chunk === 'VP8X' && bytes.length >= 30) { width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1; }
        else if (chunk === 'VP8L' && bytes[20] === 0x2f) {
            const bits = bytes.readUInt32LE(21);
            width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        } else if (chunk === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
            width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
        }
    } else if (mimeType === 'image/jpeg') {
        let offset = 2;
        while (offset + 4 <= bytes.length) {
            if (bytes[offset++] !== 0xff) break;
            while (bytes[offset] === 0xff) offset += 1;
            const marker = bytes[offset++];
            if (marker === 0xd9 || marker === 0xda) break;
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
            if (offset + 2 > bytes.length) break;
            const length = bytes.readUInt16BE(offset);
            if (length < 2 || offset + length > bytes.length) break;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
                height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
            }
            offset += length;
        }
    }
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
        && width <= MAX_THUMBNAIL_DIMENSION && height <= MAX_THUMBNAIL_DIMENSION
        && width * height <= MAX_THUMBNAIL_DIMENSION ** 2 ? { width, height } : null;
}

async function readThumbnail(record, libraryDb, signal) {
    const thumbnailPath = record?.thumb_path;
    if (typeof thumbnailPath !== 'string' || !thumbnailPath || !libraryDb?.dbPath || libraryDb.dbPath === ':memory:') return null;
    let absolutePath = path.resolve(thumbnailPath);
    const dataDirectory = path.dirname(path.resolve(libraryDb.dbPath));
    const cacheDirectories = ['thumbnails', 'text-thumbnails'];
    const owned = cacheDirectories.some(name => absolutePath.startsWith(path.join(dataDirectory, name) + path.sep));
    if (!owned) {
        const cacheDirectory = path.basename(path.dirname(absolutePath));
        if (!cacheDirectories.includes(cacheDirectory)) return null;
        // The PC thumbnail protocol resolves retained cache filenames against the current data directory too.
        absolutePath = path.join(dataDirectory, cacheDirectory, path.basename(absolutePath));
    }
    let handle;
    try {
        cancelled(signal);
        await assertNoSymlinks(absolutePath);
        if (await fs.realpath(absolutePath) !== absolutePath) return null;
        const before = await fs.lstat(absolutePath);
        if (!before.isFile() || before.size < 1 || before.size > MAX_THUMBNAIL_BYTES) return null;
        handle = await openFrozenAsset({ sourcePath: absolutePath, identity: identity(before) });
        // Read at most the inspected size, even if another process grows the thumbnail.
        const bytes = Buffer.alloc(before.size);
        let read = 0;
        while (read < bytes.length) {
            cancelled(signal);
            const next = await handle.read(bytes, read, bytes.length - read, read);
            if (!next.bytesRead) return null;
            read += next.bytesRead;
        }
        const mimeType = detectImageMimeType(bytes);
        const size = dimensions(bytes, mimeType);
        if (!size || !unchanged(before, await handle.stat())) return null;
        await assertNoSymlinks(absolutePath);
        if (!unchanged(before, await fs.lstat(absolutePath))) return null;
        cancelled(signal);
        return { mimeType, byteLength: bytes.length, sha256: digest(bytes), base64: bytes.toString('base64'), ...size };
    } catch (error) {
        cancelled(signal);
        return null;
    } finally {
        await handle?.close();
    }
}

async function folderCandidates(libraryDb, sourcePath) {
    if (!libraryDb?.withLock || !libraryDb?.getConnection) return [];
    const normalized = libraryDb.normalizeFilePath(sourcePath);
    const prefix = `${normalized}${path.sep}`.replace(/[\\%_]/g, value => `\\${value}`);
    return libraryDb.withLock(async () => libraryDb.getConnection().prepare(
        "SELECT path, size, mtime, thumb_path FROM files WHERE path LIKE ? ESCAPE '\\' AND thumb_path IS NOT NULL AND thumb_path <> '' ORDER BY path LIMIT ?",
    ).all(`${prefix}%`, MAX_FOLDER_CANDIDATES));
}

export async function readReadivePreview(scope, relativePath, libraryDb, signal) {
    cancelled(signal);
    const { sourcePath, stat } = await resolveReadiveLibraryPath(scope, relativePath);
    cancelled(signal);
    let metadata = null;
    let thumbnail = null;
    let representative = null;
    if (stat.isFile()) {
        const record = libraryDb?.getFileInfo ? await libraryDb.getFileInfo(sourcePath) : null;
        cancelled(signal);
        if (recordMatches(record, stat)) {
            metadata = metadataFromRecord(record);
            thumbnail = await readThumbnail(record, libraryDb, signal);
        }
    } else {
        const candidates = await folderCandidates(libraryDb, sourcePath);
        for (const record of candidates) {
            cancelled(signal);
            const candidatePath = path.relative(libraryDb.normalizeFilePath(scope.rootPath), record.path).split(path.sep).join('/');
            try {
                if (!record.path.startsWith(libraryDb.normalizeFilePath(sourcePath) + path.sep)) continue;
                const candidate = await resolveReadiveLibraryPath(scope, candidatePath);
                if (!candidate.stat.isFile() || !recordMatches(record, candidate.stat)) continue;
                thumbnail = await readThumbnail(record, libraryDb, signal);
                if (!thumbnail) continue;
                const after = await resolveReadiveLibraryPath(scope, candidatePath);
                if (!unchanged(candidate.stat, after.stat)) throw fail('source_changed', 409);
                representative = { path: candidatePath, identity: identity(candidate.stat) };
                break;
            } catch (error) {
                cancelled(signal);
                thumbnail = null;
            }
        }
    }
    const after = await resolveReadiveLibraryPath(scope, relativePath);
    cancelled(signal);
    if (!unchanged(stat, after.stat)) throw fail('source_changed', 409);
    return {
        path: relativePath,
        sourceVersion: digest(JSON.stringify({ version: 1, scope: scope.approvalId, source: identity(stat), representative,
            metadata, thumbnail: thumbnail?.sha256 ?? null })),
        metadata,
        thumbnail,
    };
}
