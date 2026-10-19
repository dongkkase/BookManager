import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function readerTextLength(');
const end = source.indexOf('function elementFromDomNode(', start);
assert.ok(start >= 0 && end > start, 'Reader pagination helpers must be available');
const helpers = source.slice(start, end);
const { paginateText, splitReaderLine, estimateReaderLineCount } = new Function(`${helpers}
return { paginateText, splitReaderLine, estimateReaderLineCount };
`)();
const metrics = { charsPerLine: 12, linesPerPage: 8, wrapMode: 'char', widowLineTolerance: 0 };

test('페이지 분할은 유니코드 문자와 기존의 짧은 줄 공백을 보존한다', () => {
    assert.deepEqual(splitReaderLine('  short 😀  ', 20, 1), ['  short 😀  ', '']);
    assert.deepEqual(splitReaderLine('ab😀cd', 3, 1, 'char'), ['ab😀', 'cd']);
    assert.deepEqual(splitReaderLine('a\ud83db\udc00c', 3, 1, 'char'), ['a\ud83db', '\udc00c']);
    const text = '가😀'.repeat(110);
    assert.deepEqual(paginateText(text, metrics), ['가😀'.repeat(48), '가😀'.repeat(48), '가😀'.repeat(14)]);
});

test('단어 줄바꿈은 마지막 한 줄 안의 공백만 사용하고 문자 줄바꿈은 지정된 길이를 사용한다', () => {
    assert.deepEqual(splitReaderLine('alpha beta gamma delta', 6, 2, 'word'), ['alpha beta', 'gamma delta']);
    assert.deepEqual(splitReaderLine('one ' + 'z'.repeat(20), 4, 3, 'word'), ['one ' + 'z'.repeat(8), 'z'.repeat(12)]);
    assert.deepEqual(splitReaderLine('가😀나\u00a0다😀라', 3, 2, 'word'), ['가😀나', '다😀라']);
    const prefix = '가'.repeat(86);
    const suffix = '나'.repeat(20);
    const text = prefix + ' ' + suffix;
    assert.deepEqual(paginateText(text, { ...metrics, wrapMode: 'word' }), [prefix, suffix]);
    assert.deepEqual(paginateText(text, metrics), [prefix + ' ' + '나'.repeat(9), '나'.repeat(11)]);
});

test('빈 문단 비용과 줄바꿈 정규화는 기존 페이지 경계를 유지한다', () => {
    assert.deepEqual(paginateText('첫 문단\n\n둘째 문단\n\n셋째 문단', {
        ...metrics,
        paragraphLineCost: 3,
    }), ['첫 문단\n\n둘째 문단', '셋째 문단']);
    assert.deepEqual(paginateText('\r\n  첫 줄  \r\n둘째 줄\r마지막 줄\r\n', metrics), ['첫 줄\n둘째 줄\n마지막 줄']);
    assert.deepEqual(paginateText(' \n\t\r\n', metrics), ['']);
});

test('마지막 줄 허용 범위와 본문의 br 표기는 기존대로 처리한다', () => {
    assert.deepEqual(paginateText('가'.repeat(108), metrics), ['가'.repeat(96), '가'.repeat(12)]);
    assert.deepEqual(paginateText('가'.repeat(108), { ...metrics, widowLineTolerance: 1 }), ['가'.repeat(108)]);
    assert.deepEqual(paginateText('가'.repeat(120), { ...metrics, widowLineTolerance: 1 }), ['가'.repeat(96), '가'.repeat(24)]);
    assert.deepEqual(paginateText('가'.repeat(120), { ...metrics, widowLineTolerance: 2 }), ['가'.repeat(120)]);
    for (const marker of ['<br>', '<br />', 'br/>']) {
        const tail = marker.repeat(4) + '나'.repeat(12);
        assert.deepEqual(paginateText('가'.repeat(96) + tail, {
            ...metrics,
            widowLineTolerance: 1,
        }), ['가'.repeat(96), tail]);
    }
});

test('행 수 상한은 들어갈 수 있는 줄의 정확한 계산과 초과 여부를 유지한다', () => {
    assert.equal(estimateReaderLineCount('😀'.repeat(96), 12, 8), 8);
    assert.equal(estimateReaderLineCount('😀'.repeat(97), 12, 8), 9);
    assert.equal(estimateReaderLineCount('😀'.repeat(1200), 12, 8), 9);
    assert.equal(estimateReaderLineCount('😀'.repeat(1200), 12), 100);
});

test('긴 무개행 본문은 페이지마다 남은 본문 전체를 다시 순회하지 않는다', () => {
    const input = '가😀'.repeat(12000);
    const report = vm.runInNewContext(`${helpers}
        const originalIterator = String.prototype[Symbol.iterator];
        let visitedCharacters = 0;
        String.prototype[Symbol.iterator] = function* () {
            for (const character of originalIterator.call(this)) {
                visitedCharacters += 1;
                yield character;
            }
        };
        const pages = paginateText(input, { charsPerLine: 12, linesPerPage: 8, wrapMode: 'char', widowLineTolerance: 0 });
        String.prototype[Symbol.iterator] = originalIterator;
        ({ pages, visitedCharacters });
    `, { input }, { timeout: 4000 });
    assert.equal(report.pages.length, 250);
    assert.equal(report.pages.join(''), input);
    assert.ok(report.visitedCharacters <= input.length * 4, `Pagination revisited ${report.visitedCharacters} characters for ${input.length} code units`);
});
