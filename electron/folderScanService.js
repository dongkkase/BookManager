import { Worker } from 'node:worker_threads';

const cancellationError = () => Object.assign(new Error('Folder scan cancelled.'), { code: 'TASK_CANCELLED' });
const activeScansBySender = new WeakMap();

export function shouldRunFolderScanInWorker(options = {}) {
    return options?.background === true && options.skipCoverExtraction === true && options.quickListOnly !== true;
}

export function runFolderScanInWorker(folderPath, options = {}, event, dependencies = {}) {
    const sender = event?.sender;
    const previous = sender && activeScansBySender.get(sender);
    const start = () => startFolderScanWorker(folderPath, options, event, dependencies);
    const task = previous ? previous.catch(() => {}).then(start) : start();
    if (sender) {
        activeScansBySender.set(sender, task);
        const cleanup = () => {
            if (activeScansBySender.get(sender) === task) activeScansBySender.delete(sender);
        };
        void task.then(cleanup, cleanup);
    }
    return task;
}

function startFolderScanWorker(folderPath, options, event, dependencies) {
    const { shouldCancel, thumbnailEncoder, libraryDb, ...workerOptions } = options;
    const WorkerClass = dependencies.WorkerClass || Worker;
    const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const senderClosed = () => event?.sender?.isDestroyed() === true;
    if (shouldCancel?.() || senderClosed()) return Promise.reject(cancellationError());

    return new Promise((resolve, reject) => {
        let worker;
        let cancellationTimer;
        let terminationTimer;
        let result;
        let failure;
        let receivedResult = false;
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearInterval(cancellationTimer);
            clearTimeout(terminationTimer);
            if (Atomics.load(cancellation, 0)) reject(cancellationError());
            else if (error) reject(error);
            else resolve(result);
        };
        const checkCancellation = () => {
            if (settled || Atomics.load(cancellation, 0) || (!shouldCancel?.() && !senderClosed())) return;
            Atomics.store(cancellation, 0, 1);
            terminationTimer = setTimeout(() => {
                try {
                    Promise.resolve(worker.terminate()).catch(error => { failure = error; });
                } catch (error) {
                    failure = error;
                }
            }, dependencies.cancelGraceMs ?? 5000);
        };

        try {
            worker = new WorkerClass(dependencies.workerUrl || new URL('./folderScanWorker.js', import.meta.url), {
                workerData: { folderPath, options: workerOptions, cancellation: cancellation.buffer },
                execArgv: process.execArgv.filter(argument => !argument.startsWith('--input-type')),
            });
        } catch (error) {
            finish(error);
            return;
        }
        cancellationTimer = setInterval(checkCancellation, 25);
        worker.on('message', message => {
            checkCancellation();
            if (message?.type === 'result') {
                receivedResult = true;
                result = message.files;
            } else if (message?.type === 'error') {
                failure = Object.assign(new Error(message.error?.message || 'Folder scan worker failed.'), {
                    code: message.error?.code || 'FOLDER_SCAN_FAILED',
                });
            } else if (message?.type === 'event' && !Atomics.load(cancellation, 0) && !senderClosed()) {
                event?.sender?.send(message.channel, message.data);
            }
        });
        worker.once('error', error => { failure = error; });
        worker.once('exit', code => {
            checkCancellation();
            finish(failure || (!receivedResult || code !== 0
                ? new Error(`Folder scan worker exited without a result (${code}).`)
                : null));
        });
    });
}
