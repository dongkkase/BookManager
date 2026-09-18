import { parentPort, workerData } from 'node:worker_threads';

import { loadTextCleanerFileDirect } from './textCleanerFile.js';

try {
    const result = await loadTextCleanerFileDirect(workerData.filePath);
    parentPort.postMessage({ ok: true, result });
} catch (error) {
    parentPort.postMessage({
        ok: false,
        error: {
            code: error?.code || 'LOAD_FAILED',
            message: error instanceof Error ? error.message : String(error),
        },
    });
}
