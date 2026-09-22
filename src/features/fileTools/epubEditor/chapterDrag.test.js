import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterDropTarget, reorderChapters, chapterDragScroll } from './chapterDrag.js';

const chapters = ['a', 'b', 'c', 'd'].map(id => ({ id, content: { text: id } }));
const rows = chapters.map((chapter, index) => ({ id: chapter.id, top: 100 + index * 62, bottom: 158 + index * 62 }));
const ids = items => items.map(item => item.id);

test('the top and bottom halves show the exact boundary used when moving down', () => {
    const before = chapterDropTarget(rows, 'a', rows[2].top + 10);
    const after = chapterDropTarget(rows, 'a', rows[2].bottom - 10);
    assert.deepEqual(before, { id: 'c', edge: 'before' });
    assert.deepEqual(after, { id: 'd', edge: 'before' });
    assert.deepEqual(ids(reorderChapters(chapters, 'a', before)), ['b', 'a', 'c', 'd']);
    assert.deepEqual(ids(reorderChapters(chapters, 'a', after)), ['b', 'c', 'a', 'd']);
});

test('moving up, between row gaps, to the start and after the last chapter preserves document objects', () => {
    assert.deepEqual(ids(reorderChapters(chapters, 'd', chapterDropTarget(rows, 'd', rows[0].top))), ['d', 'a', 'b', 'c']);
    assert.deepEqual(ids(reorderChapters(chapters, 'd', chapterDropTarget(rows, 'd', rows[1].bottom))), ['a', 'b', 'd', 'c']);
    assert.deepEqual(chapterDropTarget(rows, 'a', rows[1].bottom + 2), { id: 'c', edge: 'before' });
    const target = chapterDropTarget(rows, 'a', rows.at(-1).bottom + 20);
    assert.deepEqual(target, { id: 'd', edge: 'after' });
    const moved = reorderChapters(chapters, 'a', target);
    assert.deepEqual(ids(moved), ['b', 'c', 'd', 'a']);
    assert.equal(moved.at(-1), chapters[0]);
    assert.deepEqual(ids(chapters), ['a', 'b', 'c', 'd']);
});

test('dropping at the original position, invalid targets and foreign drags cause no reorder or history entry', () => {
    for (const y of [rows[1].top - 2, rows[1].top + 10, rows[1].bottom - 10, rows[1].bottom + 2]) assert.equal(chapterDropTarget(rows, 'b', y), null);
    assert.equal(chapterDropTarget(rows, 'missing', 100), null);
    assert.equal(chapterDropTarget([], 'a', 100), null);
    assert.equal(chapterDropTarget(rows, 'a', NaN), null);
    for (const target of [null, { id: 'b', edge: 'before' }, { id: 'a', edge: 'after' }, { id: 'missing', edge: 'before' }, { id: 'd', edge: 'invalid' }]) assert.equal(reorderChapters(chapters, 'a', target), chapters);
    assert.equal(reorderChapters(chapters, 'missing', { id: 'd', edge: 'after' }), chapters);
});

test('the indicator follows the rows after scrolling and works with a single chapter', () => {
    const scrolled = rows.map(row => ({ ...row, top: row.top - 100, bottom: row.bottom - 100 }));
    assert.deepEqual(chapterDropTarget(rows, 'a', 200), { id: 'c', edge: 'before' });
    assert.deepEqual(chapterDropTarget(scrolled, 'a', 200), { id: 'd', edge: 'before' });
    for (const y of [90, 110, 140, 170]) assert.equal(chapterDropTarget(rows.slice(0, 1), 'a', y), null);
});

test('edge scrolling is gradual and stops in the middle or outside the list', () => {
    assert.equal(chapterDragScroll(100, 100, 400), -14);
    assert.equal(chapterDragScroll(400, 100, 400), 14);
    assert.ok(chapterDragScroll(120, 100, 400) > chapterDragScroll(110, 100, 400));
    for (const y of [0, 99, 140, 250, 360, 401]) assert.equal(chapterDragScroll(y, 100, 400), 0);
    assert.equal(chapterDragScroll(110, 120, 100), 0);
});
