import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeReadiveResumeState, resolveReadiveResumePage } from './readiveViewerResume.js';

test('a remote DB winner replaces stale localStorage position while preserving local preferences', () => {
    const local = { pageIndex: 80, zoom: 125, flowMode: 'spread' };
    const merged = mergeReadiveResumeState(local, { updatedAt: '2026-09-07T10:00:00Z', pageIndex: 15, locator: { kind: 'page', pageIndex: 15 } });
    assert.equal(merged.pageIndex, 15);
    assert.equal(merged.zoom, 125);
    assert.equal(merged.flowMode, 'spread');
    assert.equal(resolveReadiveResumePage(merged, { type: 'comic', pageCount: 100 }), 15);
    assert.equal(local.pageIndex, 80);
});

test('newer local progress and absent remote records preserve local state', () => {
    const local = { pageIndex: 4, updatedAt: Date.parse('2026-09-07T11:00:00Z') };
    assert.equal(mergeReadiveResumeState(local, null), local);
    assert.equal(mergeReadiveResumeState(local, { updatedAt: '2026-09-07T10:00:00Z', pageIndex: 9 }), local);
});

test('text and EPUB restore using the current pagination instead of remote page count', () => {
    assert.equal(resolveReadiveResumePage({ readiveLocator: { kind: 'normalized', normalizedPosition: 0.5 } }, { type: 'text', pageCount: 201 }), 100);
    assert.equal(resolveReadiveResumePage({ readiveLocator: { kind: 'text-offset', sourceOffset: 7 } }, { type: 'text', pageCount: 3, textPages: ['abcd', 'efgh', 'ijk'] }), 1);
    assert.equal(resolveReadiveResumePage({ readiveLocator: { kind: 'epub-text', sectionHref: 'OEBPS/ch2.xhtml', sourceOffset: 6 } }, { type: 'epub', pageCount: 3, epubPages: [{ name: 'OEBPS/ch1.xhtml', text: 'aaa' }, { name: 'OEBPS/ch2.xhtml', text: '12345' }, { name: 'OEBPS/ch2.xhtml', text: '6789' }] }), 2);
});

test('audio hydration preserves playback preferences and applies the remote timestamp', () => {
    const merged = mergeReadiveResumeState({ playbackRate: 1.5, positionSeconds: 1 }, { positionSeconds: 63, durationSeconds: 300, updatedAt: '2026-09-07T10:00:00Z' });
    assert.equal(merged.positionSeconds, 63);
    assert.equal(merged.playbackRate, 1.5);
});
