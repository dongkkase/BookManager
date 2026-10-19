import { parentPort } from 'node:worker_threads';
import { LibraryDB } from './database/library_db.js';
import { readFolderDetails } from './folderDetails.js';
import { inspectFolderFile } from './tasks/folderScanTask.js';

const pendingEncodings = new Map();
let nextEncodeId = 0;
let library = null;
let busy = false;
let shuttingDown = false;

async function closeWorker() {
    await library?.close();
    library = null;
    parentPort.close();
}

parentPort.on('message', async message => {
    if (message.type === 'encoded') {
        const pending = pendingEncodings.get(message.encodeId);
        if (!pending) return;
        pendingEncodings.delete(message.encodeId);
        if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
        else pending.resolve(message.result?.buffer
            ? { ...message.result, buffer: Buffer.from(message.result.buffer) }
            : message.result);
        return;
    }
    if (message.type === 'shutdown') {
        shuttingDown = true;
        if (!busy) await closeWorker();
        return;
    }
    if (message.type !== 'run') return;
    busy = true;
    const cancellation = new Int32Array(message.cancellation);
    const shouldCancel = () => Atomics.load(cancellation, 0) !== 0;
    let response;
    try {
        if (shouldCancel() || shuttingDown) throw Object.assign(new Error('Folder preview cancelled.'), { code: 'TASK_CANCELLED' });
        const options = { ...message.options, shouldCancel };
        if (message.operation === 'preview') {
            if (library && library.dbPath !== options.dbPath) {
                await library.close();
                library = null;
            }
            if (!library && options.dbPath) library = new LibraryDB({ dbPath: options.dbPath });
            options.libraryDb = library;
            if (message.encodeThumbnails) options.thumbnailEncoder = (buffer, encodeOptions) => new Promise((resolve, reject) => {
                const encodeId = ++nextEncodeId;
                pendingEncodings.set(encodeId, { resolve, reject });
                parentPort.postMessage({
                    type: 'encode', id: message.id, encodeId, buffer, options: encodeOptions,
                });
            });
        }
        const result = message.operation === 'details'
            ? await readFolderDetails(message.filePath, options)
            : await inspectFolderFile(message.filePath, options);
        if (shouldCancel()) throw Object.assign(new Error('Folder preview cancelled.'), { code: 'TASK_CANCELLED' });
        response = { type: 'result', id: message.id, result };
    } catch (error) {
        response = { type: 'error', id: message.id, error: { message: error.message, code: error.code } };
    } finally {
        if (library?.__bookManagerUnavailable) {
            await library.close();
            library = null;
        }
    }
    parentPort.postMessage(response);
    busy = false;
    if (shuttingDown) await closeWorker();
});
