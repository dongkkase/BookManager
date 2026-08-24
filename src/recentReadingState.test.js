import assert from 'node:assert/strict';
import test from 'node:test';
import { recentReadingTimeText } from './recentReadingState.js';

const t = (key, values = []) => ({
    'folder.recent.just_now': '방금 전',
    'folder.recent.minutes_ago': `${values[0]}분 전`,
    'folder.recent.hours_ago': `${values[0]}시간 전`,
    'folder.recent.days_ago': `${values[0]}일 전`,
})[key] || key;

test('최근 읽은 시간은 경과 시간과 날짜 형식으로 표시한다', () => {
    const now = new Date('2026-08-23T12:00:00.000Z').getTime();
    assert.equal(recentReadingTimeText('2026-08-23T11:59:40.000Z', t, now), '방금 전');
    assert.equal(recentReadingTimeText('2026-08-23T11:45:00.000Z', t, now), '15분 전');
    assert.equal(recentReadingTimeText('2026-08-23T09:00:00.000Z', t, now), '3시간 전');
    assert.equal(recentReadingTimeText('2026-08-21T12:00:00.000Z', t, now), '2일 전');
    assert.match(recentReadingTimeText('2026-08-01T12:00:00.000Z', t, now, 'ko'), /2026/);
    assert.equal(recentReadingTimeText('', t, now), '');
});
