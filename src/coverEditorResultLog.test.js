import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoverEditorResultLog } from './coverEditorResultLog.js';
import { translate } from './utils/i18n.js';

const t = key => translate(key, 'ko');

test('백업과 읽기 경고를 포함한 성공 로그는 파일 한 개로 집계한다', () => {
    const filePath = '/books/book.epub';
    const result = createCoverEditorResultLog({
        entries: [{ filePath, name: '책 이름.epub', info: {} }],
        outcomes: [{ filePath, success: true, backupPath: '/books/bak/book.epub', warning: 'preview unavailable', readingWarning: 'reading position unavailable', readingAdjustmentUncertain: true }],
    }, t);
    assert.equal(result.stats.success.length, 1);
    assert.deepEqual(result.stats.skip, []);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(result.outputFiles, [filePath]);
    assert.equal(result.cancelled, false);
    for (const message of ['책 이름.epub', filePath, t('cover_editor_saved'), `${t('cover_editor_backup_path')}: /books/bak/book.epub`, `${t('cover_editor_refresh_warning')}: preview unavailable`, 'reading position unavailable', t('cover_editor_reading_check')]) {
        assert.ok(result.stats.success[0].includes(message), message);
    }
});

test('변환 저장은 원본 이름과 경로를 유지하고 실제 출력 경로를 반환한다', () => {
    const sourcePath = 'C:\\Books\\source.cbr';
    const filePath = 'C:\\Books\\source_cover.cbz';
    const result = createCoverEditorResultLog({
        entries: [{ filePath: sourcePath, name: 'source.cbr', info: {} }],
        outcomes: [{ sourcePath, filePath, success: true }],
        checkedPaths: [sourcePath],
    }, t);
    assert.deepEqual(result.outputFiles, [filePath]);
    assert.equal(result.stats.success.length, 1);
    assert.ok(result.stats.success[0].startsWith(`source.cbr\n${sourcePath}\n`));
    assert.ok(result.stats.success[0].includes(`${t('cover_editor_result_path')}: ${filePath}`));
});

test('성공·실패·중단은 각각 집계하며 선택하지 않은 파일을 건너뜀으로 만들지 않는다', () => {
    const result = createCoverEditorResultLog({
        entries: ['saved', 'failed', 'cancelled', 'unchecked'].map(name => ({ filePath: `/books/${name}.cbz`, name, info: {} })),
        outcomes: [
            { filePath: '/books/saved.cbz', success: true },
            { filePath: '/books/failed.cbz', success: false, error: 'disk full' },
            { filePath: '/books/cancelled.cbz', success: false, cancelled: true },
        ],
        checkedPaths: ['/books/saved.cbz', '/books/failed.cbz', '/books/cancelled.cbz'],
    }, t);
    assert.deepEqual(Object.fromEntries(Object.entries(result.stats).map(([kind, values]) => [kind, values.length])), { success: 1, skip: 1, error: 1 });
    assert.deepEqual(result.outputFiles, ['/books/saved.cbz']);
    assert.equal(result.cancelled, true);
    assert.match(result.stats.error[0], /disk full/);
    assert.ok(result.stats.skip[0].includes(t('cover_editor_batch_cancelled')));
    assert.equal(Object.values(result.stats).flat().some(line => line.includes('unchecked')), false);
});

test('선택한 검사 실패만 포함하며 저장 결과가 있는 원본의 검사 오류는 중복 집계하지 않는다', () => {
    const entries = [
        { filePath: '/books/inspection.cbz', name: 'inspection', error: 'cannot read archive' },
        { filePath: '/books/unchecked.cbz', name: 'unchecked', error: 'not selected' },
        { filePath: '/books/attempted.cbr', name: 'attempted', error: 'old inspection error' },
    ];
    const result = createCoverEditorResultLog({
        entries,
        outcomes: [{ sourcePath: '/books/attempted.cbr', filePath: '/books/attempted_cover.cbz', success: true }],
        checkedPaths: new Set(['/books/inspection.cbz', '/books/attempted.cbr']),
    }, t);
    assert.equal(result.stats.success.length, 1);
    assert.equal(result.stats.error.length, 1);
    assert.ok(result.stats.error[0].includes(`${t('cover_editor_batch_inspect_failed')}: cannot read archive`));
    assert.equal(Object.values(result.stats).flat().some(line => /old inspection error|not selected/.test(line)), false);
    assert.deepEqual(result.outputFiles, ['/books/attempted_cover.cbz']);
});

test('저장을 시도할 수 없는 검사 실패만으로도 결과를 만들며 빈 선택은 제외한다', () => {
    const entries = [{ filePath: '/books/invalid.cbz', error: 'invalid archive' }];
    const result = createCoverEditorResultLog({ entries }, t);
    assert.deepEqual(result.stats.success, []);
    assert.deepEqual(result.stats.skip, []);
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(result.outputFiles, []);
    assert.equal(result.cancelled, false);
    assert.deepEqual(createCoverEditorResultLog({ entries, checkedPaths: [] }, t), {
        stats: { success: [], skip: [], error: [] }, outputFiles: [], cancelled: false,
    });
});

test('기존 표지 오류 코드는 지원 언어로 번역하고 알 수 없는 오류는 메시지를 유지한다', () => {
    const codes = {
        COVER_SOURCE_CHANGED: 'cover_editor_source_changed',
        IMAGE_SOURCE_CHANGED: 'cover_editor_image_changed',
        COVER_VIEWER_OPEN: 'cover_editor_viewer_open',
        COVER_METADATA_IMAGE_UNAVAILABLE: 'cover_editor_metadata_image_unavailable',
    };
    for (const language of ['ko', 'en', 'ja']) {
        const translateKey = key => translate(key, language);
        const result = createCoverEditorResultLog({
            outcomes: Object.keys(codes).map(code => ({ filePath: `/books/${code}.cbz`, success: false, code, error: 'raw backend error' })),
        }, translateKey);
        Object.values(codes).forEach((key, index) => {
            assert.ok(result.stats.error[index].endsWith(translateKey(key)));
            assert.doesNotMatch(result.stats.error[index], /raw backend error/);
        });
    }
    const result = createCoverEditorResultLog({ outcomes: [{ filePath: '/books/unknown.cbz', success: false, code: 'OTHER', error: 'original message' }, { filePath: '/books/missing.cbz', success: false }] }, t);
    assert.ok(result.stats.error[0].endsWith('original message'));
    assert.ok(result.stats.error[1].endsWith(t('cover_editor_failed')));
});

test('로그와 출력은 작업 목록 순서로 정렬하고 목록 밖 결과는 응답 순서를 유지한다', () => {
    const entries = Object.freeze([{ filePath: '/books/first.cbz' }, { filePath: '/books/second.cbz' }].map(Object.freeze));
    const outcomes = Object.freeze([
        { filePath: '/books/outside-b.cbz', success: true },
        { filePath: '/books/second.cbz', success: true },
        { filePath: '/books/outside-a.cbz', success: true },
        { filePath: '/books/first.cbz', success: true },
    ].map(Object.freeze));
    const result = createCoverEditorResultLog({ entries, outcomes }, t);
    assert.deepEqual(result.outputFiles, ['/books/first.cbz', '/books/second.cbz', '/books/outside-b.cbz', '/books/outside-a.cbz']);
    assert.deepEqual(result.stats.success.map(line => line.split('\n')[0]), ['first.cbz', 'second.cbz', 'outside-b.cbz', 'outside-a.cbz']);
    assert.equal(outcomes[0].filePath, '/books/outside-b.cbz');
});
