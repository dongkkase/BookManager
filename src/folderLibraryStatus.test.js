import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isLibraryScanning,
    libraryStatusClass,
    libraryStatusText,
    shouldShowLibrarySyncButton,
} from './folderLibraryStatus.js';

const messages = {
    folder_library_never_scanned: '인덱스 없음',
    folder_library_scanning: '인덱싱 중',
    folder_library_scan_cancelled: '스캔 중단됨',
    folder_library_scan_failed: '스캔 실패',
    folder_library_needs_scan: '업데이트 필요',
    folder_library_scan_meta: '폴더: {0} · items: {1} · {2}',
    folder_library_time_now: '방금 전',
    folder_library_time_minutes: '{0}분 전',
    folder_library_time_hours: '{0}시간 전',
    folder_library_time_days: '{0}일 전',
};

function t(key, values = []) {
    return values.reduce(
        (message, value, index) => message.replace(`{${index}}`, String(value)),
        messages[key] || key,
    );
}

test('최신 인덱스 상태의 라이브러리는 새로고침 아이콘을 표시하지 않는다', () => {
    const nowMs = Date.parse('2026-06-21T12:00:00.000Z');
    const state = {
        status: 'ready',
        needsScan: false,
        indexedCount: 30,
        lastScannedAt: '2026-06-21T11:59:00.000Z',
    };

    assert.equal(libraryStatusClass(state, { nowMs }), 'ready');
    assert.equal(libraryStatusText(t, state, { nowMs, folderCount: 4 }), '폴더: 4 · items: 30 · 1분 전');
    assert.equal(shouldShowLibrarySyncButton(state, { nowMs }), false);
});

test('24시간이 지난 인덱스 시간은 날짜로 표시한다', () => {
    const nowMs = Date.parse('2026-06-21T12:00:00.000Z');
    const state = {
        status: 'ready',
        needsScan: false,
        indexedCount: 12,
        lastScannedAt: '2026-06-20T10:00:00.000Z',
    };

    assert.equal(libraryStatusText(t, state, { nowMs, folderCount: 2 }), '폴더: 2 · items: 12 · 2026-06-20');
});

test('업데이트가 필요한 라이브러리만 새로고침 아이콘을 표시한다', () => {
    const state = {
        status: 'ready',
        needsScan: true,
        lastScannedAt: '2026-06-21T11:59:00.000Z',
    };

    assert.equal(libraryStatusClass(state), 'needs-scan');
    assert.equal(libraryStatusText(t, state, { nowMs: Date.parse('2026-06-21T12:00:00.000Z'), folderCount: 1 }), '폴더: 1 · items: 0 · 1분 전');
    assert.equal(shouldShowLibrarySyncButton(state), true);
});

test('heartbeat가 있는 scanning 상태는 인덱싱 중으로 표시한다', () => {
    const nowMs = Date.parse('2026-06-21T12:01:00.000Z');
    const state = {
        status: 'scanning',
        lastCheckedAt: '2026-06-21T12:00:30.000Z',
    };

    assert.equal(isLibraryScanning(state, { nowMs }), true);
    assert.equal(libraryStatusClass(state, { nowMs }), 'scanning');
    assert.equal(libraryStatusText(t, state, { nowMs }), '폴더: 0 · items: 0 · 인덱싱 중');
    assert.equal(shouldShowLibrarySyncButton(state, { nowMs }), false);
});

test('중단된 라이브러리 스캔은 스캔 중으로 표시하지 않는다', () => {
    const state = {
        status: 'cancelled',
        needsScan: true,
        lastCheckedAt: '2026-06-21T11:59:00.000Z',
    };

    assert.equal(isLibraryScanning(state), false);
    assert.equal(libraryStatusClass(state), 'cancelled');
    assert.equal(libraryStatusText(t, state), '폴더: 0 · items: 0 · 스캔 중단됨');
    assert.equal(shouldShowLibrarySyncButton(state), true);
});

test('heartbeat가 없는 scanning 상태는 스캔 중으로 표시하지 않는다', () => {
    const state = {
        status: 'scanning',
    };

    assert.equal(isLibraryScanning(state), false);
    assert.equal(libraryStatusClass(state), 'cancelled');
    assert.equal(libraryStatusText(t, state), '폴더: 0 · items: 0 · 스캔 중단됨');
});

test('heartbeat가 오래된 scanning 상태는 중단 상태로 처리한다', () => {
    const nowMs = Date.parse('2026-06-21T12:03:00.000Z');
    const state = {
        status: 'scanning',
        lastCheckedAt: '2026-06-21T12:00:00.000Z',
    };

    assert.equal(isLibraryScanning(state, { nowMs, heartbeatTimeoutMs: 120000 }), false);
    assert.equal(libraryStatusClass(state, { nowMs, heartbeatTimeoutMs: 120000 }), 'cancelled');
    assert.equal(libraryStatusText(t, state, { nowMs, heartbeatTimeoutMs: 120000 }), '폴더: 0 · items: 0 · 스캔 중단됨');
});
