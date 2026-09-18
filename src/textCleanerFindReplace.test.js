import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEXT_SEARCH_OPTIONS, preserveTextCase, replaceText, searchText } from './textCleanerFindReplace.js';
import { translate } from './utils/i18n.js';

const regex = { ...DEFAULT_TEXT_SEARCH_OPTIONS, regex: true };
const apply = (text, result) => result.change
    ? text.slice(0, result.change.from) + result.change.insert + text.slice(result.change.to) : text;

test('대소문자 구분과 리터럴 특수문자를 검색한다', () => {
    assert.deepEqual(searchText('npm NPM Npm npmx', 'npm').matches, [0, 4, 8, 12]);
    assert.deepEqual(searchText('npm NPM Npm', 'npm', { caseSensitive: true }).matches, [0]);
    assert.equal(searchText('a.b a-b [x] $', 'a.b').totalCount, 1);
    assert.equal(searchText('a.b a-b [x] $', '[x]').totalCount, 1);
    assert.equal(searchText('a.b a-b [x] $', '$').totalCount, 1);
});

test('단어 경계는 한글과 유니코드 문자, 숫자, 밑줄을 구별한다', () => {
    const options = { wholeWord: true };
    assert.equal(searchText('npm npmx xnpm npm_2 (NPM) npm-가', 'npm', options).totalCount, 3);
    assert.equal(searchText('책 책상 헌책 (책) 책_1 책가', '책', options).totalCount, 2);
    assert.equal(searchText('café caféine', 'café', options).totalCount, 1);
});

test('정규식은 가변 길이와 줄 경계 및 빈 일치의 UTF-16 범위를 반환한다', () => {
    const matches = searchText('a12 b345\nc6', '\\d+', regex);
    assert.deepEqual(matches.matches, [1, 5, 10]);
    assert.deepEqual(matches.ends, [3, 8, 11]);
    assert.deepEqual(searchText('😀a', '(?=.)', regex).matches, [0, 2]);
    assert.deepEqual(searchText('a\nb', '^|$', regex).matches, [0, 1, 2, 3]);
    assert.throws(() => searchText('text', '[', regex), SyntaxError);
    assert.throws(() => searchText('text', '[', { ...regex, wholeWord: true }), SyntaxError);
});

test('단일 바꾸기는 선택 위치부터 바꾸고 끝에 도달하면 처음으로 순환한다', () => {
    const text = 'cat cat cat';
    const second = replaceText(text, 'cat', 'dog', {}, { start: 4 });
    assert.equal(apply(text, second), 'cat dog cat');
    assert.equal(second.count, 1);
    assert.equal(second.nextOffset, 7);
    assert.equal(apply(text, replaceText(text, 'cat', '', {}, { start: 20 })), ' cat cat');
});

test('모두 바꾸기는 검색 표시 상한을 넘어 전체를 치환하며 새 문자열을 재치환하지 않는다', () => {
    const text = 'a '.repeat(100005);
    assert.equal(searchText(text, 'a').truncated, true);
    const result = replaceText(text, 'a', 'aa', {}, { all: true });
    assert.equal(result.count, 100005);
    assert.equal(apply(text, result), 'aa '.repeat(100005));
});

test('정규식 캡처 그룹과 이스케이프를 치환하고 일반 모드에서는 문자 그대로 사용한다', () => {
    const text = 'item-12 item-3';
    const result = replaceText(text, '(?<name>item)-(\\d+)', '$2:$<name>:$&:$$\\n', regex, { all: true });
    assert.equal(apply(text, result), '12:item:item-12:$\n 3:item:item-3:$\n');
    assert.equal(apply('a', replaceText('a', 'a', '$1\\n')), '$1\\n');
    assert.equal(apply('b', replaceText('b', '(a)?(b)', '$1$2$12', regex)), 'b2');
    assert.equal(apply('a', replaceText('a', 'a', '\\r\\nb', regex)), '\nb');
});

test('대소문자 보존은 대문자, 소문자, 첫 글자 대문자와 구분된 단어를 유지한다', () => {
    const text = 'cat CAT Cat cAt';
    const result = replaceText(text, 'cat', 'dog', { preserveCase: true }, { all: true });
    assert.equal(apply(text, result), 'dog DOG Dog dog');
    assert.equal(preserveTextCase('Foo-BAR', 'new-name'), 'New-NAME');
    assert.equal(preserveTextCase('한글', 'New'), 'New');
    assert.equal(preserveTextCase('École', 'étude'), 'Étude');
});

test('빈 일치와 빈 치환은 무한 반복 없이 처리하고 다음 검색 위치를 이동한다', () => {
    assert.equal(apply('😀a', replaceText('😀a', '(?=.)', '-', regex, { all: true })), '-😀-a');
    assert.equal(replaceText('😀a', '(?=.)', '', regex).nextOffset, 2);
    assert.equal(apply('a\nb', replaceText('a\nb', '^', '>', regex, { all: true })), '>a\n>b');
    assert.equal(apply('aaa', replaceText('aaa', 'a', '', {}, { all: true })), '');
    assert.equal(replaceText('text', '', 'replacement').change, null);
});

test('검색과 바꾸기의 옵션 및 오류 안내를 모든 지원 언어로 표시한다', () => {
    for (const language of ['ko', 'en', 'ja']) {
        for (const name of ['match_case', 'whole_word', 'use_regex', 'preserve_case', 'replace', 'replace_all', 'invalid_regex', 'search_timeout', 'replaced']) {
            const key = `tools.text_cleaner.${name}`;
            assert.notEqual(translate(key, language, { count: 3 }), key);
        }
    }
});
