import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { writePackage, epubTextEntries } from './epubEditor/package.js';
import { importEpubPackage } from './epubEditor/epubImport.js';
import { inspectProject, paragraph, textContent, walkDocument } from './epubEditor/model.js';
import { parseEpubXml, epubReference } from './epubEditor/epubImportXml.js';
import { importedImageDimensions } from './epubEditor/epubImportImages.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64');
const xhtml = (body, title = 'Document') => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;

function bookEntries({ version = '3.0', body = '<h1 id="제목">한글 日本語 English</h1><p>Hello</p>', second = '<p id="123:끝">Second chapter</p>', extra = [], manifest = '', metadata = '', spine = '' } = {}) {
    return [
        { name: 'mimetype', data: 'application/epub+zip', store: true },
        { name: 'META-INF/container.xml', data: '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml" /></rootfiles></container>' },
        { name: 'OPS/book.opf', data: `<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>책 &amp; Book</dc:title><dc:creator>Author</dc:creator><dc:language>ko</dc:language><dc:identifier id="book">urn:uuid:original</dc:identifier><dc:identifier>urn:isbn:9780000000000</dc:identifier><dc:publisher>Publisher</dc:publisher><dc:description>Description</dc:description><dc:rights>Rights</dc:rights><dc:date>2026-09-30T00:00:00Z</dc:date>${metadata}</metadata><manifest><item id="one" href="Text/첫%20장.xhtml" media-type="application/xhtml+xml"/><item id="two" href="Text/two.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest><spine>${spine || '<itemref idref="one"/><itemref idref="two"/>'}</spine></package>` },
        { name: 'OPS/nav.xhtml', data: xhtml('<nav epub:type="toc"><ol><li><a href="Text/첫%20장.xhtml#제목">첫 장 제목</a></li><li><a href="Text/two.xhtml">두 번째</a></li></ol></nav>') },
        { name: 'OPS/Text/첫 장.xhtml', data: xhtml(body) },
        { name: 'OPS/Text/two.xhtml', data: xhtml(second) },
        ...extra,
    ];
}

async function fixture(t, options) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-import-'));
    const file = path.join(root, '가져올 책.epub');
    const service = new EpubEditorService(path.join(root, 'work'));
    await writePackage(file, bookEntries(options));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, file, service };
}

function nodes(document, type) {
    const found = [];
    walkDocument(document, node => { if (!type || node.type === type) found.push(node); });
    return found;
}

test('EPUB image widths keep percent wrappers, pixel dimensions and natural sizes through save and export', async t => {
    const img = attributes => `<img src="../Images/picture.png" alt="Picture" ${attributes}/>`;
    const { root, file, service } = await fixture(t, {
        body: `<div style="width:8%;margin:0 auto">${img('')}</div><div style="width:50%">${img('style="width:50%"')}</div>${img('width="320" height="240"')}${img('width="320" style="width:240px !important"')}<figure style="width:400px">${img('style="width:50%"')}<figcaption>Caption</figcaption></figure>${img('')}${img('height="24"')}${img('style="width:8%"')}`,
        manifest: '<item id="picture" href="Images/picture.png" media-type="image/png"/>',
        extra: [{ name: 'OPS/Images/picture.png', data: png }],
    });
    const original = await fs.readFile(file);
    const imported = await service.importEpub(1, file, 'import');
    const widths = project => nodes(project.chapters[0].content, 'image').map(({ attrs }) => [attrs.width, attrs.widthUnit]);
    const expected = [[8, '%'], [25, '%'], [320, 'px'], [240, 'px'], [200, 'px'], [1, 'px'], [24, 'px'], [8, '%']];
    assert.deepEqual(widths(imported.project), expected);
    const saved = path.join(root, 'image-sizes.bmepub');
    await service.write(1, imported.sessionId, imported.project, saved, 'save', 'save');
    const reopened = await service.open(1, saved, 'reopen');
    assert.deepEqual(widths(reopened.project), expected);
    const output = path.join(root, 'image-sizes.epub');
    await service.write(1, reopened.sessionId, reopened.project, output, 'export', 'export');
    const reimported = await importEpubPackage(output, path.join(root, 'reimport-assets'));
    assert.deepEqual(widths(reimported.project), expected);
    assert.equal(nodes(reimported.project.chapters[0].content, 'image')[4].attrs.caption, 'Caption');
    assert.deepEqual(await fs.readFile(file), original);
});

test('PNG and JPEG size probing is bounded for truncated or invalid segments', () => {
    assert.deepEqual(importedImageDimensions(png, 'png'), { width: 1, height: 1 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 8, 8, 1, 0xe0, 2, 0x80, 0]);
    assert.deepEqual(importedImageDimensions(jpeg, 'jpg'), { width: 640, height: 480 });
    for (const length of [0, 2, 4, 8, 10, 12, 17]) assert.equal(importedImageDimensions(jpeg.subarray(0, length), 'jpg'), null);
    assert.equal(importedImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'jpg'), null);
    assert.equal(importedImageDimensions(png.subarray(0, 20), 'png'), null);
});

test('EPUB imports metadata, spine, navigation, Unicode anchors, media and editable formatting; saves and exports independently', async t => {
    const { root, file, service } = await fixture(t, {
        body: '<h1 id="제목">한글 日本語 English</h1><p style="text-align:right">Hello <strong>bold</strong> <em>italic</em> &amp; &nbsp;<span style="color:#abc;background-color:rgb(1,2,3);font-size:1.25rem">color</span><br/>new line <a href="two.xhtml#123%3A끝">다음</a></p><figure style="width:65%"><img src="../Images/그림%20한개.png" alt="그림"/><figcaption>Caption</figcaption></figure><ol start="3"><li id="item"><p>Item</p><ul><li>Nested</li></ul></li></ol><table><caption>Table</caption><tbody><tr><th colspan="2">Header</th></tr><tr><td id="cell">A</td><td style="background-color:#123456">B</td></tr></tbody></table><pre>  code\n    keep spaces</pre><p><a href="https://example.com">web</a></p>',
        second: '<p id="123:끝">Second chapter <a href="첫%20장.xhtml#제목">돌아가기</a> <a href="첫%20장.xhtml#cell">cell</a> <a href="첫%20장.xhtml#item">item</a></p>',
        manifest: '<item id="cover" href="Images/그림%20한개.png" media-type="image/png" properties="cover-image"/><item id="font" href="Fonts/font.otf" media-type="application/vnd.ms-opentype"/><item id="css" href="Styles/book.css" media-type="text/css"/>',
        extra: [{ name: 'OPS/Images/그림 한개.png', data: png }, { name: 'OPS/Fonts/font.otf', data: Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(16)]) }, { name: 'OPS/Styles/book.css', data: 'p{color:red}' }],
    });
    const original = await fs.readFile(file);
    const progress = [];
    const imported = await service.importEpub(1, file, 'import', 'en', value => progress.push(value));
    const { project } = imported;
    assert.equal(imported.savedPath, null);
    assert.equal(imported.savedRevision, -1);
    assert.deepEqual(project.metadata, { title: '책 & Book', author: 'Author', language: 'ko', identifier: 'urn:uuid:original', isbn: '9780000000000', publisher: 'Publisher', description: 'Description', rights: 'Rights', date: '2026-09-30' });
    assert.deepEqual(project.chapters.map(chapter => chapter.title), ['첫 장 제목', '두 번째']);
    const first = project.chapters[0];
    const second = project.chapters[1];
    assert.match(textContent(first.content), /한글 日本語 English/);
    assert.equal(first.content.content[1].attrs.textAlign, 'right');
    assert.ok(nodes(first.content, 'text').find(node => node.text === 'bold').marks.some(mark => mark.type === 'bold'));
    assert.deepEqual(nodes(first.content, 'text').find(node => node.text === 'color').marks[0].attrs, { color: '#aabbcc', backgroundColor: '#010203', fontSize: '20px' });
    assert.equal(nodes(first.content, 'image')[0].attrs.caption, 'Caption');
    assert.equal(nodes(first.content, 'image')[0].attrs.width, 65);
    assert.equal(nodes(first.content, 'orderedList')[0].attrs.start, 3);
    assert.equal(nodes(first.content, 'tableHeader')[0].attrs.colspan, 2);
    assert.equal(nodes(first.content, 'codeBlock')[0].content[0].text, '  code\n    keep spaces');
    const link = nodes(first.content, 'text').find(node => node.text === '다음').marks.find(mark => mark.type === 'link');
    assert.equal(link.attrs.href, `epub:${second.id}#${second.content.content[0].attrs.id}`);
    assert.equal(project.cover.mode, 'image');
    assert.deepEqual(project.assets.map(asset => asset.kind), ['image', 'font']);
    assert.deepEqual((await service.asset(1, imported.sessionId, project.cover.assetId)).data, png);
    assert.equal(inspectProject(project).filter(issue => issue.severity === 'error').length, 0);
    assert.ok(imported.importWarnings.some(item => item.code === 'EPUB_IMPORT_STYLE'));
    assert.equal(progress.at(-1), 100);
    assert.deepEqual(await fs.readFile(file), original);
    await assert.rejects(service.asset(2, imported.sessionId, project.cover.assetId), { code: 'SESSION_CLOSED' });
    const recoveryId = imported.sessionId;
    await service.close(1, imported.sessionId);
    const restored = await service.restore(1, recoveryId);
    assert.deepEqual(restored.project, project);
    restored.project.chapters[0].content.content.push(paragraph('Edited manuscript'));
    restored.project.revision += 1;
    const saved = path.join(root, '편집.bmepub');
    await service.write(1, restored.sessionId, restored.project, saved, 'save', 'save');
    await fs.unlink(file);
    const reopened = await service.open(1, saved, 'reopen');
    assert.deepEqual(reopened.project, restored.project);
    const output = path.join(root, '새 책.epub');
    await service.write(1, reopened.sessionId, reopened.project, output, 'export', 'export');
    const buffer = await fs.readFile(output);
    const entries = listZipEntries(buffer);
    const html = readZipEntry(buffer, entries.find(entry => entry.name === `EPUB/text/${first.id}.xhtml`)).toString();
    assert.match(html, /Edited manuscript/);
    assert.ok(html.includes(`${second.id}.xhtml#${second.content.content[0].attrs.id}`));
    assert.equal(entries[0].name, 'mimetype');
    assert.equal(entries[0].method, 0);
    const importedAgain = await service.importEpub(1, output, 'again', 'ko');
    assert.equal(importedAgain.project.chapters.length, 2, 'The generated image cover must not become an extra chapter');
    assert.equal(inspectProject(importedAgain.project).filter(issue => issue.severity === 'error').length, 0);
});

test('EPUB 2 imports NCX chapter titles in spine order and image cover metadata', async t => {
    const { root, file, service } = await fixture(t);
    await fs.unlink(file);
    const entries = bookEntries({ version: '2.0', metadata: '<meta name="cover" content="cover"/>', manifest: '<item id="cover" href="cover.png" media-type="image/png"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', spine: '<itemref idref="two" linear="no"/><itemref idref="one"/>', extra: [{ name: 'OPS/cover.png', data: png }, { name: 'OPS/toc.ncx', data: '<ncx><navMap><navPoint><navLabel><text>NCX Second</text></navLabel><content src="Text/two.xhtml"/></navPoint><navPoint><navLabel><text>NCX First</text></navLabel><content src="Text/첫%20장.xhtml"/></navPoint></navMap></ncx>' }] });
    entries.find(entry => entry.name === 'OPS/book.opf').data = entries.find(entry => entry.name === 'OPS/book.opf').data.replace('<item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '').replace('<spine>', '<spine toc="ncx">');
    await writePackage(file, entries);
    const imported = await service.importEpub(1, file, 'epub2', 'ko');
    assert.deepEqual(imported.project.chapters.map(chapter => chapter.title), ['NCX Second', 'NCX First']);
    assert.equal(imported.project.cover.mode, 'image');
    assert.equal((await fs.readdir(path.join(root, 'work'))).length, 1);
});

test('unsupported media, scripts, styles and unresolved links are reported without losing link text', async t => {
    const { file, service } = await fixture(t, { body: '<p id="start">Before <a href="javascript:alert(1)">unsafe</a><a href="missing.xhtml">missing</a><a href="#inline">local</a><a href="#empty">empty target</a></p><p><span id="inline">target</span></p><div id="empty"/><script>secret script text</script><style>p{color:red}</style><p>After<img src="https://example.com/image.png" alt="external image"/>tail</p><svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0"/></svg><p><ruby>漢<rt>かん</rt></ruby></p>' });
    const result = await service.importEpub(1, file, 'warnings', 'ko');
    const content = result.project.chapters[0].content;
    assert.match(textContent(content), /unsafe.*missing.*local/s);
    assert.match(textContent(content), /external image/);
    assert.match(textContent(content), /tail/);
    assert.doesNotMatch(textContent(content), /secret script text|color:red/);
    assert.equal(nodes(content, 'text').find(node => node.text === 'empty target').marks[0].type, 'link');
    assert.deepEqual(new Set(result.importWarnings.map(item => item.code)), new Set(['EPUB_IMPORT_MEDIA', 'EPUB_IMPORT_STYLE', 'EPUB_IMPORT_STRUCTURE', 'EPUB_IMPORT_LINK']));
    assert.equal(inspectProject(result.project).filter(issue => issue.severity === 'error').length, 0);
    const html = epubTextEntries(result.project).find(entry => entry.name.endsWith(`${result.project.chapters[0].id}.xhtml`)).data;
    assert.doesNotMatch(html, /javascript:|<script|https:\/\/example.com\/image/);
});

test('missing declared fonts and media are reported while existing chapters and assets remain editable and exportable', async t => {
    const fonts = ['serif-bold', 'serif-light', 'serif-medium', 'sans-bold', 'sans-light', 'sans-medium'];
    const { root, file, service } = await fixture(t, {
        body: '<h1 id="제목">Editable chapter</h1><p>Original manuscript</p><img src="../Images/present.png" alt="Present image"/><img src="../Images/missing.png" alt="Missing image description"/><audio src="../Audio/missing.mp3" title="Missing sound"/>',
        manifest: fonts.map(font => `<item id="${font}" href="Fonts/${font}.ttf" media-type="application/x-font-ttf"/>`).join('')
            + '<item id="present" href="Images/present.png" media-type="image/png"/><item id="missing-image" href="Images/missing.png" media-type="image/png"/><item id="missing-audio" href="Audio/missing.mp3" media-type="audio/mpeg"/>',
        extra: [{ name: 'OPS/Images/present.png', data: png }],
    });
    const original = await fs.readFile(file);
    const result = await service.importEpub(1, file, 'missing-assets', 'ko');
    assert.equal(result.project.chapters.length, 2);
    assert.equal(result.project.assets.length, 1);
    assert.deepEqual((await service.asset(1, result.sessionId, result.project.assets[0].id)).data, png);
    const missing = result.importWarnings.find(item => item.code === 'EPUB_IMPORT_MISSING_ASSET');
    assert.equal(missing.count, 8);
    assert.deepEqual(missing.names, [...fonts.map(font => `OPS/Fonts/${font}.ttf`), 'OPS/Images/missing.png', 'OPS/Audio/missing.mp3']);
    const first = result.project.chapters[0];
    assert.match(textContent(first.content), /Original manuscript/);
    assert.match(textContent(first.content), /Missing image description/);
    assert.match(textContent(first.content), /Missing sound/);
    assert.equal(nodes(first.content, 'image').length, 1);
    assert.equal(nodes(first.content, 'audio').length, 0);
    first.content.content.push(paragraph('Edited after import'));
    result.project.revision += 1;
    const saved = path.join(root, 'without-missing-assets.bmepub');
    await service.write(1, result.sessionId, result.project, saved, 'save', 'missing-save');
    const reopened = await service.open(1, saved, 'missing-reopen');
    assert.deepEqual(reopened.project, result.project);
    const exported = path.join(root, 'without-missing-assets.epub');
    await service.write(1, reopened.sessionId, reopened.project, exported, 'export', 'missing-export');
    const buffer = await fs.readFile(exported);
    const entries = listZipEntries(buffer);
    const html = readZipEntry(buffer, entries.find(entry => entry.name === `EPUB/text/${first.id}.xhtml`)).toString();
    assert.match(html, /Edited after import/);
    assert.doesNotMatch(html, /src="[^"]*missing/);
    assert.deepEqual(inspectProject(reopened.project).filter(issue => issue.severity === 'error'), []);
    assert.deepEqual(await fs.readFile(file), original);
});

test('relative EPUB references normalize Unicode and reject external or escaping paths', () => {
    assert.deepEqual(epubReference('OPS/Text/a.xhtml', '../Images/한%20글.png'), { name: 'OPS/Images/한 글.png', anchor: '' });
    assert.deepEqual(epubReference('OPS/Text/a.xhtml', '#제목'), { name: 'OPS/Text/a.xhtml', anchor: '제목' });
    assert.equal(epubReference('OPS/Text/a.xhtml', '../Images/한글.png'.normalize('NFD')).name, 'OPS/Images/한글.png');
    for (const href of ['../../../secret', 'file:///secret', 'https://example.com', '//host/file', '%2fsecret', '..%5csecret', '%00a', '%zz']) assert.equal(epubReference('OPS/Text/a.xhtml', href), null, href);
});

test('XML rejects malformed documents and custom entities, preserves standard XHTML entities and UTF-16', () => {
    assert.equal(parseEpubXml(Buffer.from(xhtml('<p>&nbsp;&copy;&amp;</p>'))).getElementsByTagName('p')[0].textContent, '\u00a0©&');
    assert.equal(parseEpubXml(Buffer.from('\ufeff' + xhtml('<p>한글</p>'), 'utf16le')).getElementsByTagName('p')[0].textContent, '한글');
    for (const source of ['<html><body></html>', '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///tmp/secret">]><x>&x;</x>']) assert.throws(() => parseEpubXml(Buffer.from(source)), { code: 'EPUB_INVALID' });
    assert.throws(() => parseEpubXml(Buffer.from('<x>'.repeat(70) + '</x>'.repeat(70))), { code: 'EPUB_TOO_LARGE' });
});

test('XML preserves literal replacement characters while rejecting broken encoding and markup', () => {
    const source = xhtml('<p title="\uFFFD">Before \uFFFD <![CDATA[\uFFFD]]> &#xFFFD; after</p>');
    for (const data of [Buffer.from(source), Buffer.from('\ufeff' + source, 'utf16le')]) {
        const paragraph = parseEpubXml(data).getElementsByTagName('p')[0];
        assert.equal(paragraph.getAttribute('title'), '\uFFFD');
        assert.equal(paragraph.textContent, 'Before \uFFFD \uFFFD \uFFFD after');
    }
    for (const markup of ['<p title=unquoted>\uFFFD</p>', '<p>\uFFFD</div>', '<p>\uFFFD &undefinedEntity;</p>']) {
        assert.throws(() => parseEpubXml(Buffer.from(xhtml(markup))), { code: 'EPUB_INVALID' });
    }
    const invalidUtf8 = Buffer.concat([Buffer.from('<x>'), Buffer.from([0xc3, 0x28]), Buffer.from('</x>')]);
    const invalidUtf16 = Buffer.concat([Buffer.from('\ufeff<x>text</x>', 'utf16le'), Buffer.from([0])]);
    for (const data of [invalidUtf8, invalidUtf16]) assert.throws(() => parseEpubXml(data), { code: 'EPUB_INVALID' });
});

test('EPUB replacement characters survive import, project reopening and export', async t => {
    const { root, file, service } = await fixture(t, { body: '<p>Before \uFFFD After &#xFFFD;</p>' });
    const original = await fs.readFile(file);
    const imported = await service.importEpub(1, file, 'replacement-import');
    assert.equal(textContent(imported.project.chapters[0].content), 'Before \uFFFD After \uFFFD');
    const saved = path.join(root, 'replacement.bmepub');
    await service.write(1, imported.sessionId, imported.project, saved, 'save', 'replacement-save');
    const reopened = await service.open(1, saved, 'replacement-reopen');
    assert.deepEqual(reopened.project, imported.project);
    const exported = path.join(root, 'replacement.epub');
    await service.write(1, reopened.sessionId, reopened.project, exported, 'export', 'replacement-export');
    const reimported = await importEpubPackage(exported, path.join(root, 'replacement-assets'));
    assert.deepEqual(nodes(reimported.project.chapters[0].content, 'paragraph').map(textContent), ['Before \uFFFD After \uFFFD']);
    assert.deepEqual(await fs.readFile(file), original);
});

test('invalid imports clean up work directories and never offer partial recovery projects', async t => {
    const { root, file, service } = await fixture(t);
    const invalidCases = [
        { entries: [...bookEntries(), { name: '../outside.txt', data: 'outside' }], code: 'EPUB_INVALID' },
        { entries: [...bookEntries(), { name: 'OPS/Text/two.xhtml', data: xhtml('<p>duplicate</p>') }], code: 'EPUB_INVALID' },
        { entries: [...bookEntries(), { name: 'META-INF/encryption.xml', data: '<encryption><EncryptedData/></encryption>' }], code: 'EPUB_ENCRYPTED' },
        { entries: bookEntries().filter(entry => entry.name !== 'OPS/Text/two.xhtml'), code: 'EPUB_RESOURCE_MISSING' },
        { entries: bookEntries({ spine: '<itemref idref="missing"/>' }), code: 'EPUB_UNSUPPORTED_DOCUMENT' },
        { entries: bookEntries({ second: '<p>malformed', manifest: '<item id="image" href="image.png" media-type="image/png"/>', extra: [{ name: 'OPS/image.png', data: png }] }), code: 'EPUB_INVALID' },
    ];
    for (const [index, item] of invalidCases.entries()) {
        await fs.unlink(file);
        await writePackage(file, item.entries);
        await assert.rejects(service.importEpub(1, file, `bad-${index}`, 'ko'), { code: item.code });
        assert.deepEqual(await fs.readdir(path.join(root, 'work')), []);
        assert.deepEqual(await service.recoveries(), []);
        assert.equal(service.sessions.size, 0);
    }
});

test('only the owning window can cancel an import and cancellation removes partial work', async t => {
    const { root, file, service } = await fixture(t);
    let started;
    const workerStarted = new Promise(resolve => { started = resolve; });
    const importing = service.importEpub(1, file, 'cancel-import', 'ko', value => { if (value === 1) started(); });
    const rejected = assert.rejects(importing, { code: 'CANCELED' });
    await workerStarted;
    assert.deepEqual(await service.cancel(2, 'cancel-import'), { canceled: false });
    assert.deepEqual(await service.cancel(1, 'cancel-import'), { canceled: true });
    await rejected;
    assert.deepEqual(await fs.readdir(path.join(root, 'work')), []);
    assert.equal(service.sessions.size, 0);
    assert.equal(service.jobs.size, 0);
});

test('closing the owner while importing leaves no session, job or recovery data', async t => {
    const { root, file, service } = await fixture(t);
    let started;
    const workerStarted = new Promise(resolve => { started = resolve; });
    const importing = service.importEpub(1, file, 'dispose-import', 'ko', value => { if (value === 1) started(); });
    const rejected = assert.rejects(importing, { code: 'CANCELED' });
    await workerStarted;
    await service.dispose(1);
    await rejected;
    assert.deepEqual(await fs.readdir(path.join(root, 'work')), []);
    assert.equal(service.sessions.size, 0);
    assert.equal(service.jobs.size, 0);
});

test('ZIP CRC errors and excessive declared expansion are rejected before asset extraction', async t => {
    const { root, file } = await fixture(t);
    const original = await fs.readFile(file);
    const badCrc = Buffer.from(original);
    const central = badCrc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    badCrc.writeUInt32LE(0, central + 16);
    await fs.writeFile(file, badCrc);
    await assert.rejects(importEpubPackage(file, path.join(root, 'crc-assets')), { code: 'EPUB_INVALID' });
    const oversized = Buffer.from(original);
    oversized.writeUInt32LE(300 * 1024 * 1024, central + 24);
    await fs.writeFile(file, oversized);
    await assert.rejects(importEpubPackage(file, path.join(root, 'large-assets')), { code: 'EPUB_TOO_LARGE' });
    assert.deepEqual((await fs.readdir(root)).sort(), [path.basename(file)]);
});

test('import IPC uses an EPUB picker, returns conversion details, and treats empty selection as cancellation', async t => {
    const { root, file } = await fixture(t);
    let handler;
    let selection = { canceled: true };
    const progress = [];
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: (_channel, data) => progress.push(data) });
    const controller = registerEpubEditorIpc({ ipcMain: { handle: (_channel, fn) => { handler = fn; } }, app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null }, dialog: { showOpenDialog: async (_window, options) => { assert.deepEqual(options.filters[0].extensions, ['epub']); assert.deepEqual(options.properties, ['openFile']); return selection; } } });
    t.after(() => controller.dispose());
    const request = { action: 'importEpub', operationId: 'ipc-import', language: 'en' };
    assert.deepEqual(await handler({ sender }, request), { ok: true, canceled: true });
    selection = { canceled: false, filePaths: [] };
    assert.deepEqual(await handler({ sender }, request), { ok: true, canceled: true });
    selection = { canceled: false, filePaths: [file] };
    const result = await handler({ sender }, request);
    assert.equal(result.ok, true);
    assert.equal(result.project.chapters.length, 2);
    assert.ok(Array.isArray(result.importWarnings));
    assert.equal(result.savedPath, null);
    assert.ok(progress.every(event => event.operationId === 'ipc-import'));
});
