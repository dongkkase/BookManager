import { Worker } from 'node:worker_threads';

const cancelledError = () => Object.assign(new Error('Folder preview cancelled.'), { code: 'TASK_CANCELLED' });

export function createFolderPreviewService({ thumbnailEncoder, ...dependencies } = {}) {
    const WorkerClass = dependencies.WorkerClass || Worker;
    const slots = new Set();
    const queue = [];
    let nextId = 0;
    let disposed = false;
    let pollTimer = null;

    const settle = (job, error, result) => {
        if (job.settled) return;
        job.settled = true;
        if (error) job.reject(error);
        else job.resolve(result);
    };
    const stopSlot = slot => {
        if (slot.stopping) return;
        slot.stopping = true;
        clearTimeout(slot.idleTimer);
        slot.worker.terminate().catch(() => {});
    };
    const cancelJob = job => {
        Atomics.store(job.cancellation, 0, 1);
        settle(job, cancelledError());
        if (job.slot && !job.cancelTimer) {
            job.cancelTimer = setTimeout(() => stopSlot(job.slot), dependencies.cancelGraceMs ?? 5000);
        }
    };
    const checkCancellation = () => {
        for (let index = queue.length - 1; index >= 0; index -= 1) {
            if (!queue[index].shouldCancel?.()) continue;
            cancelJob(queue.splice(index, 1)[0]);
        }
        for (const slot of slots) {
            if (slot.job?.shouldCancel?.() && !slot.job.settled) cancelJob(slot.job);
        }
        if (queue.length === 0 && ![...slots].some(slot => slot.job)) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };
    const idle = slot => {
        slot.worker.unref();
        slot.idleTimer = setTimeout(() => {
            slot.stopping = true;
            slot.worker.ref();
            slot.worker.postMessage({ type: 'shutdown' });
        }, dependencies.idleTimeoutMs ?? 30000);
        slot.idleTimer.unref?.();
    };
    const createSlot = () => {
        const worker = new WorkerClass(dependencies.workerUrl || new URL('./folderPreviewWorker.js', import.meta.url), {
            execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')),
        });
        const slot = { worker, job: null, stopping: false, idleTimer: null };
        slots.add(slot);
        worker.on('message', message => {
            const job = slot.job;
            if (!job || message.id !== job.id) return;
            if (message.type === 'encode') {
                void Promise.resolve().then(() => {
                    if (job.settled || job.shouldCancel?.()) throw cancelledError();
                    return thumbnailEncoder?.(Buffer.from(message.buffer), message.options);
                }).then(result => {
                    if (slot.job === job && (!slot.stopping || slot.shuttingDown)) worker.postMessage({
                        type: 'encoded', id: job.id, encodeId: message.encodeId, result,
                    });
                }, error => {
                    if (slot.job === job && (!slot.stopping || slot.shuttingDown)) worker.postMessage({
                        type: 'encoded', id: job.id, encodeId: message.encodeId,
                        error: { message: error.message, code: error.code },
                    });
                }).catch(error => {
                    settle(job, error);
                    stopSlot(slot);
                });
                return;
            }
            if (message.type !== 'result' && message.type !== 'error') return;
            clearTimeout(job.cancelTimer);
            if (job.shouldCancel?.() || Atomics.load(job.cancellation, 0)) settle(job, cancelledError());
            else if (message.type === 'error') settle(job, Object.assign(new Error(message.error.message), {
                code: message.error.code,
            }));
            else settle(job, null, message.result);
            slot.job = null;
            pump();
            if (!slot.job && !slot.stopping) idle(slot);
            checkCancellation();
        });
        worker.on('error', error => {
            if (slot.job) settle(slot.job, error);
            stopSlot(slot);
        });
        worker.once('exit', code => {
            clearTimeout(slot.idleTimer);
            if (slot.job) {
                clearTimeout(slot.job.cancelTimer);
                settle(slot.job, new Error(`Folder preview worker exited (${code}).`));
            }
            slots.delete(slot);
            pump();
            checkCancellation();
        });
        return slot;
    };
    const pump = () => {
        if (disposed) return;
        while (queue.length > 0) {
            let slot = [...slots].find(value => !value.job && !value.stopping);
            if (!slot && slots.size >= 2) return;
            const job = queue.shift();
            if (job.shouldCancel?.()) {
                cancelJob(job);
                continue;
            }
            try {
                if (!slot) slot = createSlot();
                clearTimeout(slot.idleTimer);
                slot.worker.ref();
                slot.job = job;
                job.slot = slot;
                slot.worker.postMessage({
                    type: 'run', id: job.id, operation: job.operation, filePath: job.filePath,
                    options: job.options, cancellation: job.cancellation.buffer,
                    encodeThumbnails: typeof thumbnailEncoder === 'function',
                });
            } catch (error) {
                settle(job, error);
                if (slot) stopSlot(slot);
            }
        }
    };
    const run = (operation, filePath, options = {}) => {
        if (disposed) return Promise.reject(cancelledError());
        const { shouldCancel, thumbnailEncoder: ignoredEncoder, libraryDb, ...workerOptions } = options;
        if (shouldCancel?.()) return Promise.reject(cancelledError());
        if (queue.length >= 128) return Promise.reject(Object.assign(new Error('Folder preview queue is full.'), {
            code: 'PREVIEW_QUEUE_FULL',
        }));
        return new Promise((resolve, reject) => {
            queue.push({
                id: ++nextId, operation, filePath, options: workerOptions, shouldCancel, resolve, reject,
                cancellation: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), settled: false,
            });
            if (!pollTimer) pollTimer = setInterval(checkCancellation, 25);
            pump();
        });
    };

    return {
        preview: (filePath, options) => run('preview', filePath, options),
        details: (filePath, options) => run('details', filePath, options),
        async dispose() {
            disposed = true;
            clearInterval(pollTimer);
            pollTimer = null;
            for (const job of queue.splice(0)) cancelJob(job);
            await Promise.all([...slots].map(slot => {
                if (slot.job) {
                    cancelJob(slot.job);
                    clearTimeout(slot.job.cancelTimer);
                }
                clearTimeout(slot.idleTimer);
                slot.stopping = true;
                slot.shuttingDown = true;
                slot.worker.ref();
                return new Promise(resolve => {
                    const timeout = setTimeout(() => {
                        slot.worker.terminate().catch(() => {});
                    }, dependencies.cancelGraceMs ?? 5000);
                    slot.worker.once('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    slot.worker.postMessage({ type: 'shutdown' });
                });
            }));
        },
    };
}
