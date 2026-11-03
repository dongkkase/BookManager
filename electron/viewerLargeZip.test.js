import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32 } from './core/zipArchive.js';
import { ViewerSessionManager } from './viewerSessions.js';
import { viewerComicPageCache } from './viewerComicQueue.js';

test('6.4GiB ZIP64의 2000개 페이지를 전체 파일 로딩 없이 읽는다', { skip: process.platform === 'win32' }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-large-zip-'));
    const filePath = path.join(root, 'large.cbz');
    const manager = new ViewerSessionManager({ getSevenZPath: async () => '' });
    let session;
    t.after(() => {
        if (session) manager.cancelComicSession(session.id);
        fs.rmSync(root, { recursive: true, force: true });
    });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJtkAAAAASUVORK5CYII=', 'base64');
    const count = 2000;
    const centralOffset = Math.ceil(6.4 * 1024 ** 3);
    const records = [];
    const fd = fs.openSync(filePath, 'w');
    try {
        for (let index = 0; index < count; index += 1) {
            const name = Buffer.from(`chapter/${String(index).padStart(4, '0')}.png`);
            const offset = index === count - 1 ? centralOffset - 1024 : index * 512;
            const local = Buffer.alloc(30);
            local.writeUInt32LE(0x04034b50, 0);
            local.writeUInt16LE(45, 4);
            local.writeUInt32LE(crc32(image), 14);
            local.writeUInt32LE(image.length, 18);
            local.writeUInt32LE(image.length, 22);
            local.writeUInt16LE(name.length, 26);
            fs.writeSync(fd, Buffer.concat([local, name, image]), 0, local.length + name.length + image.length, offset);
            const extra = offset > 0xffffffff ? Buffer.alloc(12) : Buffer.alloc(0);
            if (extra.length) {
                extra.writeUInt16LE(1, 0);
                extra.writeUInt16LE(8, 2);
                extra.writeBigUInt64LE(BigInt(offset), 4);
            }
            const record = Buffer.alloc(46);
            record.writeUInt32LE(0x02014b50, 0);
            record.writeUInt16LE(45, 4);
            record.writeUInt16LE(45, 6);
            record.writeUInt32LE(crc32(image), 16);
            record.writeUInt32LE(image.length, 20);
            record.writeUInt32LE(image.length, 24);
            record.writeUInt16LE(name.length, 28);
            record.writeUInt16LE(extra.length, 30);
            record.writeUInt32LE(extra.length ? 0xffffffff : offset, 42);
            records.push(record, name, extra);
        }
        const central = Buffer.concat(records);
        const zip64 = Buffer.alloc(56);
        zip64.writeUInt32LE(0x06064b50, 0);
        zip64.writeBigUInt64LE(44n, 4);
        zip64.writeUInt16LE(45, 12);
        zip64.writeUInt16LE(45, 14);
        zip64.writeBigUInt64LE(BigInt(count), 24);
        zip64.writeBigUInt64LE(BigInt(count), 32);
        zip64.writeBigUInt64LE(BigInt(central.length), 40);
        zip64.writeBigUInt64LE(BigInt(centralOffset), 48);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        locator.writeBigUInt64LE(BigInt(centralOffset + central.length), 8);
        locator.writeUInt32LE(1, 16);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(0xffff, 8);
        end.writeUInt16LE(0xffff, 10);
        end.writeUInt32LE(central.length, 12);
        end.writeUInt32LE(0xffffffff, 16);
        const tail = Buffer.concat([central, zip64, locator, end]);
        fs.writeSync(fd, tail, 0, tail.length, centralOffset);
    } finally {
        fs.closeSync(fd);
    }
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 6.4 * 1024 ** 3);
    assert.ok(stat.blocks * 512 < 64 * 1024 * 1024, `The fixture must remain sparse: ${stat.blocks * 512} physical bytes.`);
    const baseline = process.memoryUsage().arrayBuffers;
    let peakArrayBuffers = baseline;
    session = manager.create(filePath, { skipAdjacent: true });
    const listed = await manager.listComicPages(session.id);
    assert.equal(listed.pages.length, count);
    await Promise.all(listed.pages.map(page => manager.getComicPageData(session.id, page.name).then(result => {
        assert.deepEqual(result.buffer, image);
        peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
    })));
    assert.ok(peakArrayBuffers - baseline < 64 * 1024 * 1024, 'ZIP reads must not buffer the sparse archive.');
    assert.ok(viewerComicPageCache.entries.size <= 12);
    t.diagnostic(JSON.stringify({ logicalBytes: stat.size, physicalBytes: stat.blocks * 512, pages: count, peakArrayBufferGrowth: peakArrayBuffers - baseline }));
});
