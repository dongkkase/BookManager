import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canContinueResult,
    filterExistingResultPaths,
    formatResultLog,
    normalizeResultStats,
} from './resultLog.js';

test('로그는 오류, 성공, 건너뜀 순서로 구성한다', () => {
    const log = formatResultLog({
        success: ['success.cbz'],
        skip: ['skip.cbz'],
        error: ['error.cbz'],
    });

    assert.ok(log.indexOf('[ERRORS]') < log.indexOf('[SUCCESS]'));
    assert.ok(log.indexOf('[SUCCESS]') < log.indexOf('[SKIPPED]'));
});

test('비어 있는 로그 구역은 표시하지 않는다', () => {
    assert.equal(formatResultLog({ success: ['book.cbz'] }), '[SUCCESS]\nbook.cbz');
    assert.deepEqual(normalizeResultStats(), { error: [], success: [], skip: [] });
});

test('비취소 작업에 결과 파일이 있을 때만 계속할 수 있다', () => {
    assert.equal(canContinueResult({ cancelled: false }, ['/books/a.cbz']), true);
    assert.equal(canContinueResult({ cancelled: true }, ['/books/a.cbz']), false);
    assert.equal(canContinueResult({ cancelled: false }, []), false);
});

test('실제로 존재하는 결과 경로만 계속 대상으로 유지한다', async () => {
    const existing = await filterExistingResultPaths(
        ['/books/a.cbz', '/books/missing.cbz'],
        async filePath => filePath.endsWith('a.cbz'),
    );

    assert.deepEqual(existing, ['/books/a.cbz']);
});
