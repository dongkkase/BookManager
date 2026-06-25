import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiSourceHasRequiredKey,
  metadataApiPreferenceKey,
  metadataApiSourcesForBookType,
  metadataFromApiResult,
  normalizeMetadataApiSourceForBookType,
  preferredMetadataApiSource,
  requiredApiKeyForSource,
} from './metadataApiPolicy.js';

test('API source별 필수 키 요구 여부를 판정한다', () => {
  assert.equal(requiredApiKeyForSource('알라딘'), 'aladin');
  assert.equal(requiredApiKeyForSource('Google Books'), 'google');
  assert.equal(requiredApiKeyForSource('Vine'), 'vine');
  assert.equal(requiredApiKeyForSource('Amazon'), '');
  assert.equal(requiredApiKeyForSource('리디북스'), '');
  assert.equal(apiSourceHasRequiredKey('Google Books', { google: '' }), false);
  assert.equal(apiSourceHasRequiredKey('Google Books', { google: 'key' }), true);
  assert.equal(apiSourceHasRequiredKey('Amazon', {}), true);
  assert.equal(apiSourceHasRequiredKey('리디북스', {}), true);
});

test('메타데이터 검색 API 목록은 만화책과 EPUB/PDF 도서를 분리한다', () => {
  assert.deepEqual(metadataApiSourcesForBookType('comic').map(source => source.value), [
    '리디북스',
    '알라딘',
    'Google Books',
    'Anilist',
    'Vine',
  ]);
  assert.deepEqual(metadataApiSourcesForBookType('book').map(source => source.value), [
    '리디북스',
    '알라딘',
    'Google Books',
    'Amazon',
  ]);
  assert.equal(normalizeMetadataApiSourceForBookType('Vine', 'book', {}), '리디북스');
  assert.equal(normalizeMetadataApiSourceForBookType('알라딘', 'book', { aladin: 'key' }), '알라딘');
  assert.equal(normalizeMetadataApiSourceForBookType('Amazon', 'comic', {}), '리디북스');
});

test('책 타입별 기본 검색 API 설정을 선택한다', () => {
  assert.equal(metadataApiPreferenceKey('comic'), 'preferred_meta_api_comic');
  assert.equal(metadataApiPreferenceKey('book'), 'preferred_meta_api_book');
  assert.equal(preferredMetadataApiSource({
    preferred_meta_api_comic: 'Vine',
    preferred_meta_api_book: 'Amazon',
  }, 'comic'), 'Vine');
  assert.equal(preferredMetadataApiSource({
    preferred_meta_api_comic: 'Vine',
    preferred_meta_api_book: 'Amazon',
  }, 'book'), 'Amazon');
  assert.equal(preferredMetadataApiSource({ last_meta_api: 'Anilist' }, 'book'), '리디북스');
});

test('API 검색 결과를 전체 저장에 사용할 ComicInfo 메타데이터로 변환한다', () => {
  assert.deepEqual(metadataFromApiResult({
    summary: '## 작품 소개\n설명',
    metadata: {
      Title: 'Book',
      Writer: 'Author',
    },
  }), {
    Title: 'Book',
    Writer: 'Author',
    Summary: '## 작품 소개\n설명',
    Manga: 'YesAndRightToLeft',
  });
});

test('도서 API 검색 결과에는 만화 읽기 방향 기본값을 넣지 않는다', () => {
  assert.deepEqual(metadataFromApiResult({
    summary: '설명',
    metadata: {
      Title: 'Novel',
      Writer: 'Author',
    },
  }, { bookType: 'book' }), {
    Title: 'Novel',
    Writer: 'Author',
    Summary: '설명',
  });
});
