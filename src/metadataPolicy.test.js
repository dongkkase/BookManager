import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adjacentSelectionAfterRemoval,
    clampMetadataNumber,
    cleanMetadataSummary,
    inferMetadataFromArchiveName,
} from './metadataPolicy.js';

test('metadata filename inference follows volume and chapter conventions', () => {
    assert.deepEqual(inferMetadataFromArchiveName('[팀] 작품명 Vol. 03.cbz', 'ko'), {
        Title: '작품명 03권',
        Series: '작품명',
        Volume: '03',
        Number: '',
    });
    assert.deepEqual(inferMetadataFromArchiveName('작품명 Chapter 12.zip', 'en'), {
        Title: '작품명 Ch. 12',
        Series: '작품명',
        Volume: '',
        Number: '12',
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
