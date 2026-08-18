import { parentPort, workerData } from 'node:worker_threads';
import { writeAudioMetadataFileInProcess } from './audioMetadataWriter.js';

function serializeError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        code: error?.code,
        extension: error?.extension,
        mismatches: error?.mismatches,
        stack: error?.stack,
    };
}

try {
    const result = await writeAudioMetadataFileInProcess(
        workerData.filePath,
        workerData.metadata || {},
        { cover: workerData.cover || null },
    );
    parentPort.postMessage({ result });
} catch (error) {
    parentPort.postMessage({ error: serializeError(error) });
}
