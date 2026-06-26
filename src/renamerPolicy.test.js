import test from 'node:test';
import assert from 'node:assert/strict';

import {
    archiveChangeBadges,
    clampStartNumber,
    generateRenamerName,
    moveRenamerEntry,
    normalizeRenamerBatchOptionsFromConfig,
    normalizeRenamerOptionsFromConfig,
    renamerOptionsEqual,
    serializeRenamerBatchOptions,
    serializeRenamerOptions,
} from './renamerPolicy.js';

test('원본 패턴 순서대로 새 이름을 생성한다', () => {
    const entry = { oldName: 'old.jpg' };
    assert.equal(generateRenamerName(entry, 0, 10, { patternIndex: 0 }), '00.jpg');
    assert.equal(generateRenamerName(entry, 0, 10, { patternIndex: 1 }), 'Cover.jpg');
    assert.equal(generateRenamerName(entry, 2, 10, { patternIndex: 1 }), 'Page_02.jpg');
    assert.equal(generateRenamerName(entry, 1, 10, { patternIndex: 2, archiveStem: 'My Book' }), 'My_Book_01.jpg');
    assert.equal(generateRenamerName(entry, 0, 10, { patternIndex: 3, archiveStem: 'My Book' }), 'My_Book_Cover.jpg');
    assert.equal(generateRenamerName(entry, 1, 10, { patternIndex: 4, customText: 'Page' }), 'Page_01.jpg');
});

test('WebP 변환과 내부 이름 유지가 확장자에 반영된다', () => {
    assert.equal(
        generateRenamerName({ oldName: 'cover.png' }, 0, 1, { keepName: true, webpConversion: true }),
        'cover.webp',
    );
});

test('대상 압축 파일의 출력 포맷 변경 배지를 계산한다', () => {
    assert.deepEqual(
        archiveChangeBadges({ name: 'book.zip' }, { target_format: 'cbz' }),
        [{ key: 'format', label: 'CBZ' }],
    );
    assert.deepEqual(
        archiveChangeBadges({ filepath: '/books/book.cbz' }, { target_format: 'cbz' }),
        [],
    );
    assert.deepEqual(
        archiveChangeBadges({ filepath: '/books/book.zip' }, { target_format: '7z', webp_conversion: true }),
        [
            { key: 'format', label: '7Z' },
            { key: 'webp', label: 'WEBP' },
        ],
    );
});

test('드래그 순서 변경과 시작 번호 범위를 보정한다', () => {
    assert.deepEqual(moveRenamerEntry(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
    assert.equal(clampStartNumber(-1), 0);
    assert.equal(clampStartNumber(1000000), 999999);
});

test('내부 파일명 변경 옵션은 저장된 설정에서 복원 가능한 형태로 정규화한다', () => {
    const options = normalizeRenamerOptionsFromConfig({
        rename_pattern_idx: 4,
        custom_text: 'Fairy',
        keep_internal_name: true,
        start_num: 12,
    });

    assert.deepEqual(options, {
        patternIndex: 4,
        customText: 'Fairy',
        keepName: true,
        startNum: 12,
    });
    assert.deepEqual(serializeRenamerOptions(options), {
        rename_pattern_idx: 4,
        custom_text: 'Fairy',
        keep_internal_name: true,
        start_num: 12,
    });
});

test('내부 파일명 변경 옵션 비교는 저장 키와 UI 상태 이름 차이를 흡수한다', () => {
    assert.equal(renamerOptionsEqual(
        { patternIndex: 2, customText: 'A', keepName: false, startNum: 3 },
        { rename_pattern_idx: 2, custom_text: 'A', keep_internal_name: false, start_num: 3 },
    ), true);
    assert.equal(renamerOptionsEqual(
        { patternIndex: 2, customText: 'A', keepName: false, startNum: 3 },
        { rename_pattern_idx: 3, custom_text: 'A', keep_internal_name: false, start_num: 3 },
    ), false);
});

test('내부 파일명 변경 일괄 처리 옵션은 기본값으로 저장하고 복원한다', () => {
    const options = normalizeRenamerBatchOptionsFromConfig({
        renamer_default_cap_opt: true,
        renamer_default_exif_opt: true,
    });

    assert.deepEqual(options, {
        capOpt: true,
        exifOpt: true,
    });
    assert.deepEqual(serializeRenamerBatchOptions(options), {
        renamer_default_cap_opt: true,
        renamer_default_exif_opt: true,
    });
});
