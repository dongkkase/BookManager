import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { LibraryDB } from './database/library_db.js';
import { ContentIndexDB } from './database/content_index_db.js';
import { pruneUnregisteredLibraryData } from './libraryDataCleanup.js';
import { removeUnreferencedLibraryCovers } from './libraryCacheCleanup.js';
import { createLibraryPathScope } from './libraryPathScope.js';

const library = new LibraryDB({ dbPath: workerData.dbPath });
let contentDb = null;
let completedScope = null;
const errorDetails = error => ({ message: error.message || String(error), code: error.code, path: error.path });

async function prune(libraries) {
    const response = { result: { changes: 0, cachePaths: [] }, changed: false, errors: [] };
    try {
        const db = library.getConnection();
        if (!contentDb && workerData.contentIndexDbPath && fs.existsSync(workerData.contentIndexDbPath)) {
            contentDb = new ContentIndexDB({ dbPath: workerData.contentIndexDbPath });
        }
        const content = contentDb?.getConnection();
        const scope = JSON.stringify({
            libraries,
            libraryVersion: db.pragma('data_version', { simple: true }),
            contentVersion: content?.pragma('data_version', { simple: true }) ?? null,
        });
        if (completedScope === scope) return { ...response, skipped: true };

        for (let attempt = 0; ; attempt += 1) {
            try {
                response.result = await pruneUnregisteredLibraryData(library, libraries);
                break;
            } catch (error) {
                if (attempt >= 2 || !['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED'].includes(error.code)) throw error;
                await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
            }
        }
        response.changed = response.result.changes > 0;
        const covers = await removeUnreferencedLibraryCovers(library, response.result.cachePaths, {
            thumbnailDir: workerData.thumbnailDir,
            textCoverDir: path.join(path.dirname(workerData.dbPath), 'text-thumbnails'),
        });
        response.changed ||= covers.removedFiles > 0;
        response.errors.push(...covers.errors.map(errorDetails));
        if (content) {
            const contentScope = createLibraryPathScope(library, libraries, 'normalize_library_file_path(path)');
            content.function('normalize_library_file_path', { deterministic: true }, value => library.normalizeFilePath(value));
            const paths = content.prepare(`SELECT path FROM documents WHERE NOT (${contentScope.where})`).all(...contentScope.params).map(row => row.path);
            response.changed = contentDb.removeDocumentPaths(content, paths) > 0 || response.changed;
        }
        // Keep the versions from before the pass so concurrent writes trigger another check.
        if (!response.errors.length) completedScope = scope;
    } catch (error) {
        response.errors.push(errorDetails(error));
    }
    return response;
}

parentPort.on('message', async message => {
    if (message.type === 'close') {
        await contentDb?.close();
        await library.close();
        parentPort.postMessage({ closed: true });
        parentPort.close();
        return;
    }
    parentPort.postMessage(await prune(message.libraries));
});
