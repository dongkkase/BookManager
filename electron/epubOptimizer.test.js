import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';
import { crc32, listZipEntriesFromFile, readZipEntryFromFile } from './core/zipArchive.js';
import { inspectEpub, optimizeEpub } from './epubOptimizer/core.js';

function zip(entries) {
    let offset = 0;
    const locals = [];
    const records = [];
    for (const item of entries) {
        const name = Buffer.from(item.name);
        const data = Buffer.from(item.data || '');
        const packed = item.store === false ? deflateRawSync(data) : data;
        const extra = item.localExtra || Buffer.alloc(0);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6);
        local.writeUInt16LE(item.store === false ? 8 : 0, 8);
        local.writeUInt32LE(crc32(data), 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(extra.length, 28);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50);
        central.writeUInt16LE(20, 4);
        local.copy(central, 6, 4, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, extra, packed);
        records.push(central, name);
        offset += local.length + name.length + extra.length + packed.length;
    }
    const central = Buffer.concat(records);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, central, end]);
}

function epubEntries({ version = '3.0', extra = [], manifest = '', metadata = '', body = 'A paragraph '.repeat(500), stored = true } = {}) {
    return [
        { name: 'mimetype', data: 'application/epub+zip', store: true },
        { name: 'META-INF/container.xml', data: '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', store: stored },
        { name: 'EPUB/package.opf', data: `<package xmlns="http://www.idpf.org/2007/opf" version="${version}"><metadata>${metadata}</metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>${manifest}</manifest><spine><itemref idref="chapter"/></spine></package>`, store: stored },
        { name: 'EPUB/chapter.xhtml', data: `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title></head><body><p>${body}</p></body></html>`, store: stored },
        ...extra,
    ];
}

async function fixture(t, entries) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-optimizer-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'book.epub');
    await fs.writeFile(filePath, zip(entries));
    return { directory, filePath };
}

async function contents(filePath) {
    const entries = await listZipEntriesFromFile(filePath);
    return new Map(await Promise.all(entries.map(async entry => [entry.name, await readZipEntryFromFile(filePath, entry)])));
}

function fakeJpeg(padding = 1000, width = 1200, height = 1600) {
    const header = Buffer.from([255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0]);
    const noise = Buffer.alloc(padding);
    for (let index = 0; index < noise.length; index += 1) noise[index] = index % 251;
    return Buffer.concat([header, noise, Buffer.from([255, 217])]);
}

test('EPUB inspection is read-only, recognizes EPUB 2 cover metadata and provides stable fingerprint', async t => {
    const { directory, filePath } = await fixture(t, epubEntries({ version: '2.0', metadata: '<meta name="cover" content="cover"/>', manifest: '<item id="cover" href="cover.jpg" media-type="image/jpeg"/>', extra: [{ name: 'EPUB/cover.jpg', data: fakeJpeg() }] }));
    const original = await fs.readFile(filePath);
    const result = await inspectEpub(filePath);
    assert.equal(result.version, '2.0');
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(result.fingerprint, (await inspectEpub(filePath)).fingerprint);
    const cover = result.resources.find(resource => resource.name === 'EPUB/cover.jpg');
    assert.equal(cover.isCover, true);
    assert.equal(cover.width, 1200);
    assert.equal(cover.height, 1600);
    assert.equal(cover.canOptimize, true);
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('explicit recompression saves separately, keeps each resource byte and never overwrites an existing output', async t => {
    const { filePath } = await fixture(t, epubEntries());
    const original = await fs.readFile(filePath);
    const inspection = await inspectEpub(filePath);
    const first = await optimizeEpub(filePath, { images: false, fonts: false }, { expectedFingerprint: inspection.fingerprint });
    assert.equal(first.status, 'saved');
    assert.ok(first.savedBytes > 0);
    assert.equal(first.outputPath, filePath.replace('.epub', '.optimized.epub'));
    assert.deepEqual(await contents(first.outputPath), await contents(filePath));
    const second = await optimizeEpub(filePath, { images: false, fonts: false });
    assert.equal(second.outputPath, filePath.replace('.epub', '.optimized (1).epub'));
    assert.deepEqual(await fs.readFile(filePath), original);
    const entries = await listZipEntriesFromFile(first.outputPath);
    assert.equal(entries[0].name, 'mimetype');
    assert.equal(entries[0].method, 0);
});

test('nonstandard mimetype placement, compression and extra fields are normalized only in the optimized copy', async t => {
    for (const variant of ['compressed', 'relocated', 'compressed-relocated', 'local-extra']) {
        await t.test(variant, async t => {
            const entries = epubEntries();
            const mimetype = entries[0];
            if (variant.includes('compressed')) mimetype.store = false;
            if (variant.includes('relocated')) entries.push(entries.shift());
            if (variant === 'local-extra') {
                mimetype.localExtra = Buffer.alloc(36);
                mimetype.localExtra.writeUInt16LE(0xcafe, 0);
                mimetype.localExtra.writeUInt16LE(32, 2);
            }
            const { directory, filePath } = await fixture(t, entries);
            const original = await fs.readFile(filePath);
            const originalContents = await contents(filePath);
            const inspection = await inspectEpub(filePath);
            assert.deepEqual(inspection.warnings, ['NONSTANDARD_MIMETYPE']);
            assert.equal(inspection.resources.length, entries.length);
            assert.deepEqual(await fs.readFile(filePath), original);
            assert.deepEqual(await fs.readdir(directory), ['book.epub']);

            const result = await optimizeEpub(filePath, { images: false, fonts: false }, { expectedFingerprint: inspection.fingerprint });
            assert.equal(result.status, 'saved');
            assert.ok(result.savedBytes > 0);
            assert.deepEqual(result.warnings, ['NONSTANDARD_MIMETYPE']);
            const outputEntries = await listZipEntriesFromFile(result.outputPath);
            const output = await fs.readFile(result.outputPath);
            assert.equal(outputEntries[0].name, 'mimetype');
            assert.equal(outputEntries[0].localHeaderOffset, 0);
            assert.equal(outputEntries[0].method, 0);
            assert.equal(output.readUInt32LE(0), 0x04034b50);
            assert.equal(output.readUInt16LE(8), 0);
            assert.equal(output.readUInt16LE(28), 0);
            assert.equal(output.toString('ascii', 30, 38), 'mimetype');
            assert.deepEqual(await contents(result.outputPath), originalContents);
            assert.deepEqual((await inspectEpub(result.outputPath)).warnings, []);
            assert.deepEqual(await fs.readFile(filePath), original);
        });
    }
});

test('incorrect mimetype contents and CRC still prevent inspection and optimization', async t => {
    for (const variant of ['application/zip', 'application/epub+zip\n', 'invalid-crc']) {
        const entries = epubEntries();
        if (variant !== 'invalid-crc') entries[0].data = variant;
        const { directory, filePath } = await fixture(t, entries);
        if (variant === 'invalid-crc') {
            const bytes = await fs.readFile(filePath);
            bytes[38] ^= 1;
            await fs.writeFile(filePath, bytes);
        }
        const original = await fs.readFile(filePath);
        await assert.rejects(inspectEpub(filePath), { code: 'EPUB_INVALID' });
        await assert.rejects(optimizeEpub(filePath), { code: 'EPUB_INVALID' });
        assert.deepEqual(await fs.readFile(filePath), original);
        assert.deepEqual(await fs.readdir(directory), ['book.epub']);
    }
});

test('disabled operations produce no output and a non-smaller image keeps original bytes', async t => {
    const { directory, filePath } = await fixture(t, epubEntries({ manifest: '<item id="image" href="image.jpg" media-type="image/jpeg"/>', extra: [{ name: 'EPUB/image.jpg', data: fakeJpeg(10), store: false }] }));
    const disabled = await optimizeEpub(filePath, { images: false, fonts: false, recompress: false });
    assert.equal(disabled.status, 'unchanged');
    let calls = 0;
    const unchanged = await optimizeEpub(filePath, { fonts: false, recompress: false }, { transformImage: async () => { calls += 1; return fakeJpeg(5000); } });
    assert.equal(calls, 1);
    assert.equal(unchanged.status, 'unchanged');
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('manual choices transform only enabled image and automatic fixed layout never resizes', async t => {
    const { filePath } = await fixture(t, epubEntries({ metadata: '<meta property="rendition:layout">pre-paginated</meta>', manifest: '<item id="a" href="a.jpg" media-type="image/jpeg"/><item id="b" href="b.jpg" media-type="image/jpeg"/>', extra: [{ name: 'EPUB/a.jpg', data: fakeJpeg(6000) }, { name: 'EPUB/b.jpg', data: fakeJpeg(6000) }] }));
    const calls = [];
    const manual = await optimizeEpub(filePath, { mode: 'manual', fonts: false, recompress: false, resources: { 'EPUB/a.jpg': { enabled: false }, 'EPUB/b.jpg': { quality: 65, maxDimension: 1024 } } }, { transformImage: async request => { calls.push(request); return fakeJpeg(20, 600, 800); } });
    assert.equal(manual.status, 'saved');
    assert.deepEqual(calls.map(call => call.name), ['EPUB/b.jpg']);
    assert.equal(calls[0].settings.quality, 65);
    assert.equal(calls[0].settings.maxDimension, 1024);
    const saved = await contents(manual.outputPath);
    assert.deepEqual(saved.get('EPUB/a.jpg'), (await contents(filePath)).get('EPUB/a.jpg'));
    calls.length = 0;
    await optimizeEpub(filePath, { fonts: false, recompress: false }, { transformImage: async request => { calls.push(request); return fakeJpeg(20); } });
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.settings.maxDimension === 0));
});

test('inspection rejects path traversal, duplicate names, DRM, signatures and absent spine files', async t => {
    for (const [entries, code] of [
        [epubEntries({ extra: [{ name: '../escape', data: 'bad' }] }), 'EPUB_UNSAFE_ARCHIVE'],
        [epubEntries({ extra: [{ name: 'EPUB/chapter.xhtml', data: 'duplicate' }] }), 'EPUB_UNSAFE_ARCHIVE'],
        [epubEntries({ extra: [{ name: 'META-INF/signatures.xml', data: '<signatures/>' }] }), 'EPUB_SIGNED'],
        [epubEntries({ extra: [{ name: 'META-INF/encryption.xml', data: '<encryption><EncryptedData><EncryptionMethod Algorithm="DRM"/><CipherData><CipherReference URI="EPUB/chapter.xhtml"/></CipherData></EncryptedData></encryption>' }] }), 'EPUB_ENCRYPTED'],
        [epubEntries().filter(entry => entry.name !== 'EPUB/chapter.xhtml'), 'EPUB_RESOURCE_MISSING'],
    ]) {
        const { filePath } = await fixture(t, entries);
        await assert.rejects(inspectEpub(filePath), { code });
    }
});

test('missing fonts and images warn without blocking inspection or changing existing references during optimization', async t => {
    const missing = ['KoPubWBB.ttf', 'KoPubWBL.ttf', 'KoPubWBM.ttf', 'KoPubWDB.ttf', 'KoPubWDL.ttf', 'KoPubWDM.ttf']
        .map(name => ({ href: `Fonts/${name}`, mediaType: 'font/ttf' }));
    missing.push({ href: 'Images/missing.jpg', mediaType: 'image/jpeg' });
    const css = '@font-face{font-family:KoPub;src:url(Fonts/KoPubWBB.ttf)}body{font-family:KoPub,serif}';
    const originalImage = fakeJpeg(6000);
    const optimizedImage = fakeJpeg(20);
    const manifest = missing.map((item, index) => `<item id="missing-${index}" href="${item.href}" media-type="${item.mediaType}"/>`).join('')
        + '<item id="style" href="style.css" media-type="text/css"/><item id="image" href="image.jpg" media-type="image/jpeg"/>';
    const { directory, filePath } = await fixture(t, epubEntries({ version: '2.0', manifest, extra: [
        { name: 'EPUB/style.css', data: css },
        { name: 'EPUB/image.jpg', data: originalImage },
    ] }));
    const original = await fs.readFile(filePath);
    const originalContents = await contents(filePath);
    const inspection = await inspectEpub(filePath);
    const missingResources = missing.map(item => ({ packageName: 'EPUB/package.opf', href: item.href, name: `EPUB/${item.href}`, mediaType: item.mediaType }));
    assert.deepEqual(inspection.warnings, ['MISSING_RESOURCES']);
    assert.deepEqual(inspection.missingResources, missingResources);
    assert.equal(inspection.resources.find(resource => resource.name === 'EPUB/image.jpg').canOptimize, true);
    assert.ok(missingResources.every(item => !inspection.resources.some(resource => resource.name === item.name)));
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);

    const transformations = [];
    const result = await optimizeEpub(filePath, { fonts: false, recompress: false }, {
        expectedFingerprint: inspection.fingerprint,
        transformImage: async request => { transformations.push(request.name); return optimizedImage; },
    });
    assert.equal(result.status, 'saved');
    assert.ok(result.savedBytes > 0);
    assert.deepEqual(result.warnings, ['MISSING_RESOURCES']);
    assert.deepEqual(transformations, ['EPUB/image.jpg']);
    const outputContents = await contents(result.outputPath);
    assert.deepEqual([...outputContents.keys()], [...originalContents.keys()]);
    for (const [name, data] of originalContents) {
        assert.deepEqual(outputContents.get(name), name === 'EPUB/image.jpg' ? optimizedImage : data, name);
    }
    const outputInspection = await inspectEpub(result.outputPath);
    assert.deepEqual(outputInspection.missingResources, missingResources);
    assert.deepEqual(outputInspection.warnings, ['MISSING_RESOURCES']);
    assert.deepEqual(await fs.readFile(filePath), original);
});

test('missing spine, navigation, NCX and unsafe resource references still prevent inspection and output', async t => {
    const spineEntries = epubEntries().filter(entry => entry.name !== 'EPUB/chapter.xhtml');
    const navigationEntries = epubEntries({ manifest: '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' });
    const ncxEntries = epubEntries({ version: '2.0', manifest: '<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' });
    const ncxPackage = ncxEntries.find(entry => entry.name.endsWith('.opf'));
    ncxPackage.data = ncxPackage.data.replace('<spine>', '<spine toc="toc">');
    const unsafeEntries = ['../../escape.ttf', '%2foutside.ttf', '..%5cescape.ttf', 'file:///tmp/font.ttf', '%00font.ttf', '%zz.ttf']
        .map(href => epubEntries({ manifest: `<item id="unsafe" href="${href}" media-type="font/ttf"/>` }));
    for (const entries of [spineEntries, navigationEntries, ncxEntries, ...unsafeEntries]) {
        const { directory, filePath } = await fixture(t, entries);
        const original = await fs.readFile(filePath);
        await assert.rejects(inspectEpub(filePath), { code: 'EPUB_RESOURCE_MISSING' });
        await assert.rejects(optimizeEpub(filePath), { code: 'EPUB_RESOURCE_MISSING' });
        assert.deepEqual(await fs.readFile(filePath), original);
        assert.deepEqual(await fs.readdir(directory), ['book.epub']);
    }
});

test('obfuscated fonts remain byte-identical while other entries can be compressed', async t => {
    const font = Buffer.alloc(3000, 27);
    const { filePath } = await fixture(t, epubEntries({ manifest: '<item id="font" href="font.ttf" media-type="font/ttf"/>', extra: [{ name: 'EPUB/font.ttf', data: font }, { name: 'META-INF/encryption.xml', data: '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><CipherData><CipherReference URI="EPUB/font.ttf"/></CipherData></EncryptedData></encryption>' }] }));
    const inspection = await inspectEpub(filePath);
    const resource = inspection.resources.find(item => item.kind === 'font');
    assert.equal(resource.canOptimize, false);
    assert.equal(resource.encrypted, true);
    assert.equal(resource.reason, 'FONT_OBFUSCATED');
    const result = await optimizeEpub(filePath);
    assert.equal(result.status, 'saved');
    assert.deepEqual((await contents(result.outputPath)).get('EPUB/font.ttf'), font);
});

test('source changes and cancellation discard temporary output and preserve source', async t => {
    const { directory, filePath } = await fixture(t, epubEntries({ manifest: '<item id="image" href="image.jpg" media-type="image/jpeg"/>', extra: [{ name: 'EPUB/image.jpg', data: fakeJpeg(6000) }] }));
    await assert.rejects(optimizeEpub(filePath, {}, { expectedFingerprint: 'stale' }), { code: 'SOURCE_CHANGED' });
    let cancelled = false;
    await assert.rejects(optimizeEpub(filePath, {}, { shouldCancel: () => cancelled, transformImage: async () => { cancelled = true; return fakeJpeg(20); } }), { code: 'TASK_CANCELLED' });
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
    const original = await fs.readFile(filePath);
    await assert.rejects(optimizeEpub(filePath, {}, { transformImage: async () => { await fs.utimes(filePath, new Date(), new Date(Date.now() + 10000)); return fakeJpeg(20); } }), { code: 'SOURCE_CHANGED' });
    assert.deepEqual(await fs.readFile(filePath), original);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('corrupt untouched content is rejected before publication', async t => {
    const { filePath, directory } = await fixture(t, epubEntries());
    const bytes = await fs.readFile(filePath);
    const marker = bytes.indexOf(Buffer.from('A paragraph'));
    bytes[marker] ^= 1;
    await fs.writeFile(filePath, bytes);
    await assert.rejects(optimizeEpub(filePath), { code: 'EPUB_INVALID' });
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('Node worker returns inspection and closes without requesting image transformations', async t => {
    const { filePath } = await fixture(t, epubEntries());
    const worker = new Worker(new URL('./epubOptimizer/worker.js', import.meta.url), { workerData: { action: 'inspect', filePath } });
    const messages = [];
    const code = await new Promise((resolve, reject) => {
        worker.on('message', message => messages.push(message));
        worker.once('error', reject);
        worker.once('exit', resolve);
    });
    assert.equal(code, 0);
    assert.equal(messages.filter(message => message.type === 'result').length, 1);
    assert.equal(messages.some(message => message.type === 'image'), false);
    assert.equal(messages.find(message => message.type === 'result').result.filePath, filePath);
});

test('font conversion updates all matching manifest types and CSS formats without renaming resources', async t => {
    const font = await fs.readFile(new URL('../src/fonts/NanumGothic-Regular.ttf', import.meta.url));
    const css = '@font-face{font-family:One;src:url(one.ttf) format("truetype")}\n@font-face{font-family:Two;src:url(two.ttf) format("truetype")}';
    const { filePath } = await fixture(t, epubEntries({ manifest: '<item id="one" href="one.ttf" media-type="font/ttf"/><item id="two" href="two.ttf" media-type="application/vnd.ms-opentype"/><item id="style" href="style.css" media-type="text/css"/>', extra: [{ name: 'EPUB/one.ttf', data: font }, { name: 'EPUB/two.ttf', data: font }, { name: 'EPUB/style.css', data: css }] }));
    const inspection = await inspectEpub(filePath);
    assert.equal(inspection.resources.filter(resource => resource.kind === 'font' && resource.canOptimize).length, 2);
    const result = await optimizeEpub(filePath, { images: false, fonts: true, recompress: false });
    assert.equal(result.status, 'saved');
    const output = await contents(result.outputPath);
    assert.equal(output.get('EPUB/one.ttf').toString('ascii', 0, 4), 'wOFF');
    assert.equal(output.get('EPUB/two.ttf').toString('ascii', 0, 4), 'wOFF');
    assert.equal((output.get('EPUB/package.opf').toString().match(/media-type="font\/woff"/g) || []).length, 2);
    assert.equal(output.get('EPUB/style.css').toString(), css.replaceAll('format("truetype")', 'format("woff")'));
    assert.deepEqual(output.get('EPUB/chapter.xhtml'), (await contents(filePath)).get('EPUB/chapter.xhtml'));
    assert.equal((await contents(filePath)).get('EPUB/one.ttf').readUInt32BE(0), 0x00010000);
});

test('scripted font references are identified as unavailable during inspection', async t => {
    const font = await fs.readFile(new URL('../src/fonts/NanumGothic-Regular.ttf', import.meta.url));
    const { filePath } = await fixture(t, epubEntries({ body: '<script>document.fonts;</script>', manifest: '<item id="font" href="font.ttf" media-type="font/ttf"/>', extra: [{ name: 'EPUB/font.ttf', data: font }] }));
    const inspection = await inspectEpub(filePath);
    const resource = inspection.resources.find(item => item.kind === 'font');
    assert.equal(resource.canOptimize, false);
    assert.equal(resource.reason, 'FONT_REFERENCES_UNSUPPORTED');
    const result = await optimizeEpub(filePath, { images: false, fonts: true, recompress: false });
    assert.equal(result.status, 'unchanged');
});

test('output retains first uncompressed mimetype when central directory order differs from local order', async t => {
    const { filePath } = await fixture(t, epubEntries());
    const bytes = await fs.readFile(filePath);
    const end = bytes.length - 22;
    const start = bytes.readUInt32LE(end + 16);
    const records = [];
    for (let offset = start; offset < end;) {
        const length = 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
        records.push(bytes.subarray(offset, offset + length));
        offset += length;
    }
    await fs.writeFile(filePath, Buffer.concat([bytes.subarray(0, start), ...records.reverse(), bytes.subarray(end)]));
    const result = await optimizeEpub(filePath, { images: false, fonts: false });
    assert.equal(result.status, 'saved');
    const output = await fs.readFile(result.outputPath);
    assert.equal(output.toString('ascii', 30, 38), 'mimetype');
    assert.equal(output.readUInt16LE(8), 0);
    await inspectEpub(result.outputPath);
});

test('Node worker cancellation while awaiting image conversion closes and removes temporary files', async t => {
    const { directory, filePath } = await fixture(t, epubEntries({ manifest: '<item id="image" href="image.jpg" media-type="image/jpeg"/>', extra: [{ name: 'EPUB/image.jpg', data: fakeJpeg(6000) }] }));
    const worker = new Worker(new URL('./epubOptimizer/worker.js', import.meta.url), { workerData: { action: 'optimize', filePath, settings: { fonts: false } } });
    const messages = [];
    const code = await new Promise((resolve, reject) => {
        worker.on('message', message => {
            messages.push(message);
            if (message.type === 'image') worker.postMessage({ type: 'cancel' });
        });
        worker.once('error', reject);
        worker.once('exit', resolve);
    });
    assert.equal(code, 0);
    assert.equal(messages.find(message => message.type === 'error')?.error?.code, 'TASK_CANCELLED');
    assert.equal(messages.some(message => message.type === 'result'), false);
    assert.deepEqual(await fs.readdir(directory), ['book.epub']);
});

test('EPUB 2 guide cover pages protect their linked image without cover-id metadata', async t => {
    const entries = epubEntries({ version: '2.0', manifest: '<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-art" href="art.jpg" media-type="image/jpeg"/>', extra: [{ name: 'EPUB/cover.xhtml', data: '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="art.jpg"/></body></html>' }, { name: 'EPUB/art.jpg', data: fakeJpeg() }] });
    const packageEntry = entries.find(entry => entry.name.endsWith('.opf'));
    packageEntry.data = packageEntry.data.replace('</package>', '<guide><reference type="cover" href="cover.xhtml"/></guide></package>');
    const { filePath } = await fixture(t, entries);
    const inspection = await inspectEpub(filePath);
    assert.equal(inspection.resources.find(resource => resource.name === 'EPUB/art.jpg').isCover, true);
    let transformations = 0;
    const result = await optimizeEpub(filePath, { recompress: false, fonts: false }, { transformImage: async () => { transformations += 1; return fakeJpeg(10); } });
    assert.equal(result.status, 'unchanged');
    assert.equal(transformations, 0);
});
