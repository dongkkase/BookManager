import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ANNOTATION_STORAGE_PREFIX,
    annotationBookAuthor,
    annotationBookTitle,
    annotationPathKey,
    annotationTimestamp,
    createAnnotationExport,
    deleteCatalogAnnotation,
    filterAnnotations,
    groupAnnotationsByBook,
    groupAnnotationsByMonth,
    readAnnotationCatalog,
    summarizeAnnotations,
} from './annotationCatalog.js';

const file = { path: '/library/book.epub', title: '첫 번째 책', writer: '홍길동' };
const secondFile = { full_path: '/library/other.txt', name: 'Other book', author: 'Jane Austen' };
const timestamp = (month, day = 1) => new Date(2026, month - 1, day, 12).getTime();
const storageFor = values => ({ getItem: key => values[key] ?? null });
const key = path => `${ANNOTATION_STORAGE_PREFIX}${path}`;

function indexedStorageFor(values) {
    const keys = Object.keys(values);
    return { ...storageFor(values), length: keys.length, key: index => keys[index] ?? null };
}

test('주석은 등록된 파일에서만 읽고 중복 파일과 빈 주석을 제외한다', () => {
    const storage = storageFor({
        [key(file.path)]: JSON.stringify([
            { id: 'one', text: '  마음에 남은 문장  ', color: 'blue', pageIndex: 0, createdAt: timestamp(10) },
            { id: 'one', text: '중복된 주석' },
            { id: 'blank', text: '  ' },
            { id: 'missing-text', snippet: '실제 선택한 본문 없음' },
            null,
        ]),
        [key(secondFile.full_path)]: JSON.stringify([{ text: 'A saved passage', color: 'unknown', pageIndex: -1 }]),
        [key('/outside.epub')]: JSON.stringify([{ text: 'Not in the library' }]),
    });
    const result = readAnnotationCatalog([file, file, secondFile, { path: '/directory', isDirectory: true }], storage);
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.errors, []);
    assert.equal(result.entries[0].text, '마음에 남은 문장');
    assert.equal(result.entries[0].pageIndex, 0);
    assert.equal(result.entries[0].file, file);
    assert.equal(result.entries[1].color, 'yellow');
    assert.equal(result.entries[1].pageIndex, null);
    assert.equal(result.entries[1].path, secondFile.full_path);
});

test('손상된 저장 데이터와 접근 거부는 오류로 보고하고 정상 도서를 계속 읽는다', () => {
    const storage = {
        getItem(storageKey) {
            if (storageKey === key(file.path)) return '{bad-json';
            if (storageKey === key('/denied.epub')) throw new Error('denied');
            if (storageKey === key('/invalid.epub')) return '{}';
            return JSON.stringify([{ text: '정상 데이터' }]);
        },
    };
    const result = readAnnotationCatalog([file, secondFile, { path: '/denied.epub' }, { path: '/invalid.epub' }], storage);
    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.errors, [file.path, '/denied.epub', '/invalid.epub']);
    assert.deepEqual(readAnnotationCatalog([file], null), { entries: [], errors: [file.path] });
});

test('macOS는 분해형·조합형 경로의 기존 주석을 읽고 같은 ID만 중복 제거한다', () => {
    const composed = '/library/한글 책.epub';
    const decomposed = composed.normalize('NFD');
    const values = {
        [key(composed)]: JSON.stringify([{ id: 'shared', text: '이전 사본' }, { id: 'alias', text: '조합형 경로의 주석' }, { text: 'ID 없는 조합형 기록' }]),
        [key(decomposed)]: JSON.stringify([{ id: 'shared', text: '현재 경로 사본' }, { id: 'exact', text: '분해형 경로의 주석' }, { text: 'ID 없는 분해형 기록' }]),
    };
    const original = JSON.stringify(values);
    const result = readAnnotationCatalog([{ path: decomposed }, { path: composed }], indexedStorageFor(values), { platform: 'MacIntel' });
    assert.equal(result.entries.length, 5);
    assert.equal(result.entries[0].text, '현재 경로 사본');
    assert.equal(result.entries.filter(entry => entry.text === '이전 사본').length, 0);
    assert.equal(result.entries.every(entry => entry.path === decomposed), true);
    assert.deepEqual(result.errors, []);
    assert.equal(JSON.stringify(values), original);
    for (const [libraryPath, storedPath] of [[decomposed, composed], [composed, decomposed]]) {
        const storage = indexedStorageFor({ [key(storedPath)]: JSON.stringify([{ id: 'one', text: '기존 주석' }]) });
        assert.equal(readAnnotationCatalog([{ path: libraryPath }], storage, { platform: 'darwin' }).entries.length, 1);
    }
    assert.notEqual(annotationPathKey('/Library/Book.epub', 'darwin'), annotationPathKey('/library/book.epub', 'darwin'));
});

test('Windows는 대소문자·경로 구분자가 다른 주석을 같은 도서에 연결한다', () => {
    const path = 'C:\\Library\\Book.epub';
    const alias = 'c:/library/BOOK.epub';
    const storage = indexedStorageFor({ [key(alias)]: JSON.stringify([{ id: 'one', text: 'Windows 주석' }]) });
    const result = readAnnotationCatalog([{ path }, { path: alias }], storage, { platform: 'Win32' });
    assert.equal(annotationPathKey(path, 'win32'), annotationPathKey(alias, 'Win32'));
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].path, path);
    assert.equal(annotationPathKey('\\\\NAS\\Books\\A.epub', 'Windows'), '//nas/books/a.epub');
});

test('Linux는 Unicode 정규형·대소문자·구분자가 다른 파일 경로를 구분한다', () => {
    const composed = '/library/한글.epub';
    const variants = [composed.normalize('NFD'), '/library/Book.epub', 'C:/library/Book.epub'];
    const paths = [composed, '/library/book.epub', 'C:\\library\\Book.epub'];
    const storage = indexedStorageFor(Object.fromEntries(variants.map((path, index) => [key(path), JSON.stringify([{ id: 'same-id', text: `다른 도서 ${index}` }])])));
    assert.equal(readAnnotationCatalog(paths.map(path => ({ path })), storage, { platform: 'Linux x86_64' }).entries.length, 0);
    assert.equal(readAnnotationCatalog(variants.map(path => ({ path })), storage, { platform: 'linux' }).entries.length, 3);
    assert.equal(annotationPathKey(composed, 'linux'), composed);
    assert.notEqual(annotationPathKey(composed.normalize('NFD'), 'linux'), composed);
});

test('저장키는 한 번만 열거하며 주석 이외 데이터와 라이브러리 밖 데이터는 읽지 않는다', () => {
    const values = {
        [key(file.path)]: JSON.stringify([{ id: 'first', text: '첫 기록' }]),
        [key(secondFile.full_path)]: JSON.stringify([{ id: 'second', text: '두 번째 기록' }]),
        [key('/outside.epub')]: JSON.stringify([{ text: '범위 밖' }]),
        'bookmanager-viewer-state:/library/book.epub': '{}',
    };
    const keys = Object.keys(values);
    let enumerated = 0;
    const readKeys = [];
    const storage = {
        length: keys.length,
        key(index) { enumerated += 1; return keys[index]; },
        getItem(storageKey) { readKeys.push(storageKey); return values[storageKey] ?? null; },
    };
    assert.equal(readAnnotationCatalog([file, secondFile], storage, { platform: 'darwin' }).entries.length, 2);
    assert.equal(enumerated, keys.length);
    assert.deepEqual(readKeys, [key(file.path), key(secondFile.full_path)]);
});

test('대형 라이브러리에서도 주석이 저장된 도서만 저장소와 표시 메타데이터를 읽는다', () => {
    let metadataReads = 0;
    const files = Array.from({ length: 50000 }, (_, index) => ({
        path: `/library/한글책-${index}.epub`,
        get title() { metadataReads += 1; return `Book ${index}`; },
    }));
    const values = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [
        key(files[index * 500].path.normalize('NFD')),
        JSON.stringify([{ id: String(index), text: '저장한 문장' }]),
    ]));
    const storage = indexedStorageFor(values);
    const readKeys = [];
    storage.getItem = storageKey => { readKeys.push(storageKey); return values[storageKey] ?? null; };
    const result = readAnnotationCatalog(files, storage, { platform: 'darwin' });
    assert.equal(result.entries.length, 100);
    assert.equal(readKeys.length, 100);
    assert.equal(metadataReads, 100);
    assert.deepEqual(result.errors, []);
});

test('주석 저장키가 없으면 라이브러리 전체를 탐색하지 않는다', () => {
    const files = [{ get path() { assert.fail('주석이 없으면 도서 경로를 읽을 필요가 없다'); } }];
    const storage = indexedStorageFor({ 'bookmanager-viewer-state:/library/book.epub': '{}' });
    storage.getItem = () => assert.fail('주석 이외 데이터는 읽지 않는다');
    assert.deepEqual(readAnnotationCatalog(files, storage), { entries: [], errors: [] });
});

test('key·length가 없거나 열거에 실패해도 정확한 저장키의 주석은 읽는다', () => {
    const values = { [key(file.path)]: JSON.stringify([{ id: 'one', text: '직접 읽기' }]) };
    for (const storage of [storageFor(values), { ...storageFor(values), get length() { throw new Error('denied'); } }]) {
        const result = readAnnotationCatalog([file], storage, { platform: 'darwin' });
        assert.equal(result.entries.length, 1);
        assert.deepEqual(result.errors, []);
    }
});

test('저장키를 일부 열거한 뒤 실패해도 나머지 도서의 정확한 키를 읽는다', () => {
    const values = {
        [key(file.path)]: JSON.stringify([{ id: 'one', text: '열거한 주석' }]),
        [key(secondFile.full_path)]: JSON.stringify([{ id: 'two', text: '직접 읽은 주석' }]),
    };
    const storage = indexedStorageFor(values);
    storage.key = index => {
        if (index === 1) throw new Error('enumeration failed');
        return key(file.path);
    };
    const result = readAnnotationCatalog([file, secondFile], storage);
    assert.deepEqual(result.entries.map(entry => entry.text), ['열거한 주석', '직접 읽은 주석']);
    assert.deepEqual(result.errors, []);
});

test('정확한 저장키가 손상되어도 같은 경로 별칭의 정상 기록은 보존한다', () => {
    const path = '/library/책.epub'.normalize('NFD');
    const storage = indexedStorageFor({
        [key(path)]: 'invalid-json',
        [key(path.normalize('NFC'))]: JSON.stringify([{ id: 'one', text: '남아 있는 기록' }]),
    });
    const result = readAnnotationCatalog([{ path }], storage, { platform: 'darwin' });
    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.errors, [path]);
});

function writableStorageFor(values) {
    return {
        get length() { return Object.keys(values).length; },
        key: index => Object.keys(values)[index] ?? null,
        getItem: storageKey => values[storageKey] ?? null,
        setItem: (storageKey, value) => { values[storageKey] = value; },
    };
}

test('주석 삭제는 선택한 ID만 제거하고 다른 주석과 도서 데이터를 보존한다', () => {
    const retained = { id: 'keep', text: '남길 문장', epubPosition: { spineIndex: 2 }, color: 'pink' };
    const values = {
        [key(file.path)]: JSON.stringify([{ id: 'delete', text: '지울 문장' }, retained, null, { id: 'blank', text: '' }]),
        [key(secondFile.full_path)]: JSON.stringify([{ id: 'delete', text: '다른 책의 같은 ID' }]),
        'bookmanager-viewer-state:/library/book.epub': '{"pageIndex":2}',
    };
    const storage = writableStorageFor(values);
    const entry = readAnnotationCatalog([file], storage).entries[0];
    assert.equal(deleteCatalogAnnotation(entry, storage), true);
    assert.deepEqual(JSON.parse(values[key(file.path)]), [retained, null, { id: 'blank', text: '' }]);
    assert.deepEqual(JSON.parse(values[key(secondFile.full_path)]), [{ id: 'delete', text: '다른 책의 같은 ID' }]);
    assert.equal(values['bookmanager-viewer-state:/library/book.epub'], '{"pageIndex":2}');
    assert.equal(deleteCatalogAnnotation(entry, storage), false);
    assert.deepEqual(readAnnotationCatalog([file], storage).entries.map(item => item.text), ['남길 문장']);
});

test('macOS·Windows 별칭에 중복된 주석 ID도 함께 삭제하여 다시 나타나지 않는다', () => {
    for (const [path, alias, platform] of [
        ['/library/한글.epub', '/library/한글.epub'.normalize('NFD'), 'MacIntel'],
        ['C:\\Library\\Book.epub', 'c:/library/BOOK.epub', 'Win32'],
    ]) {
        const values = {
            [key(path)]: JSON.stringify([{ id: 'same', text: '표시된 문장' }, { id: 'same', text: '같은 키 중복 기록' }, { id: 'keep', text: '남길 문장' }]),
            [key(alias)]: JSON.stringify([{ id: 'same', text: '이전 사본' }, { id: 'alias', text: '별칭의 다른 기록' }]),
        };
        const storage = writableStorageFor(values);
        const entry = readAnnotationCatalog([{ path }], storage, { platform }).entries[0];
        assert.equal(deleteCatalogAnnotation(entry, storage, { platform }), true);
        assert.deepEqual(JSON.parse(values[key(path)]).map(item => item.id), ['keep']);
        assert.deepEqual(JSON.parse(values[key(alias)]).map(item => item.id), ['alias']);
        assert.equal(readAnnotationCatalog([{ path }], storage, { platform }).entries.length, 2);
    }
});

test('Linux에서 다른 경로의 동일 ID와 macOS 별칭의 ID 없는 주석은 별개로 유지한다', () => {
    const path = '/library/한글.epub';
    const alias = path.normalize('NFD');
    const legacy = { text: 'ID 없는 동일한 문장', color: 'blue' };
    for (const platform of ['linux', 'darwin']) {
        const values = {
            [key(path)]: JSON.stringify(platform === 'linux' ? [{ id: 'same', text: '표시된 문장' }] : [legacy]),
            [key(alias)]: JSON.stringify(platform === 'linux' ? [{ id: 'same', text: '별개 도서의 문장' }] : [legacy]),
        };
        const originalAlias = values[key(alias)];
        const storage = writableStorageFor(values);
        const entry = readAnnotationCatalog([{ path }], storage, { platform }).entries[0];
        assert.equal(deleteCatalogAnnotation(entry, storage, { platform }), true);
        assert.equal(values[key(path)], '[]');
        assert.equal(values[key(alias)], originalAlias);
    }
});

test('ID 없는 이전 주석은 인덱스가 바뀌어도 같은 원본만 삭제하고 수정된 주석은 보존한다', () => {
    const first = { text: '첫 문장' };
    const second = { text: '두 번째 문장', snippet: '원문' };
    const values = { [key(file.path)]: JSON.stringify([first, second]) };
    const storage = writableStorageFor(values);
    const entries = readAnnotationCatalog([file], storage).entries;
    assert.equal(deleteCatalogAnnotation(entries[0], storage), true);
    assert.equal(deleteCatalogAnnotation(entries[1], storage), true);
    assert.equal(values[key(file.path)], '[]');
    values[key(file.path)] = JSON.stringify([{ ...first, color: 'red' }, second]);
    const modified = values[key(file.path)];
    assert.equal(deleteCatalogAnnotation(entries[0], storage), false);
    assert.equal(values[key(file.path)], modified);
});

test('손상되거나 읽을 수 없는 별칭이 있으면 어떤 주석도 삭제하지 않는다', () => {
    const path = '/library/책.epub';
    const alias = path.normalize('NFD');
    for (const invalid of ['{bad-json', '{}', 'denied']) {
        const values = {
            [key(path)]: JSON.stringify([{ id: 'one', text: '남아 있는 기록' }]),
            [key(alias)]: invalid,
        };
        const storage = writableStorageFor(values);
        const entry = readAnnotationCatalog([{ path }], storage, { platform: 'darwin' }).entries[0];
        const original = JSON.stringify(values);
        if (invalid === 'denied') {
            storage.getItem = storageKey => {
                if (storageKey === key(alias)) throw new Error('denied');
                return values[storageKey] ?? null;
            };
        }
        assert.throws(() => deleteCatalogAnnotation(entry, storage, { platform: 'darwin' }));
        assert.equal(JSON.stringify(values), original);
    }
});

test('별칭 저장 중 실패하면 이미 저장한 주석을 원래 값으로 복원한다', () => {
    const path = '/library/책.epub';
    const alias = path.normalize('NFD');
    const values = {
        [key(path)]: JSON.stringify([{ id: 'one', text: '표시된 문장' }]),
        [key(alias)]: JSON.stringify([{ id: 'one', text: '이전 사본' }]),
    };
    const storage = writableStorageFor(values);
    const entry = readAnnotationCatalog([{ path }], storage, { platform: 'darwin' }).entries[0];
    const original = JSON.stringify(values);
    storage.setItem = (storageKey, value) => {
        if (storageKey === key(alias)) throw new Error('write denied');
        values[storageKey] = value;
    };
    assert.throws(() => deleteCatalogAnnotation(entry, storage, { platform: 'darwin' }), /write denied/);
    assert.equal(JSON.stringify(values), original);
});

test('저장소 열거 실패와 잘못된 삭제 대상은 기존 데이터를 변경하지 않는다', () => {
    const values = { [key(file.path)]: JSON.stringify([{ id: 'one', text: '남아 있는 기록' }]) };
    const storage = writableStorageFor(values);
    const entry = readAnnotationCatalog([file], storage).entries[0];
    const original = JSON.stringify(values);
    storage.key = () => { throw new Error('enumeration denied'); };
    assert.throws(() => deleteCatalogAnnotation(entry, storage), /enumerate/);
    assert.throws(() => deleteCatalogAnnotation({ ...entry, path: secondFile.full_path }, storage), /source/);
    assert.throws(() => deleteCatalogAnnotation({ path: file.path }, storage), /source/);
    assert.throws(() => deleteCatalogAnnotation(entry, null), /Storage/);
    assert.equal(JSON.stringify(values), original);
});

test('ISO 날짜와 숫자 timestamp를 읽고 locale 날짜에는 timestamp ID를 우선 적용한다', () => {
    assert.equal(annotationTimestamp({ createdAt: '2026-10-25T03:00:00.000Z' }), Date.parse('2026-10-25T03:00:00.000Z'));
    assert.equal(annotationTimestamp({ createdAt: timestamp(10, 25) }), timestamp(10, 25));
    assert.equal(annotationTimestamp({ createdAt: String(timestamp(10, 25)) }), timestamp(10, 25));
    assert.equal(annotationTimestamp({ createdAt: '04/05/2026 10:00:00', id: `${timestamp(10, 25)}-abc` }), timestamp(10, 25));
    assert.equal(annotationTimestamp({ createdAt: 'broken date', id: `${timestamp(10, 25)}-abc` }), timestamp(10, 25));
});

test('이전 한국어·영어·일본어 날짜를 읽고 잘못된 날짜는 미상으로 남긴다', () => {
    assert.equal(annotationTimestamp({ createdAt: '2026. 10. 25. 오후 3:04:05' }), new Date(2026, 9, 25, 15, 4, 5).getTime());
    assert.equal(annotationTimestamp({ createdAt: '2026. 10. 25. 오전 12:04:05' }), new Date(2026, 9, 25, 0, 4, 5).getTime());
    assert.equal(annotationTimestamp({ createdAt: '10/25/2026, 3:04:05 PM' }), new Date(2026, 9, 25, 15, 4, 5).getTime());
    assert.equal(annotationTimestamp({ createdAt: '2026/10/25 15:04:05' }), new Date(2026, 9, 25, 15, 4, 5).getTime());
    assert.equal(annotationTimestamp({ createdAt: '2026/10/25 午後3:04:05' }), new Date(2026, 9, 25, 15, 4, 5).getTime());
    assert.equal(annotationTimestamp({ createdAt: '25/10/2026, 15:04:05' }), new Date(2026, 9, 25, 15, 4, 5).getTime());
    assert.equal(annotationTimestamp({ createdAt: '2026. 10. 25.' }), new Date(2026, 9, 25).getTime());
    assert.equal(annotationTimestamp({ createdAt: '2026. 02. 31. 오후 3:04:05' }), null);
    assert.equal(annotationTimestamp({ createdAt: 'not a date' }), null);
    assert.equal(annotationTimestamp({}), null);
});

function sampleEntries() {
    return readAnnotationCatalog([file, secondFile], storageFor({
        [key(file.path)]: JSON.stringify([
            { id: 'a', text: '푸른 바다', color: 'blue', createdAt: timestamp(10, 1) },
            { id: 'b', text: '초록 숲', color: 'green', createdAt: timestamp(10, 3) },
            { id: 'c', text: '날짜 없는 문장', color: 'blue' },
        ]),
        [key(secondFile.full_path)]: JSON.stringify([
            { id: 'd', text: 'Austen and the BLUE sea', color: 'blue', createdAt: timestamp(9, 2) },
            { id: 'e', text: 'Earlier passage', color: 'underline', createdAt: new Date(2025, 9, 3).getTime() },
        ]),
    })).entries;
}

test('추가된 다섯 색상은 저장값·필터별 개수·내보내기에서 노랑으로 바뀌지 않는다', () => {
    const colors = ['orange', 'red', 'olive', 'cyan', 'gray'];
    const saved = JSON.stringify(colors.flatMap(color => [
        { id: `${color}-first`, color, text: `${color} 첫 문장`, pageIndex: 0 },
        { id: `${color}-second`, color, text: `${color} 두 번째 문장`, pageIndex: 1 },
    ]));
    const storage = indexedStorageFor({ [key(file.path)]: saved });
    const { entries } = readAnnotationCatalog([file], storage);
    const summary = summarizeAnnotations(entries);
    assert.equal(summary.total, 10);
    assert.deepEqual(summary.colors, colors.map(color => ({ color, count: 2 })));
    assert.deepEqual(summary.styles, [{ style: 'highlight', count: 10 }, { style: 'underline', count: 0 }, { style: 'strikethrough', count: 0 }]);
    for (const color of colors) {
        const filtered = filterAnnotations(entries, { color });
        assert.equal(filtered.length, 2);
        const exported = JSON.parse(createAnnotationExport(filtered, { format: 'json' }).text);
        assert.deepEqual(exported.map(entry => entry.color), [color, color]);
        assert.ok(exported.every(entry => entry.style === 'highlight'));
    }
    for (const language of ['ko', 'en', 'ja']) {
        const result = createAnnotationExport(entries, { format: 'csv', language });
        assert.ok(!result.text.includes('undefined'));
    }
    assert.equal(storage.getItem(key(file.path)), saved);
});

test('검색은 본문·도서명·저자에 적용하고 색상·도서 조건을 함께 적용한다', () => {
    const entries = sampleEntries();
    assert.equal(filterAnnotations(entries, { query: '홍길동 바다' }).length, 1);
    assert.equal(filterAnnotations(entries, { query: 'jane ｂｌｕｅ' }).length, 1);
    assert.equal(filterAnnotations(entries, { query: '첫 번째' }).length, 3);
    assert.equal(filterAnnotations(entries, { color: 'blue', bookPath: file.path }).length, 2);
    assert.equal(filterAnnotations(entries, { color: 'green', query: '바다' }).length, 0);
    assert.equal(entries[0].text, '푸른 바다');
});

test('취소선 저장값을 보존하고 표시 방식 필터·개수·내보내기에서 하이라이트와 구분한다', () => {
    const saved = JSON.stringify([
        { id: 'strike-one', text: '지울 첫 문장', color: 'strikethrough', pageIndex: 1, createdAt: timestamp(10, 25) },
        { id: 'strike-two', text: '지울 두 번째 문장', color: 'strikethrough', createdAt: timestamp(9, 14) },
        { id: 'underline', text: '밑줄 문장', color: 'underline' },
        { id: 'highlight', text: '파란 문장', color: 'blue' },
    ]);
    const storage = indexedStorageFor({ [key(file.path)]: saved });
    const { entries } = readAnnotationCatalog([file], storage);
    assert.deepEqual(entries.map(entry => entry.color), ['strikethrough', 'strikethrough', 'underline', 'blue']);
    const summary = summarizeAnnotations(entries);
    assert.deepEqual(summary.styles, [{ style: 'highlight', count: 1 }, { style: 'underline', count: 1 }, { style: 'strikethrough', count: 2 }]);
    assert.deepEqual(summary.colors, [{ color: 'blue', count: 1 }, { color: 'underline', count: 1 }, { color: 'strikethrough', count: 2 }]);
    assert.equal(filterAnnotations(entries, { style: 'highlight' }).length, 1);
    assert.equal(filterAnnotations(entries, { style: 'underline' }).length, 1);
    const filtered = filterAnnotations(entries, { style: 'strikethrough' });
    assert.deepEqual(filtered.map(entry => entry.text), ['지울 첫 문장', '지울 두 번째 문장']);
    assert.equal(filterAnnotations(entries, { style: 'strikethrough', color: 'blue' }).length, 0);
    assert.equal(filterAnnotations(entries, { style: 'strikethrough', bookPath: file.path, month: '2026-10', query: '첫' }).length, 1);
    assert.equal(filterAnnotations(entries, { color: 'strikethrough' }).length, 2);
    const exported = JSON.parse(createAnnotationExport(filtered, { format: 'json' }).text);
    assert.ok(exported.every(entry => entry.color === 'strikethrough' && entry.style === 'strikethrough'));
    for (const [language, label] of [['ko', '취소선'], ['en', 'Strikethrough'], ['ja', '取り消し線']]) {
        assert.ok(createAnnotationExport(filtered, { format: 'csv', language }).text.includes(`"${label}","${label}"`));
        assert.ok(createAnnotationExport(filtered, { format: 'markdown', language }).text.includes(`: ${label}\n`));
    }
    assert.equal(storage.getItem(key(file.path)), saved);
});

test('표시 방식과 월 필터는 검색·색상·도서 필터와 함께 적용하고 날짜 미상도 선택한다', () => {
    const entries = sampleEntries();
    assert.equal(filterAnnotations(entries, { style: 'highlight' }).length, 4);
    assert.deepEqual(filterAnnotations(entries, { style: 'underline' }).map(entry => entry.text), ['Earlier passage']);
    assert.deepEqual(filterAnnotations(entries, { month: '2026-10', sort: 'oldest' }).map(entry => entry.text), ['푸른 바다', '초록 숲']);
    assert.deepEqual(filterAnnotations(entries, { month: 'unknown' }).map(entry => entry.text), ['날짜 없는 문장']);
    assert.equal(filterAnnotations(entries, { style: 'highlight', month: '2026-10', color: 'blue', bookPath: file.path, query: '홍길동 바다' }).length, 1);
    assert.equal(filterAnnotations(entries, { style: 'underline', color: 'blue' }).length, 0);
    assert.equal(filterAnnotations(entries, { style: 'underline', month: '2026-10' }).length, 0);
    assert.equal(filterAnnotations(entries, { month: '2026-08' }).length, 0);
    assert.equal(entries[0].text, '푸른 바다');
});

test('최신순·오래된순 모두 날짜 미상은 마지막에 배치하고 월별 그룹을 만든다', () => {
    const newest = filterAnnotations(sampleEntries());
    const oldest = filterAnnotations(sampleEntries(), { sort: 'oldest' });
    assert.equal(newest[0].text, '초록 숲');
    assert.equal(oldest[0].text, 'Earlier passage');
    assert.equal(newest.at(-1).text, '날짜 없는 문장');
    assert.equal(oldest.at(-1).text, '날짜 없는 문장');
    const groups = groupAnnotationsByMonth(newest);
    assert.deepEqual(groups.map(group => group.key), ['2026-10', '2026-09', '2025-10', 'unknown']);
    assert.equal(groups[0].entries.length, 2);
});

test('도서별 그룹은 제목을 정렬하되 같은 제목의 다른 도서와 주석 입력 순서를 보존한다', () => {
    const entries = filterAnnotations(sampleEntries());
    const before = entries.map(entry => entry.id);
    const groups = groupAnnotationsByBook(entries, 'en-US');
    assert.deepEqual(groups.map(group => group.key), [secondFile.full_path, file.path]);
    assert.equal(groups[0].title, 'Other book');
    assert.equal(groups[0].author, 'Jane Austen');
    assert.equal(groups[0].file, secondFile);
    assert.deepEqual(groups[1].entries.map(entry => entry.text), ['초록 숲', '푸른 바다', '날짜 없는 문장']);
    assert.deepEqual(entries.map(entry => entry.id), before);
    const distinctBooks = groupAnnotationsByBook([
        { ...entries[0], path: '/book-10', title: '책 10' },
        { ...entries[0], path: '/book-2', title: '책 2' },
        { ...entries[0], path: '/another-book-2', title: '책 2' },
    ]);
    assert.deepEqual(distinctBooks.map(group => group.key), ['/book-2', '/another-book-2', '/book-10']);
    assert.deepEqual(groupAnnotationsByBook([]), []);
});

test('통계는 색상·도서·최근 12개월을 집계하며 오래되거나 날짜 없는 주석도 전체 수에는 포함한다', () => {
    const summary = summarizeAnnotations(sampleEntries(), new Date(2026, 9, 25));
    assert.equal(summary.total, 5);
    assert.equal(summary.bookCount, 2);
    assert.deepEqual(summary.colors, [{ color: 'green', count: 1 }, { color: 'blue', count: 3 }, { color: 'underline', count: 1 }]);
    assert.deepEqual(summary.styles, [{ style: 'highlight', count: 4 }, { style: 'underline', count: 1 }, { style: 'strikethrough', count: 0 }]);
    assert.equal(summary.books[0].path, file.path);
    assert.equal(summary.books[0].count, 3);
    assert.equal(summary.months.length, 12);
    assert.equal(summary.months[0].key, '2025-11');
    assert.equal(summary.months.at(-1).key, '2026-10');
    assert.equal(summary.months.at(-1).count, 2);
    assert.equal(summary.months.reduce((sum, month) => sum + month.count, 0), 3);
    assert.equal(summarizeAnnotations([], new Date(2026, 9, 25)).total, 0);
    assert.deepEqual(summarizeAnnotations([]).styles, [{ style: 'highlight', count: 0 }, { style: 'underline', count: 0 }, { style: 'strikethrough', count: 0 }]);
});

test('JSON 내보내기는 전달한 주석의 순서와 본문만 유지하고 내부 파일 정보는 제외한다', () => {
    const entries = filterAnnotations(sampleEntries(), { month: '2026-10' }).map((entry, index) => ({
        ...entry,
        pageIndex: index === 0 ? 0 : null,
        full_path: '/private/full-path-secret',
        storageKey: 'private-storage-key',
        file: { ...entry.file, secret: 'private-file-metadata' },
    }));
    const original = JSON.stringify(entries);
    const result = createAnnotationExport(entries, { format: 'json', language: 'en' });
    assert.equal(result.mimeType, 'application/json;charset=utf-8');
    assert.equal(result.extension, 'json');
    const records = JSON.parse(result.text);
    assert.deepEqual(Object.keys(records[0]), ['title', 'author', 'text', 'color', 'style', 'page', 'createdAt']);
    assert.deepEqual(records.map(record => record.text), ['초록 숲', '푸른 바다']);
    assert.equal(records[0].page, 1);
    assert.equal(records[1].page, null);
    assert.equal(records[0].createdAt, new Date(timestamp(10, 3)).toISOString());
    assert.equal(records[0].style, 'highlight');
    assert.equal(records[0].color, 'green');
    assert.equal(JSON.stringify(entries), original);
    for (const format of ['json', 'csv', 'markdown']) {
        const { text } = createAnnotationExport(entries, { format });
        for (const privateValue of [file.path, '/private/full-path-secret', 'private-storage-key', 'private-file-metadata', entries[0].id]) {
            assert.equal(text.includes(privateValue), false);
        }
    }
    const undated = JSON.parse(createAnnotationExport([{ ...entries[0], color: 'underline', timestamp: null, pageIndex: -1 }], { format: 'json' }).text)[0];
    assert.equal(undated.style, 'underline');
    assert.equal(undated.createdAt, null);
    assert.equal(undated.page, null);
});

test('Markdown 내보내기는 여러 줄 인용문과 빈 줄을 유지하고 메타데이터를 구분한다', () => {
    const entries = [{
        ...sampleEntries()[0], title: '책 [1]\n다음 줄', author: '*저자*', text: '첫 줄\n\n  마지막 줄', pageIndex: 2, timestamp: null,
    }];
    const result = createAnnotationExport(entries);
    assert.equal(result.extension, 'md');
    assert.equal(result.mimeType, 'text/markdown;charset=utf-8');
    assert.match(result.text, /^# 주석\n/);
    assert.ok(result.text.includes('## 책 \\[1\\] 다음 줄'));
    assert.ok(result.text.includes('- 저자: \\*저자\\*'));
    assert.ok(result.text.includes('- 색상: 파랑\n- 표시 방식: 하이라이트\n- 페이지: 3\n- 날짜: 미상'));
    assert.ok(result.text.includes('> 첫 줄\n> \n>   마지막 줄'));
    assert.ok(createAnnotationExport(entries, { language: 'en' }).text.startsWith('# Annotations\n'));
    assert.ok(createAnnotationExport(entries, { language: 'ja' }).text.includes('- ページ: 3'));
});

test('CSV 내보내기는 쉼표·따옴표·줄바꿈을 인용하고 수식으로 해석되는 시작 문자를 보호한다', () => {
    const base = { ...sampleEntries()[0], title: '=HYPERLINK("https://example.test")', author: '  @author', pageIndex: 0 };
    const quote = 'He said, "read"\nagain';
    const result = createAnnotationExport([{ ...base, text: quote }], { format: 'csv', language: 'en' });
    assert.equal(result.extension, 'csv');
    assert.equal(result.mimeType, 'text/csv;charset=utf-8');
    assert.ok(result.text.startsWith('\uFEFF"Book","Author","Quote","Color","Style","Page","Date"\r\n'));
    assert.ok(result.text.includes('"\'=HYPERLINK(""https://example.test"")"'));
    assert.ok(result.text.includes('"\'  @author"'));
    assert.ok(result.text.includes('"He said, ""read""\nagain"'));
    assert.ok(result.text.includes('"Blue","Highlight","1"'));
    for (const text of ['=1+1', '+1+1', '-1+1', '@SUM(1)', ' \t=1+1', '\ttext', '\rtext', '\ntext']) {
        const csv = createAnnotationExport([{ ...base, text }], { format: 'csv' }).text;
        assert.ok(csv.includes(`"'${text}"`), `수식 시작 문자 보호: ${JSON.stringify(text)}`);
    }
    const ordered = createAnnotationExport([{ ...base, text: 'first' }, { ...base, text: 'second' }], { format: 'csv', language: 'ja' }).text;
    assert.ok(ordered.startsWith('\uFEFF"書籍","著者","引用文"'));
    assert.ok(ordered.indexOf('"first"') < ordered.indexOf('"second"'));
});

test('빈 주석도 유효한 파일로 내보내며 지원하지 않는 형식은 거부한다', () => {
    assert.equal(createAnnotationExport([]).text, '# 주석\n');
    assert.deepEqual(JSON.parse(createAnnotationExport([], { format: 'json' }).text), []);
    assert.equal(createAnnotationExport([], { format: 'csv' }).text.split('\r\n').length, 2);
    assert.throws(() => createAnnotationExport([], { format: 'html' }), RangeError);
});

test('표시용 제목과 저자는 기존 파일 메타데이터의 대체 필드를 지원한다', () => {
    assert.equal(annotationBookTitle({ full_path: 'C:\\books\\Sample.epub' }), 'Sample.epub');
    assert.equal(annotationBookTitle({ title: '  ', name: 'Filename' }), 'Filename');
    assert.equal(annotationBookAuthor({ author: ['First', 'Second'] }), 'First, Second');
    assert.equal(annotationBookAuthor({ writer: 'Author', author: 'Legacy author' }), 'Author');
});

test('저자가 없는 파일은 PDF 제작 도구나 제작자 필드를 작가로 표시하지 않는다', () => {
    assert.equal(annotationBookAuthor({ writer: '', author: 'Adobe PDF Library', creators: 'Adobe PDF Library' }), '');
    assert.equal(annotationBookAuthor({ writer: null, author: 'PDF Producer' }), '');
    assert.equal(annotationBookAuthor({ creators: 'Adobe PDF Library' }), '');
});
