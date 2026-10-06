import fs from 'node:fs/promises';
import path from 'node:path';
import { LibraryDB } from './database/library_db.js';
import { SCAN_TARGET_EXTENSIONS } from './scanTargets.js';
import { AUDIO_EXTENSIONS } from '../src/metadata/metadataTypes.js';

const SECONDS_PER_PAGE = 20;

export async function readFolderDetails(folderPath, options = {}) {
    const root = path.resolve(folderPath);
    const checkCancelled = () => {
        if (options.shouldCancel?.()) {
            const error = new Error('Folder details cancelled');
            error.code = 'TASK_CANCELLED';
            throw error;
        }
    };
    checkCancelled();
    const stats = await fs.lstat(root);
    if (!stats.isDirectory()) throw new Error('Not a directory');
    const library = options.libraryDb || new LibraryDB({ dbPath: options.dbPath });
    const summary = {
        fileCount: 0,
        folderCount: 0,
        pageCount: 0,
        unknownPageFileCount: 0,
        estimatedReadingSeconds: 0,
        unknownReadingTimeFileCount: 0,
        unreadableFolderCount: 0,
        secondsPerPage: SECONDS_PER_PAGE,
    };
    try {
        const rows = await library.getFolderDetailMetadata(root);
        const metadata = new Map(rows.map(row => [library.normalizeFilePath(row.path), row]));
        const pending = [root];
        while (pending.length > 0) {
            checkCancelled();
            const current = pending.pop();
            let entries;
            try {
                entries = await fs.readdir(current, { withFileTypes: true });
            } catch (error) {
                if (current === root) throw error;
                summary.unreadableFolderCount += 1;
                continue;
            }
            checkCancelled();
            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    summary.folderCount += 1;
                    pending.push(fullPath);
                } else if (entry.isFile()) {
                    summary.fileCount += 1;
                    const extension = path.extname(entry.name).toLowerCase();
                    if (!SCAN_TARGET_EXTENSIONS.includes(extension)) continue;
                    const record = metadata.get(library.normalizeFilePath(fullPath));
                    if (AUDIO_EXTENSIONS.has(extension)) {
                        const duration = Number(record?.duration_seconds);
                        if (Number.isFinite(duration) && duration > 0) {
                            summary.estimatedReadingSeconds += duration;
                        } else {
                            summary.unknownReadingTimeFileCount += 1;
                        }
                    } else {
                        const pages = Number(record?.page_count);
                        if (Number.isFinite(pages) && pages > 0) {
                            summary.pageCount += Math.floor(pages);
                            summary.estimatedReadingSeconds += Math.floor(pages) * SECONDS_PER_PAGE;
                        } else {
                            summary.unknownPageFileCount += 1;
                            summary.unknownReadingTimeFileCount += 1;
                        }
                    }
                }
            }
        }
        checkCancelled();
        return summary;
    } finally {
        if (!options.libraryDb) await library.close();
    }
}
