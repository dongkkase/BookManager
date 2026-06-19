import test from 'node:test';
import assert from 'node:assert/strict';

import { findMissingVolumes, isPathInsideFolder } from './missingVolumesPolicy.js';

test('findMissingVolumes finds gaps before the highest volume', () => {
    const result = findMissingVolumes([
        { name: 'Series 1권.cbz', full_path: '/library/Series/Series 1권.cbz', series: 'Series' },
        { name: 'Series 3권.cbz', full_path: '/library/Series/Series 3권.cbz', series: 'Series' },
    ]);

    assert.deepEqual(result, [{
        series: 'Series',
        missing: ['2'],
        folder_path: '/library/Series',
    }]);
});

test('isPathInsideFolder handles platform separators', () => {
    assert.equal(isPathInsideFolder('C:\\Books\\A\\1.cbz', 'C:\\Books\\A'), true);
    assert.equal(isPathInsideFolder('/books/AB/1.cbz', '/books/A'), false);
});
