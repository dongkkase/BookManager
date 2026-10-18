import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { METADATA_API_SOURCE_NAMES, normalizeMetadataApiEnabled } from '../electron/metadataProviderSettings.js';
import {
    ALL_METADATA_API_SOURCES,
    UNIFIED_METADATA_API_SOURCE,
  apiSourceHasRequiredKey,
  cleanApiSeriesName,
    enabledMetadataApiSourcesForBookType,
  metadataApiPreferenceKey,
  metadataApiSourcesForBookType,
    metadataSearchSourcesForBookType,
    metadataSearchQueryForItem,
  metadataFromApiResult,
  normalizeMetadataApiSourceForBookType,
  preferredMetadataApiSource,
  requiredApiKeyForSource,
} from './metadataApiPolicy.js';

const additionalBookSources = ['Goodreads', 'Hardcover', 'Open Library', 'iTunes', 'Kobo', 'LubimyCzytac', 'RanobeDB'];
const additionalKeylessSources = additionalBookSources.filter(source => source !== 'Hardcover');
const audioOnlySources = ['Audible', 'AudNexus', 'Libro.fm'];

test('모든 검색 소스는 활성화 설정의 등록 목록과 일치한다', () => {
    assert.deepEqual(ALL_METADATA_API_SOURCES.map(source => source.value).sort(), [...METADATA_API_SOURCE_NAMES].sort());
});

test('검색 목록은 토글을 반영하고 통합검색은 활성화와 필수 키를 모두 확인한다', () => {
    const settings = { '리디북스': false, YES24: false, Audible: false };
    for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
        const shown = metadataSearchSourcesForBookType(bookType, settings).map(source => source.value);
        assert.equal(shown[0], UNIFIED_METADATA_API_SOURCE);
        assert.ok(!shown.includes('리디북스'));
        assert.ok(!shown.includes('YES24'));
        assert.ok(!shown.includes('Audible'));
        assert.ok(shown.includes('알라딘'));
        const available = enabledMetadataApiSourcesForBookType(bookType, { yes24: 'key', aladin: 'key' }, settings).map(source => source.value);
        assert.ok(!available.includes('YES24'));
        assert.ok(!available.includes('Hardcover'));
        assert.ok(available.includes('알라딘'));
    }
});

test('비활성 기본 검색 소스는 사용 가능한 소스로 복구하고 모든 소스가 꺼지면 통합검색을 유지한다', () => {
    const disabled = Object.fromEntries(METADATA_API_SOURCE_NAMES.map(source => [source, false]));
    for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
        assert.deepEqual(metadataSearchSourcesForBookType(bookType, disabled).map(source => source.value), [UNIFIED_METADATA_API_SOURCE]);
        assert.deepEqual(enabledMetadataApiSourcesForBookType(bookType, { yes24: 'key' }, disabled), []);
        assert.equal(normalizeMetadataApiSourceForBookType('리디북스', bookType, {}, disabled), UNIFIED_METADATA_API_SOURCE);
        assert.equal(preferredMetadataApiSource({ last_meta_api: '리디북스', metadata_api_enabled: disabled }, bookType), UNIFIED_METADATA_API_SOURCE);
        assert.equal(normalizeMetadataApiSourceForBookType('리디북스', bookType, { hardcover: 'Bearer token' }, { ...disabled, Hardcover: true }), 'Hardcover');
        assert.equal(normalizeMetadataApiSourceForBookType('리디북스', bookType, {}, { ...disabled, Hardcover: true }), UNIFIED_METADATA_API_SOURCE);
        assert.equal(normalizeMetadataApiSourceForBookType('Hardcover', bookType, {}, { ...disabled, Hardcover: true }), 'Hardcover');
        assert.equal(preferredMetadataApiSource({ last_meta_api: '리디북스', metadata_api_enabled: { '리디북스': false } }, bookType), '문피아');
    }
    assert.deepEqual(normalizeMetadataApiEnabled(disabled), disabled);
});

const metadataTabSource = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const ipcSource = readFileSync(new URL('../electron/ipcHandlers.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');

test('API source별 필수 키 요구 여부를 판정한다', () => {
    assert.equal(requiredApiKeyForSource('YES24'), 'yes24');
    assert.equal(apiSourceHasRequiredKey('YES24', {}), false);
    assert.equal(apiSourceHasRequiredKey('YES24', { yes24: '  ' }), false);
    assert.equal(apiSourceHasRequiredKey('YES24', { yes24: 'yk_live_test' }), true);
  assert.equal(requiredApiKeyForSource('알라딘'), 'aladin');
  assert.equal(requiredApiKeyForSource('Google Books'), 'google');
  assert.equal(requiredApiKeyForSource('Vine'), 'vine');
  assert.equal(requiredApiKeyForSource('Amazon'), '');
  assert.equal(requiredApiKeyForSource('리디북스'), '');
    assert.equal(requiredApiKeyForSource('문피아'), '');
    assert.equal(requiredApiKeyForSource('한국웹툰'), '');
  assert.equal(apiSourceHasRequiredKey('Google Books', { google: '' }), false);
  assert.equal(apiSourceHasRequiredKey('Google Books', { google: 'key' }), true);
  assert.equal(apiSourceHasRequiredKey('Amazon', {}), true);
  assert.equal(apiSourceHasRequiredKey('리디북스', {}), true);
    assert.equal(apiSourceHasRequiredKey('문피아', {}), true);
    assert.equal(apiSourceHasRequiredKey('한국웹툰', {}), true);
});

test('메타데이터 검색 API 목록은 만화책과 EPUB/PDF/오디오북 도서를 분리한다', () => {
  assert.deepEqual(metadataApiSourcesForBookType('comic').map(source => source.value), [
    '리디북스',
    '문피아',
    '한국웹툰',
    'YES24',
    '알라딘',
    'Google Books',
    'Anilist',
    'Vine',
    ...additionalBookSources,
  ]);
  assert.deepEqual(metadataApiSourcesForBookType('book').map(source => source.value), [
    '리디북스',
    '문피아',
    'YES24',
    '알라딘',
    'Google Books',
    'Amazon',
    ...additionalBookSources,
  ]);
  assert.deepEqual(metadataApiSourcesForBookType('pdf').map(source => source.value), [
    '리디북스',
    '문피아',
    'YES24',
    '알라딘',
    'Google Books',
    'Amazon',
    ...additionalBookSources,
  ]);
  assert.deepEqual(metadataApiSourcesForBookType('audio').map(source => source.value), [
    '리디북스',
    '문피아',
    'YES24',
    '알라딘',
    'Google Books',
    'Amazon',
    ...additionalBookSources,
    ...audioOnlySources,
  ]);
  assert.equal(normalizeMetadataApiSourceForBookType('Vine', 'book', {}), '리디북스');
  assert.equal(normalizeMetadataApiSourceForBookType('Vine', 'pdf', {}), '리디북스');
  assert.equal(normalizeMetadataApiSourceForBookType('Vine', 'audio', {}), '리디북스');
  assert.equal(normalizeMetadataApiSourceForBookType('알라딘', 'book', { aladin: 'key' }), '알라딘');
  assert.equal(normalizeMetadataApiSourceForBookType('Amazon', 'comic', {}), '리디북스');
});

test('문피아는 키 없이 모든 책 타입에서 검색과 기본 제공자로 선택할 수 있다', () => {
    assert.deepEqual(ALL_METADATA_API_SOURCES.filter(source => source.value === '문피아'), [
        { value: '문피아', labelKey: 'api_source_munpia' },
    ]);
    for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
        assert.equal(normalizeMetadataApiSourceForBookType('문피아', bookType, {}), '문피아');
        assert.equal(preferredMetadataApiSource({
            [metadataApiPreferenceKey(bookType)]: '문피아',
        }, bookType), '문피아');
        assert.equal(preferredMetadataApiSource({ last_meta_api: '문피아' }, bookType), '문피아');
    }
});

test('책 타입별 기본 검색 API 설정을 선택한다', () => {
  assert.equal(metadataApiPreferenceKey('comic'), 'preferred_meta_api_comic');
  assert.equal(metadataApiPreferenceKey('book'), 'preferred_meta_api_book');
  assert.equal(metadataApiPreferenceKey('pdf'), 'preferred_meta_api_pdf');
  assert.equal(metadataApiPreferenceKey('audio'), 'preferred_meta_api_audio');
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
  assert.equal(preferredMetadataApiSource({ preferred_meta_api_book: 'Amazon' }, 'audio'), 'Amazon');
});

test('한국웹툰은 키 없이 만화책 검색과 기본 제공자로 선택할 수 있다', () => {
    assert.deepEqual(ALL_METADATA_API_SOURCES.filter(source => source.value === '한국웹툰'), [
        { value: '한국웹툰', labelKey: 'api_source_kmas' },
    ]);
    assert.equal(normalizeMetadataApiSourceForBookType('한국웹툰', 'comic'), '한국웹툰');
    assert.equal(preferredMetadataApiSource({ preferred_meta_api_comic: '한국웹툰' }, 'comic'), '한국웹툰');
    assert.equal(preferredMetadataApiSource({ last_meta_api: '한국웹툰' }, 'comic'), '한국웹툰');
    for (const bookType of ['book', 'pdf', 'audio']) {
        assert.equal(normalizeMetadataApiSourceForBookType('한국웹툰', bookType), '리디북스');
        assert.equal(preferredMetadataApiSource({ last_meta_api: '한국웹툰' }, bookType), '리디북스');
    }
});

test('통합검색은 모든 책 타입에서 선택할 수 있고 실제 API 목록에 포함되지 않는다', () => {
    for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
        const searchSources = metadataSearchSourcesForBookType(bookType);
        assert.deepEqual(searchSources[0], {
            value: UNIFIED_METADATA_API_SOURCE,
            labelKey: 'api_source_unified',
        });
        assert.deepEqual(searchSources.slice(1), metadataApiSourcesForBookType(bookType));
        assert.equal(normalizeMetadataApiSourceForBookType(UNIFIED_METADATA_API_SOURCE, bookType), UNIFIED_METADATA_API_SOURCE);
        assert.equal(preferredMetadataApiSource({
            [metadataApiPreferenceKey(bookType)]: UNIFIED_METADATA_API_SOURCE,
        }, bookType), UNIFIED_METADATA_API_SOURCE);
        assert.equal(preferredMetadataApiSource({ last_meta_api: UNIFIED_METADATA_API_SOURCE }, bookType), UNIFIED_METADATA_API_SOURCE);
        assert.equal(preferredMetadataApiSource({}, bookType), '리디북스');
    }
    assert.equal(ALL_METADATA_API_SOURCES.some(source => source.value === UNIFIED_METADATA_API_SOURCE), false);
});

test('통합검색 대상은 책 타입과 API 키 등록 여부를 함께 반영한다', () => {
    assert.deepEqual(enabledMetadataApiSourcesForBookType('comic').map(source => source.value), [
        '리디북스', '문피아', '한국웹툰', 'Anilist', ...additionalKeylessSources,
    ]);
    for (const bookType of ['book', 'pdf', 'audio']) {
        assert.deepEqual(enabledMetadataApiSourcesForBookType(bookType).map(source => source.value), [
            '리디북스', '문피아', 'Amazon', ...additionalKeylessSources,
            ...(bookType === 'audio' ? audioOnlySources : []),
        ]);
    }
    assert.deepEqual(enabledMetadataApiSourcesForBookType('comic', {
        yes24: 'yk_live_test', aladin: ' ', google: 'key', vine: '',
    }).map(source => source.value), [
        '리디북스', '문피아', '한국웹툰', 'YES24', 'Google Books', 'Anilist', ...additionalKeylessSources,
    ]);
    const apiKeys = { yes24: 'key', aladin: 'key', google: 'key', vine: 'key', hardcover: 'token' };
    for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
        assert.deepEqual(enabledMetadataApiSourcesForBookType(bookType, apiKeys), metadataApiSourcesForBookType(bookType));
    }
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

test('TXT 검색 결과의 전체권수를 빈 권/화 항목에 적용한다', () => {
    for (const number of ['', ' ', undefined]) {
        const result = { metadata: { Title: '전지적 독자 시점', Count: '1064', Volume: '2', Number: number } };
        const converted = metadataFromApiResult(result, { bookType: 'book', isTextMetadata: true });
        assert.equal(converted.Number, '1064');
        assert.equal(converted.Volume, '2');
        assert.equal(converted.Count, '1064');
        assert.equal(result.metadata.Number, number);
    }
    assert.equal(metadataFromApiResult({ metadata: { Count: 0 } }, {
        bookType: 'book', isTextMetadata: true,
    }).Number, '0');
});

test('TXT의 명시적인 권/화 값과 다른 파일 형식의 권수 의미를 보존한다', () => {
    for (const number of ['12.5', '1-551', '0']) {
        assert.equal(metadataFromApiResult({ metadata: { Count: '1064', Number: number } }, {
            bookType: 'book', isTextMetadata: true,
        }).Number, number);
    }
    for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
        assert.equal(metadataFromApiResult({ metadata: { Count: '1064', Number: '' } }, {
            bookType,
        }).Number, '');
    }
    assert.equal(metadataFromApiResult({ metadata: {} }, {
        bookType: 'book', isTextMetadata: true,
    }).Number, undefined);
});

test('자동 검색어는 자모가 분리된 작가명·회차 범위·완결 표기를 정리한다', () => {
    for (const normalization of ['NFC', 'NFD']) {
        const title = '[싱숑] 전지적 독자 시점 1-551 완'.normalize(normalization);
        for (const item of [
            { name: `${title}.txt` },
            { metadata: { Series: title } },
            { metadata: { Title: title } },
        ]) {
            const before = structuredClone(item);
            assert.equal(metadataSearchQueryForItem(item), '전지적 독자 시점');
            assert.deepEqual(item, before);
        }
    }
});

test('자동 검색어는 제목 끝의 회차 범위와 괄호로 묶인 완결 표기를 처리한다', () => {
    for (const suffix of [
        '1-551', '1-551 완결', '001~551화 [완]', '1～551 完',
        '제1화–제551화 (완결)', '1권-5권', '(1-551 완)', '[1-551] [완결]',
        '완결 1-551', '551화', '제12권', 'Vol. 12', 'Chapter 551',
    ]) {
        assert.equal(metadataSearchQueryForItem({
            metadata: { Series: `전지적 독자 시점 ${suffix}` },
        }), '전지적 독자 시점', suffix);
    }
});

test('자동 검색어는 제목 자체의 숫자와 시즌·외전을 보존한다', () => {
    for (const title of [
        '1984', '1Q84', '제3인류', '22-11-63', '20세기 소년', '3월의 라이온',
        '아이실드 21', '86 -에이티식스-', '0.5인분의 연인', '완벽한 결혼의 정석',
        '작품명 시즌2', '작품명 외전', '1-551', '완', '미완',
    ]) {
        assert.equal(metadataSearchQueryForItem({ metadata: { Title: title } }), title);
    }
    assert.equal(metadataSearchQueryForItem({
        metadata: { Series: '작품명 외전 1-10 완' },
    }), '작품명 외전');
    for (const title of ['[외전] 작품명 1-10 완', '[작가] (외전) 작품명 1-10 완']) {
        assert.equal(metadataSearchQueryForItem({ metadata: { Title: title } }), '외전 작품명');
    }
});

test('자동 검색어는 시리즈·제목·파일명 우선순위를 유지한다', () => {
    assert.equal(metadataSearchQueryForItem({
        metadata: { Series: '시리즈 1-12 완', Title: '다른 제목' }, name: '파일명.txt',
    }), '시리즈');
    assert.equal(metadataSearchQueryForItem({
        metadata: { Series: ' ', Title: '제목 1-12 완' }, name: '파일명.txt',
    }), '제목');
    assert.equal(metadataSearchQueryForItem({
        filepath: '/책/[싱숑] 전지적 독자 시점 1-551 완.txt'.normalize('NFD'),
    }), '전지적 독자 시점');
    assert.equal(metadataSearchQueryForItem({
        name: 'C:\\Books\\[작가] 작품명 1-12 완.TXT',
    }), '작품명');
    assert.equal(metadataSearchQueryForItem({}), '');
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

test('오디오북 API 검색 결과에도 만화 읽기 방향 기본값을 넣지 않는다', () => {
  assert.deepEqual(metadataFromApiResult({
    summary: '설명',
    metadata: {
      Title: 'Audiobook',
      Writer: 'Artist',
    },
  }, { bookType: 'audio' }), {
    Title: 'Audiobook',
    Writer: 'Artist',
    Summary: '설명',
  });
});

test('새 검색 소스는 매체에 맞게 선택되며 Hardcover 토큰이 있어야 통합검색에 포함된다', () => {
    for (const source of additionalBookSources) {
        for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
            assert.equal(normalizeMetadataApiSourceForBookType(source, bookType), source);
        }
    }
    for (const source of audioOnlySources) {
        assert.equal(normalizeMetadataApiSourceForBookType(source, 'audio'), source);
        for (const bookType of ['comic', 'book', 'pdf']) {
            assert.equal(normalizeMetadataApiSourceForBookType(source, bookType), '리디북스');
        }
    }
    assert.equal(requiredApiKeyForSource('Hardcover'), 'hardcover');
    assert.equal(apiSourceHasRequiredKey('Hardcover', { hardcover: ' Bearer  ' }), false);
    assert.equal(apiSourceHasRequiredKey('Hardcover', { hardcover: ' Bearer token ' }), true);
    assert.equal(preferredMetadataApiSource({ preferred_meta_api_book: 'Kobo' }, 'audio'), 'Kobo');
    assert.equal(preferredMetadataApiSource({ preferred_meta_api_book: 'Kobo', preferred_meta_api_audio: 'Audible' }, 'audio'), 'Audible');
    assert.equal(new Set(ALL_METADATA_API_SOURCES.map(source => source.value)).size, ALL_METADATA_API_SOURCES.length);
});
