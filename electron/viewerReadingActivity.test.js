import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { isRegisteredLibraryFile } from './libraryPathScope.js';

const source = readFileSync(new URL('./viewerWindow.js', import.meta.url), 'utf8');
const section = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
};

function fixture() {
    const root = path.resolve('reading-activity-library');
    const now = 1_800_000_000_000;
    const readerSender = {};
    const audioSender = {};
    const reader = { currentSession: { id: 'reader' } };
    const audio = { currentSession: { id: 'audio' } };
    const sessions = new Map([
        ['reader', { id: 'reader', type: 'epub', filePath: path.join(root, 'book.epub') }],
        ['audio', { id: 'audio', type: 'audio', filePath: path.join(root, 'book.mp3') }],
        ['old', { id: 'old', type: 'epub', filePath: path.join(root, 'previous.epub') }],
    ]);
    const writes = [];
    const notices = [];
    const handlers = new Map();
    let libraries = [root];
    const context = vm.createContext({
        sessions,
        contextForSession: session => session?.type === 'audio' ? audio : reader,
        viewerContextForSender: sender => sender === readerSender ? reader : sender === audioSender ? audio : null,
        getLibraryDbPath: () => 'test.db',
        configManager: { canPruneLibraryData: () => true, getConfig: () => ({ libraries }) },
        isRegisteredLibraryFile,
        LibraryDB: class {
            async recordReadingActivity(filePath, interval) {
                writes.push({ filePath, ...JSON.parse(JSON.stringify(interval)) });
                return { changes: 1, seconds: (interval.endedAt - interval.startedAt) / 1_000 };
            }
        },
        mainAppWindow: () => ({ webContents: { send: (channel, payload) => notices.push({ channel, ...payload }) } }),
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        Date: { now: () => now },
        console,
    });
    vm.runInContext(`
        let readingStateDb = null;
        ${section('    const viewerContextForSessionRequest =', '    const openAdjacentViewer =')}
        ${section("    ipcMain.handle('viewer:recordReadingActivity'", "    ipcMain.on('viewer:audio-track-state'")}
    `, context);
    return {
        writes, notices, sessions, readerSender, audioSender, now,
        interval: { eventId: 'event-1', startedAt: now - 30_000, endedAt: now },
        updateLibraries: value => { libraries = value; },
        record(id, interval, sender = readerSender) {
            return handlers.get('viewer:recordReadingActivity')({ sender }, id, interval);
        },
    };
}

test('activity IPC binds the file to the current viewer session and namespaces idempotency keys', async () => {
    const value = fixture();
    const result = await value.record('reader', { ...value.interval, filePath: '/forged/book.epub', retainOutsideLibrary: true });
    assert.equal(result.seconds, 30);
    assert.equal(value.writes[0].filePath, value.sessions.get('reader').filePath);
    assert.equal(value.writes[0].eventId, 'reader:event-1');
    assert.equal(value.writes[0].retainOutsideLibrary, false);
    assert.equal(value.notices[0].channel, 'reading:changed');
    assert.equal(value.notices[0].activity, true);
});

test('activity IPC rejects unknown senders, stale sessions and cross-viewer requests', async () => {
    const value = fixture();
    await assert.rejects(value.record('reader', value.interval, {}), /window was not found/);
    await assert.rejects(value.record('audio', value.interval), /does not belong/);
    await assert.rejects(value.record('old', value.interval), /no longer current/);
    await assert.rejects(value.record('missing', value.interval), /no longer current/);
    assert.deepEqual(value.writes, []);
    assert.equal((await value.record('audio', value.interval, value.audioSender)).seconds, 30);
});

test('preview sessions and revoked library access cannot persist time', async () => {
    const value = fixture();
    value.sessions.get('reader').preview = true;
    assert.equal(await value.record('reader', value.interval), null);
    value.sessions.get('reader').preview = false;
    value.updateLibraries([]);
    assert.equal(await value.record('reader', { ...value.interval, retainOutsideLibrary: true }), null);
    assert.deepEqual(value.writes, []);
    value.sessions.get('reader').retainOutsideLibrary = true;
    assert.equal((await value.record('reader', value.interval)).seconds, 30);
});

test('invalid, stale, future and oversized intervals are ignored before database access', async () => {
    const value = fixture();
    for (const interval of [
        null, {}, { ...value.interval, eventId: '' }, { ...value.interval, eventId: 'x'.repeat(129) },
        { ...value.interval, startedAt: NaN }, { ...value.interval, endedAt: Infinity },
        { ...value.interval, startedAt: value.now - 60_001 },
        { ...value.interval, startedAt: value.now - 130_000, endedAt: value.now - 120_000 },
        { ...value.interval, endedAt: value.now + 5_001 },
        { ...value.interval, startedAt: value.now },
    ]) assert.equal(await value.record('reader', interval), null);
    assert.deepEqual(value.writes, []);
});
