import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSeenReleases, readSeenReleases, releaseNotificationKey, RELEASE_RECENT_MS, unreadRecentReleases } from './releaseNotificationPolicy.js';

const now = Date.parse('2026-09-15T12:00:00Z');
const release = (id, timestamp = now) => ({ id, publishedAt: new Date(timestamp).toISOString() });

test('only unread published releases in the last seven days receive a badge', () => {
    const items = [release('today'), release('week', now - RELEASE_RECENT_MS), release('old', now - RELEASE_RECENT_MS - 1),
        release('future', now + 1), { ...release('draft'), draft: true }, { id: 'invalid', publishedAt: 'invalid' }, release('read')];
    const seen = [releaseNotificationKey(items[6])];
    assert.deepEqual(unreadRecentReleases(items, seen, now).map(item => item.id), ['today', 'week']);
    assert.deepEqual(unreadRecentReleases([items[1]], [], now + 1), []);
});

test('read state persists across restarts and does not hide new or republished releases', () => {
    const first = release('v3.9.0', now - 1000);
    const seen = mergeSeenReleases([], [first]);
    const restored = readSeenReleases({ getItem: () => JSON.stringify(seen) });
    assert.deepEqual(unreadRecentReleases([first], restored, now), []);
    assert.equal(unreadRecentReleases([release('v3.9.1')], restored, now).length, 1);
    assert.equal(unreadRecentReleases([release('v3.9.0')], restored, now).length, 1);
    assert.deepEqual(mergeSeenReleases(restored, [first]), restored);
});

test('unavailable or malformed read-state storage cannot break release loading', () => {
    for (const value of ['broken json', '{}', 'null']) {
        assert.deepEqual(readSeenReleases({ getItem: () => value }), []);
    }
    assert.deepEqual(readSeenReleases({ getItem: () => { throw new Error('Storage blocked'); } }), []);
    assert.deepEqual(readSeenReleases({ getItem: () => '[3,"read-key",null]' }), ['read-key']);
});

test('read history stays bounded and drafts are never marked as published updates', () => {
    const seen = mergeSeenReleases([], Array.from({ length: 250 }, (_, index) => release(index + 1)));
    assert.equal(seen.length, 200);
    assert.ok(seen.includes(releaseNotificationKey(release(250))));
    assert.deepEqual(mergeSeenReleases([], [{ ...release('draft'), draft: true }]), []);
});
