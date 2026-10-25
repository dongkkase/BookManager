import assert from 'node:assert/strict';
import test from 'node:test';
import {
    latestMetadataPathKey,
    latestMetadataTitleKey,
    normalizeLatestMetadataTitle,
} from './metadataLatestPolicy.js';

test('최신권 macOS 경로 비교는 한글 NFC/NFD만 통일하고 실제 후보 경로를 바꾸지 않는다', () => {
    const composed = '/라이브러리/별의 여행 11권.cbz';
    const decomposed = composed.normalize('NFD');
    assert.notEqual(composed, decomposed);
    assert.equal(latestMetadataPathKey(composed, 'darwin'), latestMetadataPathKey(decomposed, 'darwin'));
    assert.equal(latestMetadataPathKey('/라이브러리/다른 폴더/../별의 여행 11권.cbz', 'darwin'), latestMetadataPathKey(composed, 'darwin'));
    assert.notEqual(latestMetadataPathKey(composed, 'darwin'), latestMetadataPathKey('/라이브러리/별의 여행 10권.cbz', 'darwin'));
    assert.equal(latestMetadataPathKey('', 'darwin'), '');
});

test('최신권 Windows 경로 비교는 대소문자를 무시하고 Linux 파일명은 구별한다', () => {
    assert.equal(latestMetadataPathKey('C:\\Library\\Book.cbz', 'win32'), latestMetadataPathKey('c:/library/book.cbz', 'win32'));
    const composed = '/library/별의 여행.cbz';
    assert.notEqual(latestMetadataPathKey(composed, 'linux'), latestMetadataPathKey(composed.normalize('NFD'), 'linux'));
    assert.notEqual(latestMetadataPathKey('/library/Book.cbz', 'linux'), latestMetadataPathKey('/library/book.cbz', 'linux'));
});

test('최신권 검색 제목에서 한국어 권수와 화수를 제거한다', () => {
    assert.equal(normalizeLatestMetadataTitle('별의 여행 10권'), '별의 여행');
    assert.equal(normalizeLatestMetadataTitle('별의 여행 - 제10.5화'), '별의 여행');
    assert.equal(normalizeLatestMetadataTitle('별의 여행 (1~3권)'), '별의 여행');
    assert.equal(normalizeLatestMetadataTitle('별의 여행 1권~10권'), '별의 여행');
    assert.equal(normalizeLatestMetadataTitle('별의 여행 12권 34화'), '별의 여행');
    assert.equal(normalizeLatestMetadataTitle('별의 여행 12권 - 완결'), '별의 여행');
});

test('최신권 검색 제목에서 영문과 일본어 권수 표기를 제거한다', () => {
    assert.equal(normalizeLatestMetadataTitle('Star Journey Vol. 10'), 'Star Journey');
    assert.equal(normalizeLatestMetadataTitle('Star Journey Chapter 12'), 'Star Journey');
    assert.equal(normalizeLatestMetadataTitle('星の旅 第10巻'), '星の旅');
    assert.equal(normalizeLatestMetadataTitle('星の旅 12話 (完結)'), '星の旅');
    assert.equal(normalizeLatestMetadataTitle('星の旅 第1巻～第3巻（完結）'), '星の旅');
});

test('권수 표기가 없는 제목은 유지하고 비교 키는 대소문자를 무시한다', () => {
    assert.equal(normalizeLatestMetadataTitle('20세기 소년'), '20세기 소년');
    assert.equal(normalizeLatestMetadataTitle('3월의 라이온'), '3월의 라이온');
    assert.equal(normalizeLatestMetadataTitle('아이실드 21'), '아이실드 21');
    assert.equal(normalizeLatestMetadataTitle('왕들의 전쟁권'), '왕들의 전쟁권');
    assert.equal(normalizeLatestMetadataTitle('제2부 제5장'), '제2부 제5장');
    assert.equal(latestMetadataTitleKey('Star Journey Vol. 2'), 'star journey');
    assert.equal(latestMetadataTitleKey('STAR JOURNEY Chapter 9'), 'star journey');
    assert.equal(normalizeLatestMetadataTitle('10권'), '');
});
