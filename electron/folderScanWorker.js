import { parentPort, workerData } from 'node:worker_threads';
import { scanFolder } from './tasks/folderScanTask.js';

const READY_BATCH_SIZE = 128;
const READY_BATCH_INTERVAL_MS = 150;
const cancellation = new Int32Array(workerData.cancellation);
const shouldCancel = () => Atomics.load(cancellation, 0) !== 0;
let readyFiles = [];
let readyMetadata = null;
let readyTimer = null;

function flushReadyFiles() {
    clearTimeout(readyTimer);
    readyTimer = null;
    if (readyFiles.length === 0) return;
    const files = readyFiles;
    readyFiles = [];
    if (!shouldCancel()) {
        parentPort.postMessage({ type: 'event', channel: 'folder:fileReady', data: { ...readyMetadata, files } });
    }
}

const event = { sender: {
    isDestroyed: shouldCancel,
    send(channel, data) {
        if (shouldCancel()) return;
        if (channel === 'folder:fileReady' && data?.file) {
            const { file, ...metadata } = data;
            readyMetadata = metadata;
            readyFiles.push(file);
            if (readyFiles.length >= READY_BATCH_SIZE) flushReadyFiles();
            else if (!readyTimer) readyTimer = setTimeout(flushReadyFiles, READY_BATCH_INTERVAL_MS);
        } else {
            if (channel === 'scan-complete' || data?.progress === 100) flushReadyFiles();
            parentPort.postMessage({ type: 'event', channel, data });
        }
    },
} };

try {
    const files = await scanFolder(workerData.folderPath, { ...workerData.options, shouldCancel }, event);
    flushReadyFiles();
    parentPort.postMessage({ type: 'result', files });
} catch (error) {
    flushReadyFiles();
    parentPort.postMessage({ type: 'error', error: { code: error.code, message: error.message } });
} finally {
    clearTimeout(readyTimer);
    parentPort.close();
}
