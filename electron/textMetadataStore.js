import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { detectImageMimeType, supportedImageExtensionForMimeType } from './imageMagic.js';

const MAX_COVER_BYTES = 16 * 1024 * 1024;
const METADATA_FIELDS = {
    Title: 'title', Series: 'series', SeriesGroup: 'series_group', Volume: 'volume',
    Number: 'number', Writer: 'writer', Creator: 'creators', Penciller: 'penciller',
    Inker: 'inker', Colorist: 'colorist', Letterer: 'letterer', CoverArtist: 'cover_artist',
    Editor: 'editor', Publisher: 'publisher', Imprint: 'imprint', Genre: 'genre',
    Count: 'volume_count', PageCount: 'page_count', Format: 'format', Manga: 'manga',
    LanguageISO: 'language', CommunityRating: 'rating', AgeRating: 'age_rating',
    Summary: 'summary', Characters: 'characters', Teams: 'teams', Locations: 'locations',
    StoryArc: 'story_arc', Tags: 'tags', Notes: 'notes', Web: 'web', ISBN: 'isbn',
};

export function isTextMetadataPath(filePath = '') {
    return path.extname(String(filePath)).toLowerCase() === '.txt';
}

function sameFileState(left, right) {
    return left.size === right.size && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs && left.ino === right.ino && left.dev === right.dev;
}

async function textFileIdentity(filePath) {
    if (!isTextMetadataPath(filePath)) throw new Error('Text metadata requires a TXT file.');
    const handle = await fs.open(filePath, 'r');
    try {
        const before = await handle.stat();
        if (!before.isFile()) throw new Error('Text metadata requires a regular file.');
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await fs.stat(filePath);
        if (!sameFileState(before, after)) throw new Error('The TXT file changed while its content was being read.');
        return { contentHash: hash.digest('hex'), stat: after };
    } finally {
        await handle.close();
    }
}

export async function getTextContentHash(filePath) {
    return (await textFileIdentity(filePath)).contentHash;
}

function currentRecord(filePath, stat, record, coverPath) {
    return {
        ...record,
        path: filePath,
        mtime: stat.mtimeMs / 1000,
        size: stat.size,
        ext: '.txt',
        book_type: 'book',
        has_metadata: 1,
        metadata_override: 1,
        cover_override_path: coverPath,
        thumb_path: coverPath,
    };
}

function legacyMetadata(record) {
    const metadata = Object.fromEntries(Object.entries(METADATA_FIELDS).map(
        ([field, column]) => [field, record[column] ?? ''],
    ));
    const [year = '', month = '', day = ''] = String(record.publish_date || '').split('-');
    return { ...metadata, Year: year, Month: month, Day: day };
}

function hasLegacyMetadata(record, filePath, stat) {
    if (!record) return false;
    if (Number(record.size) > 0 && Number(record.size) !== stat.size) return false;
    if (Number(record.mtime) > 0 && Number(record.mtime) !== stat.mtimeMs / 1000) return false;
    if (Number(record.metadata_override) === 1 || Number(record.has_metadata) === 1) return true;
    if (record.cover_override_path) return true;
    const defaultTitle = path.basename(filePath, path.extname(filePath));
    if (record.title && record.title !== defaultTitle && record.title !== path.basename(filePath)) return true;
    const legacySaveWithoutFlags = record.has_metadata === '' && record.metadata_override === '';
    return Object.values(METADATA_FIELDS).some(column => (
        (legacySaveWithoutFlags || !['title', 'series', 'volume', 'number', 'format', 'page_count', 'language'].includes(column))
        && column !== 'title'
        && String(record[column] ?? '').trim() !== ''
    ));
}

function coverExtension(buffer) {
    const extension = supportedImageExtensionForMimeType(detectImageMimeType(buffer));
    if (!extension) throw new Error('The text cover must be a PNG, JPEG, GIF, WebP, or BMP image.');
    return extension;
}

function coverDirectory(libraryDb, thumbnailDir) {
    const parent = libraryDb?.dbPath && libraryDb.dbPath !== ':memory:'
        ? path.dirname(libraryDb.dbPath)
        : thumbnailDir ? path.dirname(thumbnailDir) : '';
    if (!parent) throw new Error('The text metadata storage directory is unavailable.');
    return path.join(parent, 'text-thumbnails');
}

async function writeCover(sourcePath, directory, contentHash) {
    const handle = await fs.open(sourcePath, 'r');
    let buffer;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_COVER_BYTES) {
            throw new Error('The text cover must be an image no larger than 16 MiB.');
        }
        buffer = await handle.readFile();
        if (buffer.length > MAX_COVER_BYTES) throw new Error('The text cover must be no larger than 16 MiB.');
    } finally {
        await handle.close();
    }
    const extension = coverExtension(buffer);
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${contentHash}-${randomUUID()}${extension}`);
    const temporary = `${destination}.tmp`;
    try {
        await fs.writeFile(temporary, buffer, { flag: 'wx' });
        await fs.rename(temporary, destination);
        return destination;
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

async function existingCoverPath(stored) {
    if (!stored?.coverPath) return '';
    try {
        return (await fs.stat(stored.coverPath)).isFile() ? stored.coverPath : '';
    } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }
}

async function missingLinkedPaths(libraryDb, contentHash, currentPath) {
    const paths = await libraryDb.getTextMetadataPaths(contentHash);
    const missing = await Promise.all(paths.filter(filePath => filePath !== currentPath).map(async filePath => {
        try {
            await fs.stat(filePath);
            return '';
        } catch (error) {
            return ['ENOENT', 'ENOTDIR'].includes(error.code) ? filePath : '';
        }
    }));
    return missing.filter(Boolean);
}

async function matchingLinkedRecords(libraryDb, identity, filePath, record, coverPath) {
    const currentPath = libraryDb.normalizeFilePath(path.resolve(filePath));
    const linkedPaths = await libraryDb.getTextMetadataPaths(identity.contentHash);
    const records = [];
    for (const linkedPath of linkedPaths) {
        if (libraryDb.normalizeFilePath(path.resolve(linkedPath)) === currentPath) continue;
        try {
            const linkedIdentity = await textFileIdentity(linkedPath);
            if (linkedIdentity.contentHash === identity.contentHash) {
                records.push(currentRecord(linkedPath, linkedIdentity.stat, record, coverPath));
            }
        } catch {
            // 읽을 수 없거나 읽는 동안 변경된 복사본의 검색 메타데이터는 덮어쓰지 않습니다.
        }
    }
    return records;
}

async function saveWithIdentity(filePath, identity, options) {
    const { libraryDb, metadata, record, coverChange, thumbnailDir } = options;
    const storedMetadata = JSON.parse(JSON.stringify(metadata ?? {}));
    const previous = await libraryDb.getTextMetadata(identity.contentHash);
    let coverPath = await existingCoverPath(previous);
    let newCover = '';
    if (coverChange?.type === 'file') {
        newCover = await writeCover(coverChange.filePath, coverDirectory(libraryDb, thumbnailDir), identity.contentHash);
        coverPath = newCover;
    } else if (coverChange?.type === 'reset') {
        coverPath = '';
    } else if (coverChange) {
        throw new Error('Unsupported text cover change.');
    }
    const result = {
        metadata: storedMetadata,
        record: currentRecord(filePath, identity.stat, record ?? {}, coverPath),
        contentHash: identity.contentHash,
        coverPath,
    };
    try {
        const relatedRecords = await matchingLinkedRecords(libraryDb, identity, filePath, record ?? {}, coverPath);
        if (!sameFileState(identity.stat, await fs.stat(filePath))) {
            throw new Error('The TXT file changed before its metadata could be saved.');
        }
        await libraryDb.saveTextMetadataRecord({ ...result, relatedRecords });
    } catch (error) {
        if (newCover) await fs.rm(newCover, { force: true }).catch(() => {});
        throw error;
    }
    return result;
}

export async function saveTextMetadata(filePath, options = {}) {
    if (typeof options.libraryDb?.saveTextMetadataRecord !== 'function') {
        throw new Error('The text metadata database is unavailable.');
    }
    const identity = await textFileIdentity(filePath);
    if (options.expectedContentHash && options.expectedContentHash !== identity.contentHash) {
        throw new Error('The TXT file content has changed. Reload the file before saving metadata.');
    }
    return saveWithIdentity(filePath, identity, options);
}

export async function resolveTextMetadata(filePath, { libraryDb } = {}) {
    if (!isTextMetadataPath(filePath) || typeof libraryDb?.getTextMetadata !== 'function') return null;
    const identity = await textFileIdentity(filePath);
    const stored = await libraryDb.getTextMetadata(identity.contentHash);
    if (stored) {
        const coverPath = await existingCoverPath(stored);
        const result = {
            ...stored,
            record: currentRecord(filePath, identity.stat, stored.record, coverPath),
            coverPath,
        };
        await libraryDb.linkTextMetadataRecord({
            ...result,
            missingPaths: await missingLinkedPaths(libraryDb, identity.contentHash, filePath),
        });
        return result;
    }
    if (await libraryDb.getTextMetadataPathHash(filePath)) return null;
    const legacy = await libraryDb.getFileInfo(filePath);
    if (!hasLegacyMetadata(legacy, filePath, identity.stat)) return null;
    const legacyCover = await existingCoverPath({ coverPath: legacy.cover_override_path });
    return saveWithIdentity(filePath, identity, {
        libraryDb,
        metadata: legacyMetadata(legacy),
        record: legacy,
        coverChange: legacyCover ? { type: 'file', filePath: legacyCover } : undefined,
    });
}
