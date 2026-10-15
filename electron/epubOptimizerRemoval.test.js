import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { crc32, listZipEntriesFromFile, readZipEntryFromFile } from './core/zipArchive.js';
import { inspectEpub, optimizeEpub } from './epubOptimizer/core.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const FONT = Buffer.concat([Buffer.from('wOFF'), Buffer.alloc(4096, 71)]);
const AUDIO = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(8192, 81)]);
const noTransforms = { images: false, fonts: false, recompress: false };
const removeAll = { ...noTransforms, removeUnusedFonts: true, removeUnusedImages: true, removeUnusedAudio: true };

function zip(entries) {
    let offset = 0;
    const localRecords = [];
    const centralRecords = [];
    for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const data = Buffer.from(entry.data);
        const packed = entry.deflate ? deflateRawSync(data) : data;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6);
        local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
        local.writeUInt32LE(crc32(data), 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50);
        central.writeUInt16LE(20, 4);
        local.copy(central, 6, 4, 28);
        central.writeUInt32LE(offset, 42);
        localRecords.push(local, name, packed);
        centralRecords.push(central, name);
        offset += local.length + name.length + packed.length;
    }
    const central = Buffer.concat(centralRecords);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...localRecords, central, end]);
}

function packageXml({ manifest = '', metadata = '', version = '3.0', chapterAttributes = '', suffix = '' } = {}) {
    return `<package xmlns="http://www.idpf.org/2007/opf" version="${version}"><metadata>${metadata}</metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" ${chapterAttributes}/>${manifest}</manifest><spine><itemref idref="chapter"/></spine>${suffix}</package>`;
}

function entries({ manifest = '', metadata = '', version = '3.0', chapterAttributes = '', body = '', head = '', extra = [], suffix = '' } = {}) {
    return [
        { name: 'mimetype', data: 'application/epub+zip' },
        { name: 'META-INF/container.xml', data: '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
        { name: 'EPUB/package.opf', data: packageXml({ manifest, metadata, version, chapterAttributes, suffix }) },
        { name: 'EPUB/chapter.xhtml', data: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title>${head}</head><body><p>${'Text '.repeat(200)}</p>${body}</body></html>` },
        ...extra,
    ];
}

function orphanMedia() {
    return {
        manifest: '<item id="unused-font" href="Fonts/unused.woff" media-type="font/woff"/><item id="unused-image" href="Images/unused.png" media-type="image/png"/><item id="unused-audio" href="Audio/unused.mp3" media-type="audio/mpeg"/>',
        extra: [
            { name: 'EPUB/Fonts/unused.woff', data: FONT },
            { name: 'EPUB/Images/unused.png', data: PNG },
            { name: 'EPUB/Audio/unused.mp3', data: AUDIO },
        ],
    };
}

async function fixture(t, archiveEntries) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-optimizer-removal-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.epub');
    await fs.writeFile(filePath, zip(archiveEntries));
    return { directory, filePath };
}

async function contents(filePath) {
    const result = new Map();
    for (const entry of await listZipEntriesFromFile(filePath)) {
        const data = await readZipEntryFromFile(filePath, entry);
        assert.equal(data.length, entry.uncompressedSize, entry.name);
        assert.equal(crc32(data), entry.crc, entry.name);
        result.set(entry.name, data);
    }
    return result;
}

function manifestHrefs(data) {
    const document = new DOMParser().parseFromString(data.toString(), 'application/xml');
    return Array.from(document.getElementsByTagName('item')).map(item => item.getAttribute('href'));
}

test('inspection identifies unused media independently from manifest registration and never writes files', async t => {
    const media = orphanMedia();
    const { directory, filePath } = await fixture(t, entries({
        ...media,
        manifest: `${media.manifest}<item id="style" href="style.css" media-type="text/css"/><item id="font" href="Fonts/used.woff" media-type="font/woff"/><item id="image" href="Images/used.png" media-type="image/png"/><item id="audio" href="Audio/used.mp3" media-type="audio/mpeg"/>`,
        head: '<link rel="stylesheet" href="style.css"/>',
        body: '<img src="Images/used.png" alt=""/><audio><source src="Audio/used.mp3" type="audio/mpeg"/></audio>',
        extra: [...media.extra,
            { name: 'EPUB/style.css', data: '@font-face{font-family:NeverSelected;src:url("Fonts/used.woff")}body{font-family:serif}' },
            { name: 'EPUB/Fonts/used.woff', data: FONT },
            { name: 'EPUB/Images/used.png', data: PNG },
            { name: 'EPUB/Audio/used.mp3', data: AUDIO },
            { name: 'EPUB/Images/unlisted.png', data: PNG },
        ],
    }));
    const original = await fs.readFile(filePath);
    const inspection = await inspectEpub(filePath);
    const resources = new Map(inspection.resources.map(resource => [resource.name, resource]));
    for (const name of [...media.extra.map(entry => entry.name), 'EPUB/Images/unlisted.png']) {
        assert.equal(resources.get(name).usage, 'unused', name);
        assert.equal(resources.get(name).canRemove, true, name);
    }
    for (const name of ['EPUB/Fonts/used.woff', 'EPUB/Images/used.png', 'EPUB/Audio/used.mp3']) {
        assert.equal(resources.get(name).usage, 'referenced', name);
        assert.equal(resources.get(name).canRemove, false, name);
    }
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('unused media remain untouched unless deletion is explicitly enabled', async t => {
    const { directory, filePath } = await fixture(t, entries(orphanMedia()));
    const original = await fs.readFile(filePath);
    const result = await optimizeEpub(filePath, noTransforms);
    assert.equal(result.status, 'unchanged');
    assert.deepEqual(result.removedResources, []);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('enabled deletion removes orphan fonts, images and audio with their manifest entries in a separate valid EPUB', async t => {
    const media = orphanMedia();
    const { directory, filePath } = await fixture(t, entries({
        ...media,
        manifest: `${media.manifest}<item id="missing" href="Fonts/missing.woff" media-type="font/woff"/>`,
        extra: [...media.extra, { name: 'EPUB/Audio/unlisted.mp3', data: AUDIO }],
    }));
    const original = await fs.readFile(filePath);
    const inspection = await inspectEpub(filePath);
    const result = await optimizeEpub(filePath, removeAll, { expectedFingerprint: inspection.fingerprint });
    assert.equal(result.status, 'saved');
    assert.equal(result.outputPath, filePath.replace('.epub', '.optimized.epub'));
    const expectedRemoved = inspection.resources.filter(resource => resource.canRemove)
        .map(({ name, kind, compressedSize }) => ({ name, kind, compressedSize }));
    assert.equal(expectedRemoved.length, 4);
    assert.deepEqual(result.removedResources, expectedRemoved);
    const output = await contents(result.outputPath);
    assert.deepEqual(manifestHrefs(output.get('EPUB/package.opf')), ['chapter.xhtml', 'Fonts/missing.woff']);
    for (const resource of expectedRemoved) assert.equal(output.has(resource.name), false, resource.name);
    assert.deepEqual(output.get('EPUB/chapter.xhtml'), (await contents(filePath)).get('EPUB/chapter.xhtml'));
    assert.deepEqual((await inspectEpub(result.outputPath)).missingResources, inspection.missingResources);
    assert.equal(result.savedBytes, original.length - (await fs.stat(result.outputPath)).size);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['book.epub', 'book.optimized.epub']);
});

test('each media deletion option affects only its selected category', async t => {
    for (const [option, kind] of [['removeUnusedFonts', 'font'], ['removeUnusedImages', 'image'], ['removeUnusedAudio', 'audio']]) {
        await t.test(kind, async t => {
            const { filePath } = await fixture(t, entries(orphanMedia()));
            const result = await optimizeEpub(filePath, { ...noTransforms, [option]: true });
            assert.equal(result.status, 'saved');
            assert.deepEqual(result.removedResources.map(resource => resource.kind), [kind]);
            const remaining = await inspectEpub(result.outputPath);
            assert.deepEqual(remaining.resources.filter(resource => ['font', 'image', 'audio'].includes(resource.kind)).map(resource => resource.kind).sort(), ['font', 'image', 'audio'].filter(value => value !== kind).sort());
        });
    }
});

test('manual removal can select unused media, exclude category selections and cannot force removal of referenced media', async t => {
    const media = orphanMedia();
    const usedName = 'EPUB/Images/used.png';
    const { filePath } = await fixture(t, entries({
        ...media,
        manifest: `${media.manifest}<item id="used" href="Images/used.png" media-type="image/png"/>`,
        body: '<img src="Images/used.png" alt=""/>',
        extra: [...media.extra, { name: usedName, data: PNG }],
    }));
    const result = await optimizeEpub(filePath, {
        ...noTransforms,
        mode: 'manual',
        removeUnusedFonts: true,
        resources: {
            'EPUB/Fonts/unused.woff': { remove: false },
            'EPUB/Audio/unused.mp3': { remove: true },
            [usedName]: { remove: true },
        },
    });
    assert.equal(result.status, 'saved');
    assert.deepEqual(result.removedResources.map(resource => resource.name), ['EPUB/Audio/unused.mp3']);
    const source = await contents(filePath);
    const output = await contents(result.outputPath);
    for (const name of ['EPUB/Fonts/unused.woff', 'EPUB/Images/unused.png', usedName]) assert.deepEqual(output.get(name), source.get(name));
});

test('EPUB 2 and 3 cover metadata, fallback resources and obfuscated fonts are protected from forced removal', async t => {
    for (const version of ['2.0', '3.0']) {
        await t.test(version, async t => {
            const coverProperties = version === '3.0' ? 'properties="cover-image"' : '';
            const { directory, filePath } = await fixture(t, entries({
                version,
                metadata: version === '2.0' ? '<meta name="cover" content="cover"/>' : '',
                manifest: `<item id="cover" href="cover.png" media-type="image/png" ${coverProperties}/><item id="custom" href="custom.bin" media-type="application/x-custom" fallback="fallback"/><item id="fallback" href="fallback.png" media-type="image/png"/><item id="obfuscated" href="obfuscated.woff" media-type="font/woff"/>`,
                extra: [
                    { name: 'EPUB/cover.png', data: PNG },
                    { name: 'EPUB/fallback.png', data: PNG },
                    { name: 'EPUB/custom.bin', data: 'custom data' },
                    { name: 'EPUB/obfuscated.woff', data: FONT },
                    { name: 'META-INF/encryption.xml', data: '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="EPUB/obfuscated.woff"/></CipherData></EncryptedData></encryption>' },
                ],
            }));
            const inspection = await inspectEpub(filePath);
            const protectedNames = ['EPUB/cover.png', 'EPUB/fallback.png', 'EPUB/obfuscated.woff'];
            for (const name of protectedNames) assert.equal(inspection.resources.find(resource => resource.name === name).canRemove, false, name);
            const result = await optimizeEpub(filePath, { ...removeAll, mode: 'manual', resources: Object.fromEntries(protectedNames.map(name => [name, { remove: true }])) });
            assert.equal(result.status, 'unchanged');
            assert.deepEqual(result.removedResources, []);
            assert.deepEqual(await fs.readdir(directory), ['book.epub']);
        });
    }
});

test('scripts and unreadable reference documents conservatively prevent unused-media removal', async t => {
    const media = orphanMedia();
    const variants = [
        { name: 'inline script', body: '<script>const path = "Images/" + "unused.png";</script>' },
        { name: 'unlisted script', extra: [{ name: 'EPUB/script.js', data: 'document.createElement("img")' }] },
        { name: 'scripted manifest property', chapterAttributes: 'properties="scripted"' },
        { name: 'unsupported manifest document', manifest: `${media.manifest}<item id="custom" href="custom.bin" media-type="application/x-custom"/>`, extra: [{ name: 'EPUB/custom.bin', data: 'Images/unused.png' }] },
        { name: 'malformed XHTML', extra: [{ name: 'EPUB/broken.xhtml', data: '<html><body><img src="Images/unused.png"></body>' }] },
        { name: 'malformed CSS', extra: [{ name: 'EPUB/broken.css', data: 'body { background-image: url("Images/unused.png);' }] },
    ];
    for (const variant of variants) {
        await t.test(variant.name, async t => {
            const { directory, filePath } = await fixture(t, entries({ ...media, ...variant, extra: [...media.extra, ...(variant.extra || [])] }));
            const original = await fs.readFile(filePath);
            const inspection = await inspectEpub(filePath);
            for (const { name } of media.extra) {
                const resource = inspection.resources.find(resource => resource.name === name);
                assert.equal(resource.canRemove, false, name);
                assert.equal(resource.usage, 'unknown', name);
            }
            const result = await optimizeEpub(filePath, { ...removeAll, mode: 'manual', resources: Object.fromEntries(media.extra.map(({ name }) => [name, { remove: true }])) });
            assert.equal(result.status, 'unchanged');
            assert.deepEqual(result.removedResources, []);
            assert.deepEqual(await fs.readFile(filePath), original);
            assert.deepEqual(await fs.readdir(directory), ['book.epub']);
        });
    }
});

test('CSS, SVG and SMIL references preserve media including percent-encoded Unicode paths', async t => {
    const names = ['EPUB/Images/표지.png', 'EPUB/Images/svg.png', 'EPUB/Audio/overlay.mp3'];
    const { directory, filePath } = await fixture(t, entries({
        manifest: '<item id="image" href="Images/%ED%91%9C%EC%A7%80.png" media-type="image/png"/><item id="svg-image" href="Images/svg.png" media-type="image/png"/><item id="audio" href="Audio/overlay.mp3" media-type="audio/mpeg"/>',
        body: '<img src="drawing.svg" alt=""/>',
        extra: [
            { name: names[0], data: PNG },
            { name: names[1], data: PNG },
            { name: names[2], data: AUDIO },
            { name: 'EPUB/Styles/extra.css', data: '.unused-selector{background:url("../Images/%ED%91%9C%EC%A7%80.png#image")}' },
            { name: 'EPUB/drawing.svg', data: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="Images/svg.png"/></svg>' },
            { name: 'EPUB/overlay.smil', data: '<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><par><text src="chapter.xhtml#p"/><audio src="Audio/overlay.mp3"/></par></seq></body></smil>' },
        ],
    }));
    const inspection = await inspectEpub(filePath);
    for (const name of names) assert.equal(inspection.resources.find(resource => resource.name === name).canRemove, false, name);
    const result = await optimizeEpub(filePath, removeAll);
    assert.equal(result.status, 'unchanged');
    assert.deepEqual(result.removedResources, []);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('SVG presentation attribute URLs preserve external image resources', async t => {
    const { directory, filePath } = await fixture(t, entries({
        body: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(Images/pattern.svg#pattern)" filter="url(Images/filter.svg#blur)"/></svg>',
        extra: [
            { name: 'EPUB/Images/pattern.svg', data: '<svg xmlns="http://www.w3.org/2000/svg"><defs><pattern id="pattern" width="1" height="1"><rect width="1" height="1"/></pattern></defs></svg>' },
            { name: 'EPUB/Images/filter.svg', data: '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="blur"><feGaussianBlur stdDeviation="5"/></filter></defs></svg>' },
        ],
    }));
    const inspection = await inspectEpub(filePath);
    const images = inspection.resources.filter(resource => resource.kind === 'image');
    assert.equal(images.length, 2);
    assert.ok(images.every(resource => resource.canRemove === false));
    const result = await optimizeEpub(filePath, removeAll);
    assert.equal(result.status, 'unchanged');
    assert.deepEqual(result.removedResources, []);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('multiple package manifests remove only orphan entries while preserving media referenced by an alternate rendition', async t => {
    const media = orphanMedia();
    const archiveEntries = entries(media);
    archiveEntries[1].data = '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/><rootfile full-path="Alternate/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
    archiveEntries.push(
        { name: 'Alternate/package.opf', data: packageXml({ manifest: '<item id="font" href="../EPUB/Fonts/unused.woff" media-type="font/woff"/><item id="image" href="../EPUB/Images/unused.png" media-type="image/png"/><item id="audio" href="../EPUB/Audio/unused.mp3" media-type="audio/mpeg"/>' }) },
        { name: 'Alternate/chapter.xhtml', data: '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Alternate</title></head><body><img src="../EPUB/Images/unused.png" alt=""/></body></html>' },
    );
    const { filePath } = await fixture(t, archiveEntries);
    const result = await optimizeEpub(filePath, removeAll);
    assert.equal(result.status, 'saved');
    assert.deepEqual(result.removedResources.map(resource => resource.kind).sort(), ['audio', 'font']);
    const output = await contents(result.outputPath);
    assert.deepEqual(manifestHrefs(output.get('EPUB/package.opf')), ['chapter.xhtml', 'Images/unused.png']);
    assert.deepEqual(manifestHrefs(output.get('Alternate/package.opf')), ['chapter.xhtml', '../EPUB/Images/unused.png']);
    assert.deepEqual(output.get('EPUB/Images/unused.png'), PNG);
    assert.deepEqual((await inspectEpub(result.outputPath)).missingResources, []);
});

test('media removal combines with mimetype normalization and text recompression without changing retained content', async t => {
    const archiveEntries = entries(orphanMedia());
    const mimetype = archiveEntries.shift();
    mimetype.deflate = true;
    archiveEntries.push(mimetype);
    const { filePath } = await fixture(t, archiveEntries);
    const original = await fs.readFile(filePath);
    const result = await optimizeEpub(filePath, { ...removeAll, recompress: true });
    assert.equal(result.status, 'saved');
    assert.equal(result.removedResources.length, 3);
    const outputEntries = await listZipEntriesFromFile(result.outputPath);
    assert.equal(outputEntries[0].name, 'mimetype');
    assert.equal(outputEntries[0].localHeaderOffset, 0);
    assert.equal(outputEntries[0].method, 0);
    assert.equal(outputEntries.find(entry => entry.name === 'EPUB/chapter.xhtml').method, 8);
    const output = await contents(result.outputPath);
    assert.deepEqual(output.get('EPUB/chapter.xhtml'), (await contents(filePath)).get('EPUB/chapter.xhtml'));
    assert.deepEqual((await inspectEpub(result.outputPath)).warnings, []);
    assert.deepEqual(await fs.readFile(filePath), original);
});

test('image optimization skips deleted images and still processes retained referenced images', async t => {
    const media = orphanMedia();
    const usedName = 'EPUB/Images/used.png';
    const { filePath } = await fixture(t, entries({
        ...media,
        manifest: `${media.manifest}<item id="used" href="Images/used.png" media-type="image/png"/>`,
        body: '<img src="Images/used.png" alt=""/>',
        extra: [...media.extra, { name: usedName, data: Buffer.concat([PNG, Buffer.alloc(8192, 65)]) }],
    }));
    const calls = [];
    const result = await optimizeEpub(filePath, { ...removeAll, images: true }, {
        transformImage: async request => {
            calls.push(request.name);
            return PNG;
        },
    });
    assert.equal(result.status, 'saved');
    assert.deepEqual(calls, [usedName]);
    assert.equal(result.removedResources.length, 3);
    const output = await contents(result.outputPath);
    assert.deepEqual(output.get(usedName), PNG);
    assert.equal(output.has('EPUB/Images/unused.png'), false);
});

test('deleting an unused audio entry cannot bypass the source CRC check or leave partial output', async t => {
    const { directory, filePath } = await fixture(t, entries(orphanMedia()));
    const sourceEntries = await listZipEntriesFromFile(filePath);
    const audio = sourceEntries.find(entry => entry.name === 'EPUB/Audio/unused.mp3');
    const damaged = await fs.readFile(filePath);
    const dataStart = audio.localHeaderOffset + 30 + damaged.readUInt16LE(audio.localHeaderOffset + 26) + damaged.readUInt16LE(audio.localHeaderOffset + 28);
    damaged[dataStart] ^= 1;
    await fs.writeFile(filePath, damaged);
    await assert.rejects(optimizeEpub(filePath, removeAll), { code: 'EPUB_INVALID' });
    assert.deepEqual(await fs.readFile(filePath), damaged);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});
