import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { LibraryDB } from './database/library_db.js';
import {
    collectFolderTagCategories,
    filterFilesByFolderTags,
} from '../src/folderTagFilter.js';

const QUERY_ERROR_CODE = 'ERR_LIBRARY_SEARCH_QUERY';
const library = new LibraryDB({ dbPath: workerData.dbPath });
let activeSearch = null;
let queuedSearch = null;
let preparePromise = null;
let searchQueueScheduled = false;
let tagMetadataCache = null;

function postSuperseded(message) {
    parentPort.postMessage({ id: message.id, result: [], superseded: true });
}

async function prepareIndex() {
    if (library.searchIndexUnhealthy) preparePromise = null;
    if (!preparePromise) {
        preparePromise = library.prepareSearchIndex()
            .then(ready => {
                if (!ready) preparePromise = null;
                return ready;
            })
            .catch(error => {
                preparePromise = null;
                throw error;
            });
    }
    return preparePromise;
}

async function runSearchQueue() {
    if (activeSearch) return;
    while (queuedSearch) {
        activeSearch = queuedSearch;
        queuedSearch = null;
        const message = activeSearch;
        try {
            await prepareIndex();
            if (queuedSearch) {
                postSuperseded(message);
                continue;
            }
            const libraries = (message.libraries || []).filter(folder => {
                try {
                    return fs.existsSync(folder);
                } catch {
                    return false;
                }
            });
            const result = await library.searchFiles(message.query, libraries, message.options);
            parentPort.postMessage({ id: message.id, result });
        } catch (error) {
            parentPort.postMessage({
                id: message.id,
                error: {
                    message: error?.message || String(error),
                    code: QUERY_ERROR_CODE,
                },
            });
        } finally {
            activeSearch = null;
        }
    }
}

function scheduleSearchQueue() {
    if (activeSearch || searchQueueScheduled) return;
    searchQueueScheduled = true;
    setImmediate(() => {
        searchQueueScheduled = false;
        void runSearchQueue();
    });
}

async function handlePrepare(message) {
    try {
        const ready = await prepareIndex();
        parentPort.postMessage({ id: message.id, result: { ready } });
    } catch (error) {
        parentPort.postMessage({
            id: message.id,
            error: {
                message: error?.message || String(error),
                code: QUERY_ERROR_CODE,
            },
        });
    }
}

async function getTagMetadataCache(libraries = []) {
    const scopeKey = JSON.stringify(libraries);
    const dataVersion = await library.getDataVersion();
    if (
        tagMetadataCache?.scopeKey === scopeKey
        && tagMetadataCache.dataVersion === dataVersion
    ) {
        return tagMetadataCache;
    }

    const files = await library.listTagMetadata(libraries);
    tagMetadataCache = {
        scopeKey,
        dataVersion,
        files,
        categories: collectFolderTagCategories(files),
    };
    return tagMetadataCache;
}

async function handleTagFacets(message) {
    try {
        const cache = await getTagMetadataCache(message.libraries || []);
        parentPort.postMessage({
            id: message.id,
            result: {
                categories: cache.categories,
                totalCount: cache.files.length,
            },
        });
    } catch (error) {
        parentPort.postMessage({
            id: message.id,
            error: {
                message: error?.message || String(error),
                code: QUERY_ERROR_CODE,
            },
        });
    }
}

async function handleTagSearch(message) {
    try {
        const cache = await getTagMetadataCache(message.libraries || []);
        const matchedFiles = filterFilesByFolderTags(
            cache.files,
            message.selections || [],
            message.matchMode,
        );
        const result = await library.listFilesByPaths(matchedFiles.map(file => file.path));
        parentPort.postMessage({ id: message.id, result });
    } catch (error) {
        parentPort.postMessage({
            id: message.id,
            error: {
                message: error?.message || String(error),
                code: QUERY_ERROR_CODE,
            },
        });
    }
}

parentPort.on('message', message => {
    if (message?.type === 'prepare') {
        void handlePrepare(message);
        return;
    }
    if (message?.type === 'search') {
        if (queuedSearch) postSuperseded(queuedSearch);
        queuedSearch = message;
        scheduleSearchQueue();
        return;
    }
    if (message?.type === 'tag-facets') {
        void handleTagFacets(message);
        return;
    }
    if (message?.type === 'tag-search') {
        void handleTagSearch(message);
        return;
    }
    parentPort.postMessage({
        id: message?.id,
        error: {
            message: `Unknown library search request: ${message?.type}`,
            code: QUERY_ERROR_CODE,
        },
    });
});
