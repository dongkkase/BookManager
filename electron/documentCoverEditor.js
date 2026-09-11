import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LibraryDB } from './database/library_db.js';
import { isAudioPath } from './audioMetadata.js';
import { writeAudioMetadataFile } from './audioMetadataWriter.js';
import { detectImageMimeType, supportedImageExtensionForMimeType, supportedImageMimeTypeForPath } from './imageMagic.js';
import { getTextContentHash, resolveTextMetadata, saveTextMetadata } from './textMetadataStore.js';

const MAX_COVER_BYTES = 16 * 1024 * 1024;
export const LOCAL_COVER_OVERRIDE_PREFIX = 'local-cover-override-';

async function readCoverImage(imagePath) {
    const handle = await fs.open(imagePath, 'r');
    let buffer;
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_COVER_BYTES) {
            throw new Error('The cover must be an image no larger than 16 MiB.');
        }
        buffer = await handle.readFile();
    } finally {
        await handle.close();
    }
    if (buffer.length > MAX_COVER_BYTES) throw new Error('The cover must be no larger than 16 MiB.');
    const mimeType = detectImageMimeType(buffer);
    if (!mimeType || mimeType !== supportedImageMimeTypeForPath(imagePath)) {
        throw new Error('The cover must be a valid PNG, JPEG, GIF, WebP, or BMP image.');
    }
    return { buffer, mimeType };
}

async function withLibraryDb(options, callback) {
    const libraryDb = options.libraryDb || new LibraryDB({ dbPath: options.dbPath });
    try {
        return await callback(libraryDb);
    } finally {
        if (!options.libraryDb) await libraryDb.close();
    }
}

export async function writeAudioCoverOnly(filePath, imagePath, options = {}) {
    let cover = await readCoverImage(imagePath);
    if (!['image/jpeg', 'image/png'].includes(cover.mimeType)) {
        if (typeof options.normalizeEpubCoverImage !== 'function') {
            throw new Error('Audiobook covers must be JPEG or PNG images.');
        }
        const normalized = await options.normalizeEpubCoverImage(cover.buffer, imagePath, cover.mimeType);
        const buffer = normalized?.buffer ? Buffer.from(normalized.buffer) : null;
        const mimeType = normalized?.mimeType || normalized?.mediaType || '';
        if (!buffer?.length || buffer.length > MAX_COVER_BYTES
            || !['image/jpeg', 'image/png'].includes(mimeType) || detectImageMimeType(buffer) !== mimeType) {
            throw new Error('The cover could not be converted to JPEG or PNG.');
        }
        cover = { buffer, mimeType };
    }
    await writeAudioMetadataFile(filePath, {}, {
        cover: { ...cover, description: path.basename(imagePath) },
        coverOnly: true,
        useWorker: options.useWorker,
    });
    return {};
}

export async function saveTextCoverOnly(filePath, imagePath, options = {}) {
    await readCoverImage(imagePath);
    const contentHash = await getTextContentHash(filePath);
    if (options.expectedContentHash && options.expectedContentHash !== contentHash) {
        throw new Error('The TXT file content has changed. Reload the file before saving its cover.');
    }
    return withLibraryDb(options, async libraryDb => {
        const stored = await resolveTextMetadata(filePath, { libraryDb });
        const existing = stored?.record || await libraryDb.getFileInfo(filePath);
        const linkedHash = await libraryDb.getTextMetadataPathHash(filePath);
        const stat = await fs.stat(filePath);
        const canUseExisting = !linkedHash || linkedHash === contentHash;
        const record = stored?.record || (canUseExisting && existing
            && Number(existing.size) === stat.size && Number(existing.mtime) === stat.mtimeMs / 1000
            ? existing : { title: path.basename(filePath, path.extname(filePath)) });
        const saved = await saveTextMetadata(filePath, {
            libraryDb,
            metadata: stored?.metadata || {},
            record,
            coverChange: { type: 'file', filePath: imagePath },
            thumbnailDir: options.thumbnailDir,
            expectedContentHash: contentHash,
        });
        return { coverPath: saved.coverPath, contentHash: saved.contentHash };
    });
}

function managedLocalCover(filePath, directory) {
    return Boolean(filePath && path.dirname(path.resolve(filePath)) === path.resolve(directory)
        && path.basename(filePath).startsWith(LOCAL_COVER_OVERRIDE_PREFIX));
}

export async function saveLocalCoverOverride(filePath, imagePath, options = {}) {
    const cover = await readCoverImage(imagePath);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('A cover can only be assigned to a regular file.');
    return withLibraryDb(options, async libraryDb => {
        const directory = options.thumbnailDir || (libraryDb.dbPath && libraryDb.dbPath !== ':memory:'
            ? path.join(path.dirname(libraryDb.dbPath), 'thumbnails') : '');
        if (!directory) throw new Error('The cover storage directory is unavailable.');
        const coverPath = path.join(directory, `${LOCAL_COVER_OVERRIDE_PREFIX}${randomUUID()}${supportedImageExtensionForMimeType(cover.mimeType)}`);
        const temporaryPath = `${coverPath}.tmp`;
        await fs.mkdir(directory, { recursive: true });
        let unusedPreviousPath = '';
        try {
            await fs.writeFile(temporaryPath, cover.buffer, { flag: 'wx' });
            await fs.rename(temporaryPath, coverPath);
            await libraryDb.withLock(async () => {
                const db = libraryDb.getConnection();
                const normalizedPath = libraryDb.normalizeFilePath(filePath);
                db.transaction(() => {
                    const previous = db.prepare('SELECT cover_override_path FROM files WHERE path = ?').get(normalizedPath);
                    db.prepare(`
                        INSERT INTO files (path, mtime, size, ext, title, book_type, cover_override_path, thumb_path)
                        VALUES (@path, @mtime, @size, @ext, @title, @bookType, @coverPath, @coverPath)
                        ON CONFLICT(path) DO UPDATE SET
                            cover_override_path = excluded.cover_override_path,
                            thumb_path = excluded.thumb_path
                    `).run({
                        path: normalizedPath,
                        mtime: stat.mtimeMs / 1000,
                        size: stat.size,
                        ext: path.extname(filePath).toLowerCase(),
                        title: path.basename(filePath, path.extname(filePath)),
                        bookType: isAudioPath(filePath) ? 'audio' : 'book',
                        coverPath,
                    });
                    const previousPath = previous?.cover_override_path;
                    if (managedLocalCover(previousPath, directory)) {
                        const references = db.prepare('SELECT 1 FROM files WHERE cover_override_path = ? OR thumb_path = ? LIMIT 1').get(previousPath, previousPath);
                        if (!references) unusedPreviousPath = previousPath;
                    }
                })();
            });
        } catch (error) {
            await fs.rm(coverPath, { force: true }).catch(() => {});
            throw error;
        } finally {
            await fs.rm(temporaryPath, { force: true }).catch(() => {});
        }
        if (unusedPreviousPath) await fs.rm(unusedPreviousPath, { force: true }).catch(() => {});
        return { coverPath };
    });
}
