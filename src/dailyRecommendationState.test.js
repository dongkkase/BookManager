import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DAILY_RECOMMENDATION_STORAGE_KEY,
    dailyRecommendationDay,
    findDailyRecommendation,
    findDailyRecommendations,
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

function selectMany(files, overrides = {}) {
    return findDailyRecommendations({
        files, day: '2026-10-26', seed: 12345,
        request: async () => [], readStatus: createViewerStatusReader(memoryStorage()),
        ...overrides,
    });
}

test('추천 목록은 중복 없이 최대 8권을 같은 순서로 고르고 큰 서재도 필요한 배치만 조회한다', async () => {
    const files = Array.from({ length: 10000 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const batches = [];
    const first = await selectMany([...files, ...files], { request: async paths => { batches.push(paths); return []; } });
    const reversed = await selectMany([...files].reverse());
    assert.equal(first.files.length, 8);
    assert.equal(new Set(first.record.paths).size, 8);
    assert.deepEqual(first.record.paths, reversed.record.paths);
    assert.equal(first.file, first.files[0]);
    assert.equal(first.sourceFile, first.sourceFiles[0]);
    assert.deepEqual(batches.map(batch => batch.length), [50]);
    assert.equal((await selectMany(files, { count: 100 })).files.length, 8);
});

test('단일 추천 저장값은 첫 위치를 유지하여 8권으로 확장하고 저장목록과 활성 책을 재진입에도 유지한다', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const old = await select(files);
    const migrated = await selectMany(files, { record: old.record });
    assert.equal(migrated.record.paths[0], old.record.path);
    assert.equal(migrated.file.path, old.file.path);
    const record = { ...migrated.record, path: migrated.record.paths[5] };
    const requests = [];
    const restored = await selectMany([{ path: '/books/new.epub' }, ...files].reverse(), {
        record,
        request: async paths => {
            requests.push(paths);
            return paths.map(filePath => ({ filePath, status: 'completed' }));
        },
    });
    assert.deepEqual(restored.record, record);
    assert.deepEqual(restored.files.map(file => file.path), record.paths);
    assert.equal(restored.file.path, record.path);
    assert.ok(restored.files.every(file => file.viewerStatus.isCompleted));
    assert.deepEqual(requests, [record.paths]);
});

test('추천 목록에서 삭제되거나 중간권이 된 책을 빼고 미독 후보로 보충하며 남은 순서는 유지한다', async () => {
    const files = Array.from({ length: 14 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const first = await selectMany(files);
    const [removed, middle] = first.record.paths;
    const nextFiles = files.filter(file => file.path !== removed).map(file => file.path === middle ? { ...file, volume: '2' } : file);
    const batches = [];
    const next = await selectMany(nextFiles, { record: first.record, request: async paths => { batches.push(paths); return []; } });
    assert.equal(next.files.length, 8);
    assert.deepEqual(next.record.paths.slice(0, 6), first.record.paths.slice(2));
    assert.ok(!next.record.paths.includes(removed));
    assert.ok(!next.record.paths.includes(middle));
    assert.ok(!batches.flat().includes(removed));
    assert.ok(!batches.flat().includes(middle));
    assert.equal(next.file.path, first.record.paths[2]);
});

test('다음 날 추천 목록은 미독 상태를 다시 확인하고 전날 활성 책은 가능한 뒤로 배치한다', async () => {
    const files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }, { path: '/books/c.epub' }];
    const first = await selectMany(files);
    const reading = first.record.paths[1];
    const next = await selectMany(files, {
        day: '2026-10-27', record: first.record,
        request: async paths => paths.filter(path => path === reading).map(filePath => ({ filePath, status: 'reading' })),
    });
    assert.equal(next.files.length, 2);
    assert.notEqual(next.file.path, first.file.path);
    assert.equal(next.record.paths.at(-1), first.file.path);
    assert.ok(!next.record.paths.includes(reading));
    assert.equal(next.record.previousPath, first.file.path);
});

test('추천 목록도 로컬 읽음·첫권 조건·경로 정규화를 따르며 적은 후보와 빈 서재를 처리한다', async () => {
    const decomposed = '/books/책.epub'.normalize('NFD');
    const files = [
        { path: decomposed }, { path: decomposed.normalize('NFC') },
        { path: '/books/local.epub' }, { path: '/books/reading.epub' },
        { path: '/books/middle.epub', volume: '2' }, { path: '/books/missing.epub', exists: false },
    ];
    const storage = memoryStorage({ 'bookmanager-viewer-state:/books/local.epub': JSON.stringify({ pageIndex: 0 }) });
    const result = await selectMany(files, {
        platform: 'MacIntel', readStatus: createViewerStatusReader(storage),
        request: async () => [{ filePath: '/books/reading.epub', status: 'reading' }],
    });
    assert.deepEqual(result.record.paths, [decomposed]);
    const empty = await selectMany([], { request: () => assert.fail('Empty catalogs must not query reading state') });
    assert.deepEqual(empty.files, []);
    assert.equal(empty.file, null);
    assert.equal(empty.record, null);
    const allRead = await selectMany(files, { request: async paths => paths.map(filePath => ({ filePath, status: 'completed' })) });
    assert.deepEqual(allRead.files, []);
    assert.equal(allRead.record.path, '');
    assert.deepEqual(allRead.record.paths, []);
});

test('추천 목록 저장값은 이전 단일 형식을 허용하고 손상된 목록은 무시한다', async () => {
    const first = await selectMany([{ path: '/books/a.epub' }, { path: '/books/b.epub' }]);
    const storage = memoryStorage();
    const read = record => {
        storage.setItem(DAILY_RECOMMENDATION_STORAGE_KEY, JSON.stringify(record));
        return readDailyRecommendation(storage);
    };
    assert.deepEqual(read(first.record), first.record);
    for (const paths of [null, {}, [first.record.path, first.record.path], [false], [''], Array.from({ length: 9 }, (_, index) => `/books/${index}.epub`), []]) {
        assert.equal(read({ ...first.record, paths }), null, JSON.stringify(paths));
    }
    assert.equal(read({ ...first.record, path: '/books/not-in-list.epub' }), null);
    const { paths, ...legacy } = first.record;
    assert.deepEqual(read(legacy), legacy);
    assert.deepEqual(read({ ...first.record, paths: [], path: '' }).paths, []);
});

test('추천 목록 검증 실패는 전달하고 취소한 배치 뒤에는 추가 요청을 하지 않는다', async () => {
    const files = Array.from({ length: 123 }, (_, index) => ({ path: `/books/${index}.epub` }));
    await assert.rejects(selectMany(files, { request: async () => ({ success: false }) }), /reading_state_unavailable/);
    await assert.rejects(selectMany(files, { request: async () => { throw new Error('offline'); } }), /offline/);
    let current = true;
    let release;
    let requests = 0;
    const pending = selectMany(files, {
        isCurrent: () => current,
        request: () => { requests += 1; return new Promise(resolve => { release = resolve; }); },
    });
    current = false;
    release([]);
    assert.equal(await pending, null);
    assert.equal(requests, 1);
});

test('전체 재추첨은 기존 8권 밖의 미독 책만으로 새 8권을 만들고 기존 목록은 조회하지 않는다', async () => {
    const files = Array.from({ length: 20 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const first = await selectMany(files);
    const requests = [];
    const next = await selectMany(files, {
        record: first.record, seed: 98765, redraw: true,
        request: async paths => { requests.push(...paths); return []; },
    });
    assert.equal(next.files.length, 8);
    assert.equal(new Set(next.record.paths).size, 8);
    assert.ok(next.record.paths.every(path => !first.record.paths.includes(path)));
    assert.ok(requests.every(path => !first.record.paths.includes(path)));
    assert.equal(next.file, next.files[0]);
    assert.equal(next.record.seed, 98765);
});

test('전체 재추첨은 새 후보가 부족하면 기존 미독 목록에서 보충하되 읽은 책과 중간권을 제외한다', async () => {
    const files = Array.from({ length: 10 }, (_, index) => ({ path: `/books/${index}.epub` }));
    const first = await selectMany(files);
    const readingPath = first.record.paths[2];
    const middlePath = first.record.paths[3];
    const outsidePaths = files.map(file => file.path).filter(path => !first.record.paths.includes(path));
    const next = await selectMany([...files.map(file => file.path === middlePath ? { ...file, volume: '2' } : file), ...files.slice(0, 1)], {
        record: first.record, seed: 98765, redraw: true,
        request: async paths => paths.filter(path => path === readingPath).map(filePath => ({ filePath, status: 'reading' })),
    });
    assert.equal(next.files.length, 8);
    assert.equal(new Set(next.record.paths).size, 8);
    assert.deepEqual(new Set(next.record.paths.slice(0, 2)), new Set(outsidePaths));
    assert.ok(!next.record.paths.includes(readingPath));
    assert.ok(!next.record.paths.includes(middlePath));
    assert.notEqual(next.file.path, first.file.path);
});

test('기존 책만 있는 전체 재추첨도 우연히 같은 순서가 나오면 재정렬하고 활성 책을 가능한 뒤로 둔다', async () => {
    for (const count of [2, 8]) {
        const files = Array.from({ length: count }, (_, index) => ({ path: `/books/${index}.epub` }));
        const first = await selectMany(files);
        const record = { ...first.record, path: first.record.paths.at(-1) };
        const next = await selectMany(files, { record, redraw: true });
        assert.equal(next.files.length, count);
        assert.deepEqual(new Set(next.record.paths), new Set(record.paths));
        assert.notDeepEqual(next.record.paths, record.paths);
        if (count > 2) assert.notEqual(next.file.path, record.path);
        assert.deepEqual(next.sourceFiles.map(file => file.path), next.record.paths);
    }
});

test('전체 재추첨에서 가능한 책이 한 권이면 유지하고 모두 읽혔으면 빈 결과를 반환한다', async () => {
    const files = [{ path: '/books/only.epub' }];
    const first = await selectMany(files);
    const next = await selectMany(files, { record: first.record, redraw: true, seed: 98765 });
    assert.deepEqual(next.record.paths, first.record.paths);
    const empty = await selectMany(files, {
        record: first.record, redraw: true,
        request: async paths => paths.map(filePath => ({ filePath, status: 'completed' })),
    });
    assert.deepEqual(empty.files, []);
    assert.equal(empty.file, null);
    assert.deepEqual(empty.record.paths, []);
});
