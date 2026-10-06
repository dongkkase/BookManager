import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EpubEditorService } from './epubEditor/service.js';
import { identifyAsset, writePackage } from './epubEditor/package.js';
import { importEpubPackage } from './epubEditor/epubImport.js';
import { importedImageDimensions } from './epubEditor/epubImportImages.js';
import { assetFilename, inspectProject } from './epubEditor/model.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';

const webp = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=', 'base64');

function container(type, payload) {
    const chunk = Buffer.alloc(8 + payload.length + payload.length % 2);
    chunk.write(type);
    chunk.writeUInt32LE(payload.length, 4);
    payload.copy(chunk, 8);
    const header = Buffer.from('RIFF0000WEBP');
    header.writeUInt32LE(chunk.length + 4, 4);
    return Buffer.concat([header, chunk]);
}

test('WebP headers identify lossy, lossless and extended image dimensions', () => {
    assert.deepEqual(identifyAsset(webp), { extension: 'webp', mime: 'image/webp', kind: 'image' });
    assert.deepEqual(importedImageDimensions(webp, 'webp'), { width: 1, height: 1 });
    const lossless = Buffer.alloc(5);
    lossless[0] = 0x2f;
    lossless.writeUInt32LE((479 << 14) | 639, 1);
    const extended = Buffer.alloc(10);
    extended[0] = 0x10;
    extended.writeUIntLE(799, 4, 3);
    extended.writeUIntLE(1199, 7, 3);
    for (const [data, width, height] of [[container('VP8L', lossless), 640, 480], [container('VP8X', extended), 800, 1200]]) {
        assert.equal(identifyAsset(data).mime, 'image/webp');
        assert.deepEqual(importedImageDimensions(data, 'webp'), { width, height });
    }
});

test('WebP probing rejects truncated chunks, invalid signatures and non-WebP RIFF files', () => {
    const tooLarge = Buffer.from(webp);
    tooLarge.writeUInt32LE(0xffffffff, 16);
    const invalidFrame = Buffer.from(webp);
    invalidFrame[23] = 0;
    const wav = Buffer.from(webp);
    wav.write('WAVE', 8);
    for (const data of [webp.subarray(0, 12), webp.subarray(0, 29), webp.subarray(0, -1), tooLarge, invalidFrame, wav, container('JUNK', Buffer.alloc(10))]) {
        assert.equal(importedImageDimensions(data, 'webp'), null);
        assert.throws(() => identifyAsset(data), { code: 'INVALID_ASSET' });
    }
});

for (const version of ['2.0', '3.0']) {
    test(`EPUB ${version} keeps a WebP cover and body images through recovery, save, templates and export`, async t => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-webp-'));
        const service = new EpubEditorService(path.join(root, 'work'));
        t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
        const file = path.join(root, 'source.epub');
        const href = '../Images/표지%20그림.WEBP';
        const html = body => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>WebP book</title></head><body>${body}</body></html>`;
        await writePackage(file, [
            { name: 'mimetype', data: 'application/epub+zip', store: true },
            { name: 'META-INF/container.xml', data: '<container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
            { name: 'OPS/book.opf', data: `<package version="${version}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>WebP book</dc:title>${version === '2.0' ? '<meta name="cover" content="cover"/>' : ''}</metadata><manifest><item id="cover" href="Images/표지%20그림.WEBP" media-type="image/webp"${version === '3.0' ? ' properties="cover-image"' : ''}/><item id="front" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="body" href="Text/body.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="front"/><itemref idref="body"/></spine></package>` },
            { name: 'OPS/Text/cover.xhtml', data: html(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100%"><image xlink:href="${href}"/></svg>`) },
            { name: 'OPS/Text/body.xhtml', data: html(`<p>Editable text</p><img src="${href}" alt="Natural size"/><img src="${href}" style="width:64px" alt="Fixed size"/>`) },
            { name: 'OPS/Images/표지 그림.WEBP', data: webp },
        ]);
        const source = await fs.readFile(file);
        const imported = await service.importEpub(1, file, 'import');
        assert.equal(imported.project.cover.mode, 'image');
        assert.equal(imported.project.chapters.length, 1, 'The cover-only chapter must not be duplicated');
        assert.equal(imported.project.assets.length, 1);
        assert.equal(imported.importWarnings.some(warning => warning.code === 'EPUB_IMPORT_MEDIA'), false);
        const asset = imported.project.assets[0];
        assert.equal(asset.id, imported.project.cover.assetId);
        assert.equal(asset.mime, 'image/webp');
        assert.equal(asset.extension, 'webp');
        const images = imported.project.chapters[0].content.content.filter(node => node.type === 'image');
        assert.deepEqual(images.map(node => [node.attrs.width, node.attrs.widthUnit]), [[1, 'px'], [64, 'px']]);
        await service.close(1, imported.sessionId);
        const restored = await service.restore(1, imported.sessionId);
        assert.deepEqual(restored.project, imported.project);
        const saved = path.join(root, 'saved.bmepub');
        await service.write(1, restored.sessionId, restored.project, saved, 'save', 'save');
        const reopened = await service.open(1, saved, 'open');
        assert.deepEqual(reopened.project, imported.project);
        assert.deepEqual((await service.asset(1, reopened.sessionId, asset.id)).data, webp);
        const library = await service.saveContentTemplate(1, reopened.sessionId, { name: 'WebP template', description: '', content: { type: 'doc', content: images } }, 0);
        const template = library.templates[0];
        assert.deepEqual((await service.contentTemplateAsset(template.id, template.assets[0].id)).data, webp);
        await service.deleteContentTemplate(template.id, library.revision);
        assert.deepEqual(await fs.readdir(path.join(root, 'work', 'template-assets')), []);
        const output = path.join(root, 'output.epub');
        await service.write(1, reopened.sessionId, reopened.project, output, 'export', 'export');
        const buffer = await fs.readFile(output);
        const entries = listZipEntries(buffer);
        const opf = readZipEntry(buffer, entries.find(entry => entry.name.endsWith('.opf'))).toString('utf8');
        assert.match(opf, /media-type="image\/webp" properties="cover-image"/);
        assert.deepEqual(readZipEntry(buffer, entries.find(entry => entry.name === `EPUB/assets/${assetFilename(asset)}`)), webp);
        const reimported = await importEpubPackage(output, path.join(root, 'reimport'));
        assert.equal(reimported.project.cover.mode, 'image');
        assert.equal(reimported.project.assets.find(item => item.id === reimported.project.cover.assetId).mime, 'image/webp');
        assert.deepEqual(inspectProject(reimported.project).filter(issue => issue.severity === 'error'), []);
        assert.deepEqual(await fs.readFile(file), source);
    });
}
