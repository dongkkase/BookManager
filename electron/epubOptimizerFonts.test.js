import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { inspectFont, optimizeFont } from './epubOptimizer/fonts.js';
import { inspectFontReferences } from './epubOptimizer/fontReferences.js';
import { DOMParser } from '@xmldom/xmldom';

const align4 = value => Math.ceil(value / 4) * 4;

function sum(data) {
    let result = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
        const bytes = Buffer.alloc(4);
        data.copy(bytes, 0, offset, offset + 4);
        result = (result + bytes.readUInt32BE(0)) >>> 0;
    }
    return result;
}

function createFont({ flavor = 0x00010000, flags = 0, signed = false, tiny = false } = {}) {
    const head = Buffer.alloc(54);
    if (tiny) {
        for (let index = 0; index < head.length; index++) head[index] = (index * 113 + 37) % 256;
    }
    head.writeUInt32BE(0x00010000, 0);
    head.writeUInt32BE(0, 8);
    head.writeUInt32BE(0x5f0f3cf5, 12);
    const os2 = Buffer.alloc(96);
    os2.writeUInt16BE(4, 0);
    os2.writeUInt16BE(flags, 8);
    const physical = tiny ? [
        { name: 'head', data: head },
    ] : [
        { name: 'head', data: head },
        { name: flavor === 0x4f54544f ? 'CFF ' : 'glyf', data: Buffer.alloc(8191, 0x41) },
        { name: 'OS/2', data: os2 },
    ];
    if (signed) physical.push({ name: 'DSIG', data: Buffer.alloc(16) });
    const directory = [...physical].sort((a, b) => a.name < b.name ? -1 : 1);
    const size = 12 + directory.length * 16 + physical.reduce((total, table) => total + align4(table.data.length), 0);
    const data = Buffer.alloc(size);
    data.writeUInt32BE(flavor, 0);
    data.writeUInt16BE(directory.length, 4);
    const selector = Math.floor(Math.log2(directory.length));
    data.writeUInt16BE(2 ** selector * 16, 6);
    data.writeUInt16BE(selector, 8);
    data.writeUInt16BE(directory.length * 16 - 2 ** selector * 16, 10);
    let offset = 12 + directory.length * 16;
    for (const table of physical) {
        table.offset = offset;
        table.data.copy(data, offset);
        offset += align4(table.data.length);
    }
    directory.forEach((table, index) => {
        const record = 12 + index * 16;
        data.write(table.name, record, 'ascii');
        data.writeUInt32BE(sum(table.data), record + 4);
        data.writeUInt32BE(table.offset, record + 8);
        data.writeUInt32BE(table.data.length, record + 12);
    });
    const headOffset = physical.find(table => table.name === 'head').offset;
    data.writeUInt32BE((0xb1b0afba - sum(data)) >>> 0, headOffset + 8);
    return data;
}

function decodeWoff(woff) {
    assert.equal(woff.toString('ascii', 0, 4), 'wOFF');
    assert.equal(woff.readUInt32BE(8), woff.length);
    assert.equal(woff.readUInt16BE(14), 0);
    assert.deepEqual(woff.subarray(24, 44), Buffer.alloc(20));
    const count = woff.readUInt16BE(12);
    const decoded = Buffer.alloc(woff.readUInt32BE(16));
    decoded.writeUInt32BE(woff.readUInt32BE(4), 0);
    decoded.writeUInt16BE(count, 4);
    const selector = Math.floor(Math.log2(count));
    decoded.writeUInt16BE(2 ** selector * 16, 6);
    decoded.writeUInt16BE(selector, 8);
    decoded.writeUInt16BE(count * 16 - 2 ** selector * 16, 10);
    const tables = [];
    let previousTag = -1;
    for (let index = 0; index < count; index++) {
        const record = 44 + index * 20;
        const tag = woff.readUInt32BE(record);
        const offset = woff.readUInt32BE(record + 4);
        const compressedSize = woff.readUInt32BE(record + 8);
        const originalSize = woff.readUInt32BE(record + 12);
        assert.ok(tag > previousTag);
        assert.equal(offset % 4, 0);
        assert.ok(compressedSize <= originalSize);
        const encoded = woff.subarray(offset, offset + compressedSize);
        const data = compressedSize < originalSize ? inflateSync(encoded) : encoded;
        assert.equal(data.length, originalSize);
        const checksumData = Buffer.from(data);
        if (tag === 0x68656164) checksumData.writeUInt32BE(0, 8);
        assert.equal(sum(checksumData), woff.readUInt32BE(record + 16));
        tables.push({ index, tag, offset, data, checksum: woff.readUInt32BE(record + 16) });
        previousTag = tag;
    }
    let offset = 12 + 16 * count;
    for (const table of tables.sort((a, b) => a.offset - b.offset)) {
        const record = 12 + table.index * 16;
        decoded.writeUInt32BE(table.tag, record);
        decoded.writeUInt32BE(table.checksum, record + 4);
        decoded.writeUInt32BE(offset, record + 8);
        decoded.writeUInt32BE(table.data.length, record + 12);
        table.data.copy(decoded, offset);
        offset += align4(table.data.length);
    }
    assert.equal(offset, decoded.length);
    assert.equal(sum(decoded), 0xb1b0afba);
    return decoded;
}

test('TTF and OTF WOFF packaging preserves every byte on round trip and never mutates source', () => {
    for (const flavor of [0x00010000, 0x4f54544f]) {
        const source = createFont({ flavor });
        const copy = Buffer.from(source);
        assert.equal(inspectFont(source).canOptimize, true);
        const result = optimizeFont(source);
        assert.equal(result.optimized, true);
        assert.equal(result.format, 'woff');
        assert.ok(result.optimizedSize < result.originalSize);
        assert.deepEqual(decodeWoff(result.data), copy);
        assert.deepEqual(source, copy);
    }
});

test('non-beneficial packaging retains the original buffer', () => {
    const source = createFont({ tiny: true });
    assert.equal(inspectFont(source).canOptimize, true);
    const result = optimizeFont(source);
    assert.equal(result.optimized, false);
    assert.equal(result.reason, 'FONT_NO_SAVING');
    assert.equal(result.data, source);
    assert.equal(result.optimizedSize, source.length);
});

test('compressed, unsupported, signed and restricted fonts remain unchanged', () => {
    const samples = [
        [Buffer.from('wOFF'), 'FONT_ALREADY_COMPRESSED'],
        [Buffer.from('wOF2'), 'FONT_ALREADY_COMPRESSED'],
        [Buffer.from('ttcf'), 'FONT_UNSUPPORTED'],
        [createFont({ signed: true }), 'FONT_SIGNED'],
        [createFont({ flags: 0x0002 }), 'FONT_EMBEDDING_RESTRICTED'],
        [createFont({ flags: 0x0200 }), 'FONT_EMBEDDING_RESTRICTED'],
    ];
    for (const [source, reason] of samples) {
        assert.equal(inspectFont(source).reason, reason);
        const result = optimizeFont(source);
        assert.equal(result.optimized, false);
        assert.equal(result.reason, reason);
        assert.equal(result.data, source);
    }
    const noSubsetFont = createFont({ flags: 0x0100 });
    assert.deepEqual(decodeWoff(optimizeFont(noSubsetFont).data), noSubsetFont);
});

test('invalid offsets, table checksums, global checksums, padding, headers and truncation are rejected', () => {
    const mutations = [
        data => data.subarray(0, data.length - 4),
        data => { data.writeUInt32BE(0xfffffff0, 20); return data; },
        data => { data.writeUInt32BE(data.readUInt32BE(20), 36); return data; },
        data => { data[data.length - 4] ^= 1; return data; },
        data => { const head = data.readUInt32BE(52); data[head + 8] ^= 1; return data; },
        data => { data.writeUInt16BE(0, 6); return data; },
        data => { data.writeUInt16BE(65535, 4); return data; },
        data => { data.copy(data, 28, 12, 16); return data; },
        data => { data[data.readUInt32BE(52) + 54] = 1; return data; },
        data => Buffer.concat([data, Buffer.alloc(4)]),
    ];
    for (const mutate of mutations) {
        const data = mutate(createFont());
        assert.equal(inspectFont(data).canOptimize, false);
        assert.equal(optimizeFont(data).reason, 'FONT_INVALID');
        assert.equal(optimizeFont(data).data, data);
    }
    assert.equal(inspectFont(Buffer.alloc(0)).reason, 'FONT_INVALID');
    assert.equal(inspectFont(Buffer.alloc(64 * 1024 * 1024 + 1)).reason, 'FONT_TOO_LARGE');
});

function references(data, mediaType = 'text/css', name = 'EPUB/styles/main.css', entryName = 'EPUB/fonts/a.ttf') {
    return inspectFontReferences({ entryName, textResources: [{ name, mediaType, data: Buffer.from(data) }] });
}

test('font references update only matching CSS sources and retain other formatting', () => {
    const original = '/* keep */\n@font-face { font-family: Book; src: local("Book"), url(../fonts/a.ttf) format("truetype"), url(../fonts/b.otf) format("opentype"); }\np { color: red; }';
    const result = references(original);
    assert.equal(result.canConvert, true);
    assert.equal(result.updates.length, 1);
    assert.equal(result.updates[0].data.toString(), original.replace('format("truetype")', 'format("woff")'));
    const second = inspectFontReferences({
        entryName: 'EPUB/fonts/b.otf',
        textResources: [{ name: 'EPUB/styles/main.css', mediaType: 'text/css', data: result.updates[0].data }],
    });
    assert.equal(second.canConvert, true);
    assert.equal(second.updates[0].data.toString(), original.replace('format("truetype")', 'format("woff")').replace('format("opentype")', 'format("woff")'));
});

test('font references handle URI encoding, CSS escaping, root paths and sources without format hints', () => {
    for (const url of ['../fonts/a.ttf', '../fonts/%61.ttf', '../fonts/\\61.ttf', '/EPUB/fonts/a.ttf']) {
        const result = references(`@font-face{src:url(${url})}`);
        assert.equal(result.canConvert, true, url);
        assert.equal(result.updates[0].data.toString(), `@font-face{src:url(${url}) format("woff")}`);
    }
    assert.deepEqual(references('@font-face{src:url(../fonts/b.ttf) format("truetype")}').updates, []);
    const decomposed = '../fonts/한글.ttf'.normalize('NFD');
    const unicode = references(`@font-face{src:url("${decomposed}") format("truetype")}`, 'text/css', 'EPUB/styles/main.css', 'EPUB/fonts/한글.ttf');
    assert.equal(unicode.canConvert, true);
    assert.equal(unicode.updates[0].data.toString(), `@font-face{src:url("${decomposed}") format("woff")}`);
});

test('XHTML embedded styles and preload types are updated while document content is preserved', () => {
    const source = '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><style><![CDATA[@font-face{src:url(fonts/a.ttf) format(truetype)}]]></style><link rel="preload" as="font" href="fonts/a.ttf" type="font/ttf"/></head><body><p style="color:red">책 &amp; 본문</p></body></html>';
    const result = references(source, 'application/xhtml+xml', 'EPUB/chapter.xhtml');
    assert.equal(result.canConvert, true);
    assert.equal(result.updates.length, 1);
    const document = new DOMParser().parseFromString(result.updates[0].data.toString(), 'application/xml');
    assert.equal(document.getElementsByTagName('style')[0].textContent, '@font-face{src:url(fonts/a.ttf) format("woff")}');
    assert.equal(document.getElementsByTagName('link')[0].getAttribute('type'), 'font/woff');
    assert.equal(document.getElementsByTagName('p')[0].textContent, '책 & 본문');
    assert.equal(document.getElementsByTagName('p')[0].getAttribute('style'), 'color:red');
});

test('ambiguous or scripted font references reject the whole plan without partial updates', () => {
    const cases = [
        ['@font-face{src:url(../fonts/a.ttf?#iefix) format("truetype")}', 'text/css'],
        ['@font-face{src:url(../fonts/a.ttf) format("embedded-opentype")}', 'text/css'],
        ['@font-face{src:url(../fonts/a.ttf) format("truetype") tech(variations)}', 'text/css'],
        ['@font-face{src:var(--font)}', 'text/css'],
        ['p{background:url(../fonts/a.ttf)}', 'text/css'],
        ['@font-face{src:url("../fonts/a.ttf)}', 'text/css'],
        ['@charset "shift_jis"; @font-face{src:url(../fonts/a.ttf)}', 'text/css'],
        ['<html><script>document.fonts</script></html>', 'application/xhtml+xml'],
        ['<html><body onload="foo()"/></html>', 'application/xhtml+xml'],
        ['<html xml:base="different/"><style>@font-face{src:url(../fonts/a.ttf)}</style></html>', 'application/xhtml+xml'],
        ['<html><base href="different/"/></html>', 'application/xhtml+xml'],
        ['<svg><font-face-uri href="../fonts/a.ttf"/></svg>', 'image/svg+xml'],
        ['document.fonts', 'text/javascript'],
        ['<html><body></html>', 'application/xhtml+xml'],
    ];
    for (const [source, mediaType] of cases) {
        const result = references(source, mediaType);
        assert.equal(result.canConvert, false, source);
        assert.equal(result.reason, 'FONT_REFERENCES_UNSUPPORTED');
        assert.deepEqual(result.updates, []);
    }
    const result = inspectFontReferences({
        entryName: 'EPUB/fonts/a.ttf',
        textResources: [
            { name: 'EPUB/styles/main.css', mediaType: 'text/css', data: Buffer.from('@font-face{src:url(../fonts/a.ttf)}') },
            { name: 'EPUB/script.js', mediaType: 'text/javascript', data: Buffer.from('document.fonts') },
        ],
    });
    assert.equal(result.canConvert, false);
    assert.deepEqual(result.updates, []);
});
