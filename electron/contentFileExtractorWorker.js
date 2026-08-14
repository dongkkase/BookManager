import { parentPort } from 'node:worker_threads';
import { extractContentTokens } from './contentTextExtractor.js';

parentPort.on('message', message => {
    if (message?.type !== 'extract') return;
    Promise.resolve(extractContentTokens(message.filePath, message.options || {}))
        .then(result => parentPort.postMessage({ id: message.id, result }))
        .catch(error => parentPort.postMessage({
            id: message.id,
            error: {
                message: error?.message || String(error),
                code: error?.code || 'ERR_CONTENT_EXTRACTION',
            },
        }));
});
