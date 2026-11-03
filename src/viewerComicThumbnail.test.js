import assert from 'node:assert/strict';
import test from 'node:test';
import { readStaticComicPngSize, scheduleComicThumbnail } from './viewerComicThumbnail.js';

function png({ animated = false, height = 125000 } = {}) {
    const chunk = (name, data) => {
        const buffer = Buffer.alloc(data.length + 12);
        buffer.writeUInt32BE(data.length);
        buffer.write(name, 4);
        data.copy(buffer, 8);
        return buffer;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(720);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return new Blob([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        ...(animated ? [chunk('acTL', Buffer.alloc(8))] : []),
        chunk('IDAT', Buffer.alloc(30 * 1024 * 1024)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

test('tall PNG metadata reads at most 25 bytes at a time without copying compressed pixels', async () => {
    const blob = png();
    let bytesRead = 0;
    const source = {
        size: blob.size,
        slice(start, end) {
            assert.ok(end - start <= 25);
            bytesRead += end - start;
            return blob.slice(start, end);
        },
    };
    assert.deepEqual(await readStaticComicPngSize(source), { width: 720, height: 125000 });
    assert.ok(bytesRead < 100);
});

test('animated, truncated and cancelled PNGs never become a static thumbnail', async () => {
    assert.equal(await readStaticComicPngSize(png({ animated: true })), null);
    const blob = png();
    assert.equal(await readStaticComicPngSize(blob.slice(0, 32)), null);
    assert.equal(await readStaticComicPngSize(blob, () => true), null);
    assert.equal(await readStaticComicPngSize(new Blob(['not png'])), null);
});

test('thumbnail decoding remains serialized when a running consumer is cancelled', async () => {
    const events = [];
    let finish;
    const cancelFirst = scheduleComicThumbnail(async isCancelled => {
        events.push('first');
        await new Promise(resolve => { finish = resolve; });
        assert.equal(isCancelled(), true);
        events.push('first-finished');
    });
    await new Promise(resolve => setImmediate(resolve));
    const cancelPending = scheduleComicThumbnail(() => events.push('cancelled-pending'));
    const completed = new Promise(resolve => scheduleComicThumbnail(() => { events.push('last'); resolve(); }));
    cancelFirst();
    cancelPending();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['first']);
    finish();
    await completed;
    assert.deepEqual(events, ['first', 'first-finished', 'last']);
});

test('foreground page decoding precedes queued thumbnails while keeping FIFO order within a priority', async () => {
    const events = [];
    let finish;
    scheduleComicThumbnail(() => new Promise(resolve => { finish = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    scheduleComicThumbnail(() => events.push('thumbnail-first'));
    const cancelPending = scheduleComicThumbnail(() => events.push('cancelled-page'), { priority: 0 });
    scheduleComicThumbnail(() => events.push('page-first'), { priority: 0 });
    scheduleComicThumbnail(() => events.push('page-second'), { priority: 0 });
    const completed = new Promise(resolve => scheduleComicThumbnail(() => { events.push('thumbnail-last'); resolve(); }));
    cancelPending();
    finish();
    await completed;
    assert.deepEqual(events, ['page-first', 'page-second', 'thumbnail-first', 'thumbnail-last']);
});
