import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFolderCharacterIndex } from './folderCharacterIndex.js';

function filesNamed(...names) {
    return names.map((name, index) => ({ name, path: `/library/${index}/${name}` }));
}

function labelsFor(names, locale) {
    return buildFolderCharacterIndex(filesNamed(...names), locale).map(entry => entry.label);
}

test('현재 목록에 존재하고 이동 가능한 항목의 인덱스만 생성한다', () => {
    const files = filesNamed('나무.cbz', '별.epub', '나비.pdf');
    files.forEach(Object.freeze);
    Object.freeze(files);

    assert.deepEqual(buildFolderCharacterIndex(files, 'ko'), [
        { key: 'ㄴ', label: 'ㄴ', path: files[0].path, count: 2 },
        { key: 'ㅂ', label: 'ㅂ', path: files[1].path, count: 1 },
    ]);
    assert.deepEqual(buildFolderCharacterIndex([files[1]], 'ko'), [
        { key: 'ㅂ', label: 'ㅂ', path: files[1].path, count: 1 },
    ]);
    assert.deepEqual(buildFolderCharacterIndex([], 'ko'), []);
    assert.deepEqual(buildFolderCharacterIndex(null, 'ko'), []);
    assert.deepEqual(buildFolderCharacterIndex([null, {}, { name: '가나다' }, { path: '/가나다' }], 'ko'), []);
});

test('목록 정렬이 달라도 문자 순서는 일정하고 각 문자의 첫 표시 항목으로 이동한다', () => {
    const files = filesNamed('Banana.cbz', 'Apple 2.cbz', 'Apple 1.cbz', 'Zebra.cbz');
    const forward = buildFolderCharacterIndex(files, 'en');
    const reverse = buildFolderCharacterIndex([...files].reverse(), 'en');

    assert.deepEqual(forward.map(entry => entry.label), ['A', 'B', 'Z']);
    assert.deepEqual(reverse.map(entry => entry.label), ['A', 'B', 'Z']);
    assert.equal(forward[0].path, files[1].path);
    assert.equal(reverse[0].path, files[2].path);
    assert.equal(forward[0].count, 2);
    assert.equal(reverse[0].count, 2);
});

test('혼합 언어 목록에서도 한글과 가나를 포함한 각 문자권은 연속해서 표시한다', () => {
    const names = [
        ...'가나다라마바사아자차카타파하', ...'あかさたなはまやらわ',
        '東京', '中国', '日本', 'Apple', 'Zebra', 'Αθήνα', 'Ωμέγα', 'Атлас', 'Яблоко',
        'العربية', 'ไทย',
    ];
    const groups = [
        [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'], [...'あかさたなはまやらわ'],
        ['東', '中', '日'], ['A', 'Z'], ['Α', 'Ω'], ['А', 'Я'], ['ا', 'ไ'],
    ];

    for (const locale of ['ko', 'ja', 'en', 'zh', 'ru']) {
        const labels = labelsFor(names, locale);
        for (const group of groups) {
            const positions = group.map(label => labels.indexOf(label));
            assert.ok(positions.every(position => position >= 0));
            assert.equal(Math.max(...positions) - Math.min(...positions), group.length - 1);
        }
        for (const group of groups.slice(0, 2)) {
            const start = labels.indexOf(group[0]);
            assert.deepEqual(labels.slice(start, start + group.length), group);
        }
    }
});

test('문자권 정렬은 입력 순서와 다른 문자 존재 여부에 관계없이 일관된다', () => {
    const names = ['다', '東京', '라', '中国', '자', '차', 'あ', 'わ', 'Apple', 'Αθήνα', 'Атлас', 'العربية'];

    for (const locale of ['ko', 'ja', 'en']) {
        const expected = labelsFor(names, locale);
        for (let offset = 0; offset < names.length; offset += 1) {
            const rotated = [...names.slice(offset), ...names.slice(0, offset)];
            assert.deepEqual(labelsFor(rotated, locale), expected);
            assert.deepEqual(labelsFor([...rotated].reverse(), locale), expected);
        }
        for (let left = 0; left < expected.length; left += 1) {
            for (let right = left + 1; right < expected.length; right += 1) {
                assert.deepEqual(labelsFor([expected[right], expected[left]], locale), [expected[left], expected[right]]);
            }
        }
    }
});

test('한글 완성형과 분해형, 호환 자모와 초성 자모를 기본 자음으로 묶는다', () => {
    const entries = buildFolderCharacterIndex(filesNamed(
        '가나다', '까치', '까치'.normalize('NFD'), 'ㄱ 모음', 'ㄲ 모음', 'ᄀ 모음', 'ᆨ 모음',
        '나무', '다람쥐', '따뜻한', '라디오', '마음', '바다', '빠른', '사과', '쌍둥이',
        '아침', '자전거', '짜장', '차례', '카드', '타조', '파도', '하늘',
    ), 'en');

    assert.deepEqual(entries.map(entry => entry.label), [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ']);
    assert.equal(entries[0].count, 7);
    for (const label of ['ㄷ', 'ㅂ', 'ㅅ', 'ㅈ']) {
        assert.equal(entries.find(entry => entry.label === label).count, 2);
    }
});

test('일본어 히라가나와 가타카나, 반각, 탁음과 반탁음을 같은 오십음 행으로 묶는다', () => {
    const entries = buildFolderCharacterIndex(filesNamed(
        'ヴァイオリン', 'うみ', 'ぁさ', 'ガラス', 'がっこう', 'ｶﾞｲﾄﾞ', 'ヶ丘',
        'ジテン', 'しろ', 'ヅキ', 'っぽい', 'にほん', 'ﾊﾟﾝ', 'ばら', 'はる',
        'むかし', 'ユメ', 'ょる', 'ロボット', 'ㇻ', 'ワニ', 'ヷ', 'んから',
    ), 'ja');

    assert.deepEqual(entries.map(entry => entry.label), [...'あかさたなはまやらわ']);
    assert.equal(entries.find(entry => entry.label === 'か').count, 4);
    assert.equal(entries.find(entry => entry.label === 'は').count, 3);
    assert.equal(entries.find(entry => entry.label === 'わ').count, 3);
});

test('라틴 강세는 locale이 같은 기본자로 취급할 때만 합친다', () => {
    const names = ['Apple', 'Åland', 'Ängel', 'Örebro', 'Orange', 'École', 'E\u0301tude'];

    assert.deepEqual(labelsFor(names, 'en'), ['A', 'E', 'O']);
    assert.deepEqual(labelsFor(names, 'sv'), ['A', 'E', 'O', 'Å', 'Ä', 'Ö']);
    assert.deepEqual(labelsFor(['noche', 'niño', 'Ñandú'], 'es'), ['N', 'Ñ']);
    assert.deepEqual(labelsFor(['Işık', 'ışık', 'İzmir', 'istanbul'], 'tr'), ['I', 'İ']);
});

test('키릴 문자와 그리스 문자는 대소문자를 합치고 자체 문자를 유지한다', () => {
    const entries = buildFolderCharacterIndex(filesNamed('Борис', 'борис', 'Αθήνα', 'αθήνα'), 'en');

    assert.deepEqual(new Set(entries.map(entry => entry.label)), new Set(['Б', 'Α']));
    assert.ok(entries.every(entry => entry.count === 2));
});

test('그리스어 강세와 분해형은 동일한 알파벳으로 묶는다', () => {
    const names = ['Άλφα', 'αλφα', 'Α\u0301λφα', 'Έψιλον', 'εψιλον', 'Ίριδα', 'ϊριδα', 'ΐριδα'];

    for (const locale of ['el', 'en', 'ko']) {
        const entries = buildFolderCharacterIndex(filesNamed(...names), locale);
        assert.deepEqual(entries.map(entry => entry.label), ['Α', 'Ε', 'Ι']);
        assert.deepEqual(entries.map(entry => entry.count), [3, 2, 3]);
    }
});

test('키릴 문자는 결합 강세를 합치되 Ё/Й/Ї/Ѓ 같은 독립 문자를 유지한다', () => {
    const names = ['Ель', 'Ёж', 'Е\u0308ж', 'Иван', 'Йога', 'И\u0306ога', 'А\u0301тлас', 'Атлас'];

    for (const locale of ['ru', 'en', 'sr']) {
        const entries = buildFolderCharacterIndex(filesNamed(...names), locale);
        assert.deepEqual(new Set(entries.map(entry => entry.label)), new Set(['А', 'Е', 'Ё', 'И', 'Й']));
        assert.equal(entries.find(entry => entry.label === 'А').count, 2);
        assert.equal(entries.find(entry => entry.label === 'Ё').count, 2);
        assert.equal(entries.find(entry => entry.label === 'Й').count, 2);
    }
    assert.deepEqual(new Set(labelsFor(['Іван', 'Їжак', 'І\u0308жак'], 'uk')), new Set(['І', 'Ї']));
    assert.deepEqual(new Set(labelsFor(['Град', 'Ѓорѓи', 'Г\u0301орѓи'], 'mk')), new Set(['Г', 'Ѓ']));
});

test('한자는 발음을 추측하지 않고 문자로 표시하며 다른 문자의 결합 글자는 유지한다', () => {
    assert.deepEqual(new Set(labelsFor(['東京', '日本', '中国', '中國'], 'zh')), new Set(['東', '日', '中']));
    assert.deepEqual(labelsFor(['किताब', 'किरण'], 'hi'), ['कि']);
    assert.deepEqual(labelsFor(['ก้าว', 'กาล'], 'th'), ['ก', 'ก้']);
    assert.deepEqual(labelsFor(['العربية'], 'ar'), ['ا']);
});

test('숫자와 기호는 존재할 때만 표시하며 전각과 선행 공백을 정규화한다', () => {
    const entries = buildFolderCharacterIndex(filesNamed('９권', '2권', '٣권', '#메모', '!주의', '  Ａlpha', 'Apple'), 'en');

    assert.deepEqual(entries.map(entry => entry.label), ['#', '0–9', 'A']);
    assert.deepEqual(entries.map(entry => entry.count), [2, 3, 2]);
    assert.deepEqual(labelsFor(['Apple'], 'en'), ['A']);
});

test('인덱스에는 폴더도 포함하고 잘못된 locale로 인해 목록이 실패하지 않는다', () => {
    const files = [{ name: '가나다', path: '/library/가나다', isDirectory: true }];

    assert.deepEqual(buildFolderCharacterIndex(files, 'not_a_locale'), [
        { key: 'ㄱ', label: 'ㄱ', path: files[0].path, count: 1 },
    ]);
});
