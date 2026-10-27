import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadingActivityTracker, READING_ACTIVITY_IDLE_MS } from './readingActivityTracker.js';

function fixture(initialState = {}) {
    let wall = 1_800_000_000_000;
    let monotonic = 0;
    const intervals = [];
    const tracker = createReadingActivityTracker({
        record: interval => intervals.push(interval),
        now: () => wall,
        monotonicNow: () => monotonic,
        createId: () => `event-${intervals.length}`,
        initialState: { ready: true, visible: true, focused: true, ...initialState },
    });
    const advance = (milliseconds, wallMilliseconds = milliseconds) => {
        wall += wallMilliseconds;
        monotonic += milliseconds;
    };
    return {
        tracker, intervals, advance,
        read(milliseconds) {
            while (milliseconds > 0) {
                const step = Math.min(5_000, milliseconds);
                advance(step);
                tracker.sample();
                milliseconds -= step;
            }
        },
        total: () => intervals.reduce((total, interval) => total + interval.endedAt - interval.startedAt, 0),
    };
}

test('active reading flushes at 30 seconds and preserves the partial interval on close', () => {
    const value = fixture();
    value.read(67_500);
    assert.equal(value.intervals.length, 2);
    value.tracker.dispose();
    assert.equal(value.total(), 67_500);
    assert.ok(value.intervals.every(interval => interval.endedAt - interval.startedAt <= 30_000));
    assert.equal(new Set(value.intervals.map(interval => interval.eventId)).size, 3);
    value.tracker.dispose();
    assert.equal(value.total(), 67_500);
});

test('documents require readiness, focus and visibility', () => {
    const value = fixture({ ready: false });
    value.read(20_000);
    value.tracker.update({ ready: true });
    value.read(10_000);
    value.tracker.update({ focused: false });
    assert.equal(value.total(), 10_000);
    value.read(20_000);
    value.tracker.update({ focused: true, visible: false });
    value.read(20_000);
    value.tracker.update({ visible: true });
    value.read(10_000);
    value.tracker.dispose();
    assert.equal(value.total(), 20_000);
});

test('five minutes without activity stop counting until a new input', () => {
    const value = fixture();
    value.read(READING_ACTIVITY_IDLE_MS + 20_000);
    value.tracker.flush();
    assert.equal(value.total(), READING_ACTIVITY_IDLE_MS);
    value.tracker.interact();
    value.read(13_000);
    value.tracker.dispose();
    assert.equal(value.total(), READING_ACTIVITY_IDLE_MS + 13_000);
});

test('input after becoming idle does not backfill idle time', () => {
    const value = fixture();
    value.read(READING_ACTIVITY_IDLE_MS - 2_000);
    value.advance(5_000);
    value.tracker.interact();
    value.read(5_000);
    value.tracker.dispose();
    assert.equal(value.total(), READING_ACTIVITY_IDLE_MS + 5_000);
});

test('audio counts actual playback in the background without counting a paused visible player', () => {
    const value = fixture({ visualReading: false, playing: false });
    value.read(10_000);
    value.tracker.update({ playing: true, visible: false, focused: false });
    value.read(37_000);
    value.tracker.update({ playing: false });
    value.read(20_000);
    value.tracker.update({ playing: true });
    value.read(8_000);
    value.tracker.dispose();
    assert.equal(value.total(), 45_000);
});

test('foreground reading with narration uses one interval and narration bypasses idle cutoff', () => {
    const value = fixture({ playing: true });
    value.read(READING_ACTIVITY_IDLE_MS + 15_000);
    value.tracker.dispose();
    assert.equal(value.total(), READING_ACTIVITY_IDLE_MS + 15_000);
});

test('computer sleep and delayed heartbeats do not become reading time', () => {
    const value = fixture({ playing: true });
    value.read(12_000);
    value.advance(60 * 60_000);
    value.tracker.sample();
    value.read(8_000);
    value.tracker.dispose();
    assert.equal(value.total(), 20_000);
});

test('clock jumps do not generate future or negative activity intervals', () => {
    const value = fixture();
    value.read(5_000);
    value.advance(5_000, 120_000);
    value.tracker.sample();
    value.advance(5_000, -120_000);
    value.tracker.sample();
    value.read(5_000);
    value.tracker.dispose();
    assert.equal(value.total(), 10_000);
});

test('duplicate ticks and repeated flushes never record the same time twice', () => {
    const value = fixture();
    value.advance(5_000);
    value.tracker.sample();
    value.tracker.sample();
    value.tracker.flush();
    value.tracker.flush();
    value.tracker.dispose();
    value.advance(5_000);
    value.tracker.sample();
    assert.equal(value.total(), 5_000);
});

test('recording errors never interrupt reading or window cleanup', async () => {
    let time = 0;
    for (const record of [() => { throw new Error('closed'); }, () => Promise.reject(new Error('closed'))]) {
        const tracker = createReadingActivityTracker({
            record, now: () => time, monotonicNow: () => time, createId: () => 'id',
            initialState: { ready: true, playing: true },
        });
        time += 5_000;
        assert.doesNotThrow(() => tracker.dispose());
    }
    await Promise.resolve();
});
