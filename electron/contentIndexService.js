import { Worker } from 'node:worker_threads';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_INDEX_TIMEOUT_MS = 12 * 60 * 60 * 1000;

function contentIndexError(message, code = 'ERR_CONTENT_INDEX') {
    const error = new Error(message);
    error.code = code;
    return error;
}

export class ContentIndexService {
    constructor(dbPath, options = {}) {
        this.dbPath = dbPath;
        this.WorkerClass = options.WorkerClass || Worker;
        this.workerUrl = options.workerUrl || new URL('./contentIndexWorker.js', import.meta.url);
        this.extractorWorkerUrl = options.extractorWorkerUrl
            ? String(options.extractorWorkerUrl)
            : null;
        this.requestTimeoutMs = Number(options.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
        this.indexTimeoutMs = Number(options.indexTimeoutMs) || DEFAULT_INDEX_TIMEOUT_MS;
        this.worker = null;
        this.queryWorker = null;
        this.pending = new Map();
        this.progressListeners = new Set();
        this.lastProgress = { running: false };
        this.activeIndexRequestCount = 0;
        this.nextRequestId = 1;
        this.closed = false;
        this.closePromise = null;
    }

    workerSlot(role) {
        return role === 'query' ? 'queryWorker' : 'worker';
    }

    startWorker(role = 'index') {
        const workerSlot = this.workerSlot(role);
        if (this[workerSlot]) return this[workerSlot];
        if (this.closed) throw contentIndexError('Content index service is closed.', 'ERR_CONTENT_INDEX_CLOSED');

        let worker;
        try {
            worker = new this.WorkerClass(this.workerUrl, {
                workerData: {
                    dbPath: this.dbPath,
                    role,
                    extractorWorkerUrl: this.extractorWorkerUrl,
                },
            });
        } catch (error) {
            throw contentIndexError(error?.message || 'Could not start content index worker.', 'ERR_CONTENT_INDEX_TRANSPORT');
        }
        this[workerSlot] = worker;
        worker.on('message', message => {
            if (message?.type === 'progress') {
                this.lastProgress = {
                    ...this.lastProgress,
                    ...(message.progress || {}),
                };
                for (const listener of this.progressListeners) listener(this.lastProgress);
                return;
            }
            const pending = this.finishRequest(message?.id);
            if (!pending || pending.worker !== worker) return;
            if (message?.error) {
                pending.reject(contentIndexError(
                    message.error.message || 'Content index operation failed.',
                    message.error.code,
                ));
                return;
            }
            if (pending.type === 'status' && message?.result && typeof message.result === 'object') {
                const running = this.activeIndexRequestCount > 0;
                pending.resolve({
                    ...message.result,
                    progress: {
                        ...(message.result.progress || {}),
                        ...this.lastProgress,
                        running,
                    },
                    running,
                });
                return;
            }
            pending.resolve(message?.result);
        });
        worker.on('error', error => this.failWorker(role, worker, error));
        worker.on('exit', code => {
            if (this[workerSlot] !== worker) return;
            this.failWorker(role, worker, contentIndexError(
                code === 0 ? 'Content index worker stopped.' : `Content index worker exited with code ${code}.`,
                'ERR_CONTENT_INDEX_TRANSPORT',
            ));
        });
        return worker;
    }

    finishRequest(id) {
        const pending = this.pending.get(id);
        if (!pending) return null;
        this.pending.delete(id);
        clearTimeout(pending.timeoutId);
        return pending;
    }

    failWorker(role, worker, sourceError) {
        const workerSlot = this.workerSlot(role);
        if (this[workerSlot] !== worker) return;
        this[workerSlot] = null;
        const error = sourceError?.code
            ? sourceError
            : contentIndexError(sourceError?.message || 'Content index worker failed.', 'ERR_CONTENT_INDEX_TRANSPORT');
        for (const [id, pending] of this.pending) {
            if (pending.worker !== worker) continue;
            this.finishRequest(id);
            pending.reject(error);
        }
        try {
            const termination = worker.terminate();
            if (termination?.catch) void termination.catch(() => {});
        } catch {
            // The worker has already stopped.
        }
    }

    request(type, payload = {}, timeoutMs = this.requestTimeoutMs, options = {}) {
        if (this.closed) {
            return Promise.reject(contentIndexError('Content index service is closed.', 'ERR_CONTENT_INDEX_CLOSED'));
        }
        return new Promise((resolve, reject) => {
            let worker;
            const workerRole = options.workerRole === 'query' ? 'query' : 'index';
            try {
                worker = this.startWorker(workerRole);
            } catch (error) {
                reject(error);
                return;
            }
            const id = this.nextRequestId;
            this.nextRequestId += 1;
            const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
            const timeoutId = normalizedTimeoutMs > 0
                ? setTimeout(() => {
                    if (!this.pending.has(id)) return;
                    const error = contentIndexError(
                        `Content index operation timed out after ${normalizedTimeoutMs}ms.`,
                        'ERR_CONTENT_INDEX_TIMEOUT',
                    );
                    if (options.terminateOnTimeout === true) {
                        this.failWorker(workerRole, worker, error);
                    } else {
                        this.finishRequest(id)?.reject(error);
                    }
                }, normalizedTimeoutMs)
                : null;
            this.pending.set(id, { resolve, reject, timeoutId, worker, type });
            try {
                worker.postMessage({ id, type, ...payload });
            } catch (error) {
                const pending = this.finishRequest(id);
                pending?.reject(contentIndexError(
                    error?.message || 'Could not send content index request.',
                    'ERR_CONTENT_INDEX_TRANSPORT',
                ));
                this.failWorker(workerRole, worker, error);
            }
        });
    }

    onProgress(listener) {
        if (typeof listener !== 'function') return () => {};
        this.progressListeners.add(listener);
        return () => this.progressListeners.delete(listener);
    }

    search(query, libraries, options = {}) {
        return this.request('search', { query, libraries, options }, this.requestTimeoutMs, {
            workerRole: 'query',
            terminateOnTimeout: true,
        });
    }

    getStatus(libraries = []) {
        return this.request('status', { libraries }, this.requestTimeoutMs, {
            workerRole: 'query',
            terminateOnTimeout: true,
        });
    }

    startIndex(entries, libraries, options = {}) {
        this.activeIndexRequestCount += 1;
        return this.request('index', { entries, libraries, options }, 0)
            .finally(() => {
                this.activeIndexRequestCount = Math.max(0, this.activeIndexRequestCount - 1);
            });
    }

    cancelIndex() {
        return this.request('cancel', {}, this.requestTimeoutMs, { terminateOnTimeout: true });
    }

    clear() {
        return this.request('clear', {}, this.indexTimeoutMs, { terminateOnTimeout: true });
    }

    close() {
        if (this.closePromise) return this.closePromise;
        this.closed = true;
        const workers = [...new Set([this.worker, this.queryWorker].filter(Boolean))];
        this.worker = null;
        this.queryWorker = null;
        const error = contentIndexError('Content index service is closed.', 'ERR_CONTENT_INDEX_CLOSED');
        for (const [id, pending] of this.pending) {
            this.finishRequest(id);
            pending.reject(error);
        }
        this.closePromise = Promise.resolve()
            .then(() => Promise.all(workers.map(worker => worker.terminate?.())))
            .then(() => undefined);
        return this.closePromise;
    }
}
