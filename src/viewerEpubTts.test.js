import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { collectEpubTtsEdits, epubTtsText, sliceEpubTtsEdits } from '../electron/epubTts.js';
import { epubAudioBlockNodes, separateEpubAudioBlockImages, sliceEpubAudioBlock } from './epubAudioPagination.js';
import { buildOriginalEpubPages } from './epubOriginalPagination.js';

const text = value => ({ type: 'text', text: value });
const span = (mode, id, replacement, children) => ({ type: 'element', tagName: 'span', attributes: { 'data-bm-tts': mode, 'data-bm-tts-id': id, 'data-bm-tts-text': replacement }, children });
const source = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const constants = ['READER_MIXED_IMAGE_LINE_RATIO', 'READER_TITLE_ONLY_TAGS'].map(name => source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
const { paginateReaderChapter, buildMeasuredReaderPages, readerMeasureBlocksFromPages } = new Function('sliceEpubTtsEdits', 'sliceEpubAudioBlock', 'epubAudioBlockNodes', 'separateEpubAudioBlockImages', `
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
${constants}
${between('function readerTextLength(', 'function elementFromDomNode(')}
${between('function isReaderTitleOnlyBlock(', 'function ToolbarButton(')}
return { paginateReaderChapter, buildMeasuredReaderPages, readerMeasureBlocksFromPages };
`)(sliceEpubTtsEdits, sliceEpubAudioBlock, epubAudioBlockNodes, separateEpubAudioBlockImages);

test('낭독 속성은 서식이 쪼개져도 한 번 치환하고 괄호와 기호를 보존한다', () => {
    const nodes = [text('앞 (설명 '), span('read', 'keep', '', [text('C++')]), text(') '),
        span('replace', 'cpu', '(씨)', [text('C')]), span('replace', 'cpu', '(씨)', [{ tagName: 'strong', children: [text('PU')] }]),
        text(' '), span('skip', 'skip', '', [text('생략')]), text(' 끝')];
    const original = '앞 (설명 C++) CPU 생략 끝';
    const edits = collectEpubTtsEdits(nodes);
    assert.equal(edits.length, 3);
    assert.equal(epubTtsText(original, edits), '앞 C++ (씨) 끝');
    assert.equal(original, '앞 (설명 C++) CPU 생략 끝');
});

test('여러 페이지에 걸친 치환은 시작 페이지에서 한 번 읽고 원문 페이지 길이는 유지한다', () => {
    const original = '앞'.repeat(140) + '원'.repeat(240) + '뒤'.repeat(160);
    const block = { type: 'html', text: original, ttsEdits: [{ start: 140, end: 380, mode: 'replace', id: 'long', text: '(씨++)' }] };
    const chapter = { name: 'chapter.xhtml', blocks: [block] };
    const unchanged = structuredClone(chapter);
    for (const linesPerPage of [8, 12, 20]) {
        const pages = paginateReaderChapter(chapter, { charsPerLine: 20, linesPerPage, paragraphLineCost: 0, widowLineTolerance: 0, wrapMode: 'char' });
        const spoken = pages.flatMap(page => page.blocks).map(part => epubTtsText(part.text, part.ttsEdits)).join('');
        assert.equal(pages.map(page => page.text).join(''), original);
        assert.equal(spoken, '앞'.repeat(140) + '(씨++)' + '뒤'.repeat(160));
        const measured = readerMeasureBlocksFromPages(pages);
        const repacked = buildMeasuredReaderPages(measured, measured.map((part, index) => ({ index, firstHeight: 100, outerHeight: 100 })), { pageContentHeight: 220 });
        assert.equal(repacked.flatMap(page => page.blocks).map(part => epubTtsText(part.text, part.ttsEdits)).join(''), spoken);
    }
    assert.deepEqual(chapter, unchanged);
});

test('남은 페이지 분할에서도 생략·원문 낭독 offset을 공백과 독립적으로 유지한다', () => {
    const block = { type: 'html', text: '가 '.repeat(300), ttsEdits: [{ start: 100, end: 220, mode: 'skip', id: 'skip' }] };
    const pages = paginateReaderChapter({ blocks: [{ type: 'text', text: '머'.repeat(75) }, block] }, { charsPerLine: 20, linesPerPage: 8, paragraphLineCost: 0, widowLineTolerance: 0, wrapMode: 'char' });
    const spoken = pages.flatMap(page => page.blocks).map(part => epubTtsText(part.text, part.ttsEdits)).join('').replace(/\s/g, '');
    assert.equal(spoken, '머'.repeat(75) + '가'.repeat(180));
});

test('원본 페이지 낭독은 측정된 낭독만 쓰고 스크롤은 장 전체 주석을 유지한다', () => {
    const chapter = { name: 'one', text: 'CPU skip', blocks: [{ text: 'CPU skip', ttsEdits: [{ start: 0, end: 3, mode: 'replace', text: '씨피유' }, { start: 3, end: 7, mode: 'skip' }] }] };
    const layouts = { one: { pageCount: 2, textByPage: ['CPU', 'skip'], ttsByPage: ['씨피유', ''] } };
    const pages = buildOriginalEpubPages([chapter], layouts);
    assert.deepEqual(pages.map(page => page.ttsText), ['씨피유', '']);
    assert.deepEqual(pages.map(page => page.text), ['CPU', 'skip']);
    const [scroll] = buildOriginalEpubPages([chapter], layouts, { scroll: true });
    assert.equal(scroll.ttsText, undefined);
    assert.equal(epubTtsText(scroll.blocks[0].text, scroll.blocks[0].ttsEdits), '씨피유');
});
