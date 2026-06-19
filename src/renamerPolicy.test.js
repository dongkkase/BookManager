import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clampStartNumber,
    generateRenamerName,
    moveRenamerEntry,
} from './renamerPolicy.js';

test('원본 패턴 순서대로 새 이름을 생성한다', () => {
    const entry = { oldName: 'old.jpg' };
    assert.equal(generateRenamerName(entry, 0, 10, { patternIndex: 0 }), '00.jpg');
    assert.equal(generateRenamerName(entry, 0, 10, { patternIndex: 1 }), 'Cover.jpg');
    assert.equal(generateRenamerName(entry, 2, 10, { patternIndex: 1 }), 'Page_02.jpg');
    assert.equal(generateRenamerName(entry, 1, 10, { patternIndex: 2, archiveStem: 'My Book' }), 'My_Book_01.jpg');
    assert.equal(generateRenamerName(entry, 0, 10, { patternIndex: 3, archiveStem: 'My Book' }), 'My_Book_Cover.jpg');
    assert.equal(generateRenamerName(entry, 1, 10, { patternIndex: 4, customText: 'Page' }), 'Page_01.jpg');
});

test('WebP 변환과 내부 이름 유지가 확장자에 반영된다', () => {
    assert.equal(
        generateRenamerName({ oldName: 'cover.png' }, 0, 1, { keepName: true, webpConversion: true }),
        'cover.webp',
    );
});

test('드래그 순서 변경과 시작 번호 범위를 보정한다', () => {
    assert.deepEqual(moveRenamerEntry(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
    assert.equal(clampStartNumber(-1), 0);
    assert.equal(clampStartNumber(1000000), 999999);
});
