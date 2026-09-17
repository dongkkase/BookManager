import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { randomBytes } from 'crypto';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import {
    crc32,
    getZipEntryCompressedData,
    listZipEntries,
    listZipEntriesFromFile,
    readZipEntry,
    replaceZipEntries,
    replaceZipEntry,
    replaceZipEntryAppendOnly,
} from './core/zipArchive.js';

const require = createRequire(import.meta.url);
const sevenZExe = require('7zip-bin').path7za;

function checkWith7z(filePath) {
    const result = spawnSync(sevenZExe, ['t', '-tzip', filePath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
}

function fixture(options = {}) {
    const content = options.content || randomBytes(1024 * 1024);
    const name = Buffer.from('OEBPS/자료.bin');
    const compressed = zlib.deflateRawSync(content);
    const extra = options.localZip64
        ? Buffer.from('0100100000000000000000000000000000000000', 'hex')
        : Buffer.from('feca040074657374', 'hex');
    if (options.localZip64) {
        extra.writeBigUInt64LE(BigInt(content.length), 4);
        extra.writeBigUInt64LE(BigInt(compressed.length), 12);
    }
    const entryComment = Buffer.from('entry comment');
    const archiveComment = Buffer.from('archive comment');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(options.localZip64 ? 45 : 20, 4);
    local.writeUInt16LE(options.localZip64 ? 0x800 : 0x808, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    if (options.localZip64) {
        local.writeUInt32LE(crc32(content), 14);
        local.writeUInt32LE(0xffffffff, 18);
        local.writeUInt32LE(0xffffffff, 22);
    }
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50);
    descriptor.writeUInt32LE(crc32(content), 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(content.length, 12);
    const localRecord = Buffer.concat([local, name, extra, compressed, ...(options.localZip64 ? [] : [descriptor])]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(options.localZip64 ? 45 : 20, 6);
    central.writeUInt16LE(options.localZip64 ? 0x800 : 0x808, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(content), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(entryComment.length, 32);
    central.writeUInt32LE(0x81a40000, 38);
    const centralRecord = Buffer.concat([central, name, extra, entryComment]);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(centralRecord.length, 12);
    end.writeUInt32LE(localRecord.length, 16);
    end.writeUInt16LE(archiveComment.length, 20);
    let zip64 = Buffer.alloc(0);
    if (options.zip64) {
        const record = Buffer.alloc(56);
        record.writeUInt32LE(0x06064b50);
        record.writeBigUInt64LE(44n, 4);
        record.writeUInt16LE(45, 12);
        record.writeUInt16LE(45, 14);
        record.writeBigUInt64LE(1n, 24);
        record.writeBigUInt64LE(1n, 32);
        record.writeBigUInt64LE(BigInt(centralRecord.length), 40);
        record.writeBigUInt64LE(BigInt(localRecord.length), 48);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50);
        locator.writeBigUInt64LE(BigInt(localRecord.length + centralRecord.length), 8);
        locator.writeUInt32LE(1, 16);
        zip64 = Buffer.concat([record, locator]);
        end.writeUInt16LE(0xffff, 8);
        end.writeUInt16LE(0xffff, 10);
        end.writeUInt32LE(0xffffffff, 12);
        end.writeUInt32LE(0xffffffff, 16);
    }
    return { buffer: Buffer.concat([localRecord, centralRecord, zip64, end, archiveComment]), content, compressed, localRecord, centralRecord, archiveComment };
}

function temporaryArchive(t, bytes) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-batch-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.epub');
    fs.writeFileSync(filePath, bytes);
    return { directory, filePath };
}

test('ZIP append update preserves original bytes, descriptors, extra fields and comments', async t => {
    const original = fixture();
    const { filePath } = temporaryArchive(t, original.buffer);
    t.mock.method(fsp, 'readFile', () => { throw new Error('Whole archive reads are forbidden'); });
    for (const rating of [3, 7]) {
        const xml = `<ComicInfo><CommunityRating>${rating}</CommunityRating></ComicInfo>`;
        await replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', xml);
        const bytes = fs.readFileSync(filePath);
        const entries = await listZipEntriesFromFile(filePath, { includeRawRecords: true });
        assert.equal(entries.length, 2);
        assert.deepEqual(bytes.subarray(0, original.buffer.length), original.buffer);
        assert.deepEqual(entries[0].centralRecord, original.centralRecord);
        assert.deepEqual(readZipEntry(bytes, entries[0]), original.content);
        assert.equal(readZipEntry(bytes, entries[1]).toString(), xml);
        assert.deepEqual(bytes.subarray(-original.archiveComment.length), original.archiveComment);
        checkWith7z(filePath);
    }
});

test('ZIP append update rejects unsupported directories before writing', async t => {
    const original = fixture({ zip64: true });
    const { filePath } = temporaryArchive(t, original.buffer);
    await assert.rejects(replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', '<ComicInfo/>'), { code: 'ZIP_APPEND_UNSUPPORTED' });
    assert.deepEqual(fs.readFileSync(filePath), original.buffer);
});

test('일괄 EPUB 갱신은 압축 데이터, descriptor, 부가정보를 제한된 크기로 복사한다', async t => {
    const original = fixture();
    const { filePath } = temporaryArchive(t, original.buffer);
    const open = fsp.open.bind(fsp);
    let largestRead = 0;
    let outputCreates = 0;
    t.mock.method(fsp, 'readFile', () => { throw new Error('Whole archive reads are forbidden'); });
    t.mock.method(fsp, 'open', async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx') outputCreates += 1;
        const read = handle.read.bind(handle);
        handle.read = (...readArgs) => {
            largestRead = Math.max(largestRead, readArgs[2]);
            return read(...readArgs);
        };
        return handle;
    });
    await replaceZipEntries(filePath, [
        { name: 'OEBPS/cover.jpg', content: Buffer.from('new cover') },
        { name: 'OEBPS/cover.xhtml', content: '<html>cover.jpg</html>' },
        { name: 'OEBPS/content.opf', content: '<package>new title</package>' },
    ]);
    assert.equal(outputCreates, 1);
    assert.ok(largestRead <= 256 * 1024, largestRead);
    const bytes = fs.readFileSync(filePath);
    const entries = await listZipEntriesFromFile(filePath, { includeRawRecords: true });
    assert.equal(entries.length, 5);
    assert.equal(entries[0].name, 'mimetype');
    assert.equal(entries[0].method, 0);
    assert.equal(entries[0].localHeaderOffset, 0);
    const retained = entries.find(entry => entry.name === 'OEBPS/자료.bin');
    assert.deepEqual(readZipEntry(bytes, retained), original.content);
    assert.deepEqual(getZipEntryCompressedData(bytes, retained), original.compressed);
    assert.deepEqual(bytes.subarray(retained.localHeaderOffset, retained.localHeaderOffset + original.localRecord.length), original.localRecord);
    const central = Buffer.from(retained.centralRecord);
    central.writeUInt32LE(0, 42);
    assert.deepEqual(central, original.centralRecord);
    assert.deepEqual(bytes.subarray(-original.archiveComment.length), original.archiveComment);
    assert.equal(readZipEntry(bytes, entries.find(entry => entry.name === 'OEBPS/content.opf')).toString(), '<package>new title</package>');
    checkWith7z(filePath);
});

test('ZIP64 local extra와 일반 중앙 디렉터리를 가진 기존 호환 EPUB도 갱신한다', async t => {
    const original = fixture({ localZip64: true });
    const { filePath } = temporaryArchive(t, original.buffer);
    await replaceZipEntries(filePath, [{ name: 'OEBPS/content.opf', content: '<package/>' }]);
    const bytes = fs.readFileSync(filePath);
    const retained = listZipEntries(bytes).find(entry => entry.name === 'OEBPS/자료.bin');
    assert.deepEqual(readZipEntry(bytes, retained), original.content);
    assert.deepEqual(bytes.subarray(retained.localHeaderOffset, retained.localHeaderOffset + original.localRecord.length), original.localRecord);
    checkWith7z(filePath);
});

test('ZIP64 EOCD는 기존 갱신이 본문을 잃는 구조이므로 새 갱신은 원본을 보존한다', async t => {
    const original = fixture({ zip64: true });
    const { directory, filePath } = temporaryArchive(t, original.buffer);
    assert.equal((await listZipEntriesFromFile(filePath)).length, 1);
    const legacyPath = path.join(directory, 'legacy.epub');
    fs.writeFileSync(legacyPath, original.buffer);
    await replaceZipEntry(legacyPath, 'OEBPS/content.opf', '<package/>');
    assert.equal(listZipEntries(fs.readFileSync(legacyPath)).some(entry => entry.name === 'OEBPS/자료.bin'), false);
    await assert.rejects(replaceZipEntries(filePath, [{ name: 'OEBPS/content.opf', content: '<package/>' }]), { code: 'ZIP_REWRITE_UNSUPPORTED' });
    assert.deepEqual(fs.readFileSync(filePath), original.buffer);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['book.epub', 'legacy.epub']);
});

test('ZIP 일괄 갱신은 최종 취소 및 쓰기 실패 시 원본과 임시파일 정리를 보장한다', async t => {
    const original = fixture();
    const { directory, filePath } = temporaryArchive(t, original.buffer);
    let cancel = false;
    await assert.rejects(replaceZipEntries(filePath, [{ name: 'OEBPS/content.opf', content: '<package/>' }], {
        shouldCancel: () => cancel,
        beforeWrite: () => { cancel = true; },
    }), { code: 'TASK_CANCELLED' });
    assert.deepEqual(fs.readFileSync(filePath), original.buffer);
    assert.deepEqual(fs.readdirSync(directory), ['book.epub']);
    const open = fsp.open.bind(fsp);
    t.mock.method(fsp, 'open', async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx') handle.write = async () => { throw new Error('Synthetic disk full'); };
        return handle;
    });
    await assert.rejects(replaceZipEntries(filePath, [{ name: 'OEBPS/content.opf', content: '<package/>' }]), /Synthetic disk full/);
    assert.deepEqual(fs.readFileSync(filePath), original.buffer);
    assert.deepEqual(fs.readdirSync(directory), ['book.epub']);
});

test('ZIP 일괄 갱신 중 원본 교체는 덮어쓰지 않는다', async t => {
    const original = fixture();
    const { directory, filePath } = temporaryArchive(t, original.buffer);
    const replacement = Buffer.from('different source');
    await assert.rejects(replaceZipEntries(filePath, [{ name: 'OEBPS/content.opf', content: '<package/>' }], {
        beforeWrite: () => fs.writeFileSync(filePath, replacement),
    }), /source changed/);
    assert.deepEqual(fs.readFileSync(filePath), replacement);
    assert.deepEqual(fs.readdirSync(directory), ['book.epub']);
});

test('ZIP 엔트리 이름 변경은 압축 데이터와 descriptor 및 부가정보를 보존한다', async t => {
    const original = fixture();
    const { filePath } = temporaryArchive(t, original.buffer);
    await replaceZipEntries(filePath, [], {
        renameEntries: [{ from: 'OEBPS/자료.bin', to: 'renamed/0001.bin' }],
    });
    const bytes = fs.readFileSync(filePath);
    const entry = (await listZipEntriesFromFile(filePath, { includeRawRecords: true })).find(item => item.name === 'renamed/0001.bin');
    assert.ok(entry);
    assert.deepEqual(getZipEntryCompressedData(bytes, entry), original.compressed);
    assert.deepEqual(readZipEntry(bytes, entry), original.content);
    const dataEnd = entry.localHeaderOffset + 30 + bytes.readUInt16LE(entry.localHeaderOffset + 26)
        + bytes.readUInt16LE(entry.localHeaderOffset + 28) + entry.compressedSize;
    assert.equal(bytes.readUInt32LE(dataEnd), 0x08074b50);
    assert.ok(entry.centralRecord.includes(Buffer.from('entry comment')));
    assert.ok(entry.centralRecord.includes(Buffer.from('test')));
    assert.deepEqual(bytes.subarray(-original.archiveComment.length), original.archiveComment);
    checkWith7z(filePath);
});

test('ZIP 엔트리 삭제와 교차 이름 변경은 원본 경로를 기준으로 한 번 적용한다', async t => {
    const { filePath } = temporaryArchive(t, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));
    await replaceZipEntry(filePath, '001.jpg', 'one');
    await replaceZipEntry(filePath, '002.jpg', 'two');
    await replaceZipEntry(filePath, 'remove.txt', 'removed');
    await replaceZipEntries(filePath, [{ name: '001.jpg', content: 'cover' }], {
        renameEntries: [{ from: '001.jpg', to: '002.jpg' }, { from: '002.jpg', to: '003.jpg' }],
        removeEntries: ['remove.txt'],
    });
    const bytes = fs.readFileSync(filePath);
    const entries = listZipEntries(bytes);
    assert.equal(readZipEntry(bytes, entries.find(entry => entry.name === '001.jpg')).toString(), 'cover');
    assert.equal(readZipEntry(bytes, entries.find(entry => entry.name === '002.jpg')).toString(), 'one');
    assert.equal(readZipEntry(bytes, entries.find(entry => entry.name === '003.jpg')).toString(), 'two');
    assert.equal(entries.some(entry => entry.name === 'remove.txt'), false);
    checkWith7z(filePath);
});
