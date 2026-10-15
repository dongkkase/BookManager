import { Worker } from 'node:worker_threads';

const failure = code => Object.assign(new Error(code), { code });

export class EpubOptimizerService {
    constructor({ createProcessor, createWorker = (url, options) => new Worker(url, options) } = {}) {
        this.createProcessor = createProcessor;
        this.createWorker = createWorker;
        this.operations = new Map();
    }

    run(owner, request, onProgress = () => {}) {
        if (this.operations.has(owner)) throw failure('OPTIMIZER_BUSY');
        const worker = this.createWorker(new URL('./worker.js', import.meta.url), { workerData: request });
        const controller = new AbortController();
        const operation = { worker, controller, operationId: request.operationId, processor: null };
        this.operations.set(owner, operation);
        operation.promise = new Promise((resolve, reject) => {
            let settled = false;
            const settle = (error, result) => {
                if (settled) return;
                settled = true;
                controller.abort();
                operation.processor?.dispose();
                if (this.operations.get(owner) === operation) this.operations.delete(owner);
                if (error) reject(error);
                else resolve(result);
            };
            worker.on('message', async message => {
                if (settled) return;
                if (message.type === 'result') settle(null, message.result);
                else if (message.type === 'error') settle(Object.assign(new Error(message.error?.message || 'OPTIMIZER_FAILED'), {
                    code: message.error?.code || 'OPTIMIZER_FAILED', ...(message.error?.backupPath ? { backupPath: message.error.backupPath } : {}),
                }));
                else if (message.type === 'progress') onProgress(message.progress);
                else if (message.type === 'image') {
                    try {
                        if (controller.signal.aborted) throw failure('TASK_CANCELLED');
                        const processor = operation.processor || await this.createProcessor();
                        if (settled) { processor.dispose(); return; }
                        operation.processor = processor;
                        if (controller.signal.aborted) throw failure('TASK_CANCELLED');
                        const data = await operation.processor.transform(message, controller.signal);
                        if (!settled) worker.postMessage({ type: 'imageResult', id: message.id, data });
                    } catch (error) {
                        if (!settled) worker.postMessage({ type: 'imageResult', id: message.id, error: { code: error.code || 'IMAGE_DECODE_FAILED', message: error.message } });
                    }
                }
            });
            worker.once('error', error => settle(error));
            worker.once('exit', () => { if (!settled) settle(failure('OPTIMIZER_INTERRUPTED')); });
        });
        return operation.promise;
    }

    cancel(owner, operationId) {
        const operation = this.operations.get(owner);
        if (!operation || operation.operationId !== operationId) return { canceled: false };
        operation.controller.abort();
        operation.worker.postMessage({ type: 'cancel' });
        return { canceled: true };
    }

    async dispose(owner) {
        const pending = [...this.operations.entries()].filter(([id]) => owner === undefined || owner === id);
        for (const [id, operation] of pending) this.cancel(id, operation.operationId);
        await Promise.allSettled(pending.map(([, operation]) => operation.promise));
    }
}
