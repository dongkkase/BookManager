import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { Writable } from 'node:stream';
import test from 'node:test';
import { pipeWebdavFileStream, pipeWebdavMultipartRanges } from './servers/webdavServer.js';

function fixture(t, size = 1024 * 1024) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-webdav-stream-'));
    const filePath = path.join(root, 'book.cbz');
    fs.writeFileSync(filePath, Buffer.alloc(size, 0x61));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return filePath;
}

function response(onWrite) {
    const res = new Writable({
        highWaterMark: 1,
        write(chunk, encoding, done) {
            this.headersSent = true;
            onWrite.call(this, chunk);
            done();
        },
    });
    res.status = () => res;
    return res;
}

test('WebDAV disconnect closes the source file and releases response listeners', async t => {
    const filePath = fixture(t);
    const res = response(function () { this.destroy(); });
    const stream = pipeWebdavFileStream(res, filePath);
    await once(stream, 'close');
    assert.equal(stream.destroyed, true);
    assert.equal(stream.closed, true);
    assert.equal(stream.fd, null);
    assert.equal(res.listenerCount('close'), 0);
});

test('WebDAV multipart disconnect closes the active file without opening subsequent ranges', async t => {
    const filePath = fixture(t);
    const streams = [];
    const original = fs.createReadStream;
    t.mock.method(fs, 'createReadStream', (...args) => {
        const stream = original(...args);
        streams.push(stream);
        return stream;
    });
    const res = response(function (chunk) {
        if (chunk.length > 1024) this.destroy();
    });
    pipeWebdavMultipartRanges(res, filePath, [
        { start: 0, end: 65535 },
        { start: 65536, end: 131071 },
    ], 'boundary', 'application/octet-stream', 1024 * 1024);
    await once(streams[0], 'close');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].fd, null);
    assert.equal(streams[0].closed, true);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('finish'), 0);
});

test('WebDAV multipart keeps exact range framing and payload on successful delivery', async t => {
    const filePath = fixture(t, 16);
    const chunks = [];
    const res = response(chunk => chunks.push(Buffer.from(chunk)));
    const finished = once(res, 'finish');
    pipeWebdavMultipartRanges(res, filePath, [
        { start: 0, end: 2 },
        { start: 8, end: 11 },
    ], 'boundary', 'application/octet-stream', 16);
    await finished;
    assert.equal(Buffer.concat(chunks).toString(),
        '--boundary\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 0-2/16\r\n\r\naaa\r\n'
        + '--boundary\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 8-11/16\r\n\r\naaaa\r\n'
        + '--boundary--\r\n');
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('finish'), 0);
});

test('WebDAV does not open files for an already disconnected response', t => {
    const filePath = fixture(t);
    const spy = t.mock.method(fs, 'createReadStream', () => { throw new Error('unexpected file open'); });
    const res = response(() => {});
    res.destroy();
    assert.equal(pipeWebdavFileStream(res, filePath), null);
    pipeWebdavMultipartRanges(res, filePath, [{ start: 0, end: 1 }], 'boundary', 'application/octet-stream', 2);
    assert.equal(spy.mock.callCount(), 0);
});

test('WebDAV multipart read failure ends the response without opening later ranges', { timeout: 1000 }, async t => {
    const filePath = `${fixture(t)}.missing`;
    const streams = [];
    const original = fs.createReadStream;
    t.mock.method(fs, 'createReadStream', (...args) => {
        const stream = original(...args);
        streams.push(stream);
        return stream;
    });
    const res = response(() => {});
    const errors = [];
    res.on('error', error => errors.push(error));
    const closed = new Promise(resolve => res.once('close', resolve));
    pipeWebdavMultipartRanges(res, filePath, [{ start: 0, end: 1 }, { start: 2, end: 3 }], 'boundary', 'application/octet-stream', 4);
    await closed;
    assert.equal(streams.length, 1);
    assert.equal(streams[0].destroyed, true);
    assert.equal(errors[0]?.code, 'ENOENT');
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('finish'), 0);
});
