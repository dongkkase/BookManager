import test from 'node:test';
import assert from 'node:assert/strict';

import { crc32, listZipEntries } from './core/zipArchive.js';

function createStoredZipWithRawName(nameBuffer, content = Buffer.from('page')) {
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(crc32(content), 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);

    const centralOffset = localHeader.length + nameBuffer.length + content.length;
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(crc32(content), 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(0, 42);

    const central = Buffer.concat([centralHeader, nameBuffer]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(centralOffset, 16);

    return Buffer.concat([localHeader, nameBuffer, content, central, eocd]);
}

test('ZIP 엔트리명이 CP949로 저장된 경우 한글 이름으로 디코딩한다', () => {
    const cp949Name = Buffer.from('c8b2c3b5c0c720c3f7b0a1c0cc2030312e7a6970', 'hex');
    const entries = listZipEntries(createStoredZipWithRawName(cp949Name));

    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, '황천의 츠가이 01.zip');
});
