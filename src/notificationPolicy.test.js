import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionSkippedFiles } from './notificationPolicy.js';

test('분석 제외 파일을 nested archive와 기타 오류로 분리한다', () => {
    assert.deepEqual(partitionSkippedFiles([
        'nested.cbz (nested archive)',
        'notes.txt',
        'encrypted.cbz (encrypted archive)',
    ]), {
        nested: ['nested.cbz (nested archive)'],
        unsupported: ['notes.txt', 'encrypted.cbz (encrypted archive)'],
    });
});

test('빈 분석 결과를 안전하게 처리한다', () => {
    assert.deepEqual(partitionSkippedFiles(), {
        nested: [],
        unsupported: [],
    });
});
