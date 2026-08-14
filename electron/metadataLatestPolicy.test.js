import assert from 'node:assert/strict';
import test from 'node:test';
import {
    latestMetadataTitleKey,
    normalizeLatestMetadataTitle,
} from './metadataLatestPolicy.js';

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
