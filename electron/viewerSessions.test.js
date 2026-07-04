import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ViewerSessionManager } from './viewerSessions.js';
import { replaceZipEntry } from './core/zipArchive.js';

test('뷰어 세션은 같은 폴더의 이전권/다음권 가능 여부를 계산한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-adjacent-'));
    try {
        const firstPath = path.join(root, '01.pdf');
        const secondPath = path.join(root, '02.pdf');
        const thirdPath = path.join(root, '03.pdf');
        const ignoredPath = path.join(root, 'cover.jpg');
        fs.writeFileSync(firstPath, '');
        fs.writeFileSync(secondPath, '');
        fs.writeFileSync(thirdPath, '');
        fs.writeFileSync(ignoredPath, '');

        const manager = new ViewerSessionManager();
        const first = manager.create(firstPath);
        assert.deepEqual(first.adjacent, { hasPrevious: false, hasNext: true });
        assert.throws(() => manager.createAdjacent(first.id, -1), /No adjacent book\./);

        const second = manager.createAdjacent(first.id, 1);
        assert.equal(second.filePath, path.resolve(secondPath));
        assert.deepEqual(second.adjacent, { hasPrevious: true, hasNext: true });
        assert.equal(
            manager.resolveDocumentRequest(`bookmanager-document://session/${encodeURIComponent(first.id)}/01.pdf`).filePath,
            path.resolve(firstPath),
        );

        const third = manager.createAdjacent(second.id, 1);
        assert.equal(third.filePath, path.resolve(thirdPath));
        assert.deepEqual(third.adjacent, { hasPrevious: true, hasNext: false });
        assert.throws(() => manager.createAdjacent(third.id, 1), /No adjacent book\./);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 뷰어 세션은 목차 제목과 내부 이미지를 읽기 페이지 데이터로 변환한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-epub-'));
    try {
        const epubPath = path.join(root, 'Sample.epub');
        fs.writeFileSync(epubPath, Buffer.alloc(0));
        await replaceZipEntry(
            epubPath,
            'META-INF/container.xml',
            `<?xml version="1.0"?>
            <container>
                <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" />
                </rootfiles>
            </container>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/content.opf',
            `<package>
                <metadata><meta name="cover" content="cover-image" /></metadata>
                <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
                    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image" />
                    <item id="style" href="styles/book.css" media-type="text/css" />
                    <item id="base-style" href="styles/base.css" media-type="text/css" />
                    <item id="cover-wrapper" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg" />
                    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml" />
                    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml" />
                    <item id="img1" href="images/illus.png" media-type="image/png" />
                </manifest>
                <spine>
                    <itemref idref="cover-wrapper" />
                    <itemref idref="chap1" />
                    <itemref idref="chap2" />
                </spine>
            </package>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/cover.xhtml',
            `<html>
                <head><title>표지</title></head>
                <body>
                    <div class="cover-wrap">
                        <svg viewBox="0 0 600 900" width="100%" height="100%">
                            <image width="600" height="900" xlink:href="images/cover.png" />
                        </svg>
                    </div>
                </body>
            </html>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/nav.xhtml',
            `<nav><ol>
                <li><a href="chap1.xhtml">프롤로그</a></li>
                <li><a href="chap2.xhtml">삽화 장면</a></li>
            </ol></nav>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/chap1.xhtml',
            `<html>
                <head>
                    <link rel="stylesheet" href="styles/book.css" />
                    <style>
                        .inline-note { text-align: right; color: #445566; font: 18px serif; background-image: url("https://example.invalid/bad.png"); }
                    </style>
                </head>
                <body>
                    <div class="img_center" style="width: 8%; margin: 0 auto;">
                        <img class="logo-mark" src="images/logo.png" alt="문장" />
                    </div>
                    <h1>Section0001.xhtml</h1>
                    <p>&nbsp;</p>
                    <p>&#160;</p>
                    <p class="lead"><strong>본문입니다.</strong></p>
                    <p class="line-breaks">첫 줄<br/>둘째 줄<br />셋째 줄</p>
                    <p class="normal">보통입니다.</p>
                    <p class="inline-note" style="letter-spacing: 2px; white-space: pre-wrap; writing-mode: vertical-rl; background-image: url(javascript:alert(1));"><span>인라인입니다.</span></p>
                    <figure class="image-frame" style="display: block; width: 80%; text-align: center;">
                        <img class="illustration" src="images/illus.png" alt="삽화1" />
                    </figure>
                </body>
            </html>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/chap2.xhtml',
            `<html><body><p>다음 장입니다.</p></body></html>`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/styles/book.css',
            `@charset "utf-8";
            @import "base.css";
            .lead { color: #123456; text-align: center; margin-bottom: 12px; font-size: 21px; line-height: 2; padding: 14px; background-color: #ffffff; word-break: break-all; background-image: url("https://example.invalid/skip.png"); }
            .normal { font-size: 100%; }
            .img_center { text-align: center; margin: 0em 1em; padding: 4px; }
            .image-frame { max-width: 360px; margin-left: auto; margin-right: auto; overflow-wrap: anywhere; }
            img.illustration { margin-top: 8px; width: 50%; }`,
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/styles/base.css',
            `h1 { text-align: center; margin: 0 0 18px; padding: 6px; }`,
        );
        await replaceZipEntry(epubPath, 'OEBPS/images/cover.png', Buffer.from('cover'));
        await replaceZipEntry(epubPath, 'OEBPS/images/logo.png', Buffer.from('logo'));
        await replaceZipEntry(epubPath, 'OEBPS/images/illus.png', Buffer.from('illus'));

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath);
        const result = await manager.getEpubText(session.id);

        assert.equal(result.chapters[0].name, 'OEBPS/cover.xhtml');
        assert.equal(result.chapters[0].title, '표지');
        assert.equal(result.chapters[0].blocks[0].type, 'html');
        assert.equal(result.chapters[0].blocks[0].hasImage, true);
        const coverImageNode = result.chapters[0].blocks[0].nodes[0].children.find(node => node.tagName === 'img');
        assert.match(coverImageNode.src, /^bookmanager-document:\/\/session\//);
        assert.match(coverImageNode.src, /\/asset\/OEBPS\/images\/cover\.png$/);
        assert.equal(coverImageNode.name, 'OEBPS/images/cover.png');
        const coverAsset = await manager.getDocumentAssetFromRequest(coverImageNode.src);
        assert.equal(coverAsset.mime, 'image/png');
        assert.equal(coverAsset.buffer.toString(), 'cover');
        assert.equal(result.chapters[1].title, '프롤로그');
        assert.equal(result.chapters[1].blocks.some(block => block.hasImage), true);
        assert.match(result.stylesheet, /\.viewer-reader-scope h1 \{ text-align: center; margin: 0 0 18px; padding: 6px; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.lead \{ text-align: center; margin-bottom: 12px; font-size: 21px; padding: 14px; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.inline-note \{ text-align: right; font: 18px serif; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.normal \{ font-size: 100%; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.img_center \{ text-align: center; margin: 0em 1em; padding: 4px; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope \.image-frame \{ max-width: 360px; margin-left: auto; margin-right: auto; \}/);
        assert.match(result.stylesheet, /\.viewer-reader-scope img\.illustration \{ margin-top: 8px; width: 50%; \}/);
        assert.doesNotMatch(result.stylesheet, /--viewer-epub-font-scale/);
        assert.doesNotMatch(result.stylesheet, /example\.invalid|javascript:/);
        const leadBlock = result.chapters[1].blocks.find(block => block.text === '본문입니다.');
        assert.deepEqual(leadBlock.style, {
            textAlign: 'center',
            marginBottom: '12px',
            fontSize: '21px',
            padding: '14px',
        });
        assert.equal(leadBlock.className, 'lead');
        assert.equal(leadBlock.nodes[0].tagName, 'p');
        assert.equal(leadBlock.nodes[0].className, 'lead');
        assert.deepEqual(leadBlock.nodes[0].style, {
            textAlign: 'center',
            marginBottom: '12px',
            fontSize: '21px',
            padding: '14px',
        });
        assert.equal(leadBlock.nodes[0].children[0].tagName, 'strong');
        const lineBreakBlock = result.chapters[1].blocks.find(block => block.className === 'line-breaks');
        assert.equal(lineBreakBlock.text, '첫 줄\n둘째 줄\n셋째 줄');
        assert.doesNotMatch(lineBreakBlock.text, /br\/>/);
        assert.equal(lineBreakBlock.nodes[0].children.filter(node => node.tagName === 'br').length, 2);
        const normalBlock = result.chapters[1].blocks.find(block => block.text === '보통입니다.');
        assert.equal(normalBlock.className, 'normal');
        assert.deepEqual(normalBlock.style, { fontSize: '100%' });
        assert.deepEqual(normalBlock.nodes[0].style, { fontSize: '100%' });
        const inlineBlock = result.chapters[1].blocks.find(block => block.text === '인라인입니다.');
        assert.deepEqual(inlineBlock.style, {
            textAlign: 'right',
            font: '18px serif',
        });
        assert.equal(inlineBlock.className, 'inline-note');
        assert.deepEqual(inlineBlock.nodes[0].style, {
            textAlign: 'right',
            font: '18px serif',
        });
        assert.equal(inlineBlock.nodes[0].className, 'inline-note');
        assert.equal(inlineBlock.nodes[0].children[0].tagName, 'span');
        const logoBlock = result.chapters[1].blocks.find(block => block.className === 'img_center');
        const logoNode = logoBlock.nodes[0];
        const logoImageNode = logoNode.children.find(node => node.tagName === 'img');
        assert.equal(logoNode.className, 'img_center');
        assert.equal(logoImageNode.className, 'logo-mark');
        assert.equal(logoNode.style.textAlign, 'center');
        assert.equal(logoNode.style.margin, '0 auto');
        assert.equal(logoNode.style.padding, '4px');
        assert.equal(logoNode.style.width, '8%');

        const headingBlock = result.chapters[1].blocks.find(block => block.tagName === 'h1');
        assert.equal(headingBlock.nodes[0].tagName, 'h1');
        assert.equal(headingBlock.nodes[0].style.textAlign, 'center');
        assert.equal(headingBlock.nodes[0].style.margin, '0 0 18px');
        assert.equal(headingBlock.nodes[0].style.padding, '6px');
        const blankBlocks = result.chapters[1].blocks.filter(block => (
            block.tagName === 'p'
            && block.text === '\u00a0'
            && block.nodes?.[0]?.children?.[0]?.text === '\u00a0'
        ));
        assert.equal(blankBlocks.length, 2);

        const imageBlock = result.chapters[1].blocks.find(block => block.className === 'image-frame');
        const figureNode = imageBlock.nodes[0];
        const imageNode = figureNode.children.find(node => node.tagName === 'img');
        assert.equal(imageBlock.text, '');
        assert.equal(figureNode.tagName, 'figure');
        assert.equal(figureNode.className, 'image-frame');
        assert.equal(imageNode.className, 'illustration');
        assert.equal(figureNode.style.display, 'block');
        assert.equal(figureNode.style.width, '80%');
        assert.equal(figureNode.style.textAlign, 'center');
        assert.equal(figureNode.style.maxWidth, '360px');
        assert.equal(figureNode.style.marginLeft, 'auto');
        assert.equal(figureNode.style.marginRight, 'auto');
        assert.equal(imageNode.style.marginTop, '8px');
        assert.equal(imageNode.style.width, '50%');
        assert.equal(result.chapters[2].title, '삽화 장면');

        const asset = await manager.getDocumentAssetFromRequest(imageNode.src);
        assert.equal(asset.mime, 'image/png');
        assert.equal(asset.buffer.toString(), 'illus');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
