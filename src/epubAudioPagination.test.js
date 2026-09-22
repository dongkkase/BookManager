import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithEsbuild } from 'vite';
import { epubAudioBlockNodes, separateEpubAudioBlockImages, sliceEpubAudioBlock } from './epubAudioPagination.js';
import { mapEpubAudioTracks } from './epubAudioContext.js';

const source = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const constants = ['READER_MIXED_IMAGE_LINE_RATIO', 'READER_TITLE_ONLY_TAGS'].map(name => source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
const { paginateReaderChapter, readerMeasureBlocksFromPages, buildMeasuredReaderPages } = new Function('sliceEpubAudioBlock', 'epubAudioBlockNodes', 'separateEpubAudioBlockImages', `
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
${constants}
${between('function readerTextLength(', 'function elementFromDomNode(')}
${between('function isReaderTitleOnlyBlock(', 'function ToolbarButton(')}
return { paginateReaderChapter, readerMeasureBlocksFromPages, buildMeasuredReaderPages };
`)(sliceEpubAudioBlock, epubAudioBlockNodes, separateEpubAudioBlockImages);

const text = value => ({ type: 'text', text: value });
const element = (tagName, children = [], extra = {}) => ({ type: 'element', tagName, children, ...extra });
const audio = id => element('span', [], { id, audioTrackId: `inline:chapter.xhtml:${id}` });
const nodeText = node => node.type === 'text' ? node.text : (node.children || []).map(nodeText).join('');
const clean = value => String(value || '').replace(/\s/gu, '');
const flatNodes = nodes => nodes.flatMap(node => [node, ...flatNodes(node.children || [])]);
const controls = page => page.blocks.flatMap(block => flatNodes(block.nodes || [])).filter(node => node.audioTrackId);
const track = (id, anchor = id, kind = 'inline') => ({ id: `${kind}:chapter.xhtml:${id}`, anchor, kind, sources: [{ src: 'bookmanager-document://session/test/asset/sound.wav', type: 'audio/wav' }] });
const options = { charsPerLine: 20, linesPerPage: 8, paragraphLineCost: 0, widowLineTolerance: 0, wrapMode: 'char' };
const audioBlock = () => ({
    type: 'html', text: '가'.repeat(400), hasAudio: true,
    anchors: ['paragraph', 'middle', 'end'],
    audioTracks: ['inline:chapter.xhtml:middle', 'inline:chapter.xhtml:end'],
    nodes: [element('p', [element('strong', [text('가'.repeat(200))]), audio('middle'), text('가'.repeat(200)), audio('end')], { id: 'paragraph' })],
});

test('inline video blocks survive pagination and measured repacking without splitting into text', () => {
    const video = {
        type: 'html', hasVideo: true, text: 'Video title '.repeat(80), anchors: ['video'],
        nodes: [element('figure', [], { id: 'video', mediaUrl: 'https://youtu.be/jNQXAC9IVRw' })],
    };
    const chapter = { name: 'video.xhtml', blocks: [{ type: 'text', text: 'Before '.repeat(80) }, video, { type: 'text', text: 'After' }] };
    const pages = paginateReaderChapter(chapter, options);
    const videos = pages.flatMap(page => page.blocks).filter(block => block.hasVideo);
    assert.equal(videos.length, 1);
    assert.deepEqual(videos[0].nodes, video.nodes);
    assert.deepEqual(videos[0].anchors, ['video']);
    const measured = readerMeasureBlocksFromPages(pages);
    const repacked = buildMeasuredReaderPages(measured, measured.map((block, index) => ({ index, firstHeight: block.hasVideo ? 320 : 80, outerHeight: block.hasVideo ? 320 : 80 })), { pageContentHeight: 360 });
    assert.equal(repacked.flatMap(page => page.blocks).filter(block => block.hasVideo).length, 1);
});

test('inline controls in repeated text stay on their actual split pages across page sizes', () => {
    for (const [linesPerPage, expected] of [[8, [1, 2]], [12, [0, 1]], [20, [0, 0]]]) {
        const block = audioBlock();
        const original = structuredClone(block);
        const chapter = { name: 'chapter.xhtml', blocks: [block], audioTracks: [track('middle'), track('end')] };
        const pages = paginateReaderChapter(chapter, { ...options, linesPerPage });
        assert.deepEqual(chapter.audioTracks.map(item => pages.findIndex(page => controls(page).some(node => node.audioTrackId === item.id))), expected);
        assert.equal(pages.flatMap(controls).length, 2);
        assert.deepEqual(mapEpubAudioTracks([chapter], pages).tracks.map(item => item.pageIndex), expected);
        assert.equal(pages.filter(page => page.blocks.some(item => item.anchors?.includes('paragraph'))).length, 1);
        for (const page of pages) assert.equal(clean(page.blocks.flatMap(item => item.nodes || []).map(nodeText).join('')), clean(page.text));
        assert.equal(clean(pages.map(page => page.text).join('')), block.text);
        assert.deepEqual(block, original, 'Pagination must not mutate the parsed EPUB chapter');
    }
});

test('an inline control exactly at a split boundary occurs once before the next text fragment', () => {
    const block = { type: 'html', text: '앞'.repeat(160) + '뒤'.repeat(160), hasAudio: true, anchors: ['boundary'], nodes: [element('p', [text('앞'.repeat(160)), audio('boundary'), text('뒤'.repeat(160))])] };
    const pages = paginateReaderChapter({ name: 'chapter.xhtml', blocks: [block] }, options);
    assert.equal(controls(pages[0]).length, 0);
    assert.equal(controls(pages[1]).length, 1);
    assert.equal(pages[0].blocks[0].anchors.includes('boundary'), false);
    assert.deepEqual(pages[1].blocks[0].anchors, ['boundary']);
});

test('SMIL passage anchors survive on their starting fragment without leaking into earlier pages', () => {
    const block = {
        type: 'html', text: '앞'.repeat(200) + '낭독'.repeat(100) + '뒤'.repeat(200), hasAudio: true,
        anchors: ['passage'], audioTracks: ['overlay:chapter.xhtml:narration'],
        nodes: [element('p', [text('앞'.repeat(200)), element('span', [text('낭독'.repeat(100))], { id: 'passage' }), text('뒤'.repeat(200))])],
    };
    const chapter = { name: 'chapter.xhtml', blocks: [block], audioTracks: [track('narration', 'passage', 'overlay')] };
    const pages = paginateReaderChapter(chapter, options);
    assert.equal(pages.findIndex(page => page.blocks.some(item => item.anchors?.includes('passage'))), 1);
    assert.equal(pages.flatMap(page => page.blocks).filter(item => item.anchors?.includes('passage')).length, 1);
    assert.equal(mapEpubAudioTracks([chapter], pages).tracks[0].pageIndex, 1);
    assert.equal(clean(pages.flatMap(page => page.blocks.flatMap(item => item.nodes || [])).map(nodeText).join('')), block.text);
});

test('remaining-page splits and measured repacking keep each inline control with its fragment', () => {
    const block = audioBlock();
    const chapter = { name: 'chapter.xhtml', blocks: [{ type: 'text', text: '머리'.repeat(50) }, block], audioTracks: [track('middle'), track('end')] };
    const pages = paginateReaderChapter(chapter, options);
    assert.equal(pages[0].text.length, 162);
    assert.equal(pages.flatMap(controls).length, 2);
    const measuredBlocks = readerMeasureBlocksFromPages(pages);
    const repacked = buildMeasuredReaderPages(measuredBlocks, measuredBlocks.map((_, index) => ({ index, firstHeight: 60, outerHeight: 60 })), { pageContentHeight: 100 });
    const mapping = mapEpubAudioTracks([chapter], repacked);
    for (const item of mapping.tracks) {
        assert.equal(controls(repacked[item.pageIndex]).filter(node => node.audioTrackId === item.id).length, 1);
        assert.equal(repacked.filter(page => page.blocks.some(fragment => fragment.anchors?.includes(item.anchor))).length, 1);
    }
});

test('audio-only blocks keep metadata while ordinary text pagination remains unchanged', () => {
    const only = { type: 'html', text: '', hasAudio: true, audioTracks: ['inline:chapter.xhtml:only'], anchors: ['only'], nodes: [audio('only')] };
    const onlyPages = paginateReaderChapter({ name: 'chapter.xhtml', blocks: [only] }, options);
    assert.equal(onlyPages.length, 1);
    assert.equal(onlyPages[0].text, '');
    assert.equal(onlyPages[0].blocks[0].hasAudio, true);
    assert.deepEqual(onlyPages[0].blocks[0].audioTracks, only.audioTracks);
    assert.equal(controls(onlyPages[0]).length, 1);
    const normal = paginateReaderChapter({ name: 'plain.xhtml', blocks: [{ type: 'text', text: '가'.repeat(400) }] }, options);
    assert.deepEqual(normal.map(page => page.text.length), [160, 160, 80]);
    assert.ok(normal.every(page => page.blocks.every(block => !block.nodes && !block.hasAudio)));
});

test('image separation keeps inline controls with text and image anchors with the image', () => {
    const block = audioBlock();
    block.hasImage = true;
    block.anchors.push('illustration');
    block.nodes[0].children.unshift(element('img', [], { id: 'illustration', src: 'bookmanager-document://session/test/asset/image.png', style: { height: '300px' } }));
    const chapter = { name: 'chapter.xhtml', blocks: [block], audioTracks: [track('middle'), track('end')] };
    const pages = paginateReaderChapter(chapter, options);
    assert.equal(pages.flatMap(controls).length, 2);
    const imageBlocks = pages.flatMap(page => page.blocks).filter(item => item.hasImage);
    assert.equal(imageBlocks.length, 1);
    assert.deepEqual(imageBlocks[0].anchors, ['illustration']);
    assert.equal(flatNodes(imageBlocks[0].nodes).filter(node => node.audioTrackId).length, 0);
    const mapping = mapEpubAudioTracks([chapter], pages);
    for (const item of mapping.tracks) assert.equal(controls(pages[item.pageIndex]).filter(node => node.audioTrackId === item.id).length, 1);
    assert.equal(clean(pages.map(page => page.text).join('')), block.text);
});

test('flattened parent SMIL anchors become actual DOM markers on only their starting fragment', async () => {
    const block = audioBlock();
    block.anchors.push('outer-cue');
    const pages = paginateReaderChapter({ name: 'chapter.xhtml', blocks: [block] }, options);
    const renderer = await transformWithEsbuild(between('function renderEpubHtmlNode(', 'function isReaderTitleOnlyBlock('), 'epub-audio-renderer.jsx', { loader: 'jsx' });
    const renderNode = new Function('React', 'FaIcon', 'viewerText', 'renderMarkedText', 'viewerClassName', 'READER_ALLOWED_HTML_TAGS', `${renderer.code}\nreturn renderEpubHtmlNode;`)(React, () => null, (_key, fallback) => fallback, value => value, (...values) => values.filter(Boolean).join(' '), new Set(['p', 'span', 'strong', 'img']));
    const html = pages.map(page => renderToStaticMarkup(React.createElement(React.Fragment, null, page.blocks.flatMap(item => item.nodes || []).map((node, index) => renderNode(node, index)))));
    assert.equal(html.filter(value => value.includes('data-epub-anchor="outer-cue"')).length, 1);
    assert.ok(html[0].includes('data-epub-anchor="outer-cue"'));
    assert.equal(html.filter(value => value.includes('data-epub-audio-id="inline:chapter.xhtml:middle"')).length, 1);
    assert.ok(html[1].includes('data-epub-audio-id="inline:chapter.xhtml:middle"'));
    assert.ok(html[1].includes('data-epub-anchor="middle"'));
    assert.ok(html[2].includes('data-epub-audio-id="inline:chapter.xhtml:end"'));
    assert.ok(html[2].includes('data-epub-anchor="end"'));
});
