import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRecentTextFiles, readRecentTextFiles, rememberTextCleanerFile, TEXT_CLEANER_RECENT_KEY, writeRecentTextFiles } from './textCleanerRecentFiles.js';

function storageFixture(t) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    t.after(() => {
        if (prior) Object.defineProperty(globalThis, 'localStorage', prior);
        else delete globalThis.localStorage;
    });
    return storage;
}

test('최근 작업은 유효한 TXT 경로만 최신순으로 최대 20개 보관한다', () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({ filePath: `/books/${index}.txt`, updatedAt: index + 1, text: '본문' }));
    const result = normalizeRecentTextFiles([
        ...entries, null, {}, { filePath: '/a.epub', updatedAt: 100 }, { filePath: 'relative.txt', updatedAt: 100 },
        { filePath: '/bad.txt', updatedAt: Infinity }, { filePath: '/bad.txt', updatedAt: 9e15 },
    ]);
    assert.equal(result.length, 20);
    assert.deepEqual(result[0], { filePath: '/books/29.txt', fileName: '29.txt', updatedAt: 30 });
    assert.equal(result.at(-1).filePath, '/books/10.txt');
    assert.equal(entries[0].filePath, '/books/0.txt');
});

test('Windows 경로의 구분자와 대소문자가 달라도 가장 최근 기록만 남긴다', () => {
    const result = normalizeRecentTextFiles([
        { filePath: 'C:\\Books\\novel.txt', updatedAt: 1 },
        { filePath: 'c:/books/NOVEL.TXT', updatedAt: 3 },
        { filePath: '\\\\server\\share\\novel.txt', updatedAt: 2 },
        { filePath: '/books/Novel.txt', updatedAt: 5 },
        { filePath: '/books/novel.txt', updatedAt: 4 },
    ]);
    assert.equal(result.length, 4);
    assert.equal(result[2].filePath, 'c:/books/NOVEL.TXT');
});

test('파일을 다시 열거나 저장하면 기록이 맨 앞으로 이동하고 본문은 저장하지 않는다', t => {
    const storage = storageFixture(t);
    rememberTextCleanerFile({ filePath: '/a.txt', text: '비공개 본문' }, 1);
    rememberTextCleanerFile({ filePath: '/b.txt' }, 2);
    rememberTextCleanerFile({ filePath: '/a.txt' }, 3);
    assert.deepEqual(readRecentTextFiles().map(file => file.filePath), ['/a.txt', '/b.txt']);
    assert.equal(readRecentTextFiles()[0].updatedAt, 3);
    assert.doesNotMatch(storage.getItem(TEXT_CLEANER_RECENT_KEY), /비공개|text/);
    writeRecentTextFiles(readRecentTextFiles().filter(file => file.filePath !== '/a.txt'));
    assert.deepEqual(readRecentTextFiles().map(file => file.filePath), ['/b.txt']);
});

test('손상된 기록과 저장소 접근 실패는 파일 작업을 막지 않는다', t => {
    const storage = storageFixture(t);
    storage.setItem(TEXT_CLEANER_RECENT_KEY, '{broken');
    assert.deepEqual(readRecentTextFiles(), []);
    storage.getItem = () => { throw new Error('storage unavailable'); };
    storage.setItem = () => { throw new Error('quota'); };
    assert.deepEqual(readRecentTextFiles(), []);
    assert.doesNotThrow(() => rememberTextCleanerFile({ filePath: '/a.txt' }));
});
