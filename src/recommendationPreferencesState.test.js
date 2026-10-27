import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailyRecommendationIndex } from './dailyRecommendationState.js';
import {
    DEFAULT_RECOMMENDATION_PREFERENCES_KEY,
    createRecommendationPreferenceMatcher,
    normalizeRecommendationPreferences,
    readRecommendationPreferences,
    recommendationPreferenceOptions,
    recommendationPreferencesKey,
} from './recommendationPreferencesState.js';

test('취향 저장값은 안전하게 정규화하고 순서·표시이름과 무관하게 같은 조건을 인식한다', () => {
    const value = normalizeRecommendationPreferences({
        libraries: ['/books', '/books', 42], genres: [' Fantasy ', 'FANTASY'], formats: ['epub', 'exe'],
        excludedBooks: [{ path: '/books/a.epub', title: 'A' }, { path: '/books/a.epub', title: 'B' }, null],
        excludedSeries: [{ title: ' Story ' }, { key: 'STORY', title: 'Story' }],
    });
    assert.deepEqual(value.libraries, ['/books']);
    assert.deepEqual(value.genres, ['fantasy']);
    assert.deepEqual(value.formats, ['epub']);
    assert.deepEqual(value.excludedBooks, [{ path: '/books/a.epub', title: 'B' }]);
    assert.deepEqual(value.excludedSeries, [{ key: 'story', title: 'Story' }]);
    assert.equal(recommendationPreferencesKey({ genres: ['Fantasy', 'SF'] }), recommendationPreferencesKey({ genres: ['sf', 'fantasy'] }));
    assert.equal(recommendationPreferencesKey(readRecommendationPreferences({ getItem: () => '{' })), DEFAULT_RECOMMENDATION_PREFERENCES_KEY);
    assert.equal(recommendationPreferencesKey(readRecommendationPreferences({ getItem: () => 'null' })), DEFAULT_RECOMMENDATION_PREFERENCES_KEY);
});

test('라이브러리는 정확한 경로 경계를 따르고 윈도우 구분자·대소문자와 macOS 정규화를 처리한다', () => {
    const matches = createRecommendationPreferenceMatcher({ libraries: ['/books/만화/'] }, 'MacIntel');
    assert.equal(matches({ path: '/books/만화/a.cbz'.normalize('NFD') }), true);
    assert.equal(matches({ path: '/books/만화2/a.cbz' }), false);
    const windows = createRecommendationPreferenceMatcher({ libraries: ['C:\\BOOKS'], excludedBooks: [{ path: 'c:/books/excluded.epub' }] }, 'Win32');
    assert.equal(windows({ path: 'c:\\books\\folder\\a.epub' }), true);
    assert.equal(windows({ path: 'c:\\books\\EXCLUDED.epub' }), false);
    assert.equal(windows({ path: 'C:/Bookshelf/a.epub' }), false);
});

test('장르 내 OR·조건 간 AND를 적용하고 첫 권·단독권 규칙과 책·시리즈 제외를 유지한다', () => {
    const files = [
        { path: '/library/a.epub', genre: 'Fantasy, Adventure', series: 'Story', volume: '1' },
        { path: '/library/b.epub', metadata: { Genre: 'SF; History', Series: 'Other' } },
        { path: '/library/c.pdf', genre: 'Fantasy' },
        { path: '/library/d.epub', genre: 'Fantasy', volume: '2' },
        { path: '/elsewhere/e.epub', genre: 'Fantasy' },
        { path: '/library/f.epub', genre: 'Romance' },
    ];
    const preferences = { libraries: ['/library'], genres: ['Fantasy', 'SF'], formats: ['epub'] };
    assert.deepEqual([...createDailyRecommendationIndex(files, '', preferences).keys()], ['/library/a.epub', '/library/b.epub']);
    const excluded = { ...preferences, excludedSeries: [{ key: 'STORY' }], excludedBooks: [{ path: '/library/b.epub' }] };
    assert.equal(createDailyRecommendationIndex(files, '', excluded).size, 0);
    assert.equal(createDailyRecommendationIndex(files, '', { ...excluded, excludedBooks: [] }).size, 1);
    assert.equal(createDailyRecommendationIndex(files, '', { ...excluded, genres: [] }).size, 1);
});

test('장르와 형식 목록은 실재 파일만 집계하고 미등록 장르를 임의로 만들지 않는다', () => {
    const options = recommendationPreferenceOptions([
        { path: '/a.epub', genre: 'Fantasy, SF' },
        { path: '/b.pdf', full_meta: { Genre: ['fantasy', 'History'] } },
        { path: '/c.txt' }, { path: '/d.cbz' }, { path: '/e.mp3' },
        { path: '/missing.pdf', exists: false, genre: 'Other' },
        { path: '/folder', isDirectory: true, genre: 'Other' },
    ]);
    assert.deepEqual(options.formatCounts, { epub: 1, pdf: 1, text: 1, comic: 1, audio: 1 });
    assert.deepEqual(options.genres.map(item => [item.key, item.count]), [['fantasy', 2], ['history', 1], ['sf', 1]]);
});
