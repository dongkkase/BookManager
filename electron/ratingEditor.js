import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LibraryDB } from './database/library_db.js';
import { writeArchiveRating } from './tasks/metadataTask.js';
import { writePdfMetadata } from './pdfMetadata.js';
import { writeAudioRating } from './audioRating.js';
import { isAudioMetadataWriteSupported } from './audioMetadataWriter.js';
import { AUDIO_EXTENSIONS, BOOK_EXTENSIONS, COMIC_EXTENSIONS } from '../src/metadata/metadataTypes.js';

const activeFiles = new Set();
const supported = new Set([...AUDIO_EXTENSIONS, ...BOOK_EXTENSIONS, ...COMIC_EXTENSIONS]);

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size
        && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function writeNativeRating(filePath, rating, options) {
    const extension = path.extname(filePath).toLowerCase();
    if (['.7z', '.cb7'].includes(extension) && !options.sevenZExe) {
        options = { ...options, sevenZExe: await options.getSevenZExe?.() };
    }
    if (['.zip', '.cbz', '.7z', '.cb7', '.epub'].includes(extension)) return writeArchiveRating(filePath, rating, options);
    if (extension === '.pdf') return writePdfMetadata(filePath, { CommunityRating: rating }, { ratingOnly: true });
    if (isAudioMetadataWriteSupported(filePath)) return writeAudioRating(filePath, rating);
    throw new Error('This file format cannot store a rating.');
}

export async function saveItemRating(request, options = {}) {
    const { filePath: requestedPath, rating } = request || {};
    if (typeof requestedPath !== 'string' || !path.isAbsolute(requestedPath) || !supported.has(path.extname(requestedPath).toLowerCase())) {
        throw new Error('Choose a supported book or audiobook file.');
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) throw new Error('Rating must be an integer from 1 to 10.');
    const filePath = path.resolve(requestedPath);
    const realPath = await fs.realpath(filePath);
    if (activeFiles.has(realPath)) throw new Error('This file is already being updated.');
    activeFiles.add(realPath);
    const libraryDb = options.libraryDb || new LibraryDB({ dbPath: options.dbPath });
    let workingDirectory;
    try {
        const originalStat = await fs.stat(filePath);
        if (!originalStat.isFile()) throw new Error('Choose a regular file.');
        // Check DB availability before attempting a file mutation.
        await libraryDb.getFileInfo(filePath);
        let storage = 'database';
        let fallbackReason = '';
        let backupPath = '';
        try {
            const extension = path.extname(realPath).toLowerCase();
            if (!['.zip', '.cbz', '.7z', '.cb7', '.epub', '.pdf'].includes(extension) && !isAudioMetadataWriteSupported(realPath)) {
                throw new Error('This file format cannot store a rating.');
            }
            await fs.access(realPath, fs.constants.W_OK);
            workingDirectory = await fs.mkdtemp(path.join(path.dirname(realPath), '.bookmanager-rating-'));
            const stagedPath = path.join(workingDirectory, path.basename(realPath));
            await fs.copyFile(realPath, stagedPath, fs.constants.COPYFILE_FICLONE);
            await (options.writeNativeRating || writeNativeRating)(stagedPath, rating, options);
            if (!sameFile(originalStat, await fs.stat(realPath))) throw Object.assign(new Error('The file changed while saving. Please try again.'), { code: 'RATING_SOURCE_CHANGED' });
            if (options.backup_on) {
                const backupDirectory = path.join(path.dirname(realPath), 'bak');
                await fs.mkdir(backupDirectory, { recursive: true });
                backupPath = path.join(backupDirectory, `${path.parse(realPath).name}_${randomUUID()}${path.extname(realPath)}`);
                await fs.copyFile(realPath, backupPath, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
            }
            await fs.rename(stagedPath, realPath);
            storage = 'file';
        } catch (error) {
            if (error.code === 'RATING_SOURCE_CHANGED') throw error;
            fallbackReason = error.message;
        }
        if (storage === 'database' && !sameFile(originalStat, await fs.stat(realPath))) {
            throw new Error('The file changed while saving. Please try again.');
        }
        await libraryDb.setFileRating(filePath, rating, { storage });
        return { success: true, filePath, rating, storage, fallbackReason, backupPath };
    } finally {
        try {
            if (workingDirectory) {
                await fs.rm(workingDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            }
        } catch (error) {
            // Cleanup failure must not replace the save result or the original save error.
            console.warn('[RatingEditor] Temporary directory cleanup failed:', workingDirectory, error.message);
        } finally {
            activeFiles.delete(realPath);
            if (!options.libraryDb) await libraryDb.close();
        }
    }
}
