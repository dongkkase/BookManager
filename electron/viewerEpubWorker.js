import { parentPort, workerData } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import { ViewerSessionManager } from './viewerSessions.js';

const { chapters, ...book } = await ViewerSessionManager.readEpubSession(workerData);
const resourceUrls = chapters[0]?.original?.resourceUrls || {};
const chapterPackets = [];
let records = [];
let length = 0;
function flush() {
    const compressed = gzipSync(`[${records.join(',')}]`, { level: 1 });
    chapterPackets.push(Uint8Array.from(compressed).buffer);
    records = [];
    length = 0;
}

// Bound each renderer parse even when a chapter contains thousands of optimized blocks.
for (const chapter of chapters) {
    const { blocks, original, ...heading } = chapter;
    heading.original = { ...original, resourceUrls: undefined };
    for (let start = 0; start < Math.max(1, blocks.length); start += 128) {
        const record = JSON.stringify([start === 0 ? heading : null, blocks.slice(start, start + 128)]);
        if (length && length + record.length > 256 * 1024) flush();
        records.push(record);
        length += record.length;
    }
}
if (length) flush();
parentPort.postMessage({ ...book, resourceUrls, chapterPackets }, chapterPackets);
