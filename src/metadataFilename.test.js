import assert from 'node:assert/strict';
import test from 'node:test';
import { splitMetadataFileDisplayName } from './metadataFilename.js';

test('메타데이터 작업리스트 파일명은 중간 말줄임용으로 권수와 확장자를 분리한다', () => {
    assert.deepEqual(
        splitMetadataFileDisplayName('“쓸모없는 빨강머리”라며 해고당한 마력 없는 마녀이지만 01권.cbz'),
        {
            head: '“쓸모없는 빨강머리”라며 해고당한 마력 없는 마녀이지만',
            tail: ' 01권.cbz',
        },
    );
    assert.deepEqual(
        splitMetadataFileDisplayName('Long Series Name Vol. 12.cbz'),
        {
            head: 'Long Series Name',
            tail: ' Vol. 12.cbz',
        },
    );
    assert.deepEqual(
        splitMetadataFileDisplayName('권수없는 아주 긴 파일명.cbz'),
        {
            head: '권수없는 아주 긴 파일명',
            tail: '.cbz',
        },
    );
});
