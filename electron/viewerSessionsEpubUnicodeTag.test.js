import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import { ViewerSessionManager } from './viewerSessions.js';

async function createUnicodeTagEpub(epubPath, { body, css = '' }) {
    fs.writeFileSync(epubPath, Buffer.alloc(0));
    await replaceZipEntry(
        epubPath,
        'META-INF/container.xml',
        '<?xml version="1.0" encoding="utf-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>',
    );
    await replaceZipEntry(
        epubPath,
        'OEBPS/content.opf',
        `<?xml version="1.0" encoding="utf-8"?>
        <package>
            <metadata><dc:title>Unicode 태그 테스트</dc:title></metadata>
            <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /></manifest>
            <spine><itemref idref="chapter" /></spine>
        </package>`,
    );
    await replaceZipEntry(
        epubPath,
        'OEBPS/chapter.xhtml',
        `<html>
            <head><style>${css}</style></head>
            <body>${body}</body>
        </html>`,
    );
}

test('EPUB 파서는 Unicode custom tag를 안전한 span으로 보존하고 숨김 텍스트를 블록 본문에서 제외한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-unicode-tag-'));
    try {
        const epubPath = path.join(root, 'unicode-tag.epub');
        await createUnicodeTagEpub(epubPath, {
            body: '<p>앞<eeḕ class="decoy">가짜</eeḕ>뒤</p>',
            css: `
                eeḕ { font-weight: 400; padding-left: 1px; }
                .decoy { font-style: italic; margin-left: 2px; }
                unused, eeḕ.decoy { text-align: right; font-weight: 600; }
                .unrelated { padding-right: 99px; }
                .decoy { font-weight: 700; margin-left: 3px; }
                eeḕ { font-weight: 800; }
                eeḕ.decoy { font-size: 0%; }
            `,
        });

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath, { skipAdjacent: true });
        const result = await manager.getEpubText(session.id);
        const chapter = result.chapters[0];
        const block = chapter.blocks[0];
        const paragraph = block.nodes[0];
        const customWrapper = paragraph.children.find(node => node.className === 'decoy');

        assert.equal(chapter.text, '앞뒤');
        assert.equal(block.text, '앞뒤');
        assert.doesNotMatch(chapter.text, /eeḕ\s+class=|\/eeḕ>/u);
        assert.ok(customWrapper);
        assert.equal(customWrapper.tagName, 'span');
        assert.equal(customWrapper.style?.fontSize, '0%');
        assert.equal(customWrapper.style?.fontWeight, '800');
        assert.equal(customWrapper.style?.fontStyle, 'italic');
        assert.equal(customWrapper.style?.paddingLeft, '1px');
        assert.equal(customWrapper.style?.marginLeft, '3px');
        assert.equal(customWrapper.style?.textAlign, 'right');
        assert.equal(customWrapper.style?.paddingRight, undefined);
        assert.equal(customWrapper.children[0]?.text, '가짜');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 파서는 보이는 Unicode custom tag의 내용과 중첩 closing 구조를 유지한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-unicode-tag-nested-'));
    try {
        const epubPath = path.join(root, 'unicode-tag-nested.epub');
        await createUnicodeTagEpub(epubPath, {
            body: '<p>시작<eeḕ class="outer">보임<속태그>안쪽</속태그>끝</eeḕ>마침</p>',
        });

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath, { skipAdjacent: true });
        const result = await manager.getEpubText(session.id);
        const block = result.chapters[0].blocks[0];
        const paragraph = block.nodes[0];
        const outer = paragraph.children.find(node => node.className === 'outer');
        const inner = outer?.children.find(node => node.sourceTagName === '속태그');

        assert.equal(block.text, '시작보임안쪽끝마침');
        assert.equal(outer?.tagName, 'span');
        assert.equal(outer?.sourceTagName, 'eeḕ');
        assert.equal(inner?.tagName, 'span');
        assert.equal(inner?.children[0]?.text, '안쪽');
        assert.equal(outer?.children.at(-1)?.text, '끝');
        assert.equal(paragraph.children.at(-1)?.text, '마침');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 파서는 기존 ASCII unknown tag를 노드로 만들지 않고 내부 텍스트만 유지한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-ascii-unknown-tag-'));
    try {
        const epubPath = path.join(root, 'ascii-unknown-tag.epub');
        await createUnicodeTagEpub(epubPath, {
            body: '<p>앞<unknown class="legacy-unknown">내용</unknown>뒤</p>',
        });

        const manager = new ViewerSessionManager();
        const session = manager.create(epubPath, { skipAdjacent: true });
        const result = await manager.getEpubText(session.id);
        const block = result.chapters[0].blocks[0];
        const paragraph = block.nodes[0];

        assert.equal(block.text, '앞내용뒤');
        assert.doesNotMatch(block.text, /unknown|legacy-unknown/);
        assert.equal(paragraph.children.some(node => node.className === 'legacy-unknown'), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
