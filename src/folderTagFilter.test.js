import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectFolderTagCategories,
    filterFilesByFolderTags,
    folderTagSelectionKey,
    sortFolderTagValues,
} from './folderTagFilter.js';

function categoryMap(files) {
    return new Map(collectFolderTagCategories(files).map(category => [category.id, category.values]));
}

test('값이 있는 메타데이터 카테고리만 파일 수와 함께 수집한다', () => {
    const categories = categoryMap([
        { genre: '판타지, 모험', tags: '마법; 성장', writer: '작가 A', ext: '.cbz' },
        { genre: '판타지', tags: '마법', writer: '작가 B', ext: '.CBZ' },
    ]);

    assert.deepEqual(categories.get('genre'), [
        { value: '모험', normalized: '모험', count: 1 },
        { value: '판타지', normalized: '판타지', count: 2 },
    ]);
    assert.equal(categories.has('publisher'), false);
    assert.deepEqual(categories.get('extension'), [
        { value: 'cbz', normalized: 'cbz', count: 2 },
    ]);
});

test('PDF 키워드는 일반 태그와 분리하고 EPUB 카테고리는 일반 태그로 수집한다', () => {
    const categories = categoryMap([
        { book_type: 'pdf', tags: '보고서, 로컬', ext: '.pdf' },
        { book_type: 'book', tags: '모험, Keyword', ext: '.epub' },
    ]);

    assert.deepEqual(categories.get('pdf_keywords').map(item => item.value), ['로컬', '보고서']);
    assert.deepEqual(categories.get('tags').map(item => item.value), ['모험', 'Keyword']);
});

test('제작진과 연도는 평면 및 metadata 객체의 수집값을 함께 지원한다', () => {
    const categories = categoryMap([
        {
            penciller: '그림 A',
            editor: '편집 A',
            date: '2024-02-03',
            metadata: { CoverArtist: '표지 A' },
        },
    ]);

    assert.equal(categories.get('penciller')[0].value, '그림 A');
    assert.equal(categories.get('cover_artist')[0].value, '표지 A');
    assert.equal(categories.get('editor')[0].value, '편집 A');
    assert.equal(categories.get('year')[0].value, '2024');
});

test('요청한 메타데이터 및 확장자 카테고리를 모두 제공한다', () => {
    const categories = categoryMap([
        {
            genre: '장르',
            tags: '태그',
            publisher: '출판사',
            writer: '작가',
            penciller: '그림',
            inker: '잉크',
            colorist: '채색',
            letterer: '글자',
            cover_artist: '표지',
            editor: '편집',
            age_rating: '전체',
            format: 'Webtoon',
            characters: '등장인물',
            date: '2025',
            ext: '.cbz',
        },
        { book_type: 'pdf', tags: 'PDF 키워드', ext: '.pdf' },
    ]);

    assert.deepEqual([...categories.keys()], [
        'genre',
        'tags',
        'pdf_keywords',
        'publisher',
        'writer',
        'penciller',
        'inker',
        'colorist',
        'letterer',
        'cover_artist',
        'editor',
        'age_rating',
        'format',
        'characters',
        'year',
        'extension',
    ]);
});

test('다중 선택은 모두 일치와 하나 이상 일치 모드를 지원한다', () => {
    const files = [
        { name: 'A.cbz', genre: '판타지', tags: '마법, 성장' },
        { name: 'B.cbz', genre: '판타지', tags: '모험' },
        { name: 'C.cbz', genre: 'SF', tags: '성장' },
    ];
    const selections = [
        { categoryId: 'genre', value: '판타지' },
        { categoryId: 'tags', value: '성장' },
    ];

    assert.deepEqual(filterFilesByFolderTags(files, selections, 'all'), [files[0]]);
    assert.deepEqual(filterFilesByFolderTags(files, selections, 'any'), [files[0], files[1], files[2]]);
    assert.equal(filterFilesByFolderTags(files), files);
});

test('선택 키와 필터 비교는 대소문자 및 호환 문자를 정규화한다', () => {
    assert.equal(
        folderTagSelectionKey({ categoryId: 'tags', value: 'Ｋｅｙｗｏｒｄ' }),
        folderTagSelectionKey({ categoryId: 'tags', value: 'keyword' }),
    );
    const files = [{ tags: 'Keyword' }];
    assert.deepEqual(
        filterFilesByFolderTags(files, [{ categoryId: 'tags', value: 'ＫＥＹＷＯＲＤ' }]),
        files,
    );
});

test('대량 태그 정렬은 기본 빈도순과 이름순을 지원한다', () => {
    const values = [
        { value: '10권', count: 1 },
        { value: '2권', count: 3 },
        { value: '희귀', count: 5 },
    ];

    assert.deepEqual(
        sortFolderTagValues(values, 'frequency').map(item => item.value),
        ['희귀', '2권', '10권'],
    );
    assert.deepEqual(
        sortFolderTagValues(values, 'name').map(item => item.value),
        ['2권', '10권', '희귀'],
    );
});
