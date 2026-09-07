import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRenameMap,
    folderNameRenamePattern,
    inferRenamePattern,
    normalPatternToRegex,
    normalReplacementToRegex,
    padNumbers,
    previewRename,
    regexPatternToNormal,
    regexReplacementToNormal,
    resolveRenamePreviewConflicts,
} from './multiRenamePolicy.js';

test('공통 접두·접미사를 기준으로 %1 패턴을 추론한다', () => {
    assert.deepEqual(inferRenamePattern(['Book 1 Final.cbz', 'Book 2 Final.cbz']), {
        oldPattern: 'Book %1 Final.cbz',
        newPattern: 'Book %1 Final.cbz',
    });
});

test('여러 가변 숫자 토큰을 %1, %2 순서로 추론한다', () => {
    assert.deepEqual(inferRenamePattern(['Book 1 Chapter 2.cbz', 'Book 3 Chapter 4.cbz']), {
        oldPattern: 'Book %1 Chapter %2.cbz',
        newPattern: 'Book %1 Chapter %2.cbz',
    });
});

test('원본 권명에 괄호가 섞여 있어도 확장자를 보존해 새 형식을 적용한다', () => {
    const names = [
        '이토 준지 걸작집 1권 토미에 (상).zip',
        '이토 준지 걸작집 2권 토미에 (하).zip',
        '이토 준지 걸작집 6권 뒷골목.zip',
        '이토 준지 걸작집 11권 괴담 (완결).zip',
    ];
    for (const normalization of ['NFC', 'NFD']) {
        const originalNames = names.map(name => name.normalize(normalization));
        const inferred = inferRenamePattern(originalNames);
        assert.equal(inferred.oldPattern, '이토 준지 걸작집 %1권 %2.zip'.normalize(normalization));
        const newPattern = inferred.newPattern.replace(
            '이토 준지'.normalize(normalization),
            '이토준지'.normalize(normalization),
        );
        for (const name of originalNames) {
            const row = previewRename({ name, path: `/books/${name}` }, { ...inferred, newPattern });
            assert.equal(row.newName, name.replace(
                '이토 준지'.normalize(normalization),
                '이토준지'.normalize(normalization),
            ));
            assert.equal(row.status, 'ok');
            assert.equal(row.targetPath, `/books/${row.newName}`);
        }
    }
});

test('일반 패턴과 정규식 치환 형식을 상호 변환한다', () => {
    assert.equal(normalPatternToRegex('Book %1').source, '^Book (.*?)$');
    assert.equal(normalReplacementToRegex('%1 New'), '\\1 New');
    assert.equal(regexPatternToNormal('Book (.*?) (\\d+)'), 'Book %1 %2');
    assert.equal(regexReplacementToNormal('\\1 New'), '%1 New');
});

test('Python 방식으로 숫자 패딩과 순번을 미리보기에 적용한다', () => {
    assert.equal(padNumbers('Book 2', 3), 'Book 002');
    assert.equal(previewRename(
        { name: 'Book 2.cbz', path: '/Books/Book 2.cbz' },
        {
            oldPattern: 'Book %1',
            newPattern: 'Volume %1',
            padNumbers: true,
            numberDigits: 3,
            addSequence: true,
            sequenceStart: 1,
            sequenceDigits: 2,
            sequencePosition: 'before',
        },
        0,
    ).newName, '01_Volume 002.cbz');
});

test('숫자 자리수는 기존 선행 0을 줄이거나 늘리고 유효 숫자는 보존한다', () => {
    const cases = [
        ['Book 01', 1, 'Book 1'],
        ['Book 001', 2, 'Book 01'],
        ['Book 1', 3, 'Book 001'],
        ['Book 000', 1, 'Book 0'],
        ['Book 0', 3, 'Book 000'],
        ['Book 0012', 1, 'Book 12'],
        ['Book 0009007199254740993', 2, 'Book 9007199254740993'],
        ['Book 001 Chapter 002', 1, 'Book 1 Chapter 2'],
    ];
    for (const [name, digits, expected] of cases) {
        assert.equal(padNumbers(name, digits), expected);
    }
});

test('숫자 자리수 변경은 미리보기에 반영하고 옵션을 끄면 원래 자리수를 유지한다', () => {
    const file = { name: 'Book 01.cbz', path: '/Books/Book 01.cbz' };
    const options = {
        oldPattern: 'Book %1.cbz',
        newPattern: 'Volume %1.cbz',
        padNumbers: true,
        numberDigits: 1,
    };
    const row = previewRename(file, options);
    assert.equal(row.newName, 'Volume 1.cbz');
    assert.equal(row.targetPath, '/Books/Volume 1.cbz');
    assert.equal(row.status, 'ok');
    assert.equal(previewRename(file, { ...options, padNumbers: false }).newName, 'Volume 01.cbz');
});

test('확장자가 패턴에 포함되면 전체 파일명을 대상으로 이름을 바꾼다', () => {
    assert.equal(previewRename(
        { name: 'Book 01.cbz', path: '/Books/Book 01.cbz' },
        {
            oldPattern: 'Book %1.cbz',
            newPattern: 'Volume %1.zip',
        },
    ).newName, 'Volume 01.zip');
});

test('일반 문자열과 와일드카드 패턴은 Python 미리보기 규칙을 따른다', () => {
    assert.equal(previewRename(
        { name: 'Book 01 Final.cbz', path: '/Books/Book 01 Final.cbz' },
        {
            oldPattern: 'Book',
            newPattern: 'Volume',
        },
    ).newName, 'Volume 01 Final.cbz');
    assert.equal(previewRename(
        { name: 'Book 01 Final.cbz', path: '/Books/Book 01 Final.cbz' },
        {
            oldPattern: 'Book * Final',
            newPattern: 'Volume',
        },
    ).newName, 'Volume.cbz');
    assert.equal(previewRename(
        { name: 'Book A Final.cbz', path: '/Books/Book A Final.cbz' },
        {
            oldPattern: 'Book ? Final',
            newPattern: 'Volume %1',
        },
    ).newName, 'Volume %1.cbz');
});

test('기존 형식이 비어 있으면 새 형식의 변수는 원래 확장자 제외 이름으로 바뀐다', () => {
    assert.equal(previewRename(
        { name: 'Book 01.cbz', path: '/Books/Book 01.cbz' },
        {
            oldPattern: '',
            newPattern: 'New %1',
        },
    ).newName, 'New Book 01.cbz');
});

test('폴더명 모드는 Python처럼 새 형식 패턴만 변경한다', () => {
    assert.equal(folderNameRenamePattern('Book %1.cbz', 'Series', false), 'Series %1.cbz');
    assert.equal(folderNameRenamePattern('Book \\1.cbz', 'Series', true), 'Series \\1.cbz');
    assert.equal(folderNameRenamePattern('Book', 'Series', false), 'Series %1');
});

test('금지 문자는 사용 불가 상태로 표시한다', () => {
    assert.equal(previewRename(
        { name: 'Book 01.cbz', path: '/Books/Book 01.cbz' },
        {
            oldPattern: 'Book %1',
            newPattern: 'Bad/%1',
        },
    ).status, 'invalid');
});

test('미리보기 충돌은 기존 파일과 이전 행의 결과를 Python 방식으로 판정한다', async () => {
    const rows = [
        previewRename({ name: 'A.cbz', path: '/Books/A.cbz' }, { oldPattern: 'A', newPattern: 'B' }),
        previewRename({ name: 'C.cbz', path: '/Books/C.cbz' }, { oldPattern: 'C', newPattern: 'B' }),
        previewRename({ name: 'D.cbz', path: '/Books/D.cbz' }, { oldPattern: 'D', newPattern: 'E' }),
    ];
    const resolved = await resolveRenamePreviewConflicts(rows, async targetPath => targetPath === '/Books/E.cbz');

    assert.equal(resolved[0].status, 'ok');
    assert.equal(resolved[1].status, 'conflict');
    assert.equal(resolved[2].status, 'conflict');
});

test('정상 행만 rename map에 포함한다', () => {
    assert.deepEqual(buildRenameMap([
        { status: 'ok', path: '/a', targetPath: '/b', oldName: 'a', newName: 'b' },
        { status: 'ok', path: '/c', targetPath: '/c', oldName: 'c', newName: 'c' },
        { status: 'conflict', path: '/d', targetPath: '/e', oldName: 'd', newName: 'e' },
    ]), { '/a': '/b' });
});
