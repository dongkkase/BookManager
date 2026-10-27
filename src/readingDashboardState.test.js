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
