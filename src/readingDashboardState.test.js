import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardAddedTimestamp, selectDashboardRecent, summarizeDashboardCatalog } from './readingDashboardState.js';

test('dashboard catalog counts usable unique books and keeps only the latest bounded selection', () => {
    const books = [
        { path: '/older.epub', readingListAddedAt: '2026-09-01' },
        { path: '/newer.epub', readingListAddedAt: '2026-10-20' },
        { path: '/middle.epub', readingListAddedAt: 'invalid', created: '2026-10-01' },
        { path: '/unknown.epub', created: 'invalid' },
        { full_path: '/newer.epub', readingListAddedAt: '2026-10-20' },
        { path: '/folder', isDirectory: true },
        { path: '/missing.epub', exists: false },
        {}, null,
    ];
    const original = [...books];
    const summary = summarizeDashboardCatalog(books, 2);
    assert.equal(summary.bookCount, 4);
    assert.deepEqual(summary.latest.map(file => file.path), ['/newer.epub', '/middle.epub']);
    assert.deepEqual(books, original);
    assert.deepEqual(summarizeDashboardCatalog(books, 0), { bookCount: 4, latest: [] });
    assert.deepEqual(summarizeDashboardCatalog(null), { bookCount: 0, latest: [] });
    assert.equal(dashboardAddedTimestamp({ readingListAddedAt: 'bad', created: 'bad', mtime: 12345 }), 12345);
    assert.equal(dashboardAddedTimestamp({ readingListAddedAt: Number.MAX_VALUE }), 0);
});

test('latest selection keeps input order for equal dates and honors date fallbacks before limiting', () => {
    const books = [
        { path: '/unknown.epub', readingListAddedAt: 'invalid', created: -1, mtime: 0 },
        { path: '/first.epub', readingListAddedAt: '2026-10-20' },
        { path: '/fallback.epub', readingListAddedAt: 'invalid', created: '2026-10-20' },
        { path: '/modified.epub', readingListAddedAt: Number.MAX_VALUE, created: 'invalid', mtime: Date.parse('2026-10-20') },
        { path: '/last.epub', readingListAddedAt: '2026-10-20' },
        { path: '/newest.epub', readingListAddedAt: '2026-10-21' },
        { path: '/first.epub', readingListAddedAt: '2026-10-30' },
    ];
    const summary = summarizeDashboardCatalog(books, 4);
    assert.equal(summary.bookCount, 6);
    assert.deepEqual(summary.latest, [books[5], books[1], books[2], books[3]]);
    assert.deepEqual(summarizeDashboardCatalog(books, 7).latest, [books[5], books[1], books[2], books[3], books[4], books[0]]);
});

test('continue reading prefers unfinished books before the most recently completed books', () => {
    const recent = [
        { path: '/finished.epub', lastReadAt: '2026-10-25', viewerStatus: { isCompleted: true } },
        { path: '/older.epub', lastReadAt: '2026-10-20' },
        { path: '/newer.epub', lastReadAt: '2026-10-23', viewerStatus: { hasReadingProgress: true } },
        { path: '/older.epub', lastReadAt: '2026-10-20' },
        { path: '/missing.epub', lastReadAt: '2026-10-26', exists: false },
        { path: '/folder', is_folder: true },
        null,
    ];
    assert.deepEqual(selectDashboardRecent(recent).map(file => file.path), ['/newer.epub', '/older.epub', '/finished.epub']);
    assert.deepEqual(selectDashboardRecent(recent, 1).map(file => file.path), ['/newer.epub']);
    assert.deepEqual(selectDashboardRecent(null), []);
});
