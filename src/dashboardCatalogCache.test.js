import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardCatalogSummary, dashboardRecommendationIndex, dashboardRecommendationOptions } from './dashboardCatalogCache.js';

test('dashboard revisits reuse derived catalog values and new snapshots refresh metadata', () => {
    const files = [{ path: '/books/a.epub', title: 'A', genre: 'Fantasy', readingListAddedAt: '2026-10-01' }];
    const summary = dashboardCatalogSummary(files, 4);
    const candidates = dashboardRecommendationIndex(files, 'MacIntel', {});
    const options = dashboardRecommendationOptions(files);
    assert.equal(dashboardCatalogSummary(files, 4), summary);
    assert.equal(dashboardRecommendationIndex(files, 'MacIntel', { formats: [] }), candidates);
    assert.equal(dashboardRecommendationOptions(files), options);

    const refreshed = [{ ...files[0], title: 'Updated', genre: 'History' }];
    const nextSummary = dashboardCatalogSummary(refreshed, 4);
    const nextCandidates = dashboardRecommendationIndex(refreshed, 'MacIntel', {});
    const nextOptions = dashboardRecommendationOptions(refreshed);
    assert.notEqual(nextSummary, summary);
    assert.equal(nextSummary.latest[0].title, 'Updated');
    assert.notEqual(nextCandidates, candidates);
    assert.equal(nextCandidates.get('/books/a.epub').file.title, 'Updated');
    assert.notEqual(nextOptions, options);
    assert.equal(nextOptions.genres[0].title, 'History');
});

test('recommendation cache distinguishes preference and platform keys and retains only the latest index', () => {
    const files = [{ path: '/Books/A.epub', genre: 'Fantasy' }, { path: '/Books/B.pdf', genre: 'History' }];
    const unfiltered = dashboardRecommendationIndex(files, 'MacIntel', {});
    assert.equal(unfiltered.size, 2);
    const filtered = dashboardRecommendationIndex(files, 'MacIntel', { formats: ['epub'] });
    assert.equal(filtered.size, 1);
    assert.equal(filtered.has('/Books/A.epub'), true);
    assert.equal(dashboardRecommendationIndex(files, 'MacIntel', { formats: ['epub'] }), filtered);
    const windows = dashboardRecommendationIndex(files, 'Win32', { formats: ['epub'] });
    assert.notEqual(windows, filtered);
    const preferences = { formats: ['epub'], libraries: ['/books'] };
    assert.equal(dashboardRecommendationIndex(files, 'Win32', preferences).size, 1);
    assert.equal(dashboardRecommendationIndex(files, 'MacIntel', preferences).size, 0);
    assert.notEqual(dashboardRecommendationIndex(files, 'MacIntel', {}), unfiltered);
});

test('summary cache respects normalized limits and handles empty catalogs', () => {
    const files = [{ path: '/a.epub' }, { path: '/b.epub' }];
    const single = dashboardCatalogSummary(files, 1);
    assert.equal(dashboardCatalogSummary(files, 1.8), single);
    const all = dashboardCatalogSummary(files, 2);
    assert.equal(all.bookCount, 2);
    assert.equal(all.latest.length, 2);
    assert.deepEqual(dashboardCatalogSummary(null), { bookCount: 0, latest: [] });
    assert.equal(dashboardRecommendationIndex(null).size, 0);
    assert.deepEqual(dashboardRecommendationOptions(null).genres, []);
});
