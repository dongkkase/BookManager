import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiSourceHasRequiredKey,
  metadataFromApiResult,
  requiredApiKeyForSource,
} from './metadataApiPolicy.js';

test('API source별 필수 키 요구 여부를 판정한다', () => {
  assert.equal(requiredApiKeyForSource('알라딘'), 'aladin');
  assert.equal(requiredApiKeyForSource('Google Books'), 'google');
  assert.equal(requiredApiKeyForSource('Vine'), 'vine');
  assert.equal(requiredApiKeyForSource('리디북스'), '');
  assert.equal(apiSourceHasRequiredKey('Google Books', { google: '' }), false);
  assert.equal(apiSourceHasRequiredKey('Google Books', { google: 'key' }), true);
  assert.equal(apiSourceHasRequiredKey('리디북스', {}), true);
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
