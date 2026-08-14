import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x800;
const DATA_DESCRIPTOR_FLAG = 0x08;
const EPUB_MIMETYPE = 'application/epub+zip';
const EOCD_TAIL_BYTES = 0xffff + 22;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRY_COUNT = 100000;
const ZIP32_MAX = 0xffffffff;
const ZIP32_MAX_ENTRIES = 0xffff;
const LEGACY_NAME_ENCODINGS = ['euc-kr', 'shift_jis'];

let crcTable = null;

function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        crcTable[i] = value >>> 0;
    }
    return crcTable;
}

export function crc32(buffer) {
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
    const minOffset = Math.max(0, buffer.length - 0xffff - 22);
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
    }
    return -1;
}

function scoreDecodedName(value) {
    let score = 0;
    for (const char of value) {
        if (char === '\ufffd') {
            score -= 50;
        } else if (/[\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff]/u.test(char)) {
            score += 4;
        } else if (/[\x00-\x08\x0e-\x1f\x7f]/u.test(char)) {
            score -= 20;
        } else if (/[\w .()[\]{}+\-_,~!@#$%^&=]/u.test(char)) {
            score += 1;
        }
    }
    if (/[ÃÂ]/u.test(value)) score -= 10;
    return score;
}

function decodeName(buffer, flags) {
    const utf8 = buffer.toString('utf8').normalize('NFC');
    if (flags & UTF8_FLAG) return utf8;

    let best = utf8;
    let bestScore = scoreDecodedName(utf8);
    for (const encoding of LEGACY_NAME_ENCODINGS) {
        try {
            const decoded = new TextDecoder(encoding).decode(buffer).normalize('NFC');
            const score = scoreDecodedName(decoded);
            if (score > bestScore) {
                best = decoded;
                bestScore = score;
            }
        } catch {
            // Ignore encodings not supported by the current runtime.
        }
    }
    return best;
}

function readUInt64LEAsNumber(buffer, offset) {
    const value = buffer.readBigUInt64LE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('ZIP64 value exceeds JavaScript safe integer range');
    }
    return Number(value);
}

function applyZip64Extra(entry, extra) {
    let offset = 0;
    const nextUInt64 = () => {
        if (offset + 8 > extra.length) return null;
        const value = readUInt64LEAsNumber(extra, offset);
        offset += 8;
        return value;
    };

    if (entry.uncompressedSize === 0xffffffff) {
        const value = nextUInt64();
        if (value !== null) entry.uncompressedSize = value;
    }
    if (entry.compressedSize === 0xffffffff) {
        const value = nextUInt64();
        if (value !== null) entry.compressedSize = value;
    }
    if (entry.localHeaderOffset === 0xffffffff) {
        const value = nextUInt64();
        if (value !== null) entry.localHeaderOffset = value;
    }
    return entry;
}

function parseZip64Extra(entry, extraBuffer) {
    let offset = 0;
    while (offset + 4 <= extraBuffer.length) {
        const headerId = extraBuffer.readUInt16LE(offset);
        const dataSize = extraBuffer.readUInt16LE(offset + 2);
        const dataStart = offset + 4;
        const dataEnd = dataStart + dataSize;
        if (dataEnd > extraBuffer.length) break;
        if (headerId === 0x0001) {
            return applyZip64Extra(entry, extraBuffer.subarray(dataStart, dataEnd));
        }
        offset = dataEnd;
    }
    return entry;
}

function normalizeZipEntryName(name = '') {
    return String(name).replace(/\\/g, '/').toLowerCase();
}

function zipEntryMatchesName(entryName, targetName, options = {}) {
    return options.removeMatchingBasename === true
        ? path.basename(entryName).toLowerCase() === path.basename(targetName).toLowerCase()
        : normalizeZipEntryName(entryName) === normalizeZipEntryName(targetName);
}

export function listZipEntries(buffer) {
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return [];

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
    const entries = [];

    for (let i = 0; i < entryCount; i += 1) {
        if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== CENTRAL_SIGNATURE) break;

        const flags = buffer.readUInt16LE(centralOffset + 8);
        const method = buffer.readUInt16LE(centralOffset + 10);
        const modTime = buffer.readUInt16LE(centralOffset + 12);
        const modDate = buffer.readUInt16LE(centralOffset + 14);
        const crc = buffer.readUInt32LE(centralOffset + 16);
        const compressedSize = buffer.readUInt32LE(centralOffset + 20);
        const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
        const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
        const extraLength = buffer.readUInt16LE(centralOffset + 30);
        const commentLength = buffer.readUInt16LE(centralOffset + 32);
        const externalAttrs = buffer.readUInt32LE(centralOffset + 38);
        const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
        const nameBuffer = Buffer.from(buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength));
        const name = decodeName(nameBuffer, flags);

        entries.push({
            name,
            nameBuffer,
            flags,
            method,
            modTime,
            modDate,
            crc,
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
            externalAttrs,
            isDirectory: name.endsWith('/'),
        });
        centralOffset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
}

export function getZipEntryCompressedData(buffer, entry) {
    const localOffset = entry.localHeaderOffset;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) return null;

    const fileNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + fileNameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) return null;
    return Buffer.from(buffer.subarray(dataStart, dataEnd));
}

export function readZipEntry(buffer, entry, options = {}) {
    if (options.maxBytes && entry.uncompressedSize > options.maxBytes) return null;
    const compressed = getZipEntryCompressedData(buffer, entry);
    if (!compressed) return null;
    if (entry.method === 0) return compressed;
    if (entry.method === 8) {
        try {
            return zlib.inflateRawSync(compressed);
        } catch {
            return null;
        }
    }
    return null;
}

async function readFileRange(handle, start, length) {
    const buffer = Buffer.alloc(Math.max(0, length));
    if (buffer.length === 0) return buffer;
    let totalBytesRead = 0;
    while (totalBytesRead < buffer.length) {
        const { bytesRead } = await handle.read(
            buffer,
            totalBytesRead,
            buffer.length - totalBytesRead,
            start + totalBytesRead,
        );
        if (bytesRead < 1) break;
        totalBytesRead += bytesRead;
    }
    return totalBytesRead === buffer.length
        ? buffer
        : buffer.subarray(0, totalBytesRead);
}

export async function listZipEntriesFromFile(filePath) {
    const handle = await fs.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        const tailLength = Math.min(stat.size, EOCD_TAIL_BYTES);
        const tailStart = stat.size - tailLength;
        const tail = await readFileRange(handle, tailStart, tailLength);
        if (tail.length !== tailLength) throw new Error('ZIP tail could not be read completely.');
        const eocdOffsetInTail = findEndOfCentralDirectory(tail);
        if (eocdOffsetInTail < 0) return [];

        let entryCount = tail.readUInt16LE(eocdOffsetInTail + 10);
        let centralSize = tail.readUInt32LE(eocdOffsetInTail + 12);
        let centralOffset = tail.readUInt32LE(eocdOffsetInTail + 16);
        const eocdOffset = tailStart + eocdOffsetInTail;

        if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
            const locatorOffset = eocdOffset - 20;
            if (locatorOffset < 0) return [];
            const locator = await readFileRange(handle, locatorOffset, 20);
            if (locator.length < 20 || locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) return [];
            const zip64EocdOffset = readUInt64LEAsNumber(locator, 8);
            if (
                !Number.isSafeInteger(zip64EocdOffset)
                || zip64EocdOffset < 0
                || zip64EocdOffset + 56 > stat.size
            ) return [];
            const zip64Eocd = await readFileRange(handle, zip64EocdOffset, 56);
            if (zip64Eocd.length < 56 || zip64Eocd.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) return [];
            entryCount = readUInt64LEAsNumber(zip64Eocd, 32);
            centralSize = readUInt64LEAsNumber(zip64Eocd, 40);
            centralOffset = readUInt64LEAsNumber(zip64Eocd, 48);
        }

        if (
            !Number.isSafeInteger(entryCount)
            || entryCount < 0
            || entryCount > MAX_ZIP_ENTRY_COUNT
            || !Number.isSafeInteger(centralSize)
            || centralSize < 0
            || centralSize > MAX_CENTRAL_DIRECTORY_BYTES
            || !Number.isSafeInteger(centralOffset)
            || centralOffset < 0
            || centralOffset > stat.size
            || centralSize > stat.size - centralOffset
            || centralOffset + centralSize > eocdOffset
        ) return [];

        const central = await readFileRange(handle, centralOffset, centralSize);
        if (central.length !== centralSize) {
            throw new Error('ZIP central directory could not be read completely.');
        }
        const entries = [];
        let offset = 0;

        for (let i = 0; i < entryCount; i += 1) {
            if (offset + 46 > central.length || central.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
                throw new Error('ZIP central directory entry is incomplete.');
            }

            const flags = central.readUInt16LE(offset + 8);
            const method = central.readUInt16LE(offset + 10);
            const modTime = central.readUInt16LE(offset + 12);
            const modDate = central.readUInt16LE(offset + 14);
            const crc = central.readUInt32LE(offset + 16);
            const compressedSize = central.readUInt32LE(offset + 20);
            const uncompressedSize = central.readUInt32LE(offset + 24);
            const fileNameLength = central.readUInt16LE(offset + 28);
            const extraLength = central.readUInt16LE(offset + 30);
            const commentLength = central.readUInt16LE(offset + 32);
            const externalAttrs = central.readUInt32LE(offset + 38);
            const localHeaderOffset = central.readUInt32LE(offset + 42);
            const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
            if (nextOffset > central.length) {
                throw new Error('ZIP central directory entry exceeds its declared size.');
            }
            const nameBuffer = Buffer.from(central.subarray(offset + 46, offset + 46 + fileNameLength));
            const extraBuffer = Buffer.from(central.subarray(offset + 46 + fileNameLength, offset + 46 + fileNameLength + extraLength));
            const name = decodeName(nameBuffer, flags);

            entries.push(parseZip64Extra({
                name,
                nameBuffer,
                flags,
                method,
                modTime,
                modDate,
                crc,
                compressedSize,
                uncompressedSize,
                localHeaderOffset,
                externalAttrs,
                isDirectory: name.endsWith('/'),
            }, extraBuffer));
            offset = nextOffset;
        }

        return entries;
    } finally {
        await handle.close();
    }
}

export async function readZipEntryFromFile(filePath, entry, options = {}) {
    const maxBytes = Number(options.maxBytes);
    const hasMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0;
    if (hasMaxBytes && entry.uncompressedSize > maxBytes) return null;
    if (options.maxCompressedBytes && entry.compressedSize > options.maxCompressedBytes) return null;

    const handle = await fs.open(filePath, 'r');
    try {
        const localHeader = await readFileRange(handle, entry.localHeaderOffset, 30);
        if (localHeader.length < 30 || localHeader.readUInt32LE(0) !== LOCAL_SIGNATURE) return null;

        const fileNameLength = localHeader.readUInt16LE(26);
        const extraLength = localHeader.readUInt16LE(28);
        const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
        const compressed = await readFileRange(handle, dataStart, entry.compressedSize);
        if (compressed.length !== entry.compressedSize) return null;
        if (entry.method === 0) {
            return hasMaxBytes && compressed.length > maxBytes ? null : compressed;
        }
        if (entry.method === 8) {
            try {
                const inflated = zlib.inflateRawSync(
                    compressed,
                    hasMaxBytes ? { maxOutputLength: maxBytes } : undefined,
                );
                return hasMaxBytes && inflated.length > maxBytes ? null : inflated;
            } catch {
                return null;
            }
        }
        return null;
    } finally {
        await handle.close();
    }
}

function dosTimeFromDate(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    return { dosDate, dosTime };
}

function createEntry(name, content, options = {}) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const store = options.store === true;
    const compressed = store ? buffer : zlib.deflateRawSync(buffer);
    const { dosDate, dosTime } = dosTimeFromDate();
    return {
        name,
        nameBuffer: Buffer.from(name, 'utf8'),
        flags: options.flags ?? UTF8_FLAG,
        method: store ? 0 : 8,
        modTime: dosTime,
        modDate: dosDate,
        crc: crc32(buffer),
        compressedSize: compressed.length,
        uncompressedSize: buffer.length,
        externalAttrs: 0,
        compressed,
    };
}

function normalizeEpubEntries(filePath, entries) {
    if (path.extname(filePath).toLowerCase() !== '.epub') return entries;
    const mimetypeEntry = createEntry('mimetype', EPUB_MIMETYPE, {
        store: true,
        flags: 0,
    });
    return [
        mimetypeEntry,
        ...entries.filter(entry => normalizeZipEntryName(entry.name) !== 'mimetype'),
    ];
}

function localHeader(entry, offset) {
    const header = Buffer.alloc(30);
    const flags = entry.flags & ~DATA_DESCRIPTOR_FLAG;
    header.writeUInt32LE(LOCAL_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(entry.modTime, 10);
    header.writeUInt16LE(entry.modDate, 12);
    header.writeUInt32LE(entry.crc >>> 0, 14);
    header.writeUInt32LE(entry.compressedSize, 18);
    header.writeUInt32LE(entry.uncompressedSize, 22);
    header.writeUInt16LE(entry.nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    return {
        offset,
        buffer: Buffer.concat([header, entry.nameBuffer]),
    };
}

function centralHeader(entry, offset) {
    const header = Buffer.alloc(46);
    const flags = entry.flags & ~DATA_DESCRIPTOR_FLAG;
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(entry.modTime, 12);
    header.writeUInt16LE(entry.modDate, 14);
    header.writeUInt32LE(entry.crc >>> 0, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.uncompressedSize, 24);
    header.writeUInt16LE(entry.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(entry.externalAttrs || 0, 38);
    header.writeUInt32LE(offset, 42);
    return Buffer.concat([header, entry.nameBuffer]);
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
    const header = Buffer.alloc(22);
    header.writeUInt32LE(EOCD_SIGNATURE, 0);
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(entryCount, 8);
    header.writeUInt16LE(entryCount, 10);
    header.writeUInt32LE(centralSize, 12);
    header.writeUInt32LE(centralOffset, 16);
    header.writeUInt16LE(0, 20);
    return header;
}

function unsupportedZipAppend(message) {
    const error = new Error(message);
    error.code = 'ZIP_APPEND_UNSUPPORTED';
    return error;
}

function canWriteZip32Entry(entry, localHeaderOffset) {
    return entry.nameBuffer.length <= 0xffff
        && entry.compressedSize <= ZIP32_MAX
        && entry.uncompressedSize <= ZIP32_MAX
        && localHeaderOffset <= ZIP32_MAX;
}

async function writeAll(handle, buffer, position) {
    let offset = 0;
    while (offset < buffer.length) {
        const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset);
        if (bytesWritten <= 0) throw new Error('Failed to append ZIP data');
        offset += bytesWritten;
    }
}

export async function replaceZipEntryAppendOnly(filePath, entryName, content, options = {}) {
    const replacement = createEntry(entryName, content, { store: true });
    const handle = await fs.open(filePath, 'r+');
    try {
        const stat = await handle.stat();
        const sourceEntries = await listZipEntriesFromFile(filePath);
        if (!sourceEntries.length && stat.size > 0) {
            throw unsupportedZipAppend('ZIP central directory was not found');
        }

        const entries = [];
        for (const entry of sourceEntries) {
            if (zipEntryMatchesName(entry.name, entryName, options)) continue;
            if (!canWriteZip32Entry(entry, entry.localHeaderOffset)) {
                throw unsupportedZipAppend('ZIP64 entries are not supported by append-only update');
            }
            entries.push(entry);
        }

        const local = localHeader(replacement, stat.size);
        const centralOffset = stat.size + local.buffer.length + replacement.compressed.length;
        const centralParts = [];
        for (const entry of [...entries, replacement]) {
            const offset = entry === replacement ? local.offset : entry.localHeaderOffset;
            if (!canWriteZip32Entry(entry, offset)) {
                throw unsupportedZipAppend('ZIP64 entries are not supported by append-only update');
            }
            centralParts.push(centralHeader(entry, offset));
        }

        const central = Buffer.concat(centralParts);
        if (centralParts.length >= ZIP32_MAX_ENTRIES || central.length > ZIP32_MAX || centralOffset > ZIP32_MAX) {
            throw unsupportedZipAppend('ZIP64 central directory is not supported by append-only update');
        }

        const eocd = endOfCentralDirectory(centralParts.length, central.length, centralOffset);
        const appendBuffer = Buffer.concat([local.buffer, replacement.compressed, central, eocd]);
        await options.beforeWrite?.();
        await writeAll(handle, appendBuffer, stat.size);
        return true;
    } finally {
        await handle.close();
    }
}

export async function replaceZipEntry(filePath, entryName, content, options = {}) {
    const source = await fs.readFile(filePath);
    const sourceEntries = listZipEntries(source);
    const replacement = createEntry(entryName, content);
    const entries = [];

    for (const entry of sourceEntries) {
        if (zipEntryMatchesName(entry.name, entryName, options)) continue;
        const compressed = getZipEntryCompressedData(source, entry);
        if (!compressed) continue;
        entries.push({ ...entry, compressed });
    }
    entries.push(replacement);
    const outputEntries = normalizeEpubEntries(filePath, entries);

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of outputEntries) {
        const local = localHeader(entry, offset);
        localParts.push(local.buffer, entry.compressed);
        centralParts.push(centralHeader(entry, local.offset));
        offset += local.buffer.length + entry.compressed.length;
    }
    const centralOffset = offset;
    const central = Buffer.concat(centralParts);
    const eocd = endOfCentralDirectory(outputEntries.length, central.length, centralOffset);
    await fs.writeFile(filePath, Buffer.concat([...localParts, central, eocd]));
}
