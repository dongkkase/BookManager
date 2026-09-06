import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrganizerRenameBatches } from './organizerRenamePolicy.js';

function makePairs(count) {
    return Array.from({ length: count }, (_, index) => ({
        oldPath: `Book/${String(index).padStart(4, '0')}.jpg`,
        newPath: `${String(index).padStart(4, '0')}.jpg`,
    }));
}

test('독립적인 이름 변경은 최대 128개로 묶고 원본 순서와 참조를 보존한다', () => {
    const pairs = Object.freeze(makePairs(260).map(Object.freeze));
    const batches = createOrganizerRenameBatches(pairs, '/bin/7za', '/out/book.partial');

    assert.deepEqual(batches.map(batch => batch.length), [128, 128, 4]);
    assert.deepEqual(batches.flat(), pairs);
    assert.equal(batches[1][0], pairs[128]);
});

test('긴 한글 경로는 인자 길이에 따라 더 작은 묶음으로 나눈다', () => {
    const command = 'C:\\Program Files\\BookManager\\7za.exe';
    const archivePath = `C:\\${'긴 출력 폴더 '.repeat(40)}\\book.partial`;
    const pairs = makePairs(80).map(pair => ({
        oldPath: `Book/${'긴 이름 '.repeat(35)}${pair.newPath}`,
        newPath: `${'긴 이름 '.repeat(35)}${pair.newPath}`,
    }));
    const batches = createOrganizerRenameBatches(pairs, command, archivePath);

    assert.ok(batches.length > 1);
    assert.deepEqual(batches.flat(), pairs);
    for (const batch of batches) {
        const args = [command, 'rn', archivePath, ...batch.flatMap(pair => [pair.oldPath, pair.newPath])];
        assert.ok(Buffer.byteLength(args.join('\0'), 'utf8') <= 8 * 1024);
    }
});

test('이름 충돌이나 의존 관계가 있으면 기존 20개 묶음 경계를 유지한다', () => {
    const cases = [
        pairs => { pairs[30].newPath = pairs[1].oldPath; },
        pairs => { pairs[30].newPath = pairs[1].newPath; },
        pairs => { pairs[30].oldPath = pairs[1].oldPath; },
        pairs => { pairs[30].oldPath = 'Book/scan*.jpg'; },
    ];
    for (const mutate of cases) {
        const pairs = makePairs(45);
        mutate(pairs);
        const batches = createOrganizerRenameBatches(pairs, '7za', '/out/book.partial');
        assert.deepEqual(batches.map(batch => batch.length), [20, 20, 5]);
        assert.deepEqual(batches.flat(), pairs);
    }

    const pairs = makePairs(45);
    pairs[30].newPath = '표지.jpg';
    const occupied = [{ name: '표지.JPG'.normalize('NFD') }];
    const batches = createOrganizerRenameBatches(pairs, '7za', '/out/book.partial', occupied);
    assert.deepEqual(batches.map(batch => batch.length), [20, 20, 5]);
    assert.deepEqual(batches.flat(), pairs);
});

test('빈 목록과 묶음 예산보다 긴 단일 경로도 항목을 유실하지 않는다', () => {
    assert.deepEqual(createOrganizerRenameBatches([], '7za', 'book.partial'), []);
    const pairs = [
        { oldPath: `Book/${'a'.repeat(20000)}.jpg`, newPath: 'page.jpg' },
        { oldPath: 'Book/002.jpg', newPath: '002.jpg' },
    ];
    const batches = createOrganizerRenameBatches(pairs, '7za', 'book.partial');
    assert.deepEqual(batches.map(batch => batch.length), [1, 1]);
    assert.deepEqual(batches.flat(), pairs);
});
