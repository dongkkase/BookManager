import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    crc32,
    listZipEntries,
    listZipEntriesFromFile,
    readZipEntry,
    readZipEntryFromFile,
    replaceZipEntry,
    replaceZipEntryAppendOnly,
} from './core/zipArchive.js';

function createStoredZipWithRawName(nameBuffer, content = Buffer.from('page'), options = {}) {
    const flags = options.flags || 0;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
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
    centralHeader.writeUInt16LE(flags, 8);
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

test('ZIP 교체 저장은 data descriptor 플래그를 남기지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-flags-'));
    try {
        const source = path.join(root, 'sample.epub');
        fs.writeFileSync(source, createStoredZipWithRawName(Buffer.from('OEBPS/images/cover.jpg'), Buffer.from('cover'), {
            flags: 0x08,
        }));

        await replaceZipEntry(source, 'OEBPS/content.opf', '<package/>');

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const coverEntry = entries.find(entry => entry.name === 'OEBPS/images/cover.jpg');

        assert.ok(coverEntry);
        const localFlags = buffer.readUInt16LE(coverEntry.localHeaderOffset + 6);
        assert.equal(coverEntry.flags & 0x08, 0);
        assert.equal(localFlags & 0x08, 0);
        assert.equal(readZipEntry(buffer, coverEntry).toString('utf8'), 'cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 교체 저장은 mimetype을 첫 번째 무압축 엔트리로 보장한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-mimetype-'));
    try {
        const source = path.join(root, 'sample.epub');
        fs.writeFileSync(source, createStoredZipWithRawName(Buffer.from('OEBPS/content.opf'), Buffer.from('<package/>')));

        await replaceZipEntry(source, 'OEBPS/images/cover.jpg', Buffer.from('cover'));

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const mimetypeEntry = entries[0];

        assert.equal(mimetypeEntry.name, 'mimetype');
        assert.equal(mimetypeEntry.method, 0);
        assert.equal(mimetypeEntry.flags, 0);
        assert.equal(mimetypeEntry.localHeaderOffset, 0);
        assert.equal(readZipEntry(buffer, mimetypeEntry).toString('utf8'), 'application/epub+zip');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
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

test('파일 기반 ZIP 읽기는 잘못된 헤더보다 큰 압축 해제 결과를 제한한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-output-limit-'));
    try {
        const source = path.join(root, 'sample.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'content.xhtml', Buffer.alloc(1024 * 1024, 0x61));

        const buffer = fs.readFileSync(source);
        const centralOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        assert.ok(centralOffset >= 0);
        buffer.writeUInt32LE(1, centralOffset + 24);
        fs.writeFileSync(source, buffer);

        const entries = await listZipEntriesFromFile(source);
        assert.equal(entries[0].uncompressedSize, 1);
        const extracted = await readZipEntryFromFile(source, entries[0], {
            maxBytes: 1024,
            maxCompressedBytes: 1024 * 1024,
        });
        assert.equal(extracted, null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('파일 기반 ZIP 목록은 파일 범위를 벗어난 중앙 디렉터리를 할당하지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-central-limit-'));
    try {
        const source = path.join(root, 'sample.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'content.xhtml', Buffer.from('content'));

        const buffer = fs.readFileSync(source);
        const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        assert.ok(eocdOffset >= 0);
        buffer.writeUInt32LE(64 * 1024 * 1024, eocdOffset + 12);
        fs.writeFileSync(source, buffer);

        assert.deepEqual(await listZipEntriesFromFile(source), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('파일 기반 ZIP 목록은 불완전한 중앙 디렉터리를 부분 결과로 반환하지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-central-partial-'));
    try {
        const source = path.join(root, 'sample.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'content.xhtml', Buffer.from('content'));

        const buffer = fs.readFileSync(source);
        const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
        assert.ok(eocdOffset >= 0);
        buffer.writeUInt16LE(2, eocdOffset + 8);
        buffer.writeUInt16LE(2, eocdOffset + 10);
        fs.writeFileSync(source, buffer);

        await assert.rejects(
            listZipEntriesFromFile(source),
            /central directory entry is incomplete/i,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
