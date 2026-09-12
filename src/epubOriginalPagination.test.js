import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildOriginalEpubPages,
    captureEpubReadingPosition,
    resolveEpubReadingPosition,
} from './epubOriginalPagination.js';

test('measured chapters expose only each displayed page text and anchors', () => {
    const chapter = { name: 'chapter.xhtml', title: 'Chapter', text: 'first second third', blocks: [{ text: 'whole chapter' }] };
    const pages = buildOriginalEpubPages([chapter], {
        'chapter.xhtml': { pageCount: 3, textByPage: ['first', 'second', 'third'], anchors: { start: 0, middle: 1, end: 2 } },
    });
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.map(page => page.text), ['first', 'second', 'third']);
    assert.deepEqual(pages.map(page => page.anchors), [['start'], ['middle'], ['end']]);
    pages.forEach((page, index) => {
        assert.equal(page.originalChapter, chapter);
        assert.equal(page.originalPageOffset, index);
        assert.equal(page.chapterIndex, 0);
        assert.equal(page.title, 'Chapter');
        assert.equal(Object.hasOwn(page, 'blocks'), false);
    });
});

test('unmeasured chapters retain one placeholder alongside measured chapter pages', () => {
    const chapters = [
        { name: 'one', text: 'not measured', blocks: [{ anchors: ['chapter-start'] }] },
        { name: 'two', text: 'already measured' },
        { name: 'three', text: 'also pending' },
    ];
    const pages = buildOriginalEpubPages(chapters, new Map([
        ['two', { pageCount: 2, textByPage: ['already', 'measured'] }],
    ]));
    assert.deepEqual(pages.map(page => page.name), ['one', 'two', 'two', 'three']);
    assert.deepEqual(pages.map(page => page.chapterIndex), [0, 1, 1, 2]);
    assert.equal(pages[0].text, 'not measured');
    assert.deepEqual(pages[0].anchors, ['chapter-start']);
});

test('scroll builds one full-text page per chapter and includes all anchors', () => {
    const pages = buildOriginalEpubPages([
        { name: 'one', text: 'Complete first chapter', anchors: ['top'], blocks: [{ anchors: ['note', 'top'] }] },
        { name: 'two', blocks: [{ text: 'part one' }, { text: 'part two' }] },
    ], {
        one: { pageCount: 4, textByPage: ['unused'], anchors: { top: 0, bottom: 3 } },
    }, { scroll: true });
    assert.equal(pages.length, 2);
    assert.equal(pages[0].text, 'Complete first chapter');
    assert.deepEqual(pages[0].anchors, ['top', 'note', 'bottom']);
    assert.equal(pages[1].text, 'part one\n\npart two');
    assert.deepEqual(pages.map(page => page.originalPageOffset), [0, 0]);
});

test('missing page text stays empty instead of repeating the full chapter for TTS', () => {
    const [first, second] = buildOriginalEpubPages([{ name: 'one', text: 'Full chapter text' }], {
        one: { pageCount: 2, textByPage: ['First page'] },
    });
    assert.equal(first.text, 'First page');
    assert.equal(second.text, '');
});

test('empty chapters and invalid layout values produce stable placeholders', () => {
    assert.deepEqual(buildOriginalEpubPages(null, null), []);
    assert.deepEqual(buildOriginalEpubPages([], {}), []);
    const chapters = [{ name: 'one' }, { name: 'two', text: 'two' }, { name: 'three' }];
    const pages = buildOriginalEpubPages(chapters, {
        one: { pageCount: 0 }, two: { pageCount: Infinity }, three: { pageCount: 2.5 },
    });
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.map(page => page.text), ['', 'two', '']);
    assert.ok(pages.every(page => page.originalPageOffset === 0));
});

test('anchor offsets are bounded to their chapter and invalid offsets are ignored', () => {
    const pages = buildOriginalEpubPages([{ name: 'one' }], {
        one: { pageCount: 2, anchors: { before: -1, after: 4, decimal: 1.8, invalid: NaN } },
    });
    assert.deepEqual(pages.map(page => page.anchors), [['before'], ['after', 'decimal']]);
});

test('optimized to original conversion restores the same text in a differently paginated chapter', () => {
    const optimized = [
        { name: 'other', text: 'Other chapter' },
        { name: 'one', text: 'ABCDE' },
        { name: 'one', text: 'FGHIJ' },
        { name: 'one', text: 'KLMNO' },
    ];
    const position = captureEpubReadingPosition(optimized, 2);
    const original = buildOriginalEpubPages([{ name: 'one' }], {
        one: { pageCount: 2, textByPage: ['ABCDEF', 'GHIJKLMNO'] },
    });
    assert.equal(position.entryName, 'one');
    assert.equal(position.chapterProgress, 1 / 3);
    assert.equal(position.textQuote, 'FGHIJ');
    assert.equal(resolveEpubReadingPosition(original, position), 0);
});

test('chapter position remains stable when preceding chapters gain pages', () => {
    const before = [{ name: 'first', text: 'previous' }, { name: 'second', text: 'AB' }, { name: 'second', text: 'CD' }];
    const after = [
        { name: 'first', text: 'pre' }, { name: 'first', text: 'vi' }, { name: 'first', text: 'ous' },
        { name: 'second', text: 'A' }, { name: 'second', text: 'B' }, { name: 'second', text: 'C' }, { name: 'second', text: 'D' },
    ];
    assert.equal(resolveEpubReadingPosition(after, captureEpubReadingPosition(before, 2)), 5);
});

test('whitespace variations across page boundaries do not shift saved text', () => {
    const before = [{ name: 'one', text: 'A B\nC' }, { name: 'one', text: ' D E F ' }];
    const after = [{ name: 'one', text: 'AB' }, { name: 'one', text: 'CD' }, { name: 'one', text: 'EF' }];
    const position = captureEpubReadingPosition(before, 1);
    assert.equal(position.chapterProgress, 0.5);
    assert.equal(position.textQuote, 'DEF');
    assert.equal(resolveEpubReadingPosition(after, position), 1);
});

test('optimized block text and chapterIndex work without entry names', () => {
    const before = [
        { chapterIndex: 1, blocks: [{ text: 'AA' }, { text: 'BB' }] },
        { chapterIndex: 1, blocks: [{ nodes: [{ children: [{ text: 'CC' }] }] }] },
    ];
    const after = [
        { chapterIndex: 0, text: 'unrelated' },
        { chapterIndex: 1, text: 'AABB' },
        { chapterIndex: 1, text: 'CC' },
    ];
    const position = captureEpubReadingPosition(before, 1);
    assert.equal(position.chapterIndex, 1);
    assert.equal(position.chapterProgress, 4 / 6);
    assert.equal(resolveEpubReadingPosition(after, position), 2);
});

test('a matching quote restores the source text despite added heading text', () => {
    const before = [{ name: 'one', text: 'ABCD' }, { name: 'one', text: 'EFGH' }];
    const after = [{ name: 'one', text: 'A much longer inserted heading ABCD' }, { name: 'one', text: 'EFGH' }];
    const position = captureEpubReadingPosition(before, 1);
    assert.equal(resolveEpubReadingPosition(after, position), 1);
});

test('repeated quotes choose the occurrence nearest the saved chapter progress', () => {
    const pages = [{ name: 'one', text: 'same' }, { name: 'one', text: 'same' }, { name: 'one', text: 'same' }];
    assert.equal(resolveEpubReadingPosition(pages, captureEpubReadingPosition(pages, 2)), 2);
});

test('missing quotes fall back to the accumulated text ratio and exact page boundaries', () => {
    const pages = [{ name: 'one', text: '012' }, { name: 'one', text: '345' }, { name: 'one', text: '6789' }];
    assert.equal(resolveEpubReadingPosition(pages, { entryName: 'one', chapterProgress: 0.6, textQuote: 'missing' }), 2);
    assert.equal(resolveEpubReadingPosition(pages, { entryName: 'one', chapterProgress: 1 }), 2);
});

test('image-only chapters retain relative page position when resized', () => {
    const before = Array.from({ length: 3 }, () => ({ name: 'images', text: '' }));
    const after = Array.from({ length: 5 }, () => ({ name: 'images', text: '' }));
    const position = captureEpubReadingPosition(before, 1);
    assert.equal(position.chapterProgress, 0.5);
    assert.equal(Object.hasOwn(position, 'textQuote'), false);
    assert.equal(resolveEpubReadingPosition(after, position), 2);
});

test('empty input and missing chapters are safe and positions are clamped', () => {
    assert.equal(captureEpubReadingPosition([], 0), null);
    assert.equal(captureEpubReadingPosition(null, 0), null);
    assert.equal(resolveEpubReadingPosition([], null), 0);
    const pages = [{ name: 'one', text: 'AB' }, { name: 'one', text: 'CD' }];
    assert.equal(captureEpubReadingPosition(pages, -3).textQuote, 'AB');
    assert.equal(captureEpubReadingPosition(pages, 100).textQuote, 'CD');
    assert.equal(resolveEpubReadingPosition(pages, { entryName: 'missing' }), 0);
    assert.equal(resolveEpubReadingPosition(pages, { entryName: 'one', chapterProgress: -4 }), 0);
    assert.equal(resolveEpubReadingPosition(pages, { entryName: 'one', chapterProgress: 8 }), 1);
    assert.equal(resolveEpubReadingPosition(pages, { entryName: 'one', chapterProgress: NaN }), 0);
});

test('saved quotes are limited to 100 characters and do not mutate source data', () => {
    const page = Object.freeze({ name: 'one', text: 'A'.repeat(150) });
    const pages = Object.freeze([page]);
    const position = captureEpubReadingPosition(pages, 0);
    assert.equal(position.textQuote.length, 100);
    assert.equal(resolveEpubReadingPosition(pages, Object.freeze(position)), 0);
    assert.equal(page.text.length, 150);
});
