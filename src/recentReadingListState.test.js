import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultRecentListOptions, filterRecentListFiles, sortRecentListFiles } from './recentReadingListState.js';

const now = Date.parse('2026-10-06T12:00:00.000Z');
const daysAgo = days => new Date(now - days * 86400000).toISOString();
const files = [
    { name: 'B.epub', ext: '.EPUB', lastReadAt: daysAgo(20), readingListAddedAt: daysAgo(1), viewerStatus: { hasReadingProgress: true, percent: 25 } },
    { name: 'C.pdf', ext: '.pdf', lastReadAt: daysAgo(1), readingListAddedAt: daysAgo(14), viewerStatus: { hasReadingProgress: true, isCompleted: true, percent: 100 } },
    { name: 'A.epub', lastReadAt: daysAgo(7), readingListAddedAt: daysAgo(14.001), viewerStatus: {} },
];

test('기간 필터는 목록의 기준 날짜와 14일 경계를 사용하며 최근 읽음은 전체 기간이 기본이다', () => {
    const select = (kind, options = {}) => filterRecentListFiles(files, kind, { ...defaultRecentListOptions(kind), ...options }, now);
    assert.deepEqual(select('recent-reading'), files);
    assert.deepEqual(select('recent-reading', { days: 7 }), [files[1], files[2]]);
    assert.deepEqual(select('recent-added'), [files[0], files[1]]);
    assert.deepEqual(select('recent-updated', { days: 3 }), [files[0]]);
    assert.deepEqual(filterRecentListFiles([{ readingListAddedAt: 'invalid' }], 'recent-added', defaultRecentListOptions('recent-added'), now), []);
});

test('확장자와 읽기 상태를 기간 조건과 함께 필터링한다', () => {
    const select = options => filterRecentListFiles(files, 'recent-reading', { ...defaultRecentListOptions('recent-reading'), ...options }, now);
    assert.deepEqual(select({ extension: '.epub' }), [files[0], files[2]]);
    assert.deepEqual(select({ extension: '.epub', status: 'reading' }), [files[0]]);
    assert.deepEqual(select({ status: 'completed', days: 7 }), [files[1]]);
    assert.deepEqual(select({ status: 'unread' }), [files[2]]);
    assert.deepEqual(select({ status: 'completed', extension: '.epub' }), []);
});

test('기준 날짜, 파일명, 진행률을 양방향으로 정렬하며 원본 순서는 보존한다', () => {
    assert.deepEqual(sortRecentListFiles(files, defaultRecentListOptions('recent-reading')), [files[1], files[2], files[0]]);
    assert.deepEqual(sortRecentListFiles(files, defaultRecentListOptions('recent-added')), files);
    assert.deepEqual(sortRecentListFiles(files, { sortKey: 'name', sortOrder: 'asc' }), [files[2], files[0], files[1]]);
    assert.deepEqual(sortRecentListFiles(files, { sortKey: 'progress', sortOrder: 'desc' }), [files[1], files[0], files[2]]);
    assert.deepEqual(sortRecentListFiles(files, { sortKey: 'progress', sortOrder: 'asc' }), [files[2], files[0], files[1]]);
    assert.deepEqual(files.map(file => file.name), ['B.epub', 'C.pdf', 'A.epub']);
});
