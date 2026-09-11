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
import { inspectComicCover, readComicCoverImage, writeComicCover, convertComicToZip } from './comicCoverEditor.js';
import { writeAudioCoverOnly, saveTextCoverOnly, saveLocalCoverOverride } from './documentCoverEditor.js';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
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
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) {
            throw new Error('Choose an image no larger than 16 MiB.');
        }
        buffer = Buffer.alloc(stat.size + 1);
        let total = 0;
        while (total < buffer.length) {
            const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
            if (!bytesRead) break;
            total += bytesRead;
        }
        if (total !== stat.size) throw new Error('The image changed while it was being read.');
        buffer = buffer.subarray(0, total);
    } finally {
        await file.close();
    }
    let mimeType = detectImageMimeType(buffer);
    if (!mimeType) throw new Error('Choose a JPEG, PNG, WebP, GIF, or BMP image.');
    const imageVersion = createHash('sha256').update(buffer).digest('hex');
    const normalized = await options.normalizeImage?.(buffer, mimeType);
    if (normalized) {
        buffer = normalized.buffer;
        mimeType = normalized.mimeType;
    }
    if (!['image/jpeg', 'image/png'].includes(mimeType) || buffer.length > MAX_IMAGE_BYTES) {
        throw new Error('The cover could not be converted to JPEG or PNG within 16 MiB.');
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
    const { version } = await sourceVersion(sourcePath);
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
        version,
        textContentHash,
        coverDataUrl,
        coverEntry: comic?.coverEntry || '',
        pageCount: comic?.pages?.length || 0,
        pages: (comic?.pages || []).slice(0, 12).map(page => ({ name: page.name })),
    };
}

async function createBackup(filePath) {
    const directory = path.join(path.dirname(filePath), 'bak');
    await fs.mkdir(directory, { recursive: true });
    const extension = path.extname(filePath);
    const destination = path.join(directory, `${path.basename(filePath, extension)}_cover_${Date.now()}_${randomUUID().slice(0, 8)}${extension}`);
    await fs.copyFile(filePath, destination, constants.COPYFILE_EXCL);
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
                await fs.copyFile(preparedPath, destination, constants.COPYFILE_EXCL);
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
    await fs.copyFile(sourcePath, holdingPath, constants.COPYFILE_EXCL);
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
                await fs.rename(holdingPath, sourcePath);
            } catch (rollbackError) {
                preserveHolding = true;
                throw new Error(`${error.message}; original file retained at ${holdingPath}: ${rollbackError.message}`);
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
            else await fs.copyFile(filePath, preparedPath, constants.COPYFILE_EXCL);
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
