import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { COMIC_EXTENSIONS, AUDIO_EXTENSIONS } from '../src/metadata/metadataTypes.js';
import { isAudioMetadataWriteSupported } from './audioMetadataWriter.js';
import { detectImageMimeType, supportedImageExtensionForMimeType } from './imageMagic.js';
import { loadMetadataCover, writeEpubCoverOnly } from './tasks/metadataTask.js';
import { getTextContentHash } from './textMetadataStore.js';
import { LibraryDB } from './database/library_db.js';
import { createComicCoverImageReader, inspectComicCover, readComicCoverImage, writeComicCover, convertComicToZip } from './comicCoverEditor.js';
import { writeAudioCoverOnly, saveTextCoverOnly, saveLocalCoverOverride } from './documentCoverEditor.js';
import { crc32, listZipEntriesFromFile, readZipEntryFromFile } from './core/zipArchive.js';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const ARCHIVE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const MAX_ARCHIVE_IMAGES = 100000;
const MAX_ARCHIVE_IMAGE_PAGE_SIZE = 100;
const MAX_ARCHIVE_THUMBNAIL_BATCH_SIZE = 8;
const EXCLUSIVE_COPY_MODE = constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE;
const activeEdits = new Set();

export function coverEditorCapabilities(filePath) {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    const kind = COMIC_EXTENSIONS.has(extension) ? 'comic'
        : extension === '.epub' ? 'epub'
            : extension === '.txt' ? 'text'
                : extension === '.pdf' ? 'pdf'
                    : AUDIO_EXTENSIONS.has(extension) ? 'audio' : '';
    if (!kind) throw new Error('This file format does not support cover editing.');
    return {
        kind,
        extension,
        storage: kind === 'text' || kind === 'pdf' || (kind === 'audio' && !isAudioMetadataWriteSupported(filePath))
            ? 'database' : 'file',
        canAdd: kind === 'comic' || kind === 'epub',
        canRenumber: kind === 'comic',
        canSelectArchiveImage: kind === 'comic' || kind === 'epub',
        conversion: extension === '.rar' || extension === '.cbr',
    };
}

async function sourceVersion(filePath) {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) throw new Error('Select a regular book file.');
    return { stat, version: [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':') };
}

async function requireSourceVersion(filePath, expected) {
    const current = await sourceVersion(filePath);
    if (current.version !== expected) {
        const error = new Error('The book changed while the cover editor was open. Reopen it before saving.');
        error.code = 'COVER_SOURCE_CHANGED';
        throw error;
    }
    return current.stat;
}

export async function loadCoverEditorImage(imagePath, options = {}) {
    const sourcePath = String(imagePath || '');
    const file = await fs.open(sourcePath, 'r');
    let buffer;
    try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size === 0) {
            throw Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_INVALID' });
        }
        if (stat.size > MAX_IMAGE_BYTES) {
            throw Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_TOO_LARGE' });
        }
        buffer = Buffer.alloc(stat.size + 1);
        let total = 0;
        while (total < buffer.length) {
            const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
            if (!bytesRead) break;
            total += bytesRead;
        }
        if (total !== stat.size) throw Object.assign(new Error('The image changed while it was being read.'), { code: 'IMAGE_SOURCE_CHANGED' });
        buffer = buffer.subarray(0, total);
    } finally {
        await file.close();
    }
    let mimeType = detectImageMimeType(buffer);
    if (!mimeType) throw Object.assign(new Error('Choose a JPEG, PNG, WebP, GIF, or BMP image.'), { code: 'COVER_IMAGE_UNSUPPORTED_FORMAT' });
    const imageVersion = createHash('sha256').update(buffer).digest('hex');
    const normalized = await options.normalizeImage?.(buffer, mimeType);
    if (normalized) {
        buffer = normalized.buffer;
        mimeType = normalized.mimeType;
    }
    if (!['image/jpeg', 'image/png'].includes(mimeType) || !buffer?.length || buffer.length > MAX_IMAGE_BYTES) {
        throw Object.assign(new Error('The cover could not be converted to JPEG or PNG within 16 MiB.'), { code: 'COVER_IMAGE_CONVERSION_FAILED' });
    }
    return {
        imagePath: sourcePath,
        imageVersion,
        buffer,
        mimeType,
        extension: supportedImageExtensionForMimeType(mimeType),
        width: normalized?.width || 0,
        height: normalized?.height || 0,
        size: buffer.length,
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    };
}

export async function inspectCoverEditor(filePath, options = {}) {
    const sourcePath = path.resolve(String(filePath || ''));
    const capabilities = coverEditorCapabilities(sourcePath);
    const { version, stat } = await sourceVersion(sourcePath);
    let coverDataUrl = '';
    let comic = null;
    if (capabilities.kind === 'comic') {
        comic = await inspectComicCover(sourcePath, options);
        if (comic.archiveType === 'rar') capabilities.conversion = true;
        if (comic.coverEntry) {
            const buffer = await readComicCoverImage(sourcePath, comic.coverEntry, options);
            const mimeType = detectImageMimeType(buffer);
            if (mimeType) coverDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
        }
    } else {
        coverDataUrl = await loadMetadataCover(sourcePath, options);
    }
    const textContentHash = capabilities.kind === 'text' ? await getTextContentHash(sourcePath) : '';
    await requireSourceVersion(sourcePath, version);
    return {
        ...capabilities,
        filePath: sourcePath,
        name: path.basename(sourcePath),
        size: stat.size,
        version,
        textContentHash,
        coverDataUrl,
        coverEntry: comic?.coverEntry || '',
        pageCount: comic?.pages?.length || 0,
        pages: (comic?.pages || []).slice(0, 12).map(page => ({ name: page.name })),
    };
}

async function coverArchiveImages(request, options) {
    const filePath = path.resolve(String(request.filePath || ''));
    const capabilities = coverEditorCapabilities(filePath);
    if (!capabilities.canSelectArchiveImage) throw new Error('This format has no archive images to select.');
    if (!request.version) throw new Error('Open the cover editor before selecting an archive image.');
    await requireSourceVersion(filePath, request.version);
    const reader = capabilities.kind === 'comic'
        ? await createComicCoverImageReader(filePath, { ...options, maxImageBytes: MAX_IMAGE_BYTES }) : null;
    const entries = reader ? reader.pages : await listZipEntriesFromFile(filePath);
    const images = entries.filter(entry => {
        const name = entry.name.replace(/\\/g, '/');
        return !entry.isDirectory && ARCHIVE_IMAGE_EXTENSIONS.has(path.posix.extname(name).toLowerCase())
            && !name.split('/').some(part => part === '__MACOSX' || part.startsWith('._'));
    });
    if (images.length > MAX_ARCHIVE_IMAGES) throw new Error('The archive contains too many images.');
    const names = new Set();
    for (const entry of images) {
        const name = entry.name.replace(/\\/g, '/');
        const key = name.normalize('NFC').toLowerCase();
        if (!name || name.length > 4096 || /^[\/@-]/.test(name) || /[\x00-\x1f\x7f:]/.test(name)
            || name.split('/').some(part => !part || part === '.' || part === '..')) {
            throw new Error('The archive contains an unsafe image entry.');
        }
        if (names.has(key)) throw new Error('The archive contains duplicate image names.');
        names.add(key);
        const unixType = (entry.externalAttrs >>> 16) & 0xf000;
        if (entry.encrypted || (entry.flags & 1) || entry.link || (unixType && unixType !== 0x8000)) {
            throw new Error('Encrypted images, links, and special files cannot be selected.');
        }
    }
    if (capabilities.kind === 'epub') images.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' }));
    await requireSourceVersion(filePath, request.version);
    return { filePath, images, readImage: reader?.readImage };
}

export async function listCoverEditorArchiveImages(request = {}, options = {}) {
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 60;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Choose a valid archive image page.');
    }
    const { images } = await coverArchiveImages(request, options);
    return {
        entries: images.slice(offset, offset + Math.min(limit, MAX_ARCHIVE_IMAGE_PAGE_SIZE)).map(entry => ({ name: entry.name })),
        total: images.length,
        offset,
    };
}

async function readCoverArchiveImage(archive, entryName, version) {
    const { filePath, images, readImage } = archive;
    const entry = images.find(image => image.name === entryName);
    if (!entry) throw Object.assign(new Error('The selected archive image is no longer available.'), { code: 'IMAGE_SOURCE_CHANGED' });
    const size = entry.uncompressedSize ?? entry.size;
    if (!Number.isSafeInteger(size) || size <= 0) {
        throw Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_INVALID' });
    }
    if (size > MAX_IMAGE_BYTES) throw Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_TOO_LARGE' });
    const buffer = readImage
        ? await readImage(entry.name)
        : await readZipEntryFromFile(filePath, entry, { maxBytes: MAX_IMAGE_BYTES, maxCompressedBytes: MAX_IMAGE_BYTES });
    if (!buffer || buffer.length !== size || buffer.length > MAX_IMAGE_BYTES
        || (Number.isInteger(entry.crc) && crc32(buffer) !== entry.crc)) {
        throw Object.assign(new Error('The archive image could not be read completely.'), { code: 'COVER_IMAGE_INVALID' });
    }
    const mimeType = detectImageMimeType(buffer);
    if (!mimeType) throw Object.assign(new Error('Choose a JPEG, PNG, WebP, GIF, or BMP image.'), { code: 'COVER_IMAGE_UNSUPPORTED_FORMAT' });
    await requireSourceVersion(filePath, version);
    return { buffer, mimeType, entry };
}

export async function loadCoverEditorArchiveThumbnails(request = {}, options = {}) {
    if (!Array.isArray(request.entryNames) || request.entryNames.length < 1
        || request.entryNames.length > MAX_ARCHIVE_THUMBNAIL_BATCH_SIZE
        || request.entryNames.some(name => typeof name !== 'string' || !name)
        || new Set(request.entryNames).size !== request.entryNames.length) {
        throw new Error('Choose between 1 and 8 archive images for thumbnails.');
    }
    if (options.shouldCancel?.()) return { cancelled: true };
    if (typeof options.createThumbnail !== 'function') throw new Error('Archive image thumbnails are unavailable.');
    let archive;
    try {
        archive = await coverArchiveImages(request, options);
    } catch (error) {
        if (options.shouldCancel?.()) return { cancelled: true };
        throw error;
    }
    const entries = new Array(request.entryNames.length);
    let nextIndex = 0;
    let sourceError;
    const worker = async () => {
        while (nextIndex < request.entryNames.length && !sourceError && !options.shouldCancel?.()) {
            const index = nextIndex++;
            const name = request.entryNames[index];
            try {
                await requireSourceVersion(archive.filePath, request.version);
                if (options.shouldCancel?.()) return;
                const { buffer, mimeType } = await readCoverArchiveImage(archive, name, request.version);
                if (options.shouldCancel?.()) return;
                const thumbnail = await options.createThumbnail(buffer, mimeType);
                if (options.shouldCancel?.()) return;
                await requireSourceVersion(archive.filePath, request.version);
                entries[index] = { name, thumbnailDataUrl: thumbnail.thumbnailDataUrl, width: thumbnail.width, height: thumbnail.height };
            } catch (error) {
                if (error.code === 'COVER_SOURCE_CHANGED') {
                    sourceError = error;
                    return;
                }
                if (options.shouldCancel?.()) return;
                entries[index] = { name, thumbnailDataUrl: '', width: 0, height: 0, error: error.message };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, entries.length) }, worker));
    if (sourceError) throw sourceError;
    if (options.shouldCancel?.()) return { cancelled: true };
    await requireSourceVersion(archive.filePath, request.version);
    return { entries };
}

export async function loadCoverEditorArchiveImage(request = {}, options = {}) {
    const archive = await coverArchiveImages(request, options);
    const { filePath } = archive;
    const { buffer, mimeType, entry } = await readCoverArchiveImage(archive, request.entryName, request.version);
    const cleanupDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-source-'));
    try {
        const imagePath = path.join(cleanupDirectory, `cover${supportedImageExtensionForMimeType(mimeType)}`);
        await fs.writeFile(imagePath, buffer, { flag: 'wx' });
        const image = await loadCoverEditorImage(imagePath, options);
        await requireSourceVersion(filePath, request.version);
        return { ...image, entryName: entry.name, cleanupDirectory };
    } catch (error) {
        await fs.rm(cleanupDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

async function createBackup(filePath) {
    const directory = path.join(path.dirname(filePath), 'bak');
    await fs.mkdir(directory, { recursive: true });
    const extension = path.extname(filePath);
    const destination = path.join(directory, `${path.basename(filePath, extension)}_cover_${Date.now()}_${randomUUID().slice(0, 8)}${extension}`);
    await fs.copyFile(filePath, destination, EXCLUSIVE_COPY_MODE);
    return destination;
}

async function invalidateCoverRecord(filePath, options, readingAdjustment = null) {
    const database = options.libraryDb || (options.dbPath ? new LibraryDB({ dbPath: options.dbPath }) : null);
    if (!database) return;
    try {
        if (readingAdjustment) {
            const stat = await fs.stat(filePath);
            return await database.commitCoverFileEdit(filePath, { mtime: stat.mtimeMs / 1000, size: stat.size, readingAdjustment });
        }
        const record = await database.getFileInfo(filePath);
        if (!record) return;
        const stat = await fs.stat(filePath);
        await database.upsertFileInfo({ ...record, thumb_path: '', cover_override_path: '', mtime: stat.mtimeMs / 1000, size: stat.size });
    } finally {
        if (!options.libraryDb) await database.close();
    }
}

async function commitEditedFile(sourcePath, preparedPath, request, options, readingAdjustment = null) {
    await requireSourceVersion(sourcePath, request.version);
    if (request.conversion) {
        const stem = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, path.extname(sourcePath))}_cover`);
        for (let index = 0; index < 1000; index += 1) {
            const destination = `${stem}${index ? `_${index}` : ''}.cbz`;
            try {
                await fs.copyFile(preparedPath, destination, EXCLUSIVE_COPY_MODE);
            } catch (error) {
                if (error.code === 'EEXIST') continue;
                throw error;
            }
            try {
                const reading = await invalidateCoverRecord(destination, options, readingAdjustment);
                return { filePath: destination, converted: true, backupPath: '', ...reading };
            } catch (error) {
                await fs.rm(destination, { force: true });
                throw error;
            }
        }
        throw new Error('Could not find an unused filename for the new CBZ.');
    }
    const backupPath = request.backup !== false ? await createBackup(sourcePath) : '';
    await requireSourceVersion(sourcePath, request.version);
    const holdingPath = path.join(path.dirname(sourcePath), `.bookmanager-cover-${randomUUID()}.old`);
    if (!backupPath) await fs.copyFile(sourcePath, holdingPath, EXCLUSIVE_COPY_MODE);
    let committed = false;
    let preserveHolding = false;
    let reading;
    try {
        await requireSourceVersion(sourcePath, request.version);
        await fs.rename(preparedPath, sourcePath);
        committed = true;
        reading = await invalidateCoverRecord(sourcePath, options, readingAdjustment);
    } catch (error) {
        if (committed) {
            try {
                if (backupPath) await fs.copyFile(backupPath, holdingPath, EXCLUSIVE_COPY_MODE);
                await fs.rename(holdingPath, sourcePath);
            } catch (rollbackError) {
                preserveHolding = !backupPath;
                throw new Error(`${error.message}; original file retained at ${backupPath || holdingPath}: ${rollbackError.message}`);
            }
        }
        throw error;
    } finally {
        if (!preserveHolding) {
            await fs.rm(holdingPath, { force: true }).catch(() => {});
        }
    }
    return { filePath: sourcePath, backupPath, converted: false, ...reading };
}

export async function applyCoverEditor(request = {}, options = {}) {
    const filePath = path.resolve(String(request.filePath || ''));
    const lockKey = await fs.realpath(filePath);
    if (activeEdits.has(lockKey)) throw new Error('This book is already being edited.');
    activeEdits.add(lockKey);
    let imageDirectory = '';
    let preparedDirectory = '';
    let preparedPath = '';
    try {
        const capabilities = coverEditorCapabilities(filePath);
        if (!request.version) throw new Error('Open the cover editor before saving.');
        await requireSourceVersion(filePath, request.version);
        if (capabilities.kind === 'comic') {
            const comic = await inspectComicCover(filePath, options);
            if (comic.archiveType === 'rar') capabilities.conversion = true;
        }
        if (!['add', 'replace'].includes(request.mode) || (request.mode === 'add' && !capabilities.canAdd)) {
            throw new Error('This cover operation is not available for the selected format.');
        }
        const image = await loadCoverEditorImage(request.imagePath, options);
        if (request.imageVersion !== image.imageVersion) {
            const error = new Error('The selected image changed. Choose it again before saving.');
            error.code = 'IMAGE_SOURCE_CHANGED';
            throw error;
        }
        imageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-'));
        const imagePath = path.join(imageDirectory, `cover${image.extension}`);
        await fs.writeFile(imagePath, image.buffer, { flag: 'wx' });
        let result;
        if (capabilities.storage === 'database') {
            await requireSourceVersion(filePath, request.version);
            if (capabilities.kind === 'text') {
                await saveTextCoverOnly(filePath, imagePath, { ...options, expectedContentHash: request.textContentHash });
            } else {
                await saveLocalCoverOverride(filePath, imagePath, options);
            }
            result = { filePath, backupPath: '', converted: false };
        } else {
            const extension = capabilities.conversion ? '.cbz' : capabilities.extension;
            preparedDirectory = await fs.mkdtemp(path.join(path.dirname(filePath), '.bookmanager-cover-'));
            preparedPath = path.join(preparedDirectory, `book${extension}`);
            if (capabilities.conversion) await convertComicToZip(filePath, preparedPath, options);
            else await fs.copyFile(filePath, preparedPath, EXCLUSIVE_COPY_MODE);
            await requireSourceVersion(filePath, request.version);
            const writeOptions = { ...options, mode: request.mode, targetEntry: request.targetEntry, renumber: request.renumber === true, imageExtension: image.extension };
            let readingAdjustment = null;
            let readingAdjustmentUncertain = false;
            if (capabilities.kind === 'comic') {
                const comic = await writeComicCover(preparedPath, imagePath, writeOptions);
                readingAdjustment = { ...comic, format: 'comic', sourcePath: filePath };
            } else if (capabilities.kind === 'epub') {
                const epub = await writeEpubCoverOnly(preparedPath, imagePath, writeOptions);
                if (epub.readingPageOffset === 1) readingAdjustment = { format: 'epub', sourcePath: filePath, pageOffset: 1 };
                readingAdjustmentUncertain = epub.readingPageOffset === null;
            } else await writeAudioCoverOnly(preparedPath, imagePath, writeOptions);
            result = await commitEditedFile(filePath, preparedPath, { ...request, conversion: capabilities.conversion }, options, readingAdjustment);
            if (readingAdjustmentUncertain) result.readingAdjustmentUncertain = true;
            if (readingAdjustment) {
                result.readingAdjustment = { ...readingAdjustment, filePath: result.filePath, readingState: result.readingState, previousUpdatedAt: result.previousUpdatedAt };
                delete result.readingState;
                delete result.previousUpdatedAt;
            }
        }
        let warning = '';
        try {
            await options.refreshFilePreview?.(result.filePath);
        } catch (error) {
            warning = error.message || String(error);
        }
        return { success: true, ...result, warning };
    } finally {
        activeEdits.delete(lockKey);
        if (preparedDirectory) await fs.rm(preparedDirectory, { recursive: true, force: true }).catch(() => {});
        if (imageDirectory) await fs.rm(imageDirectory, { recursive: true, force: true }).catch(() => {});
    }
}
