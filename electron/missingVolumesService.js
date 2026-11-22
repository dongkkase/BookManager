import { Worker } from 'node:worker_threads';

const cancellationError = () => Object.assign(new Error('Missing-volume check cancelled.'), { code: 'TASK_CANCELLED' });
const activeChecksBySender = new WeakMap();

export function runMissingVolumesInWorker(libraryFolders, options = {}, event, dependencies = {}) {
    const sender = event?.sender;
    const previous = sender && activeChecksBySender.get(sender);
    const start = () => startMissingVolumesWorker(libraryFolders, options, event, dependencies);
    const task = previous ? previous.catch(() => {}).then(start) : start();
    if (sender) {
        activeChecksBySender.set(sender, task);
        const cleanup = () => {
            if (activeChecksBySender.get(sender) === task) activeChecksBySender.delete(sender);
        };
        void task.then(cleanup, cleanup);
    }
    return task;
}

function startMissingVolumesWorker(libraryFolders, options, event, dependencies) {
    const { shouldCancel, libraryDb, ...workerOptions } = options;
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
            worker = new WorkerClass(dependencies.workerUrl || new URL('./missingVolumesWorker.js', import.meta.url), {
                workerData: { libraryFolders, options: workerOptions, cancellation: cancellation.buffer },
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
                result = message.result;
            } else if (message?.type === 'error') {
                failure = Object.assign(new Error(message.error?.message || 'Missing-volume worker failed.'), {
                    code: message.error?.code || 'MISSING_VOLUMES_FAILED',
                });
            }
        });
        worker.once('error', error => { failure = error; });
        worker.once('exit', code => {
            checkCancellation();
            finish(failure || (!receivedResult || code !== 0
                ? new Error(`Missing-volume worker exited without a result (${code}).`)
                : null));
        });
    });
}
