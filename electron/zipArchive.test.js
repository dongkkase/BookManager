import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { crc32, listZipEntries, readZipEntry, replaceZipEntry, replaceZipEntryAppendOnly } from './core/zipArchive.js';

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

test('ZIP append-only 교체는 기존 데이터를 유지하고 새 엔트리를 마지막 디렉터리에 반영한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-append-'));
    try {
        const source = path.join(root, 'sample.cbz');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', Buffer.from('cover'));
        const beforeSize = fs.statSync(source).size;

        await replaceZipEntryAppendOnly(source, 'ComicInfo.xml', '<ComicInfo><Title>Old</Title></ComicInfo>');
        await replaceZipEntryAppendOnly(source, 'ComicInfo.xml', '<ComicInfo><Title>New</Title></ComicInfo>', {
            removeMatchingBasename: true,
        });

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const comicInfoEntries = entries.filter(entry => entry.name === 'ComicInfo.xml');
        const coverEntry = entries.find(entry => entry.name === '001.jpg');

        assert.ok(fs.statSync(source).size > beforeSize);
        assert.equal(comicInfoEntries.length, 1);
        assert.ok(coverEntry);
        assert.equal(readZipEntry(buffer, coverEntry).toString('utf8'), 'cover');
        assert.equal(readZipEntry(buffer, comicInfoEntries[0]).toString('utf8'), '<ComicInfo><Title>New</Title></ComicInfo>');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
