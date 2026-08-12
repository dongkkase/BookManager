import { Worker } from 'node:worker_threads';

export const LIBRARY_SEARCH_ERROR_CODES = Object.freeze({
    closed: 'ERR_LIBRARY_SEARCH_CLOSED',
    timeout: 'ERR_LIBRARY_SEARCH_TIMEOUT',
    transport: 'ERR_LIBRARY_SEARCH_TRANSPORT',
    query: 'ERR_LIBRARY_SEARCH_QUERY',
});

const DEFAULT_SEARCH_TIMEOUT_MS = 30000;
const DEFAULT_PREPARE_TIMEOUT_MS = 120000;

function librarySearchError(message, code, cause = null) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function transportError(error, fallbackMessage = 'Library search worker failed.') {
    if (error?.code === LIBRARY_SEARCH_ERROR_CODES.transport) return error;
    return librarySearchError(
        error?.message || fallbackMessage,
        LIBRARY_SEARCH_ERROR_CODES.transport,
        error,
    );
}

export function isRetryableLibrarySearchWorkerError(error) {
    return error?.code === LIBRARY_SEARCH_ERROR_CODES.transport;
}

export class LibrarySearchService {
    constructor(dbPath, options = {}) {
        this.dbPath = dbPath;
        this.WorkerClass = options.WorkerClass || Worker;
        this.workerUrl = options.workerUrl || new URL('./librarySearchWorker.js', import.meta.url);
        this.searchTimeoutMs = Number(options.searchTimeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS;
        this.prepareTimeoutMs = Number(options.prepareTimeoutMs) || DEFAULT_PREPARE_TIMEOUT_MS;
        this.worker = null;
        this.nextRequestId = 1;
        this.pending = new Map();
        this.closed = false;
        this.closePromise = null;
    }

    startWorker() {
        if (this.worker) return this.worker;
        if (this.closed) {
            throw librarySearchError(
                'Library search service is closed.',
                LIBRARY_SEARCH_ERROR_CODES.closed,
            );
        }

        let worker;
        try {
            worker = new this.WorkerClass(this.workerUrl, {
                workerData: { dbPath: this.dbPath },
            });
        } catch (error) {
            throw transportError(error, 'Could not start library search worker.');
        }
        this.worker = worker;
        worker.on('message', message => {
            const request = this.pending.get(message?.id);
            if (!request || request.worker !== worker) return;
            this.finishRequest(message.id);
            if (message.superseded) {
                request.resolve([]);
                return;
            }
            if (message.error) {
                request.reject(librarySearchError(
                    message.error.message || 'Library search failed.',
                    message.error.code || LIBRARY_SEARCH_ERROR_CODES.query,
                ));
                return;
            }
            request.resolve(message.result);
        });
        worker.on('error', error => {
            this.failWorker(worker, transportError(error));
        });
        worker.on('exit', code => {
            if (this.worker !== worker) return;
            this.failWorker(worker, transportError(
                new Error(code === 0
                    ? 'Library search worker stopped.'
                    : `Library search worker exited with code ${code}.`),
            ));
        });
        return worker;
    }

    finishRequest(id) {
        const request = this.pending.get(id);
        if (!request) return null;
        this.pending.delete(id);
        clearTimeout(request.timeoutId);
        return request;
    }

    failWorker(worker, error) {
        if (this.worker !== worker) return;
        this.worker = null;
        for (const [id, request] of this.pending) {
            if (request.worker !== worker) continue;
            this.finishRequest(id);
            request.reject(error);
        }
        try {
            const termination = worker.terminate();
            if (termination?.catch) void termination.catch(() => {});
        } catch {
            // The worker has already stopped.
        }
    }

    request(type, payload = {}, timeoutMs = this.searchTimeoutMs) {
        if (this.closed) {
            return Promise.reject(librarySearchError(
                'Library search service is closed.',
                LIBRARY_SEARCH_ERROR_CODES.closed,
            ));
        }

        return new Promise((resolve, reject) => {
            let worker;
            try {
                worker = this.startWorker();
            } catch (error) {
                reject(error);
                return;
            }

            const id = this.nextRequestId;
            this.nextRequestId += 1;
            const timeoutId = setTimeout(() => {
                if (!this.pending.has(id)) return;
                const error = librarySearchError(
                    `Library search worker timed out after ${timeoutMs}ms.`,
                    LIBRARY_SEARCH_ERROR_CODES.timeout,
                );
                this.failWorker(worker, error);
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timeoutId, worker });
            try {
                worker.postMessage({ id, type, ...payload });
            } catch (error) {
                const request = this.finishRequest(id);
                request?.reject(transportError(error, 'Could not send library search request.'));
                this.failWorker(worker, transportError(error));
            }
        });
    }

    prepare() {
        return this.request('prepare', {}, this.prepareTimeoutMs);
    }

    search(query, libraries, options) {
        return this.request('search', { query, libraries, options }, this.searchTimeoutMs);
    }

    close() {
        if (this.closePromise) return this.closePromise;
        this.closed = true;
        const worker = this.worker;
        this.worker = null;
        const error = librarySearchError(
            'Library search service is closed.',
            LIBRARY_SEARCH_ERROR_CODES.closed,
        );
        for (const [id, request] of this.pending) {
            this.finishRequest(id);
            request.reject(error);
        }
        this.closePromise = Promise.resolve()
            .then(() => worker?.terminate?.())
            .then(() => undefined);
        return this.closePromise;
    }
}
