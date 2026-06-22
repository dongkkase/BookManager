import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adjacentSelectionAfterRemoval,
    applyBatchMetadataFields,
    applyInferredMetadataField,
    applySeriesAutoMetadata,
    clampMetadataNumber,
    cleanMetadataSummary,
    inferMetadataFromArchiveName,
    normalizeMetadataAutoNumber,
    normalizeMetadataDecimal,
} from './metadataPolicy.js';

test('metadata filename inference follows volume and chapter conventions', () => {
    assert.deepEqual(inferMetadataFromArchiveName('[팀] 작품명 Vol. 03.cbz', 'ko'), {
        Title: '작품명 03권',
        Series: '작품명',
        Volume: '3',
        Number: '',
    });
    assert.deepEqual(inferMetadataFromArchiveName('작품명 Chapter 12.zip', 'en'), {
        Title: '작품명 Ch. 12',
        Series: '작품명',
        Volume: '',
        Number: '12',
    });
});

test('metadata auto number inference removes leading zero padding', () => {
    assert.equal(normalizeMetadataAutoNumber('0012'), '12');
    assert.equal(normalizeMetadataAutoNumber('000'), '0');
    assert.equal(normalizeMetadataAutoNumber('01.5'), '1.5');
    assert.deepEqual(inferMetadataFromArchiveName('작품명 제007화.zip', 'ko'), {
        Title: '작품명 007화',
        Series: '작품명',
        Volume: '',
        Number: '7',
    });
});

test('metadata volume and chapter fields keep decimal values', () => {
    assert.equal(normalizeMetadataDecimal('001.5'), '1.5');
    assert.equal(normalizeMetadataDecimal('000.25'), '0.25');
    assert.equal(normalizeMetadataDecimal('.5'), '0.5');
    assert.equal(normalizeMetadataDecimal('2.'), '2');
    assert.equal(normalizeMetadataDecimal('abc'), 'abc');
    assert.deepEqual(inferMetadataFromArchiveName('작품명 제001.5화.zip', 'ko'), {
        Title: '작품명 001.5화',
        Series: '작품명',
        Volume: '',
        Number: '1.5',
    });
});

test('metadata auto title applies volume and chapter together', () => {
    const inferred = inferMetadataFromArchiveName('작품명 제001.5화.zip', 'ko');
    assert.deepEqual(applyInferredMetadataField({ Publisher: '출판사' }, inferred, 'Title'), {
        Publisher: '출판사',
        Title: '작품명 001.5화',
        Volume: '',
        Number: '1.5',
    });
    assert.deepEqual(applyInferredMetadataField({ Title: '기존 제목', Number: '2' }, inferred, 'Volume'), {
        Title: '기존 제목',
        Number: '2',
        Volume: '',
    });
});

test('metadata series batch apply copies batch fields then runs automatic fields', () => {
    const copied = applyBatchMetadataFields(
        { Title: '기존 제목', Publisher: '기존 출판사', PageCount: '10' },
        { Title: '검색 제목', Publisher: '새 출판사', Volume: '', Number: '' },
        ['Title', 'Publisher', 'Volume', 'Number', 'PageCount'],
        false,
    );
    assert.deepEqual(copied, {
        Title: '검색 제목',
        Publisher: '새 출판사',
        PageCount: '10',
    });
    assert.deepEqual(applySeriesAutoMetadata(copied, {
        Title: '작품명 12권',
        Volume: '12',
        Number: '',
        PageCount: '180',
    }), {
        Title: '작품명 12권',
        Publisher: '새 출판사',
        Volume: '12',
        Number: '',
        PageCount: '180',
    });
});

test('metadata number fields use the original bounds', () => {
    assert.equal(clampMetadataNumber('Year', 1200), '1800');
    assert.equal(clampMetadataNumber('Month', 20), '12');
    assert.equal(clampMetadataNumber('Day', 0), '1');
    assert.equal(clampMetadataNumber('PageCount', -3), '0');
    assert.equal(clampMetadataNumber('PageCount', ''), '');
});

test('metadata summary cleanup removes the heading and excessive blank lines', () => {
    assert.equal(cleanMetadataSummary('<책소개>\n첫 줄\n\n\n\n둘째 줄'), '첫 줄\n\n둘째 줄');
});

test('metadata removal selects the adjacent remaining item', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.equal(adjacentSelectionAfterRemoval(items, ['b'], 'b'), 'c');
    assert.equal(adjacentSelectionAfterRemoval(items, ['c'], 'c'), 'b');
    assert.equal(adjacentSelectionAfterRemoval(items, ['a', 'b', 'c'], 'b'), null);
});
