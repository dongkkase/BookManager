import { parentPort, workerData } from 'node:worker_threads';
import { inspectEpub, optimizeEpub, optimizerError } from './core.js';

let cancelled = false;
let imageSequence = 0;
const imageRequests = new Map();
parentPort.on('message', message => {
    if (message?.type === 'cancel') {
        cancelled = true;
        for (const request of imageRequests.values()) request.reject(optimizerError('TASK_CANCELLED'));
        imageRequests.clear();
    }
    if (message?.type === 'imageResult') {
        const request = imageRequests.get(message.id);
        if (!request) return;
        imageRequests.delete(message.id);
        if (message.error) request.reject(optimizerError(message.error.code || 'IMAGE_FAILED'));
        else request.resolve(Buffer.from(message.data || []));
    }
});

const options = {
    shouldCancel: () => cancelled,
    onProgress: progress => parentPort.postMessage({ type: 'progress', progress }),
    expectedFingerprint: workerData.expectedFingerprint,
    backup: workerData.backup === true,
    overwrite: workerData.overwrite === true,
    transformImage: ({ data, mimeType, settings, name }) => new Promise((resolve, reject) => {
        if (cancelled) { reject(optimizerError('TASK_CANCELLED')); return; }
        const id = ++imageSequence;
        imageRequests.set(id, { resolve, reject });
        parentPort.postMessage({ type: 'image', id, data, mimeType, settings, name });
    }),
};

try {
    let result;
    if (workerData.action === 'inspect') result = await inspectEpub(workerData.filePath, options);
    else if (workerData.action === 'optimize') result = await optimizeEpub(workerData.filePath, workerData.settings, options);
    else throw optimizerError('INVALID_ACTION');
    parentPort.postMessage({ type: 'result', result });
} catch (error) {
    parentPort.postMessage({ type: 'error', error: { code: error.code || 'EPUB_OPTIMIZATION_FAILED', message: error.message,
        ...(error.backupPath ? { backupPath: error.backupPath } : {}) } });
} finally {
    parentPort.close();
}
