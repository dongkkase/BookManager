import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanText, isProtectedTextLine, MAX_RECORDED_TEXT_CHANGES } from './textCleanerPolicy.js';

test('텍본 정리기는 행 앞 공백과 연속 공백을 제거한다', () => {
    const result = cleanText('  첫  번째 문장.\n\t두  번째 문장.');

    assert.equal(result.text, '첫 번째 문장.\n두 번째 문장.');
    assert.equal(result.changes.filter(change => change.type === 'whitespace').length, 2);
});

test('따옴표 짝이 잘못되거나 닫히지 않은 짧은 대사도 앞 공백을 정리한다', () => {
    for (const dialogue of ["'사저.....!\"", '“사저.....!\'', '"사저.....!', '「사저.....!』']) {
        for (const whitespace of [' ', '\t', '\u3000', '\u00a0']) {
            assert.equal(cleanText(whitespace + dialogue).text, dialogue);
            assert.equal(cleanText(whitespace + dialogue, {
                trimLeadingWhitespace: false, collapseRepeatedSpaces: false,
            }).text, whitespace + dialogue);
        }
    }
    const table = "  '항목'\t'값\"";
    assert.equal(cleanText(table).text, table);
    const code = "```\n  '사저.....!\"\n```";
    assert.equal(cleanText(code).text, code);
});

test('따옴표와 문장부호 비율이 높은 짧은 대사도 앞 공백을 제거한다', () => {
    for (const dialogue of ['"네!"', '"응?"', "'왜?'", '“네!”', '‘응?’', '「네!」', '『응?』', '"......"', '“……”']) {
        for (const whitespace of [' ', '  ', '\t', '\u3000', '\u00a0']) {
            const source = whitespace + dialogue;
            const result = cleanText(source);

            assert.equal(result.text, dialogue);
            assert.equal(result.changes.length, 1);
            assert.equal(result.changes[0].type, 'whitespace');
            assert.equal(result.changes[0].before, source);
            assert.equal(result.changes[0].after, dialogue);
            assert.equal(isProtectedTextLine(source), false);
            assert.equal(cleanText(source, {
                trimLeadingWhitespace: false,
                collapseRepeatedSpaces: false,
            }).text, source);
        }
    }
});

test('짧은 대사의 앞 공백만 제거하고 대사 앞뒤의 개행은 유지한다', () => {
    for (const newline of ['\n', '\r\n', '\r']) {
        const source = ['장군보는 얼굴을 붉히며 대답했다.', '', ' "네!"', '', '바로 이때였다.'].join(newline);
        const expected = ['장군보는 얼굴을 붉히며 대답했다.', '', '"네!"', '', '바로 이때였다.'].join(newline);

        assert.equal(cleanText(source).text, expected);
        assert.equal(cleanText(expected).text, expected);
    }
    assert.equal(cleanText(' "네!"\n "응?"').text, '"네!"\n"응?"');
});

test('짧은 대사와 유사해도 표와 구분선 및 코드 블록의 공백은 보호한다', () => {
    const source = [
        '    ------',
        '    ......',
        '    ****',
        '    ┌────┬────┐',
        '    | "네!" | 대사 |',
        '\t"네!"\t대사',
        '    "네!"    "응?"    "왜?"',
        '```',
        '    "네!"',
        '```',
    ].join('\n');

    assert.equal(cleanText(source).text, source);
});

test('제목과 머리말 및 본문의 연속 공백을 표로 오인하지 않는다', () => {
    const source = [
        '      의천도룡기(倚天屠龍記)    제 1 권',
        '      ------  머리말',
        '       이 소설<대륙의  영웅(大陸의 英雄)>은   현존의 중국 최대',
        '작가로 알려진 김용의 소설이다.',
    ].join('\n');
    const result = cleanText(source, { joinBrokenLines: false });

    assert.equal(result.text, [
        '의천도룡기(倚天屠龍記) 제 1 권',
        '------ 머리말',
        '이 소설<대륙의 영웅(大陸의 英雄)>은 현존의 중국 최대',
        '작가로 알려진 김용의 소설이다.',
    ].join('\n'));
    assert.equal(result.changes.filter(change => change.type === 'whitespace').length, 3);
    assert.equal(cleanText(source).text.startsWith('의천도룡기(倚天屠龍記) 제 1 권\n------ 머리말\n'), true);
});

test('전각 공백과 줄 바꿈 없는 공백도 옵션에 따라 정리한다', () => {
    const source = '\u3000\u00a0첫\u3000\u3000번째 문장.\r\n\u2002\u2003두\u00a0\u00a0번째 문장.';

    assert.equal(cleanText(source).text, '첫 번째 문장.\r\n두 번째 문장.');
    assert.equal(cleanText(source, {
        trimLeadingWhitespace: false,
        collapseRepeatedSpaces: false,
    }).text, source);
    assert.equal(cleanText('\u3000첫  문장.', { collapseRepeatedSpaces: false }).text, '첫  문장.');
    assert.equal(cleanText('  첫\u3000\u3000문장.', { trimLeadingWhitespace: false }).text, ' 첫 문장.');
});

test('들여쓴 표와 탭 구분 행 및 코드 블록의 공백은 보존한다', () => {
    const source = [
        '    이름  등급  상태',
        '    홍길동  S급  생존',
        '    항목    값',
        '\t이름\t설명',
        '    | 이름 | 설명 |',
        '    ------',
        '```',
        '    const title = "첫  문장";',
        '```',
    ].join('\n');

    assert.equal(cleanText(source).text, source);
});

test('텍본 정리기는 문장 중간에 잘못 들어간 개행을 연결한다', () => {
    const result = cleanText('예고하고 있었\n 다.\n\n숨긴 무\n림고수였다.');

    assert.equal(result.text, '예고하고 있었다.\n\n숨긴 무림고수였다.');
    assert.equal(result.changes.filter(change => change.type === 'lineBreak').length, 2);
});

test('괄호 안에서 끊긴 한자 인용문은 공백과 개행을 함께 정리한다', () => {
    const lines = [
        '".......무량백천만억대중지중(無量百千萬億大衆之中) 설승묘가타왈(說勝妙伽他曰), 유애고생우(由愛故生憂), 우애고생포(由',
        '愛故生怖)     약이어애자(若離於愛者)     무우역무포(無憂亦無',
        '怖)......."',
    ];
    const expected = '".......무량백천만억대중지중(無量百千萬億大衆之中) 설승묘가타왈(說勝妙伽他曰), 유애고생우(由愛故生憂), 우애고생포(由愛故生怖) 약이어애자(若離於愛者) 무우역무포(無憂亦無怖)......."';

    for (const newline of ['\n', '\r\n', '\r']) {
        const result = cleanText(lines.join(newline));

        assert.equal(result.text, expected);
        assert.equal(result.changes.filter(change => change.type === 'lineBreak').length, 2);
        assert.equal(result.changes.filter(change => change.type === 'whitespace').length, 1);
        assert.equal(cleanText(result.text).text, result.text);
        for (const change of result.changes) {
            assert.equal(result.text.slice(change.resultStart, change.resultEnd), change.after);
        }
        assert.equal(cleanText(lines.join(newline), { joinBrokenLines: false }).text,
            lines.join(newline).replace(/ {5}/g, ' '));
        assert.equal(cleanText(lines.join(newline), { collapseRepeatedSpaces: false }).text,
            lines.join(''));
    }
});

test('괄호의 이어지는 줄은 전각 괄호와 중첩 괄호도 인식한다', () => {
    assert.equal(cleanText('구절（無憂亦無\n怖）.......').text, '구절（無憂亦無怖）.......');
    assert.equal(cleanText('구절((無憂)亦無\n怖).......').text, '구절((無憂)亦無怖).......');
    assert.equal(cleanText('영문(hello\nworld).').text, '영문(hello world).');
});

test('한자 구절을 나열한 인용문은 표로 보호하지 않고 구절 사이를 띄워 연결한다', () => {
    const first = ' "고반재간(考槃在澗)  석인지관(碩人之寬)  독매오언(獨寐寤言)';
    const last = '영시물훤(永示勿萱)........"';
    const expected = '"고반재간(考槃在澗) 석인지관(碩人之寬) 독매오언(獨寐寤言) 영시물훤(永示勿萱)........"';
    for (const newline of ['\n', '\r\n', '\r']) {
        const source = first + newline + last;
        const result = cleanText(source);
        assert.equal(result.text, expected);
        assert.equal(result.protectedLineCount, 0);
        assert.equal(cleanText(result.text).text, expected);
        for (const change of result.changes) {
            assert.equal(result.text.slice(change.resultStart, change.resultEnd), change.after);
        }
        assert.equal(cleanText(source, { joinBrokenLines: false }).text,
            first.trimStart().replace(/ {2}/g, ' ') + newline + last);
        assert.equal(cleanText(source, { collapseRepeatedSpaces: false }).text, first.trimStart() + ' ' + last);
    }
});

test('여러 줄의 한자 구절과 전각 괄호 인용문도 같은 규칙으로 연결한다', () => {
    for (const [opening, closing] of [['"', '"'], ['“', '”'], ['「', '」']]) {
        const lines = [
            `${opening}고반재간（考槃在澗）`,
            '석인지관（碩人之寬）  독매오언（獨寐寤言）',
            `영시물훤（永示勿萱）........${closing}`,
        ];
        assert.equal(cleanText(lines.join('\n')).text, lines.join(' ').replace(/ {2}/g, ' '));
    }
});

test('한자 인용문 연결은 빈 줄과 코드, 표 및 일반 괄호 목록의 경계를 보존한다', () => {
    for (const source of [
        '"고반재간(考槃在澗)\n\n영시물훤(永示勿萱)"',
        '제목(題目)\n저자(著者)',
        '고반재간(考槃在澗)  석인지관(碩人之寬)  독매오언(獨寐寤言)',
        '"고반재간(考槃在澗)"\n이름(姓名)  등급(等級)  상태(狀態)',
        '"고반재간(考槃在澗)\n석인지관(碩人之寬)\t독매오언(獨寐寤言)"',
        '```\n "고반재간(考槃在澗)  석인지관(碩人之寬)\n영시물훤(永示勿萱)"\n```',
    ]) assert.equal(cleanText(source).text, source);
});

test('하이픈으로 둘러싼 문장의 끊긴 단어를 연결하고 장식은 남긴다', () => {
    const lines = [
        '-----즐겁게 심산유곡을 노니느니 님의 마음 너그러워라, 자연',
        '을 벗삼아 홀로 잠들고 홀로 말하니, 님이여 영원히 잊지 않으',
        '리.-----',
    ];
    for (const newline of ['\n', '\r\n', '\r']) {
        const source = lines.join(newline);
        const result = cleanText(source);
        assert.equal(result.text, lines.join(''));
        assert.equal(result.changes.length, 2);
        assert.equal(result.protectedLineCount, 0);
        assert.equal(cleanText(result.text).text, result.text);
        assert.equal(cleanText(source, { joinBrokenLines: false }).text, source);
        assert.equal(cleanText(source + newline + '다음 문장.').text, lines.join('') + newline + '다음 문장.');
        assert.equal(cleanText('앞 문단' + newline + source).text, '앞 문단' + newline + lines.join(''));
        for (const change of result.changes) {
            assert.equal(source.slice(change.sourceStart, change.sourceEnd), newline);
            assert.equal(result.text.slice(change.resultStart, change.resultEnd), change.after);
        }
    }
});

test('제목과 단독 구분선, 빈 줄 및 코드·표가 있는 장식 구간은 계속 보호한다', () => {
    for (const source of [
        '------ 머리말\n본문입니다.',
        '-----제목-----\n본문입니다.',
        '-----제목\n부제-----',
        '-----자연\n\n을 벗삼는다.-----',
        '-----\n문장.\n-----',
        '```\n-----자연\n을 벗삼는다.-----\n```',
        '-----자연\n| 항목 | 값 |\n리.-----',
    ]) assert.equal(cleanText(source).text, source);
});

test('한자 인용문과 하이픈 문단 사이의 빈 줄은 유지한다', () => {
    const source = ' "고반재간(考槃在澗)  석인지관(碩人之寬)  독매오언(獨寐寤言)\n영시물훤(永示勿萱)........"\n\n-----자연\n을 벗삼아 살았\n다.-----';
    const result = cleanText(source);
    assert.equal(result.text, '"고반재간(考槃在澗) 석인지관(碩人之寬) 독매오언(獨寐寤言) 영시물훤(永示勿萱)........"\n\n-----자연을 벗삼아 살았다.-----');
});

test('한자 병기 뒤에서 끊긴 조사는 앞줄의 닫는 괄호에 붙여 연결한다', () => {
    const first = '비문에는 당태종이 당시 진왕(秦王)의 신분으로 왕세충(王世忠)';
    const second = '을 토벌할 때 소림 승려들이 종군하여 공을 세운 업적이 수록돼있었다.';

    for (const newline of ['\n', '\r\n', '\r']) {
        const source = `${first}${newline}${second}`;
        const result = cleanText(source);

        assert.equal(result.text, first + second);
        assert.equal(result.changes.length, 1);
        assert.equal(result.changes[0].type, 'lineBreak');
        assert.equal(result.changes[0].after, '');
        assert.equal(result.text.slice(result.changes[0].resultStart, result.changes[0].resultEnd), '');
        assert.equal(cleanText(source, { joinBrokenLines: false }).text, source);
    }
});

test('한자 병기의 여는 괄호 앞에서 끊긴 문장을 연결한다', () => {
    const first = '도화도주 동사 황약사는 곽양의 외조부로서, 성품이 괴팍하여평생 예법을 무시하며 살아 다. 그는 자신의 외손녀를 소동사';
    const second = '(小東邪)라 불렀고, 곽양은 그를 노동사로 부렀다. 황약사는 그럴 때마다 나무라지 않았을 뿐더러 오히려 기뻐했다.';

    for (const newline of ['\n', '\r\n', '\r']) {
        const source = first + newline + second;
        const result = cleanText(source);

        assert.equal(result.text, first + second);
        assert.equal(result.changes.length, 1);
        assert.equal(result.changes[0].type, 'lineBreak');
        assert.equal(result.changes[0].after, '');
        assert.equal(cleanText(result.text).text, result.text);
        assert.equal(cleanText(source, { joinBrokenLines: false }).text, source);
    }
});

test('전각 괄호와 여러 줄로 끊긴 한자 병기도 앞 단어에 붙인다', () => {
    for (const [opening, closing] of [['(', ')'], ['（', '）']]) {
        assert.equal(cleanText(`소동사\n ${opening}小東邪${closing}라 불렀다.`).text, `소동사${opening}小東邪${closing}라 불렀다.`);
        assert.equal(cleanText(`소동사\n${opening}小\n東邪${closing}라 불렀다.`).text, `소동사${opening}小東邪${closing}라 불렀다.`);
    }
});

test('고정 폭 줄바꿈으로 판정된 빈 줄 뒤의 한자 병기도 연결한다', () => {
    const first = `${'가'.repeat(37)}소동사`;
    const second = '(小東邪)라 불렀다.';
    const source = Array.from({ length: 6 }, () => [first, second]).flat().join('\n\n');

    assert.equal(cleanText(source).text, Array.from({ length: 6 }, () => first + second).join('\n\n'));
});

test('한자 병기 앞이라도 문장 끝과 문단 및 일반 괄호 목록은 유지한다', () => {
    for (const source of [
        '소동사였다.\n(小東邪)라는 이름이다.',
        '소동사\n\n(小東邪)라 불렀다.',
        '등장인물\n(1) 소동사',
        '등장인물\n(가) 소동사',
        '소동사\n(참고) 별명이다.',
        '소동사\n(小東邪)    등급    상태',
        '```\n소동사\n(小東邪)라 불렀다.\n```',
    ]) {
        assert.equal(cleanText(source).text, source);
    }
});

test('일반 괄호와 전각 괄호 뒤의 여러 조사를 인식한다', () => {
    for (const name of ['진왕(秦王)', '진왕（秦王）', '진왕((秦王))']) {
        for (const particle of ['은', '는', '이', '가', '을', '를', '의', '와', '과', '에', '에서', '에게', '으로', '로', '도', '만', '부터', '까지']) {
            assert.equal(cleanText(`${name}\n ${particle} 이어진 문장.`).text, `${name}${particle} 이어진 문장.`);
        }
    }
});

test('닫는 괄호 뒤라도 문장 끝과 새 문단 및 조사로 시작하지 않는 줄은 유지한다', () => {
    for (const source of [
        '설명(여기서 끝.)\n이 다음 문장이다.',
        '설명（여기서 끝.）\n이 다음 문장이다.',
        '왕세충(王世忠)\n\n을 토벌했다.',
        '왕세충(王世忠)\n을지문덕이 등장했다.',
        '왕세충(王世忠)\n그는 떠났다.',
        '왕세충(王世忠)\n------ 머리말',
    ]) {
        assert.equal(cleanText(source).text, source);
    }
});

test('닫힌 괄호와 빈 줄 뒤의 표 및 명시적인 레이아웃은 계속 보호한다', () => {
    for (const prefix of ['설명(끝)\n', '설명(미완성\n', '설명(미완성\n\n']) {
        const source = `${prefix}이름  등급  상태\n홍길동  S급  생존`;
        assert.equal(cleanText(source).text, source);
    }
    for (const layout of ['이름\t등급\t상태', '| 이름 | 등급 |', '┌────┬────┐', '------', '```\n  코드  본문\n```']) {
        const source = `설명(미완성\n${layout}`;
        assert.equal(cleanText(source).text, source);
    }
    const table = '이름(한자)    등급(S)    상태(생존)';
    assert.equal(cleanText(table).text, table);
});

test('텍본 정리기는 문장 끝과 빈 줄의 개행을 유지한다', () => {
    const source = '첫 문장이다.\n둘째 문장이다.\n\n새 문단이다.';
    assert.equal(cleanText(source).text, source);
});

test('고정 폭으로 보이는 인용문도 문장 끝의 닫는 따옴표 뒤 개행은 유지한다', () => {
    const thought = '아마 암중 호위대는 그냥 자기가 자객들을 처리하기 귀찮아서 부리는 건가.';
    const narration = '황제는 슬프게도 황실에서 가장 암살 위협을 많이 받는 이였다.';
    for (const [opening, closing] of [["'", "'"], ['‘', '’'], ['"', '"'], ['“', '”'], ['「', '」'], ['『', '』']]) {
        for (const newline of ['\n', '\r\n', '\r']) {
            const quote = opening + thought + closing;
            const pair = quote + newline + narration;
            assert.equal(cleanText(pair).text, pair);
            const source = Array.from({ length: 6 }, () => [quote, narration]).flat().join(newline.repeat(2));
            const result = cleanText(source);
            assert.equal(result.text, source);
            assert.equal(result.changes.filter(change => change.type === 'lineBreak').length, 0);
        }
    }
});

test('고정 폭 문서에서도 문장 끝은 보존하고 문장 중간의 끊긴 줄만 연결한다', () => {
    for (const ending of ['.', '!', '?', '。', '？', '！', '…', '.’', '!”', '?)']) {
        const complete = '가'.repeat(40 - ending.length) + ending;
        const broken = '나'.repeat(40);
        const tail = '다.';
        const source = Array.from({ length: 6 }, () => [complete, broken, tail]).flat().join('\n\n');
        const expected = Array.from({ length: 6 }, () => [complete, broken + tail]).flat().join('\n\n');
        const result = cleanText(source);
        assert.equal(result.text, expected);
        assert.equal(result.changes.filter(change => change.type === 'lineBreak').length, 6);
        assert.equal(cleanText(result.text).text, expected);
        assert.equal(cleanText(source, { joinBrokenLines: false }).text, source);
        for (const change of result.changes) {
            assert.equal(source.slice(change.sourceStart, change.sourceEnd), '\n\n');
            assert.equal(result.text.slice(change.resultStart, change.resultEnd), change.after);
        }
    }
});

test('날짜와 사건으로 구성된 연표는 공백만 정리하고 개행을 유지한다', () => {
    const lines = [
        ' 2150년 01월 01일 : 제3차 대전',
        ' 2150년 05월 03일 : 전세계 무정부 채택',
        ' 2150년 09월 12일 : 새로운 신생국가 생성',
        ' 2152년 05월 05일 : 기계인간을 이용한 제4차 대전',
        ' 2160년 12월 04일 : 인조인간 첫 탄생',
        ' 2172년 11월 28일 : 인조인간 법령 제정',
        ' 2200년 03월 05일 : 생체관련 DNA 조작 법령 제정',
    ];

    for (const newline of ['\n', '\r\n', '\r']) {
        const result = cleanText(lines.join(newline));

        assert.equal(result.text, lines.map(line => line.trimStart()).join(newline));
        assert.equal(result.changes.filter(change => change.type === 'whitespace').length, lines.length);
        assert.equal(result.changes.filter(change => change.type === 'lineBreak').length, 0);
        assert.equal(cleanText(result.text).text, result.text);
    }
});

test('연표 항목은 앞뒤의 일반 문장과 연결하지 않는다', () => {
    const source = '주요 사건\n 2150년1월1일：제3차 대전\n이후의 이야기';

    assert.equal(cleanText(source).text, source.replace('\n ', '\n'));
    assert.equal(cleanText(source, { trimLeadingWhitespace: false }).text, source);
    assert.equal(cleanText('2150년 1월 1일에 시작된 전\n쟁이었다.').text, '2150년 1월 1일에 시작된 전쟁이었다.');
});

test('빈 줄이 삽입된 고정 폭 텍스트에서도 연표 앞뒤의 개행은 유지한다', () => {
    const prose = '가'.repeat(40);
    const timeline = `2150년 01월 01일 : ${'나'.repeat(24)}`;
    const source = Array.from({ length: 6 }, () => [prose, timeline]).flat().join('\n\n');
    const result = cleanText(source);

    assert.equal(result.text, source);
    assert.equal(result.changes.filter(change => change.type === 'lineBreak').length, 0);
});

test('빈 줄이 삽입된 고정 폭 줄바꿈은 연결하고 짧은 문단 끝은 유지한다', () => {
    const wrappedLine = `${'가'.repeat(38)} `;
    const blocks = Array.from({ length: 6 }, (_, index) => ({
        wrapped: wrappedLine,
        tail: `마지막 문장 ${index + 1}.`,
    }));
    const source = blocks
        .flatMap(block => [block.wrapped, '', block.tail, ''])
        .slice(0, -1)
        .join('\n');
    const expected = blocks
        .map(block => `${block.wrapped}${block.tail}`)
        .join('\n\n');
    const result = cleanText(source);

    assert.equal(result.text, expected);
    assert.equal(result.changes.filter(change => change.type === 'lineBreak').length, blocks.length);
    assert.equal(result.changes[0].before, '\\n\\n');
});

test('텍스트 표와 특수문자 구분선은 변경하지 않는다', () => {
    const source = '이름  등급  상태\n항목    값\n홍길동  S급  생존\n┌────┬────┐\n| 이름 | 값 |\n-----';
    const result = cleanText(source);

    assert.equal(result.text, source);
    assert.ok(result.protectedLineCount >= 5);
    assert.equal(isProtectedTextLine('이름  등급  상태'), true);
});

test('쉼표 뒤에 끊긴 문장은 공백을 넣어 연결한다', () => {
    assert.equal(cleanText('그는 말했다,\n그리고 떠났다.').text, '그는 말했다, 그리고 떠났다.');
});

test('규칙은 개별적으로 끌 수 있다', () => {
    const source = '  무\n림  고수';
    const result = cleanText(source, {
        trimLeadingWhitespace: false,
        collapseRepeatedSpaces: false,
        joinBrokenLines: false,
    });

    assert.equal(result.text, source);
    assert.equal(result.changes.length, 0);
});

test('대량 변경은 전체 건수를 집계하되 상세 기록 수를 제한한다', () => {
    const source = Array.from({ length: MAX_RECORDED_TEXT_CHANGES + 5 }, () => '  문장.').join('\n');
    const result = cleanText(source);

    assert.equal(result.changeCount, MAX_RECORDED_TEXT_CHANGES + 5);
    assert.equal(result.changes.length, MAX_RECORDED_TEXT_CHANGES);
    assert.equal(result.changesTruncated, true);
});
