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

test('동기화된 TXT 진행률은 로컬 저장값 없이 표시하고 다른 기기의 페이지 수로 완료 처리하지 않는다', () => {
    const file = {
        path: '/books/synced.txt', page_count: 1,
        readingState: {
            format: 'text', pageIndex: 0, pageCount: 197, scrollPercent: 4.06091371,
            positionSeconds: 0, durationSeconds: 0, status: 'reading',
            locator: { kind: 'normalized', normalizedPosition: 0.0406091371 },
            updatedAt: '2026-09-09T00:00:00.000Z',
        },
    };
    for (const status of [readViewerFileStatus(file, new MemoryStorage()), createViewerStatusReader(new MemoryStorage())(file)]) {
        assert.equal(status.hasReadingProgress, true);
        assert.equal(status.isAudio, false);
        assert.equal(status.isCompleted, false);
        assert.equal(status.percent, 4);
        assert.equal(viewerReadingProgressText(status), '4%');
    }
});

test('DB와 로컬 중 최신 진행률을 선택하며 로컬 책갈피를 보존한다', () => {
    const file = {
        path: '/books/book.pdf',
        readingState: {
            pageIndex: 24, pageCount: 100, positionSeconds: 0, durationSeconds: 0,
            locator: { kind: 'page', pageIndex: 24, pageCount: 100 }, status: 'reading',
            updatedAt: '2026-09-09T00:00:00.000Z',
        },
    };
    for (const localTime of [undefined, Date.parse('2026-09-08T00:00:00.000Z'), Date.parse('2026-09-10T00:00:00.000Z')]) {
        const storage = new MemoryStorage({
            'bookmanager-viewer-state:/books/book.pdf': JSON.stringify({ pageIndex: 49, pageCount: 100, updatedAt: localTime }),
            'bookmanager-viewer-bookmarks:/books/book.pdf': JSON.stringify([{ id: 'local' }]),
        });
        for (const status of [readViewerFileStatus(file, storage), createViewerStatusReader(storage)(file)]) {
            assert.equal(status.percent, localTime > Date.parse(file.readingState.updatedAt) ? 50 : 25);
            assert.equal(status.isAudio, false);
            assert.equal(status.bookmarkCount, 1);
        }
    }
});

test('DB의 명시적 미독과 완료 상태를 유지하며 오디오만 시간 진행률을 표시한다', () => {
    const reader = createViewerStatusReader(new MemoryStorage());
    const completed = reader({ path: '/books/done.epub', readingState: { status: 'completed', locator: { kind: 'normalized', normalizedPosition: 0.4 } } });
    assert.equal(completed.isCompleted, true);
    assert.equal(viewerReadingProgressText(completed), '100%');
    const unread = reader({ path: '/books/new.pdf', readingState: { status: 'unread', pageIndex: 0, pageCount: 1 } });
    assert.equal(unread.hasReadingProgress, false);
    assert.equal(unread.isCompleted, false);
    const audio = reader({ path: '/books/audio.m4b', readingState: { status: 'reading', format: 'audio', positionSeconds: 30, durationSeconds: 120, locator: { kind: 'audio-time' } } });
    assert.equal(viewerReadingProgressText(audio), '25% · 0:30 / 2:00');
});

test('PC가 저장한 동일한 위치의 DB 응답은 기존 TXT/EPUB 페이지 표시를 바꾸지 않는다', () => {
    for (const extension of ['txt', 'epub']) {
        const path = `/books/local.${extension}`;
        const local = { pageIndex: 8, pageCount: 197, scrollPercent: 4.06091371, updatedAt: Date.parse('2026-09-09T00:00:00.000Z') };
        const storage = new MemoryStorage({ [`bookmanager-viewer-state:${path}`]: JSON.stringify(local) });
        const before = readViewerFileStatus({ path }, storage);
        const file = { path, readingState: { ...local, status: 'reading', locator: { kind: 'normalized', normalizedPosition: local.scrollPercent / 100 }, updatedAt: '2026-09-09T00:00:00.100Z' } };
        assert.equal(viewerReadingProgressText(readViewerFileStatus(file, storage)), viewerReadingProgressText(before));
        assert.equal(viewerReadingProgressText(createViewerStatusReader(storage)(file)), viewerReadingProgressText(before));
        file.readingState.status = 'completed';
        assert.equal(readViewerFileStatus(file, storage).isCompleted, true);
        file.readingState.status = 'unread';
        assert.equal(readViewerFileStatus(file, storage).hasReadingProgress, false);
    }
});
