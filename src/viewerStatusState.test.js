import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createViewerStatusReader,
    isViewerStatusStorageKey,
    readViewerFileStatus,
    viewerReadingProgressText,
    viewerBookmarkStatusText,
    viewerReadingStatusText,
} from './viewerStatusState.js';

class MemoryStorage {
    constructor(entries = {}) {
        this.entries = new Map(Object.entries(entries));
    }

    get length() {
        return this.entries.size;
    }

    key(index) {
        return Array.from(this.entries.keys())[index] || null;
    }

    getItem(key) {
        return this.entries.has(key) ? this.entries.get(key) : null;
    }
}

test('뷰어 상태 저장 키를 식별한다', () => {
    assert.equal(isViewerStatusStorageKey('bookmanager-viewer-state:C:/a.cbz'), true);
    assert.equal(isViewerStatusStorageKey('bookmanager-viewer-bookmarks:C:/a.cbz'), true);
    assert.equal(isViewerStatusStorageKey('bookmanager-viewer-prefs:comic'), false);
});

test('읽는 중과 완료 상태를 계산한다', () => {
    const storage = new MemoryStorage({
        'bookmanager-viewer-state:C:/first.cbz': JSON.stringify({ pageIndex: 0, scrollPercent: 0 }),
        'bookmanager-viewer-state:C:/book.cbz': JSON.stringify({ pageIndex: 12, scrollPercent: 0 }),
        'bookmanager-viewer-state:C:/done.cbz': JSON.stringify({ pageIndex: 99, pageCount: 100 }),
    });
    const first = readViewerFileStatus({ path: 'C:/first.cbz', page_count: 100 }, storage);
    const reading = readViewerFileStatus({ path: 'C:/book.cbz', page_count: 100 }, storage);
    const completed = readViewerFileStatus({ path: 'C:/done.cbz' }, storage);

    assert.equal(first.hasReadingProgress, true);
    assert.equal(first.isCompleted, false);
    assert.equal(reading.hasReadingProgress, true);
    assert.equal(reading.isCompleted, false);
    assert.equal(viewerReadingProgressText(reading), '13% · 13 / 100p');
    assert.equal(completed.isCompleted, true);
    assert.equal(viewerReadingStatusText(reading, key => ({ viewer_status_reading: '읽는 중' })[key]), '읽는 중');
});

test('상태 리더는 저장소를 한 번 스캔해 책갈피 수를 읽는다', () => {
    const storage = new MemoryStorage({
        'bookmanager-viewer-state:C:/book.pdf': JSON.stringify({ pageIndex: 1 }),
        'bookmanager-viewer-bookmarks:C:/book.pdf': JSON.stringify([{ id: 1 }, { id: 2 }]),
    });
    const reader = createViewerStatusReader(storage);
    const status = reader({ full_path: 'C:/book.pdf', page_count: 10 });

    assert.equal(status.hasBookmarks, true);
    assert.equal(status.bookmarkCount, 2);
    assert.equal(viewerBookmarkStatusText(status, (key, values) => `${values[0]}개`), '2개');
});

test('오디오북 진행률과 초 단위 북마크 상태를 계산한다', () => {
    const storage = new MemoryStorage({
        'bookmanager-viewer-state:C:/audio.m4b': JSON.stringify({
            positionSeconds: 3723,
            durationSeconds: 7200,
        }),
        'bookmanager-viewer-bookmarks:C:/audio.m4b': JSON.stringify([
            { id: 1, timeSeconds: 60, label: '1:00' },
        ]),
    });
    const status = readViewerFileStatus({ path: 'C:/audio.m4b', book_type: 'audio' }, storage);

    assert.equal(status.isAudio, true);
    assert.equal(status.percent, 52);
    assert.equal(status.isCompleted, false);
    assert.equal(status.bookmarkCount, 1);
    assert.equal(viewerReadingProgressText(status), '52% · 1:02:03 / 2:00:00');

    const completed = readViewerFileStatus({ path: 'C:/done.mp3' }, new MemoryStorage({
        'bookmanager-viewer-state:C:/done.mp3': JSON.stringify({
            positionSeconds: 99.5,
            durationSeconds: 100,
        }),
    }));
    assert.equal(completed.isCompleted, true);
});
