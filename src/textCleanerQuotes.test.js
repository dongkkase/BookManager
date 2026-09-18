import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { cleanText } from './textCleanerPolicy.js';
import { inspectTextQuotes, MAX_RECORDED_QUOTE_ISSUES } from './textCleanerQuotes.js';
import { translate } from './utils/i18n.js';

test('짝이 다른 대사는 공백만 정리하고 따옴표는 검토 항목으로 남긴다', () => {
    const text = cleanText("  '사저.....!\"").text;
    assert.equal(text, "'사저.....!\"");
    const review = inspectTextQuotes(text);
    assert.equal(review.total, 1);
    assert.deepEqual(review.issues[0], {
        type: 'mismatch', start: 0, end: text.length, line: 1,
        expected: "'", actual: '"', preview: text,
    });
});

test('정상 따옴표와 중첩 인용, 여러 줄 대사, 아포스트로피는 표시하지 않는다', () => {
    for (const text of [
        '"네!"', "'네!'", '“네!”', '‘네!’', '「네!」', '『네!』',
        '"그가 \'안녕!\'이라고 했다."', '“그가 ‘안녕!’이라고 했다.”',
        '「그가 『안녕!』이라고 했다.」', '"첫째 줄\n둘째 줄"',
        '"첫째 줄\r\n둘째 줄"', "Don't stop. O’Connor said so.",
        '"그가 \\"안녕\\"이라고 했다."',
    ]) assert.equal(inspectTextQuotes(text).total, 0, text);
});

test('닫는 따옴표 누락과 여는 따옴표 누락을 구별하고 다음 문단에서 복구한다', () => {
    const text = '"사저.....!\n\n정상 문단.\n\n사저.....!"\n\n"네!"';
    const review = inspectTextQuotes(text);
    assert.deepEqual(review.issues.map(issue => [issue.type, issue.line]), [
        ['unclosed', 1], ['unexpected', 5],
    ]);
    assert.equal(text.slice(review.issues[1].start, review.issues[1].end), '"');
});

test('스마트 따옴표 불일치와 중첩 인용의 누락을 찾는다', () => {
    for (const text of ['“사저.....!\'', '「사저.....!』', '"그가 \'네!"']) {
        const review = inspectTextQuotes(text);
        assert.equal(review.total, 1, text);
        assert.equal(review.issues[0].type, 'mismatch');
    }
});

test('코드 블록과 표의 따옴표는 건너뛴다', () => {
    const text = "```\n  'code\"\n```\n\n| 'name | value |\n'a\tvalue\n\n\"네!\"";
    assert.equal(inspectTextQuotes(text).total, 0);
});

test('CRLF와 이모지 뒤에서도 결과 문자열의 UTF-16 선택 위치를 제공한다', () => {
    const text = '😀 정상.\r\n\r\n\'사저.....!"';
    const issue = inspectTextQuotes(text).issues[0];
    assert.equal(issue.line, 3);
    assert.equal(text.slice(issue.start, issue.end), "'사저.....!\"");
    assert.equal(inspectTextQuotes(text.replace(/!"$/, "!'")).total, 0);
});

test('검토 목록의 크기는 제한하지만 전체 의심 건수는 유지한다', () => {
    const review = inspectTextQuotes("'사저!\"\n\n".repeat(MAX_RECORDED_QUOTE_ISSUES + 7));
    assert.equal(review.total, MAX_RECORDED_QUOTE_ISSUES + 7);
    assert.equal(review.issues.length, MAX_RECORDED_QUOTE_ISSUES);
    assert.equal(review.truncated, true);
});

test('직접 수정 후 워커 재검사는 요청 번호와 현재 검사 결과만 반환한다', () => {
    const source = fs.readFileSync(new URL('./workers/textCleanerWorker.js', import.meta.url), 'utf8');
    const messages = [];
    const worker = { postMessage: message => messages.push(message) };
    vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
        self: worker, inspectTextQuotes,
    });
    worker.onmessage({ data: { type: 'quoteReview', requestId: 1, text: "'사저!\"" } });
    worker.onmessage({ data: { type: 'quoteReview', requestId: 2, text: "'사저!'" } });
    assert.deepEqual(messages.map(message => [message.type, message.requestId, message.review.total]), [
        ['quoteReviewResult', 1, 1], ['quoteReviewResult', 2, 0],
    ]);
});

test('따옴표 검토 사유와 이동 안내를 지원 언어로 표시한다', () => {
    for (const language of ['ko', 'en', 'ja']) {
        for (const name of ['review', 'quote_review', 'quote_checking', 'quote_hint', 'previous_quote', 'next_quote', 'quote_go', 'quote_mismatch', 'quote_unclosed', 'quote_unexpected', 'no_quote_issues']) {
            const key = `tools.text_cleaner.${name}`;
            const value = translate(key, language, { expected: '”', actual: "'" });
            assert.notEqual(value, key);
            assert.doesNotMatch(value, /\{(?:expected|actual)\}/);
        }
    }
});
