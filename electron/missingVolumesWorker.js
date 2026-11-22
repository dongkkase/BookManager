import { parentPort, workerData } from 'node:worker_threads';
import { checkMissingVolumes } from './tasks/missingVolumesTask.js';

const cancellation = new Int32Array(workerData.cancellation);
const shouldCancel = () => Atomics.load(cancellation, 0) !== 0;

try {
    const result = await checkMissingVolumes(workerData.libraryFolders, { ...workerData.options, shouldCancel });
    if (shouldCancel()) throw Object.assign(new Error('Missing-volume check cancelled.'), { code: 'TASK_CANCELLED' });
    parentPort.postMessage({ type: 'result', result });
} catch (error) {
    parentPort.postMessage({ type: 'error', error: { code: error.code, message: error.message } });
} finally {
    parentPort.close();
}
