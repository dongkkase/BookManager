import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInflateRaw, deflateRawSync } from 'node:zlib';
import { setImmediate } from 'node:timers/promises';
import { crc32, listZipEntriesFromFile, readZipEntryFromFile } from '../core/zipArchive.js';

export const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 20000;

export function optimizerError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

export function checkCancelled(options = {}) {
    if (options.shouldCancel?.()) throw optimizerError('TASK_CANCELLED');
}

export function sameStat(left, right) {
    return ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].every(key => left[key] === right[key]);
}

export async function fingerprintFile(filePath, options = {}) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
        checkCancelled(options);
        hash.update(chunk);
    }
    return hash.digest('hex');
}

async function readAt(handle, position, length) {
    const data = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
        const { bytesRead } = await handle.read(data, offset, length - offset, position + offset);
        if (!bytesRead) throw optimizerError('EPUB_INVALID');
        offset += bytesRead;
    }
    return data;
}

export async function openArchive(filePath) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw optimizerError('EPUB_INVALID');
    if (stat.size > MAX_ARCHIVE_BYTES) throw optimizerError('EPUB_TOO_LARGE');
    if (stat.size < 22) throw optimizerError('EPUB_INVALID');
    const source = await fs.open(filePath, 'r');
    try {
        const length = Math.min(stat.size, 65557);
        const tail = await readAt(source, stat.size - length, length);
        let end = -1;
        for (let at = length - 22; at >= 0; at -= 1) {
            if (tail.readUInt32LE(at) === 0x06054b50 && at + 22 + tail.readUInt16LE(at + 20) === length) {
                end = at;
                break;
            }
        }
        if (end < 0) throw optimizerError('EPUB_INVALID');
        const count = tail.readUInt16LE(end + 10);
        const centralSize = tail.readUInt32LE(end + 12);
        const centralOffset = tail.readUInt32LE(end + 16);
        if (count === 65535 || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw optimizerError('EPUB_ZIP_UNSUPPORTED');
        if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count) throw optimizerError('EPUB_ZIP_UNSUPPORTED');
        if (!count || count > MAX_ENTRIES || centralOffset + centralSize !== stat.size - length + end) throw optimizerError('EPUB_INVALID');
        const entries = await listZipEntriesFromFile(filePath, { includeRawRecords: true });
        if (entries.length !== count || entries.reduce((sum, entry) => sum + entry.centralRecord.length, 0) !== centralSize) throw optimizerError('EPUB_INVALID');
        const names = new Set();
        let total = 0;
        const sorted = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
        for (let index = 0; index < sorted.length; index += 1) {
            const entry = sorted[index];
            if (!entry.name || /^[\/\\]|^[a-z]:|[\u0000-\u001f\u007f\\]/i.test(entry.name)
                || entry.name.split('/').some(part => part === '.' || part === '..') || names.has(entry.name)
                || (entry.externalAttrs >>> 16 & 0xf000) === 0xa000) throw optimizerError('EPUB_UNSAFE_ARCHIVE');
            names.add(entry.name);
            if (entry.flags & 0x41) throw optimizerError('EPUB_ENCRYPTED');
            if (![0, 8].includes(entry.method) || entry.centralRecord.readUInt16LE(34)) throw optimizerError('EPUB_ZIP_UNSUPPORTED');
            if (entry.uncompressedSize > 512 * 1024 * 1024 || (total += entry.uncompressedSize) > MAX_TOTAL_BYTES) throw optimizerError('EPUB_TOO_LARGE');
            if (entry.localHeaderOffset + 30 > centralOffset) throw optimizerError('EPUB_INVALID');
            const local = await readAt(source, entry.localHeaderOffset, 30);
            if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== entry.flags || local.readUInt16LE(8) !== entry.method) throw optimizerError('EPUB_INVALID');
            const nameLength = local.readUInt16LE(26);
            const extraLength = local.readUInt16LE(28);
            entry.dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
            const next = sorted[index + 1]?.localHeaderOffset ?? centralOffset;
            if (entry.dataStart + entry.compressedSize > next || next <= entry.localHeaderOffset) throw optimizerError('EPUB_INVALID');
            const name = await readAt(source, entry.localHeaderOffset + 30, nameLength);
            if (!name.equals(entry.nameBuffer)) throw optimizerError('EPUB_INVALID');
            if (!(entry.flags & 8) && (local.readUInt32LE(14) !== entry.crc || local.readUInt32LE(18) !== entry.compressedSize || local.readUInt32LE(22) !== entry.uncompressedSize)) throw optimizerError('EPUB_INVALID');
            if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) throw optimizerError('EPUB_INVALID');
            entry.localRecordLength = next - entry.localHeaderOffset;
            entry.localExtraLength = extraLength;
        }
        return { stat, entries: sorted, comment: tail.subarray(end + 22), centralOffset };
    } finally {
        await source.close();
    }
}

export async function readEntry(filePath, entry, limit = MAX_ENTRY_BYTES) {
    if (!entry || entry.uncompressedSize > limit || entry.compressedSize > limit) throw optimizerError(entry ? 'EPUB_TOO_LARGE' : 'EPUB_INVALID');
    const data = await readZipEntryFromFile(filePath, entry, { maxBytes: limit, maxCompressedBytes: limit });
    if (!data || data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) throw optimizerError('EPUB_INVALID');
    return data;
}

let crcTable;
function updateCrc(crc, chunk) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let i = 0; i < 256; i += 1) {
            let value = i;
            for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
            crcTable[i] = value >>> 0;
        }
    }
    for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return crc;
}

export async function verifyEntry(filePath, entry, options = {}) {
    checkCancelled(options);
    if (!entry.compressedSize) {
        if (entry.uncompressedSize || entry.crc) throw optimizerError('EPUB_INVALID');
        return;
    }
    const source = createReadStream(filePath, { start: entry.dataStart, end: entry.dataStart + entry.compressedSize - 1 });
    const stream = entry.method === 8 ? source.pipe(createInflateRaw()) : source;
    if (stream !== source) source.on('error', error => stream.destroy(error));
    let size = 0;
    let crc = 0xffffffff;
    try {
        for await (const chunk of stream) {
            checkCancelled(options);
            size += chunk.length;
            if (size > entry.uncompressedSize) throw optimizerError('EPUB_INVALID');
            crc = updateCrc(crc, chunk);
        }
        if (size !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) throw optimizerError('EPUB_INVALID');
    } finally {
        source.destroy();
        stream.destroy();
    }
}

function replacementHeaders(entry, data, offset, forceStore = false) {
    const compressed = forceStore ? data : deflateRawSync(data, { level: 9 });
    const method = forceStore ? 0 : 8;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.flags & ~8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(entry.modTime, 10);
    header.writeUInt16LE(entry.modDate, 12);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(entry.nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.centralRecord.readUInt16LE(4), 4);
    header.copy(central, 6, 4, 28);
    central.writeUInt32LE(entry.externalAttrs, 38);
    central.writeUInt32LE(offset, 42);
    return { header, compressed, central: Buffer.concat([central, entry.nameBuffer]) };
}

export async function rewriteArchive(filePath, outputPath, archive, transform, options = {}) {
    const source = await fs.open(filePath, 'r');
    let output;
    let offset = 0;
    const central = [];
    const write = async data => {
        let done = 0;
        while (done < data.length) {
            const { bytesWritten } = await output.write(data, done, data.length - done, offset);
            if (!bytesWritten) throw optimizerError('WRITE_FAILED');
            done += bytesWritten;
            offset += bytesWritten;
        }
    };
    const copy = Buffer.alloc(256 * 1024);
    try {
        output = await fs.open(outputPath, 'wx', archive.stat.mode & 0o777);
        for (let index = 0; index < archive.entries.length; index += 1) {
            await setImmediate();
            checkCancelled(options);
            const entry = archive.entries[index];
            const transformed = await transform(entry);
            if (transformed?.remove === true) {
                options.onProgress?.({ completed: index + 1, total: archive.entries.length, name: entry.name, percent: Math.round((index + 1) / archive.entries.length * 85), phase: 'optimizing' });
                continue;
            }
            const candidate = transformed?.data ? replacementHeaders(entry, transformed.data, offset, entry.name === 'mimetype') : null;
            if (candidate && (transformed.required || candidate.compressed.length < entry.compressedSize)) {
                central.push(candidate.central);
                await write(candidate.header);
                await write(entry.nameBuffer);
                await write(candidate.compressed);
            } else {
                const record = Buffer.from(entry.centralRecord);
                record.writeUInt32LE(offset, 42);
                central.push(record);
                let copied = 0;
                while (copied < entry.localRecordLength) {
                    checkCancelled(options);
                    const { bytesRead } = await source.read(copy, 0, Math.min(copy.length, entry.localRecordLength - copied), entry.localHeaderOffset + copied);
                    if (!bytesRead) throw optimizerError('EPUB_INVALID');
                    await write(copy.subarray(0, bytesRead));
                    copied += bytesRead;
                }
            }
            options.onProgress?.({ completed: index + 1, total: archive.entries.length, name: entry.name, percent: Math.round((index + 1) / archive.entries.length * 85), phase: 'optimizing' });
        }
        const start = offset;
        for (const record of central) await write(record);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(central.length, 8);
        end.writeUInt16LE(central.length, 10);
        end.writeUInt32LE(offset - start, 12);
        end.writeUInt32LE(start, 16);
        end.writeUInt16LE(archive.comment.length, 20);
        await write(end);
        await write(archive.comment);
        await output.sync();
    } finally {
        await source.close();
        await output?.close();
    }
}

export function compressedLength(data) {
    return deflateRawSync(data, { level: 9 }).length;
}
