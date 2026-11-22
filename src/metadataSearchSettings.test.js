import assert from 'node:assert/strict';
import test from 'node:test';
import {
    filterMetadataSearchResults,
    isMetadataSearchTagExcluded,
    metadataSearchResultTags,
    metadataSearchSettingType,
    metadataWithoutExcludedSearchTags,
    normalizeMetadataSearchSettings,
    toggleMetadataSearchExcludedTag,
} from './metadataSearchSettings.js';
import { searchMetadata } from './metadataSearch.js';

test('settings distinguish EPUB and TXT while grouping archive and audio formats', () => {
    for (const [extension, type] of [['cbz', 'comic'], ['zip', 'comic'], ['cbr', 'comic'], ['epub', 'epub'], ['txt', 'txt'], ['pdf', 'pdf'], ['m4b', 'audio']]) {
        assert.equal(metadataSearchSettingType({ filepath: `/books/book.${extension.toUpperCase()}` }), type);
    }
    assert.equal(metadataSearchSettingType(null), 'comic');
    const settings = normalizeMetadataSearchSettings({
        comic: { excludedTitleTerms: [' 특별 세트 ', '특별 세트'.normalize('NFD'), '', null] },
        epub: { excludedResultTags: '연재, Serialized, serialized' },
        txt: { excludedTags: ['광고'] },
    });
    assert.deepEqual(settings.comic.excludedTitleTerms, ['특별 세트']);
    assert.deepEqual(settings.epub.excludedResultTags, ['연재', 'Serialized']);
    assert.deepEqual(settings.txt.excludedTags, ['광고']);
    assert.deepEqual(settings.comic.excludedTags, []);
    assert.deepEqual(normalizeMetadataSearchSettings(null), normalizeMetadataSearchSettings());
});

test('title filtering removes the special set from the user example and can be undone from cached results', () => {
    const title = '추방당한 전생 중기사는 게임 지식으로 무쌍한다';
    const results = Object.freeze([
        Object.freeze({ id: 1, title }),
        Object.freeze({ id: 2, title: `[특별 세트]${title}(총 14권)` }),
    ]);
    assert.deepEqual(filterMetadataSearchResults(results, { excludedTitleTerms: ['특별 세트'.normalize('NFD')] }), [results[0]]);
    assert.deepEqual(filterMetadataSearchResults(results), results);
    assert.equal(results.length, 2);
    assert.deepEqual(filterMetadataSearchResults([{ title: 'Visible', metadata: { Title: '[SPECIAL SET] Book' } }], { excludedTitleTerms: ['special set'] }), []);
});

test('result-tag exclusion uses whole tags, independently from tags omitted on application', () => {
    const title = '전생에 마술사단장이던 나, 당신을 사랑할 일 없다고 말한 남편이';
    const results = [
        { id: 1, title, metadata: { Tags: '로맨스, 연재' } },
        { id: 2, title, tags: ['로맨스', '단행본'], metadata: { Tags: '연재작가' } },
    ];
    assert.deepEqual(filterMetadataSearchResults(results, { excludedResultTags: ['연재'] }), [results[1]]);
    assert.deepEqual(filterMetadataSearchResults(results, { excludedTags: ['연재'] }), results);
    assert.deepEqual(filterMetadataSearchResults([{ metadata: { Genre: 'Serialized' } }], { excludedResultTags: ['serialized'] }), []);
});

test('all displayed genres and tags support exact inclusion toggles without duplicates', () => {
    const tags = metadataSearchResultTags({ tags: ['SF', '연재'], Tags: 'Romance|SF', metadata: { Tags: '연재/완결', Genre: 'SF, 판타지' } });
    assert.deepEqual(tags, ['SF', '연재', 'Romance', '완결', '판타지']);
    const excluded = toggleMetadataSearchExcludedTag({ excludedResultTags: ['연재'] }, 'SF');
    assert.ok(isMetadataSearchTagExcluded('ｓｆ', excluded));
    assert.deepEqual(toggleMetadataSearchExcludedTag(excluded, 'sf'), { excludedResultTags: ['연재'], excludedTags: [] });
});

test('tag application preserves unrelated metadata and leaves formatting unchanged without exclusions', () => {
    const metadata = Object.freeze({ Title: 'Book', Tags: ' A / B, C ', Genre: 'Fantasy', Writer: 'Writer' });
    assert.deepEqual(metadataWithoutExcludedSearchTags(metadata), metadata);
    assert.deepEqual(metadataWithoutExcludedSearchTags(metadata, { excludedTags: ['a', 'Fantasy'] }), {
        Title: 'Book', Tags: 'B, C', Genre: '', Writer: 'Writer',
    });
    assert.equal(metadata.Tags, ' A / B, C ');
});

test('filtering a cached page down to zero keeps provider pagination and cached records intact', async () => {
    const cached = [{ id: 1, title: '[특별 세트] 작품' }];
    const response = await searchMetadata({ apiSource: '리디북스', query: '작품', bookType: 'book' }, async () => ({
        success: true, results: cached, cached: true, hasNext: true,
    }));
    assert.deepEqual(filterMetadataSearchResults(response.results, { excludedTitleTerms: ['특별 세트'] }), []);
    assert.equal(response.hasNext, true);
    assert.equal(response.cached, true);
    assert.equal(response.results.length, 1);
    assert.equal(cached.length, 1);
});
