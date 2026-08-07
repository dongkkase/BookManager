import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  apiSourceHasRequiredKey,
  cleanApiSeriesName,
  metadataApiPreferenceKey,
  metadataApiSourcesForBookType,
  metadataFromApiResult,
  normalizeMetadataApiSourceForBookType,
  preferredMetadataApiSource,
  requiredApiKeyForSource,
} from './metadataApiPolicy.js';

const metadataTabSource = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const ipcSource = readFileSync(new URL('../electron/ipcHandlers.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');

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
  assert.deepEqual(metadataApiSourcesForBookType('pdf').map(source => source.value), [
    '리디북스',
    '알라딘',
    'Google Books',
    'Amazon',
  ]);
  assert.equal(normalizeMetadataApiSourceForBookType('Vine', 'book', {}), '리디북스');
  assert.equal(normalizeMetadataApiSourceForBookType('Vine', 'pdf', {}), '리디북스');
  assert.equal(normalizeMetadataApiSourceForBookType('알라딘', 'book', { aladin: 'key' }), '알라딘');
  assert.equal(normalizeMetadataApiSourceForBookType('Amazon', 'comic', {}), '리디북스');
});

test('책 타입별 기본 검색 API 설정을 선택한다', () => {
  assert.equal(metadataApiPreferenceKey('comic'), 'preferred_meta_api_comic');
  assert.equal(metadataApiPreferenceKey('book'), 'preferred_meta_api_book');
  assert.equal(metadataApiPreferenceKey('pdf'), 'preferred_meta_api_pdf');
  assert.equal(preferredMetadataApiSource({
    preferred_meta_api_comic: 'Vine',
    preferred_meta_api_book: 'Amazon',
    preferred_meta_api_pdf: 'Google Books',
  }, 'comic'), 'Vine');
  assert.equal(preferredMetadataApiSource({
    preferred_meta_api_comic: 'Vine',
    preferred_meta_api_book: 'Amazon',
    preferred_meta_api_pdf: 'Google Books',
  }, 'book'), 'Amazon');
  assert.equal(preferredMetadataApiSource({
    preferred_meta_api_comic: 'Vine',
    preferred_meta_api_book: 'Amazon',
    preferred_meta_api_pdf: 'Google Books',
  }, 'pdf'), 'Google Books');
  assert.equal(preferredMetadataApiSource({ last_meta_api: 'Anilist' }, 'book'), '리디북스');
});

test('메타데이터 관리의 검색 API 선택은 환경 설정 기본값을 저장하지 않는다', () => {
  assert.match(metadataTabSource, /const selectApiSource = useCallback[\s\S]*?setApiSource\(nextSource\)/);
  assert.doesNotMatch(metadataTabSource, /saveApiSourcePreference|metadataApiPreferenceKey|saveConfig/);
  assert.doesNotMatch(appSource, /<MemoMetadataTab[^>]*saveConfig=/);
});

test('모든 메타데이터 검색 서비스 결과에 번역 버튼을 표시한다', () => {
  assert.match(metadataTabSource, /className=\{`meta-api-translate-btn/);
  assert.doesNotMatch(metadataTabSource, /canTranslateSelected/);
  assert.doesNotMatch(metadataTabSource, /\['Anilist', 'Vine', 'Amazon'\]\.includes/);
});

test('메타데이터 번역 대상 언어는 환경설정 값을 메인 프로세스에서 사용한다', () => {
  assert.match(preloadSource, /translateMetadata: \(result\) => ipcRenderer\.invoke\('api:translateMetadata', result\)/);
  assert.match(ipcSource, /ipcMain\.handle\('api:translateMetadata', async \(_event, result = \{\}\) => \{/);
  assert.match(ipcSource, /const targetLang = config\.language \|\| config\.lang \|\| 'ko'/);
  assert.doesNotMatch(metadataTabSource, /translateMetadata\(rawSelected, targetLang\)/);
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

test('API 검색 결과 제목은 앞쪽 불필요한 태그를 제거한다', () => {
  assert.deepEqual(metadataFromApiResult({
    metadata: {
      Title: '[코믹] 변경의 팔라딘',
    },
  }).Title, '변경의 팔라딘');
  assert.deepEqual(metadataFromApiResult({
    metadata: {
      Title: '(미즈) 변경의 팔라딘',
    },
  }).Title, '변경의 팔라딘');
  assert.deepEqual(metadataFromApiResult({
    metadata: {
      Title: '[특별 세트] [기간한정] 변경의 팔라딘',
    },
  }).Title, '변경의 팔라딘');
  assert.deepEqual(metadataFromApiResult({
    metadata: {
      Title: '【한정 판매】 변경의 팔라딘',
    },
  }).Title, '변경의 팔라딘');
});

test('API 검색 결과를 적용할 때 제목과 시리즈의 선행 태그가 함께 제거된다', () => {
  assert.deepEqual(metadataFromApiResult({
    metadata: {
      Title: '[코믹] [미즈] 변경의 팔라딘',
      Series: '[특별 세트] [기간한정] 변경의 팔라딘',
    },
  }), {
    Title: '변경의 팔라딘',
    Series: '변경의 팔라딘',
    Summary: '',
    Manga: 'YesAndRightToLeft',
  });
});

test('API 검색 결과 적용 시 시리즈명 끝의 권수와 화수를 제거한다', () => {
  assert.deepEqual(metadataFromApiResult({
    metadata: {
      Title: '던전밥 12권',
      Series: '던전밥 12권',
      Volume: '12',
    },
  }, { bookType: 'book' }), {
    Title: '던전밥 12권',
    Series: '던전밥',
    Volume: '12',
    Summary: '',
  });

  assert.equal(cleanApiSeriesName('나 혼자만 레벨업 180화'), '나 혼자만 레벨업');
  assert.equal(cleanApiSeriesName('작품명 1권~10권 [완결]'), '작품명');
  assert.equal(cleanApiSeriesName('작품명 12권 34화'), '작품명');
  assert.equal(cleanApiSeriesName('Example Series, Vol. 3'), 'Example Series');
  assert.equal(cleanApiSeriesName('Example Series Chapter 27'), 'Example Series');
});

test('API 검색어와 일치하는 시리즈명 뒤의 단위 없는 권수도 제거한다', () => {
  assert.deepEqual(metadataFromApiResult({
    metadata: {
      Title: '0.5인분의 연인 1',
      Series: '0.5인분의 연인 1',
      Count: '4',
      Volume: '1',
    },
  }, {
    bookType: 'comic',
    query: '0.5인분의 연인',
  }), {
    Title: '0.5인분의 연인 1',
    Series: '0.5인분의 연인',
    Count: '4',
    Volume: '1',
    Summary: '',
    Manga: 'YesAndRightToLeft',
  });
});

test('API 시리즈명 정제는 작품명 자체의 숫자와 구두점을 보존한다', () => {
  assert.equal(cleanApiSeriesName('20세기 소년'), '20세기 소년');
  assert.equal(cleanApiSeriesName('3월의 라이온'), '3월의 라이온');
  assert.equal(cleanApiSeriesName('86 -에이티식스-'), '86 -에이티식스-');
  assert.equal(cleanApiSeriesName('아이실드 21'), '아이실드 21');
});

test('도서 API 검색 결과에는 만화 읽기 방향 기본값을 넣지 않는다', () => {
  assert.deepEqual(metadataFromApiResult({
    summary: '<책소개>\n설명',
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

test('PDF API 검색 결과에도 만화 읽기 방향 기본값을 넣지 않는다', () => {
  assert.deepEqual(metadataFromApiResult({
    summary: '설명',
    metadata: {
      Title: 'PDF',
      Writer: 'Author',
    },
  }, { bookType: 'pdf' }), {
    Title: 'PDF',
    Writer: 'Author',
    Summary: '설명',
  });
});
