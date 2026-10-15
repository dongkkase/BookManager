import { deflateSync } from 'node:zlib';

const MAX_FONT_SIZE = 64 * 1024 * 1024;
const SFNT_CHECKSUM = 0xb1b0afba;
const align4 = value => Math.ceil(value / 4) * 4;

function checksum(data, zeroAdjustment = false) {
    let sum = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
        if (zeroAdjustment && offset === 8) continue;
        let word = 0;
        for (let byte = 0; byte < 4; byte++) {
            word = (word << 8) | (data[offset + byte] || 0);
        }
        sum = (sum + (word >>> 0)) >>> 0;
    }
    return sum;
}

function parseFont(data) {
    const originalSize = Buffer.isBuffer(data) ? data.length : 0;
    const fail = (reason, format = null) => ({ canOptimize: false, reason, format, originalSize });
    if (!Buffer.isBuffer(data) || data.length < 4) return fail('FONT_INVALID');
    if (data.length > MAX_FONT_SIZE) return fail('FONT_TOO_LARGE');
    const signature = data.toString('ascii', 0, 4);
    if (signature === 'wOFF' || signature === 'wOF2') {
        return fail('FONT_ALREADY_COMPRESSED', signature === 'wOFF' ? 'woff' : 'woff2');
    }
    const flavor = data.readUInt32BE(0);
    const format = flavor === 0x00010000 ? 'ttf' : flavor === 0x4f54544f ? 'otf' : null;
    if (!format) return fail('FONT_UNSUPPORTED');
    const invalid = () => fail('FONT_INVALID', format);
    if (data.length < 12 || data.length % 4 !== 0) return invalid();
    const count = data.readUInt16BE(4);
    const directoryEnd = 12 + count * 16;
    if (!count || count > 4095 || directoryEnd > data.length) return invalid();
    const selector = Math.floor(Math.log2(count));
    const searchRange = (2 ** selector) * 16;
    if (data.readUInt16BE(6) !== searchRange || data.readUInt16BE(8) !== selector
        || data.readUInt16BE(10) !== count * 16 - searchRange) return invalid();

    const tables = [];
    let previousTag = -1;
    for (let index = 0; index < count; index++) {
        const record = 12 + index * 16;
        const tag = data.readUInt32BE(record);
        const tagName = data.toString('latin1', record, record + 4);
        const offset = data.readUInt32BE(record + 8);
        const length = data.readUInt32BE(record + 12);
        if (tag <= previousTag || !/^[\x20-\x7e]{4}$/.test(tagName) || !length
            || offset % 4 !== 0 || offset < directoryEnd || offset + align4(length) > data.length) return invalid();
        previousTag = tag;
        tables.push({ tag, tagName, offset, length, checksum: data.readUInt32BE(record + 4) });
    }

    const ordered = [...tables].sort((a, b) => a.offset - b.offset);
    let nextOffset = directoryEnd;
    for (const table of ordered) {
        // Preserve exact SFNT reconstruction: reject gaps, overlaps and nonzero padding.
        if (table.offset !== nextOffset) return invalid();
        nextOffset += align4(table.length);
        for (let offset = table.offset + table.length; offset < nextOffset; offset++) {
            if (data[offset] !== 0) return invalid();
        }
        if (checksum(data.subarray(table.offset, table.offset + table.length), table.tagName === 'head') !== table.checksum) return invalid();
    }
    if (nextOffset !== data.length || checksum(data) !== SFNT_CHECKSUM) return invalid();
    const head = tables.find(table => table.tagName === 'head');
    if (!head || head.length < 54 || data.readUInt32BE(head.offset + 12) !== 0x5f0f3cf5) return invalid();
    if (tables.some(table => table.tagName === 'DSIG')) return fail('FONT_SIGNED', format);
    const os2 = tables.find(table => table.tagName === 'OS/2');
    if (os2) {
        if (os2.length < 10) return invalid();
        const flags = data.readUInt16BE(os2.offset + 8);
        if (flags & 0x0202) return fail('FONT_EMBEDDING_RESTRICTED', format);
    }
    return { canOptimize: true, reason: null, format, originalSize, flavor, tables, ordered };
}

export function inspectFont(data) {
    const { tables, ordered, flavor, ...result } = parseFont(data);
    return result;
}

export function optimizeFont(data) {
    const parsed = parseFont(data);
    const unchanged = reason => ({
        data,
        optimized: false,
        reason,
        format: parsed.format,
        originalSize: parsed.originalSize,
        optimizedSize: parsed.originalSize,
    });
    if (!parsed.canOptimize) return unchanged(parsed.reason);

    // WOFF 1.0 preserves every table and its original physical order; no glyphs are removed.
    // https://www.w3.org/TR/WOFF/#DataTables
    let total = 44 + parsed.tables.length * 20;
    for (const table of parsed.ordered) {
        const original = data.subarray(table.offset, table.offset + table.length);
        const compressed = deflateSync(original, { level: 9 });
        table.output = compressed.length < original.length ? compressed : original;
        table.outputOffset = total;
        total += align4(table.output.length);
    }
    if (total >= data.length) return unchanged('FONT_NO_SAVING');

    const output = Buffer.alloc(total);
    output.write('wOFF', 0, 'ascii');
    output.writeUInt32BE(parsed.flavor, 4);
    output.writeUInt32BE(total, 8);
    output.writeUInt16BE(parsed.tables.length, 12);
    output.writeUInt32BE(data.length, 16);
    output.writeUInt16BE(1, 20);
    for (let index = 0; index < parsed.tables.length; index++) {
        const table = parsed.tables[index];
        const record = 44 + index * 20;
        output.writeUInt32BE(table.tag, record);
        output.writeUInt32BE(table.outputOffset, record + 4);
        output.writeUInt32BE(table.output.length, record + 8);
        output.writeUInt32BE(table.length, record + 12);
        output.writeUInt32BE(table.checksum, record + 16);
        table.output.copy(output, table.outputOffset);
    }
    return {
        data: output,
        optimized: true,
        reason: null,
        format: 'woff',
        originalSize: data.length,
        optimizedSize: output.length,
    };
}
