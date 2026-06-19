import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildRenameMap,
    inferRenamePattern,
    normalPatternToRegex,
    normalReplacementToRegex,
    padNumbers,
    previewRename,
    regexReplacementToNormal,
} from './multiRenamePolicy.js';

test('공통 접두·접미사를 기준으로 %1 패턴을 추론한다', () => {
    assert.deepEqual(inferRenamePattern(['Book 1 Final.cbz', 'Book 2 Final.cbz']), {
        oldPattern: 'Book %1 Final',
        newPattern: 'Book %1 Final',
    });
});

test('여러 가변 숫자 토큰을 %1, %2 순서로 추론한다', () => {
    assert.deepEqual(inferRenamePattern(['Book 1 Chapter 2.cbz', 'Book 3 Chapter 4.cbz']), {
        oldPattern: 'Book %1 Chapter %2',
        newPattern: 'Book %1 Chapter %2',
    });
});

test('일반 패턴과 정규식 치환 형식을 상호 변환한다', () => {
    assert.equal(normalPatternToRegex('Book %1').source, '^Book (.*)$');
    assert.equal(normalReplacementToRegex('%1 New'), '\\1 New');
    assert.equal(regexReplacementToNormal('\\1 New'), '%1 New');
});

test('숫자 패딩과 순번을 미리보기에 적용한다', () => {
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
    ).newName, '01Volume 002.cbz');
});

test('정상 행만 rename map에 포함한다', () => {
    assert.deepEqual(buildRenameMap([
        { status: 'ok', path: '/a', targetPath: '/b' },
        { status: 'unchanged', path: '/c', targetPath: '/c' },
    ]), { '/a': '/b' });
});
