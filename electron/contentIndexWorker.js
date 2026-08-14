import fsp from 'node:fs/promises';
import path from 'node:path';
import { parentPort, Worker, workerData } from 'node:worker_threads';
import { ContentIndexDB } from './database/content_index_db.js';
import { tokenizeContentQuery } from './contentTextExtractor.js';

const CONTENT_EXTRACTOR_VERSION = '2';
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.epub', '.pdf']);
const FILE_STAT_TIMEOUT_MS = 15000;
const LIBRARY_AVAILABILITY_TIMEOUT_MS = 15000;
const DEFAULT_TEXT_EXTRACTION_TIMEOUT_MS = 30000;
const DEFAULT_EPUB_EXTRACTION_TIMEOUT_MS = 90000;
const DEFAULT_PDF_EXTRACTION_TIMEOUT_MS = 180000;
const MAX_FILE_EXTRACTION_TIMEOUT_MS = 10 * 60 * 1000;
const CONTENT_FILE_EXTRACTOR_URL = workerData.extractorWorkerUrl
    ? new URL(workerData.extractorWorkerUrl)
    : new URL('./contentFileExtractorWorker.js', import.meta.url);
const contentIndex = new ContentIndexDB({ dbPath: workerData.dbPath });
let indexRunning = false;
let cancelRequested = false;
let activeIndexAbortController = null;
let activeIndexCompletionPromise = null;
let contentFileExtractor = null;
let activeExtraction = null;
let nextExtractionId = 1;
let progressState = {
    running: false,
    total: 0,
    processed: 0,
    indexed: 0,
    skipped: 0,
    failed: 0,
    currentPath: '',
};

function normalizedEntry(entry = {}) {
    const sourcePath = entry.full_path || entry.file_path || entry.path || '';
    if (!sourcePath) return null;
    const filePath = path.resolve(sourcePath);
    const extension = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) return null;
    return {
        path: filePath,
        library_path: path.resolve(entry.target_folder || entry.library_path || path.dirname(filePath)),
        size: Number(entry.size) || 0,
        mtime: Number(entry.mtime) || 0,
        ext: extension,
    };
}

function indexAbortError() {
    const error = new Error('Content indexing was cancelled.');
    error.name = 'AbortError';
    return error;
}

function contentExtractionError(message, code = 'ERR_CONTENT_EXTRACTION') {
    const error = new Error(message);
    error.code = code;
    return error;
}

function fileExtractionTimeoutMs(value, filePath = '') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        const extension = path.extname(filePath).toLowerCase();
        if (extension === '.pdf') return DEFAULT_PDF_EXTRACTION_TIMEOUT_MS;
        if (extension === '.epub') return DEFAULT_EPUB_EXTRACTION_TIMEOUT_MS;
        return DEFAULT_TEXT_EXTRACTION_TIMEOUT_MS;
    }
    return Math.min(MAX_FILE_EXTRACTION_TIMEOUT_MS, Math.max(1000, Math.floor(parsed)));
}

function finishActiveExtraction(id) {
    if (!activeExtraction || activeExtraction.id !== id) return null;
    const pending = activeExtraction;
    activeExtraction = null;
    clearTimeout(pending.timeoutId);
    return pending;
}

function terminateContentFileExtractor(worker = contentFileExtractor) {
    if (!worker) return;
    if (contentFileExtractor === worker) contentFileExtractor = null;
    try {
        const termination = worker.terminate();
        termination?.catch?.(() => {});
    } catch {
        // The extractor worker has already stopped.
    }
}

function failContentFileExtractor(worker, sourceError) {
    if (contentFileExtractor !== worker && activeExtraction?.worker !== worker) return;
    if (contentFileExtractor === worker) contentFileExtractor = null;
    if (activeExtraction?.worker === worker) {
        const pending = finishActiveExtraction(activeExtraction.id);
        pending?.reject(sourceError?.code
            ? sourceError
            : contentExtractionError(
                sourceError?.message || 'Content file extractor stopped.',
                'ERR_CONTENT_EXTRACTION_TRANSPORT',
            ));
    }
    terminateContentFileExtractor(worker);
}

function startContentFileExtractor() {
    if (contentFileExtractor) return contentFileExtractor;
    const worker = new Worker(CONTENT_FILE_EXTRACTOR_URL);
    contentFileExtractor = worker;
    worker.on('message', message => {
        const pending = finishActiveExtraction(message?.id);
        if (!pending || pending.worker !== worker) return;
        if (message?.error) {
            pending.reject(contentExtractionError(
                message.error.message || 'Content file extraction failed.',
                message.error.code,
            ));
            return;
        }
        pending.resolve(message?.result);
    });
    worker.on('error', error => failContentFileExtractor(worker, error));
    worker.on('exit', code => {
        if (contentFileExtractor !== worker && activeExtraction?.worker !== worker) return;
        failContentFileExtractor(worker, contentExtractionError(
            code === 0
                ? 'Content file extractor stopped.'
                : `Content file extractor exited with code ${code}.`,
            'ERR_CONTENT_EXTRACTION_TRANSPORT',
        ));
    });
    return worker;
}

function extractFileContent(filePath, options = {}) {
    if (activeExtraction) {
        return Promise.reject(contentExtractionError(
            'Content file extraction is already running.',
            'ERR_CONTENT_EXTRACTION_BUSY',
        ));
    }
    let worker;
    try {
        worker = startContentFileExtractor();
    } catch (error) {
        return Promise.reject(contentExtractionError(
            error?.message || 'Could not start content file extractor.',
            'ERR_CONTENT_EXTRACTION_TRANSPORT',
        ));
    }
    const id = nextExtractionId;
    nextExtractionId += 1;
    const timeoutMs = fileExtractionTimeoutMs(options.timeoutMs, filePath);
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            const pending = finishActiveExtraction(id);
            if (!pending) return;
            pending.reject(contentExtractionError(
                `Content extraction timed out after ${timeoutMs}ms.`,
                'ERR_CONTENT_EXTRACTION_TIMEOUT',
            ));
            terminateContentFileExtractor(worker);
        }, timeoutMs);
        activeExtraction = { id, reject, resolve, timeoutId, worker };
        try {
            worker.postMessage({
                id,
                type: 'extract',
                filePath,
                options: options.extractorOptions || {},
            });
        } catch (error) {
            finishActiveExtraction(id)?.reject(contentExtractionError(
                error?.message || 'Could not start content file extraction.',
                'ERR_CONTENT_EXTRACTION_TRANSPORT',
            ));
            terminateContentFileExtractor(worker);
        }
    });
}

function cancelActiveExtraction() {
    if (!activeExtraction) return false;
    const worker = activeExtraction.worker;
    const pending = finishActiveExtraction(activeExtraction.id);
    pending?.reject(indexAbortError());
    terminateContentFileExtractor(worker);
    return true;
}

function awaitWithTimeout(operation, timeoutMs, signal = null) {
    if (signal?.aborted) return Promise.reject(indexAbortError());
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = callback => value => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            signal?.removeEventListener?.('abort', handleAbort);
            callback(value);
        };
        const handleAbort = () => finish(reject)(indexAbortError());
        const timeoutId = setTimeout(() => {
            const error = new Error(`Filesystem operation timed out after ${timeoutMs}ms.`);
            error.code = 'ERR_CONTENT_INDEX_IO_TIMEOUT';
            finish(reject)(error);
        }, timeoutMs);
        signal?.addEventListener?.('abort', handleAbort, { once: true });
        Promise.resolve(operation).then(finish(resolve), finish(reject));
    });
}

async function currentFileDocument(entry, signal) {
    try {
        const stat = await awaitWithTimeout(fsp.stat(entry.path), FILE_STAT_TIMEOUT_MS, signal);
        return {
            available: true,
            document: {
                ...entry,
                size: stat.size,
                mtime: stat.mtimeMs,
                extractor_version: CONTENT_EXTRACTOR_VERSION,
            },
            error: '',
        };
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        return {
            available: false,
            document: {
                ...entry,
                extractor_version: CONTENT_EXTRACTOR_VERSION,
            },
            error: error?.message || String(error),
        };
    }
}

function sameFingerprint(document, entry) {
    return Boolean(
        document
        && ['ready', 'ok', 'truncated', 'empty', 'ocr_required', 'encrypted', 'unsupported'].includes(document.status)
        && Number(document.size) === Number(entry.size)
        && Math.abs(Number(document.mtime || 0) - Number(entry.mtime || 0)) < 2
        && String(document.extractor_version || '') === CONTENT_EXTRACTOR_VERSION
    );
}

function postProgress(changes = {}) {
    progressState = { ...progressState, ...changes };
    parentPort.postMessage({ type: 'progress', progress: progressState });
}

async function combinedStatus(libraries = [], options = {}) {
    const [status, size, availability] = await Promise.all([
        contentIndex.getStatus(libraries),
        contentIndex.getDatabaseSize(),
        resolveLibraryAvailability(libraries),
    ]);
    return {
        ...status,
        ...size,
        ...availability,
        dbPath: workerData.dbPath,
        progress: {
            ...progressState,
            running: options.running ?? progressState.running,
        },
        running: options.running ?? indexRunning,
    };
}

async function resolveLibraryAvailability(libraries = [], signal = null) {
    const onlineLibraries = [];
    const offlineLibraries = [];
    await Promise.all([...new Set((libraries || []).filter(Boolean).map(folder => path.resolve(folder)))].map(async libraryPath => {
        try {
            const stat = await awaitWithTimeout(
                fsp.stat(libraryPath),
                LIBRARY_AVAILABILITY_TIMEOUT_MS,
                signal,
            );
            if (stat.isDirectory()) onlineLibraries.push(libraryPath);
            else offlineLibraries.push(libraryPath);
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError') throw error;
            offlineLibraries.push(libraryPath);
        }
    }));
    return {
        onlineLibraries,
        offlineLibraries,
        onlineLibraryCount: onlineLibraries.length,
        offlineLibraryCount: offlineLibraries.length,
    };
}

async function handleIndex(message) {
    if (indexRunning) {
        throw Object.assign(new Error('Content indexing is already running.'), {
            code: 'ERR_CONTENT_INDEX_BUSY',
        });
    }
    indexRunning = true;
    cancelRequested = false;
    const abortController = new AbortController();
    activeIndexAbortController = abortController;
    const signal = abortController.signal;
    const force = message.options?.force === true;
    const libraries = [...new Set((message.libraries || []).filter(Boolean).map(folder => path.resolve(folder)))];
    const activeLibraries = [...new Set((message.options?.activeLibraries || libraries)
        .filter(Boolean)
        .map(folder => path.resolve(folder)))];
    const authoritativeLibrarySet = new Set((message.options?.authoritativeLibraries || [])
        .filter(Boolean)
        .map(folder => path.resolve(folder)));
    postProgress({
        running: true,
        total: 0,
        processed: 0,
        indexed: 0,
        skipped: 0,
        failed: 0,
        currentPath: '',
        offlineLibraryCount: 0,
    });
    let finalStatus = null;
    let runCancelled = false;

    try {
        const { onlineLibraries, offlineLibraries } = await resolveLibraryAvailability(libraries, signal);
        const onlineLibrarySet = new Set(onlineLibraries);
        const entries = (message.entries || [])
            .map(normalizedEntry)
            .filter(entry => entry && onlineLibrarySet.has(entry.library_path));
        postProgress({
            total: entries.length,
            offlineLibraryCount: offlineLibraries.length,
        });
        if (activeLibraries.length > 0) await contentIndex.removeMissingRoots(activeLibraries);
        for (const libraryPath of onlineLibraries) {
            if (!authoritativeLibrarySet.has(libraryPath)) continue;
            const currentPaths = entries
                .filter(entry => entry.library_path === libraryPath)
                .map(entry => entry.path);
            await contentIndex.removeDocumentsNotInLibrary(libraryPath, currentPaths);
        }

        for (const entry of entries) {
            if (cancelRequested || signal.aborted) break;
            const fileState = await currentFileDocument(entry, signal);
            const document = fileState.document;
            postProgress({ currentPath: document.path });
            const existing = await contentIndex.getDocument(document.path);
            if (!fileState.available) {
                if (!existing) {
                    await contentIndex.markDocumentFailed({
                        ...document,
                        status: 'failed',
                    }, fileState.error || 'File is not available.');
                }
                postProgress({
                    processed: progressState.processed + 1,
                    failed: progressState.failed + 1,
                });
                continue;
            }
            if (!force && sameFingerprint(existing, document)) {
                postProgress({
                    processed: progressState.processed + 1,
                    skipped: progressState.skipped + 1,
                });
                continue;
            }

            let extraction;
            try {
                extraction = await extractFileContent(document.path, {
                    timeoutMs: message.options?.fileExtractionTimeoutMs,
                    extractorOptions: {
                        maxSourceBytes: message.options?.maxSourceBytes,
                        maxPdfSourceBytes: message.options?.maxPdfSourceBytes,
                        maxTokenBytes: message.options?.maxTokenBytes,
                        maxTotalTokenBytes: message.options?.maxTotalTokenBytes,
                        maxUniqueTokens: message.options?.maxUniqueTokens,
                    },
                });
            } catch (error) {
                if (cancelRequested || signal.aborted || error?.name === 'AbortError') {
                    cancelRequested = true;
                    break;
                }
                if (!existing) {
                    await contentIndex.markDocumentFailed({
                        ...document,
                        status: 'failed',
                    }, error?.message || String(error));
                }
                postProgress({
                    processed: progressState.processed + 1,
                    failed: progressState.failed + 1,
                });
                continue;
            }
            await new Promise(resolve => setImmediate(resolve));
            if (extraction.status === 'cancelled') {
                cancelRequested = true;
                break;
            }
            if (cancelRequested || signal.aborted) break;

            if (['ok', 'empty', 'truncated', 'ocr_required', 'encrypted', 'unsupported'].includes(extraction.status)) {
                await contentIndex.upsertDocumentTokens({
                    ...document,
                    status: extraction.status,
                    error: (extraction.warnings || []).join('\n'),
                    token_count: extraction.tokenCount,
                    indexed_at: new Date().toISOString(),
                }, extraction.tokens);
                postProgress({
                    processed: progressState.processed + 1,
                    indexed: progressState.indexed + 1,
                });
                continue;
            }

            if (!existing) {
                await contentIndex.markDocumentFailed({
                    ...document,
                    status: 'failed',
                }, (extraction.warnings || []).join('\n') || extraction.status);
            }
            postProgress({
                processed: progressState.processed + 1,
                failed: progressState.failed + 1,
            });
        }

    } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') {
            cancelRequested = true;
        } else {
            throw error;
        }
    } finally {
        cancelActiveExtraction();
        terminateContentFileExtractor();
        if (activeIndexAbortController === abortController) {
            activeIndexAbortController = null;
        }
        postProgress({ running: false, currentPath: '' });
        runCancelled = cancelRequested;
        try {
            finalStatus = await combinedStatus(libraries, { running: false });
        } finally {
            indexRunning = false;
        }
    }
    return {
        ...finalStatus,
        cancelled: runCancelled,
    };
}

async function handleMessage(message) {
    switch (message.type) {
        case 'search': {
            const tokens = tokenizeContentQuery(message.query || '');
            if (tokens.length === 0) return [];
            return contentIndex.search(tokens, message.libraries || [], message.options || {});
        }
        case 'status':
            return combinedStatus(message.libraries || []);
        case 'index': {
            if (activeIndexCompletionPromise) {
                throw Object.assign(new Error('Content indexing is already running.'), {
                    code: 'ERR_CONTENT_INDEX_BUSY',
                });
            }
            const operation = handleIndex(message);
            activeIndexCompletionPromise = operation;
            void operation.finally(() => {
                if (activeIndexCompletionPromise === operation) activeIndexCompletionPromise = null;
            }).catch(() => {});
            return operation;
        }
        case 'cancel': {
            const wasRunning = indexRunning;
            cancelRequested = true;
            activeIndexAbortController?.abort();
            cancelActiveExtraction();
            if (activeIndexCompletionPromise) {
                try {
                    await activeIndexCompletionPromise;
                } catch {
                    // The original index request reports its own failure.
                }
            }
            return { cancelled: wasRunning };
        }
        case 'clear':
            if (indexRunning) {
                throw Object.assign(new Error('Stop content indexing before clearing the index.'), {
                    code: 'ERR_CONTENT_INDEX_BUSY',
                });
            }
            await contentIndex.clear();
            return combinedStatus([]);
        default:
            throw Object.assign(new Error(`Unknown content index request: ${message.type}`), {
                code: 'ERR_CONTENT_INDEX_REQUEST',
            });
    }
}

parentPort.on('message', message => {
    Promise.resolve(handleMessage(message))
        .then(result => parentPort.postMessage({ id: message.id, result }))
        .catch(error => parentPort.postMessage({
            id: message.id,
            error: {
                message: error?.message || String(error),
                code: error?.code || 'ERR_CONTENT_INDEX',
            },
        }));
});
