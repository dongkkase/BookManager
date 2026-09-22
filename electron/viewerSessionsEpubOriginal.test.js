import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import { ViewerSessionManager } from './viewerSessions.js';
import { buildWebApp } from './servers/webServer.js';
import { epubOriginalCssParts, rewriteEpubOriginalCssUrls, wrapEpubOriginalCssImport } from './epubOriginal.js';

async function createOriginalEpub(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-original-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const epubPath = path.join(root, 'original.epub');
    fs.writeFileSync(epubPath, Buffer.alloc(0));
    const html = `<html lang="ko"><head><meta name="viewport" content="width=768, height=1024" />
        <link rel="stylesheet" href="../styles/book.css" />
        <style>body { line-height: 1.8; background-image: url('../images/paper.png'); }</style></head>
        <body class="publisher"><section style="position:absolute;left:24px"><h1 id="title">출판사 서식</h1>
        <svg viewBox="0 0 100 100"><image href="../images/paper.png" /></svg><p>원본 본문</p></section></body></html>`;
    const entries = {
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>',
        'OEBPS/content.opf': `<package><metadata><dc:title>원본 테스트</dc:title><meta property="rendition:layout">pre-paginated</meta></metadata>
            <manifest><item id="one" href="text/one.xhtml" media-type="application/xhtml+xml" />
            <item id="two" href="text/two.xhtml" media-type="application/xhtml+xml" />
            <item id="art" href="text/art.xhtml" media-type="application/xhtml+xml" /></manifest>
            <spine><itemref idref="one" /><itemref idref="two" properties="rendition:layout-reflowable" /><itemref idref="art" /></spine></package>`,
        'OEBPS/text/one.xhtml': html,
        'OEBPS/text/two.xhtml': '<html><head></head><body><p>두 번째 장</p></body></html>',
        'OEBPS/text/art.xhtml': '<html><head><style>body { background: url("../images/paper.png"); }</style></head><body><svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg></body></html>',
        'OEBPS/styles/book.css': `@charset "utf-8";
            @import "nested/base.css" screen and (min-width: 600px);
            @import "https://example.invalid/external.css";
            body.publisher { color: #234567; background: url('../images/paper.png'); writing-mode: vertical-rl; }
            .layout { position: absolute; display: grid; transform: rotate(2deg); border: 2px solid red; }
            .remote { background: url(https://example.invalid/tracker.png); }
            .sprite { mask-image: url('../images/sprite.svg#mark'); }
            @media print { p { color: red !important; } }`,
        'OEBPS/styles/nested/base.css': `@import "../book.css";
            @font-face { font-family: "Publisher"; src: url('../../fonts/publisher.woff2'); }
            .paper { background-image: url('../../images/paper.png'); }
            .literal::before { content: "url(unmodified.png)"; }`,
        'OEBPS/images/paper.png': Buffer.from('paper'),
        'OEBPS/images/sprite.svg': '<svg xmlns="http://www.w3.org/2000/svg"><path id="mark" d="M0 0L10 10" /></svg>',
        'OEBPS/fonts/publisher.woff2': Buffer.from('font'),
        'OEBPS/secret.txt': 'not an image or font',
    };
    for (const [name, value] of Object.entries(entries)) await replaceZipEntry(epubPath, name, value);
    return { root, epubPath, html };
}

test('EPUB video embeds become inline media in optimized chapters including video-only pages', async t => {
    const { epubPath } = await createOriginalEpub(t);
    await replaceZipEntry(epubPath, 'OEBPS/text/two.xhtml', `<html><body>
        <iframe id="youtube" title="Video title" src="//www.youtube.com/embed/jNQXAC9IVRw?start=30"></iframe>
        <object id="vimeo" data="https://player.vimeo.com/video/123456789?h=a1b2c3d4e5"></object>
        <embed src="https://www.youtube-nocookie.com/embed/jNQXAC9IVRw" />
        <iframe src="https://www.youtube.com.evil.test/embed/jNQXAC9IVRw"></iframe>
        <iframe src="javascript:alert(1)"></iframe>
    </body></html>`);
    const manager = new ViewerSessionManager();
    const session = manager.create(epubPath, { skipAdjacent: true });
    const chapter = (await manager.getEpubText(session.id)).chapters.find(item => item.name.endsWith('/two.xhtml'));
    const links = nodes => nodes.flatMap(node => [node.mediaUrl, ...links(node.children || [])]).filter(Boolean);
    assert.deepEqual(chapter.blocks.flatMap(block => links(block.nodes || [])), [
        'https://www.youtube.com/watch?v=jNQXAC9IVRw&t=30',
        'https://vimeo.com/123456789/a1b2c3d4e5',
        'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    ]);
    assert.ok(chapter.blocks.some(block => block.anchors.includes('youtube')));
    assert.ok(chapter.blocks.every(block => block.hasVideo));
    assert.ok(!chapter.originalOnly);
});

test('원본 EPUB 자료는 DOM과 출판사 CSS를 보존하고 각 CSS 위치에서 자산 경로를 해결한다', async t => {
    const { epubPath, html } = await createOriginalEpub(t);
    const manager = new ViewerSessionManager();
    const session = manager.create(epubPath, { skipAdjacent: true });
    const result = await manager.getEpubText(session.id);
    const chapter = result.chapters[0];
    const original = chapter.original;
    assert.equal(original.html, html);
    assert.equal(original.layout, 'pre-paginated');
    assert.deepEqual(original.viewport, { width: 768, height: 1024 });
    assert.equal(result.chapters[1].original.layout, 'reflowable');
    assert.equal(result.chapters[1].original.viewport, null);
    assert.equal(result.chapters[2].originalOnly, true);
    assert.match(result.chapters[2].original.html, /<svg/);
    assert.match(original.stylesheet, /@media screen and \(min-width: 600px\)/);
    assert.match(original.stylesheet, /position: absolute; display: grid; transform: rotate\(2deg\); border: 2px solid red/);
    assert.match(original.stylesheet, /writing-mode: vertical-rl/);
    assert.match(original.stylesheet, /color: red !important/);
    assert.match(original.stylesheet, /\/asset\/OEBPS\/fonts\/publisher\.woff2/);
    assert.match(original.stylesheet, /\/asset\/OEBPS\/images\/paper\.png/);
    assert.match(original.stylesheet, /\/asset\/OEBPS\/images\/sprite\.svg#mark/);
    assert.match(original.stylesheet, /content: "url\(unmodified.png\)"/);
    assert.doesNotMatch(original.stylesheet, /@import|@charset|example\.invalid|line-height: 1.8/);
    assert.equal(original.resourceUrls['OEBPS/secret.txt'], undefined);
    assert.equal(original.resourceUrls['OEBPS/styles/book.css'], undefined);
    const image = await manager.getDocumentAssetFromRequest(original.resourceUrls['OEBPS/images/paper.png']);
    assert.equal(image.buffer.toString(), 'paper');
    assert.doesNotMatch(result.stylesheet, /writing-mode|position:|display: grid|color: #234567|background:/);
    assert.match(chapter.text, /출판사 서식/);
});

test('CSS 원본 경로 변환은 주석과 문자열을 유지하고 escaped URL 및 import 조건을 처리한다', () => {
    const css = String.raw`/* url(ignore.png) @import "ignore.css"; */
        @import url("theme.css") layer(book) supports(display: grid) screen;
        .label::before { content: 'url(ignore.png)'; background: url('paper\20 image.png'); filter: url(#mask); }`;
    const parts = epubOriginalCssParts(css);
    assert.equal(parts.filter(part => part.href).length, 1);
    assert.equal(parts[1].href, 'theme.css');
    assert.equal(parts[1].condition, 'layer(book) supports(display: grid) screen');
    assert.match(wrapEpubOriginalCssImport('p { color:red }', parts[1].condition), /@layer book \{\n@supports \(display: grid\) \{\n@media screen/);
    const seen = [];
    const rewritten = rewriteEpubOriginalCssUrls(parts[2].css, href => {
        seen.push(href);
        return 'bookmanager-document://session/test/asset/paper%20image.png';
    });
    assert.deepEqual(seen, ['paper image.png']);
    assert.match(rewritten, /content: 'url\(ignore.png\)'/);
    assert.match(rewritten, /url\("#mask"\)/);
});

test('최적화 EPUB은 문서 루트 크기를 자식 전체에 적용하지 않고 명시적인 전체 선택자를 유지한다', async t => {
    const { epubPath } = await createOriginalEpub(t);
    await replaceZipEntry(epubPath, 'OEBPS/styles/book.css', `
        html, body, html body, html > body { width: 600px; height: 800px; margin: 0; }
        * { box-sizing: border-box; }
        body p { margin-bottom: 12px; }
        html body > .kept { padding: 6px; }
    `);
    const manager = new ViewerSessionManager();
    const session = manager.create(epubPath, { skipAdjacent: true });
    const result = await manager.getEpubText(session.id);
    assert.doesNotMatch(result.stylesheet, /width: 600px|height: 800px/);
    assert.match(result.stylesheet, /\.viewer-reader-scope \* \{ box-sizing: border-box; \}/);
    assert.match(result.stylesheet, /\.viewer-reader-scope p \{ margin-bottom: 12px; \}/);
    assert.match(result.stylesheet, /\.viewer-reader-scope \.kept \{ padding: 6px; \}/);
    assert.match(result.chapters[0].original.stylesheet, /html, body, html body, html > body \{ width: 600px; height: 800px; margin: 0; \}/);
});

test('웹 EPUB API는 원본 stylesheet와 자산 맵의 URL을 변환하고 SVG fragment를 유지한다', async t => {
    const { root, epubPath } = await createOriginalEpub(t);
    const app = buildWebApp({ dup_check_folders: [root] });
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    try {
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const sessionResponse = await fetch(`${baseUrl}/api/viewer/session?file=${encodeURIComponent(epubPath)}`);
        assert.equal(sessionResponse.status, 200);
        const session = await sessionResponse.json();
        const response = await fetch(`${baseUrl}/api/viewer/epub/${session.id}`);
        assert.equal(response.status, 200);
        const result = await response.json();
        const original = result.chapters[0].original;
        assert.doesNotMatch(original.stylesheet, /bookmanager-document:/);
        assert.match(original.stylesheet, /asset=OEBPS%2Fimages%2Fsprite\.svg#mark/);
        const imageUrl = original.resourceUrls['OEBPS/images/paper.png'];
        assert.match(imageUrl, /^\/api\/viewer\/epub-asset\//);
        const imageResponse = await fetch(`${baseUrl}${imageUrl}`);
        assert.equal(imageResponse.status, 200);
        assert.equal(await imageResponse.text(), 'paper');
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
