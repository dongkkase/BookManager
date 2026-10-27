import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DAILY_RECOMMENDATION_STORAGE_KEY,
    dailyRecommendationDay,
    findDailyRecommendation,
    isDailyRecommendationEntryVolume,
    nextRecommendationDelay,
    readDailyRecommendation,
} from './dailyRecommendationState.js';
import { createViewerStatusReader } from './viewerStatusState.js';

function memoryStorage(entries = {}) {
    const values = new Map(Object.entries(entries));
    return {
        get length() { return values.size; },
        key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
}

function select(files, overrides = {}) {
    return findDailyRecommendation({
        files,
        day: '2026-10-26',
        seed: 12345,
        request: async () => [],
        readStatus: createViewerStatusReader(memoryStorage()),
        ...overrides,
    });
}

test('첫 권과 단독권만 추천 후보로 허용하고 화수나 시리즈 이름만으로 단독권을 제외하지 않는다', () => {
    const eligible = [
        { path: '/books/단독권.epub' },
        { name: '1984.epub', title: '1984' },
        { name: '1Q84.epub', title: '1Q84', series: '1Q84' },
        { name: '1984.epub', title: '1984', series: '', volume: '1984', has_metadata: false },
        { name: '1Q84.epub', title: '1Q84', series: '1Q', volume: '84', has_metadata: 0 },
        { name: '독서노트 (2024).epub', title: '독서노트', series: '독서노트' },
        { name: '독서노트 [1999].epub', title: '독서노트', series: '독서노트' },
        { name: 'Fahrenheit 451.epub', title: 'Fahrenheit 451', series: 'Fahrenheit 451' },
        { name: '아이실드 21.epub', title: '아이실드 21', series: '아이실드 21' },
        { name: '단독권.txt', series: '단독권', Number: '1064' },
        { name: '첫 이야기.epub', volume: '001.0', number: '1064' },
        { name: '책 제1권.cbz' },
        { name: 'Book Vol. 1.epub' },
        { name: 'Book Volume I.epub' },
        { name: '本 第１巻.cbz' },
        { name: '작품 001.cbz', series: '작품' },
        { name: '작품 [01].cbz' },
        { name: '작품 1~551(완).txt', series: '작품', volume: '1~551' },
        { name: '작품 1권-3권.cbz', volume: '1~3' },
        { name: '별도 제목.epub', metadata: { Volume: '1' } },
        { name: '별도 제목.epub', full_meta: { Volume: '단권' } },
    ];
    for (const file of eligible) assert.equal(isDailyRecommendationEntryVolume(file), true, JSON.stringify(file));
});

test('메타데이터와 파일명의 중간권·소수권은 현재 보유한 최소 권수와 무관하게 제외한다', () => {
    const excluded = [
        { name: '다음 이야기.epub', volume: '2' },
        { name: '다음 이야기.epub', full_meta: { Volume: '3' } },
        { name: '다음 이야기.epub', metadata: { Volume: '1.5' } },
        { name: 'Book Vol. 02.cbz' },
        { name: 'Book Volume II.cbz' },
        { name: '작품 03권.cbz' },
        { name: '작품 1.5권.cbz', volume: '1' },
        { name: '작품 2~8권.cbz' },
        { name: '작품 2권-8권.cbz' },
        { name: '작품 003(완결).cbz', series: '작품' },
        { name: '작품 [03].cbz' },
        { name: 'chapter.cbz', title: '작품 20화' },
        { name: '작품.epub', volume: '0' },
        { name: '작품.epub', volume: 'unknown' },
        { name: '1984.epub', title: '1984', series: '', volume: '2', has_metadata: false },
        { name: '작품003.cbz', title: '작품003', series: '작품', volume: '3', has_metadata: false },
        { name: '작품 2권 (2024).epub', volume: '2' },
    ];
    for (const file of excluded) assert.equal(isDailyRecommendationEntryVolume(file), false, JSON.stringify(file));
});

test('당일 저장된 중간권도 다시 고르며 첫 권을 읽은 뒤 후속권으로 넘어가지 않는다', async () => {
    const files = [
        { path: '/books/first.epub', volume: '1' },
        { path: '/books/middle.epub', volume: '2' },
        { path: '/books/standalone.epub' },
    ];
    const record = { version: 1, day: '2026-10-26', path: files[1].path, previousPath: '', seed: 12345 };
    const batches = [];
    const request = async paths => {
        batches.push(...paths);
        return paths.filter(filePath => filePath === files[0].path).map(filePath => ({ filePath, status: 'completed' }));
    };
    const result = await select(files, { record, request });
    assert.equal(result.file.path, files[2].path);
    assert.ok(!batches.includes(files[1].path));
    const noEntry = await select(files.slice(0, 2), { record, request });
    assert.equal(noEntry.file, null);
    const onlyMiddle = await select(files.slice(1, 2), { request: () => assert.fail('Middle volumes must not be queried') });
    assert.equal(onlyMiddle.file, null);
});

test('추천 날짜와 자정 타이머는 UTC 대신 기기의 로컬 달력을 따른다', () => {
    const beforeMidnight = new Date(2026, 9, 26, 23, 59, 59, 900);
    assert.equal(dailyRecommendationDay(beforeMidnight), '2026-10-26');
    assert.equal(nextRecommendationDelay(beforeMidnight), 100);
    assert.equal(dailyRecommendationDay(new Date(beforeMidnight.getTime() + 100)), '2026-10-27');
    assert.equal(dailyRecommendationDay(new Date(2027, 0, 1)), '2027-01-01');
});

test('동일 날짜와 seed는 입력 순서와 무관하며 큰 카탈로그도 첫 미독 배치까지만 읽는다', async () => {
    const files = Array.from({ length: 10000 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const batches = [];
    const first = await select(files, { request: async paths => { batches.push(paths); return []; } });
    const reordered = await select([...files].reverse());
    assert.equal(first.file.path, reordered.file.path);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 50);
    assert.equal(first.file.viewerStatus.hasReadingProgress, false);
    assert.equal(first.file.viewerStatus.isCompleted, false);
});

test('저장한 당일 추천은 재진입·순서 변경·새 책 추가 후에도 한 권만 재검증하고 유지한다', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const first = await select(files);
    const storage = memoryStorage({ [DAILY_RECOMMENDATION_STORAGE_KEY]: JSON.stringify(first.record) });
    const record = readDailyRecommendation(storage);
    assert.deepEqual(record, first.record);
    const batches = [];
    const next = await select([{ path: '/books/new.epub' }, ...files].reverse(), {
        record,
        request: async paths => { batches.push(paths); return []; },
    });
    assert.equal(next.file.path, first.file.path);
    assert.deepEqual(batches, [[first.file.path]]);
    assert.deepEqual(next.record, first.record);
    storage.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, '{broken');
    assert.equal(readDailyRecommendation(storage), null);
    storage.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, JSON.stringify({ ...record, seed: -1 }));
    assert.equal(readDailyRecommendation(storage), null);
});

test('다음 날에는 가능한 전날과 다른 미독 책을 고르고 한 권만 남으면 그 책을 사용한다', async () => {
    const files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }];
    const first = await select(files);
    const tomorrow = await select(files, { day: '2026-10-27', record: first.record });
    assert.notEqual(tomorrow.file.path, first.file.path);
    assert.equal(tomorrow.record.previousPath, first.file.path);
    assert.equal(tomorrow.record.day, '2026-10-27');
    const onlyUnread = await select(files, {
        day: '2026-10-27',
        record: first.record,
        request: async paths => paths.filter(path => path !== first.file.path)
            .map(filePath => ({ filePath, status: 'reading' })),
    });
    assert.equal(onlyUnread.file.path, first.file.path);
    const allRead = await select(files, {
        day: '2026-10-27',
        record: first.record,
        request: async paths => paths.map(filePath => ({ filePath, status: 'completed' })),
    });
    assert.equal(allRead.file, null, 'A saved recommendation from yesterday must still pass unread eligibility');
});

test('수동 재추첨은 저장된 당일 추천과 다른 미독 첫 권을 우선하고 대안이 없으면 기존 책을 반환한다', async () => {
    const files = [
        { path: '/books/current.epub', volume: '1' },
        { path: '/books/alternative.epub' },
        { path: '/books/middle.epub', volume: '2' },
    ];
    const record = { version: 1, day: '2026-10-26', path: files[0].path, previousPath: '', seed: 12345 };
    const requests = [];
    const next = await select(files, {
        record,
        seed: 98765,
        preferDifferentFrom: files[0].path,
        request: async paths => { requests.push(...paths); return []; },
    });
    assert.equal(next.file.path, files[1].path);
    assert.ok(!requests.includes(files[0].path));
    assert.ok(!requests.includes(files[2].path));
    assert.equal(record.path, files[0].path);
    const same = await select(files, {
        record,
        preferDifferentFrom: files[0].path,
        request: async paths => paths.filter(filePath => filePath === files[1].path)
            .map(filePath => ({ filePath, status: 'reading' })),
    });
    assert.equal(same.file.path, files[0].path);
    const allRead = await select(files, {
        record,
        preferDifferentFrom: files[0].path,
        request: async paths => paths.map(filePath => ({ filePath, status: 'completed' })),
    });
    assert.equal(allRead.file, null, 'A manual draw must not retain a read book as an eligible candidate');
});

test('DB와 로컬 상태를 병합하여 첫 페이지를 연 책·읽는 중·완독을 모두 제외한다', async () => {
    const files = [
        { path: '/books/first-page.epub' },
        { path: '/books/reading.epub' },
        { path: '/books/completed.epub' },
        { path: '/books/local.epub' },
        { path: '/books/local-newer.epub' },
        { path: '/books/unread.epub' },
    ];
    const storage = memoryStorage({
        'bookmanager-viewer-state:/books/local.epub': JSON.stringify({ pageIndex: 0 }),
        'bookmanager-viewer-state:/books/local-newer.epub': JSON.stringify({ pageIndex: 3, updatedAt: '2026-10-26' }),
        'bookmanager-viewer-state:/books/unread.epub': JSON.stringify({ pageIndex: 3, updatedAt: '2026-10-24' }),
    });
    const states = [
        { filePath: files[0].path, status: 'reading', pageIndex: 0, scrollPercent: 0 },
        { filePath: files[1].path, status: 'reading', pageIndex: 8 },
        { filePath: files[2].path, status: 'completed' },
        { filePath: files[4].path, status: 'unread', updatedAt: '2026-10-25' },
        { filePath: files[5].path, status: 'unread', updatedAt: '2026-10-26' },
    ];
    const result = await select(files, {
        readStatus: createViewerStatusReader(storage),
        request: async () => states,
    });
    assert.equal(result.file.path, '/books/unread.epub');
    assert.equal(result.file.viewerStatus.hasReadingProgress, false);
});

test('당일 추천은 읽기 시작·완독 후에도 유지하고 삭제된 경로는 다시 고른다', async () => {
    const files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }];
    const first = await select(files);
    const batches = [];
    for (const status of ['reading', 'completed']) {
        const next = await select(files, {
            record: first.record,
            request: async paths => {
                batches.push(paths);
                return paths.filter(filePath => filePath === first.file.path).map(filePath => ({ filePath, status }));
            },
        });
        assert.equal(next.file.path, first.file.path);
        assert.deepEqual(next.record, first.record);
        assert.equal(next.file.viewerStatus.isCompleted, status === 'completed');
        assert.equal(next.file.viewerStatus.hasReadingProgress, true);
    }
    assert.deepEqual(batches, [[first.file.path], [first.file.path]]);
    const remaining = files.filter(file => file.path !== first.file.path);
    const afterRemoval = await select(remaining, {
        record: first.record,
        request: async paths => { assert.ok(!paths.includes(first.file.path)); return []; },
    });
    assert.equal(afterRemoval.file.path, remaining[0].path);
});

test('모두 읽은 라이브러리는 제한된 배치로 끝까지 확인한 뒤 추천 없음으로 반환한다', async () => {
    const files = Array.from({ length: 123 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const requests = [];
    const result = await select(files, {
        request: async paths => {
            requests.push(paths);
            return paths.map(filePath => ({ filePath, status: 'completed' }));
        },
    });
    assert.equal(result.file, null);
    assert.equal(result.record.path, '');
    assert.deepEqual(requests.map(batch => batch.length), [50, 50, 23]);
    assert.equal(new Set(requests.flat()).size, 123);
});

test('폴더·사라진 항목·중복을 제외하고 macOS의 DB 경로 정규화를 일치시킨다', async () => {
    const path = '/books/책.epub'.normalize('NFD');
    const requests = [];
    const result = await select([
        { path }, { full_path: path.normalize('NFC') }, { path: '/books/folder', isDirectory: true },
        { path: '/books/missing.epub', exists: false }, null, {}, { path: '/books/unread.epub' },
    ], {
        platform: 'MacIntel',
        request: async paths => {
            requests.push(...paths);
            return [{ filePath: path.normalize('NFC'), status: 'completed' }];
        },
    });
    assert.equal(result.file.path, '/books/unread.epub');
    assert.equal(requests.length, 2);
    const empty = await select([], { request: () => assert.fail('An empty catalog must not query reading state') });
    assert.equal(empty.file, null);
    assert.equal(empty.record, null);
});

test('DB 실패와 잘못된 응답은 추천 없음으로 처리하지 않고 오류를 전달한다', async () => {
    const files = [{ path: '/books/a.epub' }];
    await assert.rejects(select(files, { request: async () => { throw new Error('database unavailable'); } }), /database unavailable/);
    await assert.rejects(select(files, { request: async () => ({ success: false }) }), /reading_state_unavailable/);
    await assert.rejects(select(files, { request: undefined }), /reading_state_unavailable/);
});

test('목록 변경이나 언마운트로 취소한 조회의 결과는 게시하지 않고 추가 요청도 중단한다', async () => {
    let current = true;
    let release;
    let requests = 0;
    const promise = select(Array.from({ length: 100 }, (_, index) => ({ path: `/books/${index}.epub` })), {
        isCurrent: () => current,
        request: () => { requests += 1; return new Promise(resolve => { release = resolve; }); },
    });
    current = false;
    release([]);
    assert.equal(await promise, null);
    assert.equal(requests, 1);
});
