import fs from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_EXTENSIONS, COMIC_EXTENSIONS } from '../src/metadata/metadataTypes.js';
import { shouldSkipScanDirectoryEntry } from './scanExclusions.js';

export function readingActionFormat(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (COMIC_EXTENSIONS.has(extension)) return 'comic';
    if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
    if (extension === '.epub') return 'epub';
    if (extension === '.pdf') return 'pdf';
    if (['.txt', '.text', '.log', '.md'].includes(extension)) return 'text';
    return '';
}

function readingActionPatch(action, format, previous = {}, metadata = {}) {
    const completed = action === 'mark-read';
    const pageCount = Math.max(0, Number(previous.pageCount) || Number(metadata.page_count) || 0);
    const durationSeconds = Math.max(0, Number(previous.durationSeconds) || Number(metadata.duration_seconds) || 0);
    const pageIndex = completed ? Math.max(0, pageCount - 1) : 0;
    const positionSeconds = completed ? durationSeconds : 0;
    const locator = format === 'audio'
        ? { kind: 'audio-time', positionSeconds }
        : { kind: 'normalized', normalizedPosition: completed ? 1 : 0 };
    return {
        format,
        status: completed ? 'completed' : 'unread',
        pageIndex,
        pageCount,
        scrollPercent: completed ? 100 : 0,
        positionSeconds,
        durationSeconds,
        locator,
        ...(previous.lastReadAt ? { lastReadAt: previous.lastReadAt } : {}),
    };
}

export async function updateReadingProgress(db, paths, action, { getOpenViewerPaths = () => [] } = {}) {
    if (!['mark-read', 'reset-progress'].includes(action)) throw new Error('invalid_reading_action');
    if (!Array.isArray(paths) || paths.length > 10000 || paths.some(value => (
        typeof value !== 'string' || !value || value.length > 32768
        || value.includes('\0') || !path.isAbsolute(value)
    ))) throw new Error('invalid_reading_paths');

    const files = new Map();
    const visited = new Set();
    const errors = [];
    const pending = [...paths];
    while (pending.length > 0) {
        const filePath = path.resolve(pending.pop());
        const key = db.normalizeFilePath(filePath);
        if (visited.has(key)) continue;
        visited.add(key);
        try {
            const stat = await fs.lstat(filePath);
            if (stat.isDirectory()) {
                const entries = await fs.readdir(filePath, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isSymbolicLink() && !shouldSkipScanDirectoryEntry(entry)) {
                        pending.push(path.join(filePath, entry.name));
                    }
                }
            } else if (stat.isFile() && readingActionFormat(filePath)) {
                files.set(key, filePath);
            }
        } catch (error) {
            errors.push({ filePath, message: error.message });
        }
    }

    const states = [];
    const filePaths = [...files.values()];
    for (let index = 0; index < filePaths.length; index += 500) {
        const batch = filePaths.slice(index, index + 500);
        try {
            const previous = new Map((await db.listReadingStatesByPaths(batch)).map(state => [state.filePath, state]));
            const metadata = new Map((await db.listFilesByPaths(batch)).map(file => [file.path, file]));
            for (const filePath of batch) {
                try {
                    const key = db.normalizeFilePath(filePath);
                    if (getOpenViewerPaths().some(openPath => db.normalizeFilePath(path.resolve(openPath)) === key)) {
                        errors.push({ filePath, code: 'READING_VIEWER_OPEN' });
                        continue;
                    }
                    const saved = await db.upsertReadingState(filePath, readingActionPatch(
                        action, readingActionFormat(filePath), previous.get(key), metadata.get(key),
                    ));
                    states.push({ ...saved, filePath });
                } catch (error) {
                    errors.push({ filePath, message: error.message });
                }
            }
        } catch (error) {
            for (const filePath of batch) errors.push({ filePath, message: error.message });
        }
        await new Promise(resolve => setImmediate(resolve));
    }
    return { states, errors };
}
