import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTranslation, translate } from './utils/i18n.js';

test('인덱스 및 순차 자리표시자에 동적 값을 삽입한다', () => {
    assert.equal(formatTranslation('{0}개 성공, {1}개 실패', [3, 1]), '3개 성공, 1개 실패');
    assert.equal(formatTranslation('{} series have {} missing volumes', [2, 4]), '2 series have 4 missing volumes');
});

test('누락 권수 Toast 문구를 각 언어에서 동적으로 생성한다', () => {
    assert.match(translate('tf_toast_missing', 'ko', [2]), /2/);
    assert.match(translate('tf_toast_missing', 'en', [2]), /2/);
    assert.match(translate('tf_toast_missing', 'ja', [2]), /2/);
});
