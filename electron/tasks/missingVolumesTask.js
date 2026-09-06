import fs from 'node:fs/promises';
import path from 'node:path';
import { LibraryDB, normalizeLibraryFilePath } from '../database/library_db.js';
import { pathHasHiddenDirectorySegment, shouldSkipScanDirectoryEntry } from '../scanExclusions.js';
import { SCAN_TARGET_EXTENSIONS } from '../scanTargets.js';
import { findMissingVolumes } from '../../src/missingVolumesPolicy.js';

const TARGET_EXTENSIONS = new Set(SCAN_TARGET_EXTENSIONS);

function throwIfCancelled(options) {
    if (typeof options.shouldCancel !== 'function' || !options.shouldCancel()) return;
    const error = new Error('Task cancelled.');
    error.code = 'TASK_CANCELLED';
    throw error;
}

function distinctLibraryRoots(libraryFolders, normalizePath) {
    const byPath = new Map();
    for (const folder of libraryFolders || []) {
        if (!folder) continue;
        const root = path.resolve(folder);
        const key = normalizePath(root);
        if (!byPath.has(key)) byPath.set(key, root);
    }
    const roots = [...byPath.entries()];
    return roots.filter(([rootKey]) => !roots.some(([parentKey]) => {
        if (rootKey === parentKey) return false;
        const relativePath = path.relative(parentKey, rootKey);
        return relativePath !== ''
            && relativePath !== '..'
            && !relativePath.startsWith(`..${path.sep}`)
            && !path.isAbsolute(relativePath)
            && !pathHasHiddenDirectorySegment(rootKey, parentKey);
    })).map(([, root]) => root);
}

export async function checkMissingVolumes(libraryFolders, options = {}) {
    throwIfCancelled(options);
    const indexOnly = options.indexOnly === true;
    const libraryDb = options.libraryDb || (options.dbPath ? new LibraryDB({ dbPath: options.dbPath }) : null);
    const normalizePath = filePath => typeof libraryDb?.normalizeFilePath === 'function'
        ? libraryDb.normalizeFilePath(filePath)
        : normalizeLibraryFilePath(filePath);
    const roots = distinctLibraryRoots(libraryFolders, normalizePath);
    if (roots.length === 0) return { missing: [], fileCount: 0, cancelled: false, indexOnly };

    try {
        const metadata = libraryDb ? await libraryDb.getMissingVolumeMetadata(roots) : [];
        throwIfCancelled(options);
        const seriesByPath = new Map(metadata.map(row => [normalizePath(row.path), row.series || '']));
        const files = [];
        const visitedDirectories = new Set();
        const visitedFiles = new Set();
        const pendingDirectories = [...roots];

        if (indexOnly) {
            const rootKeys = roots.map(normalizePath);
            for (const row of metadata) {
                throwIfCancelled(options);
                const fullPath = row.path || '';
                if (!fullPath || !TARGET_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) continue;
                const fileKey = normalizePath(fullPath);
                if (visitedFiles.has(fileKey)) continue;
                const insideVisibleRoot = rootKeys.some(root => {
                    const relativePath = path.relative(root, fileKey);
                    return relativePath !== ''
                        && relativePath !== '..'
                        && !relativePath.startsWith(`..${path.sep}`)
                        && !path.isAbsolute(relativePath)
                        && !pathHasHiddenDirectorySegment(path.dirname(fileKey), root);
                });
                if (!insideVisibleRoot) continue;
                visitedFiles.add(fileKey);
                files.push({
                    name: path.basename(fullPath),
                    full_path: fullPath,
                    series: seriesByPath.get(fileKey) || '',
                });
            }
            return { missing: findMissingVolumes(files), fileCount: files.length, cancelled: false, indexOnly };
        }

        for (let index = 0; index < pendingDirectories.length; index += 1) {
            throwIfCancelled(options);
            const directory = pendingDirectories[index];
            const directoryKey = normalizePath(directory);
            if (visitedDirectories.has(directoryKey)) continue;
            visitedDirectories.add(directoryKey);
            const entries = await fs.readdir(directory, { withFileTypes: true });
            throwIfCancelled(options);

            for (const entry of entries) {
                throwIfCancelled(options);
                if (shouldSkipScanDirectoryEntry(entry)) continue;
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    pendingDirectories.push(fullPath);
                } else if (entry.isFile() && TARGET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                    const fileKey = normalizePath(fullPath);
                    if (visitedFiles.has(fileKey)) continue;
                    visitedFiles.add(fileKey);
                    files.push({
                        name: entry.name,
                        full_path: fullPath,
                        series: seriesByPath.get(fileKey) || '',
                    });
                }
            }
        }

        throwIfCancelled(options);
        return { missing: findMissingVolumes(files), fileCount: files.length, cancelled: false, indexOnly };
    } finally {
        if (!options.libraryDb) await libraryDb?.close();
    }
}
