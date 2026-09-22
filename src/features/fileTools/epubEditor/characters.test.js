import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { IME_SYMBOL_GROUPS } from './imeSymbols.js';
import { SPECIAL_CHARACTERS, EMOJI_CHARACTERS, ALL_EMOJI_CHARACTERS, SKIN_TONES, characterDisplay, characterValue, filterCharacters } from './characters.js';

test('the IME catalog covers all 18 consonant groups without duplicating existing symbols', () => {
    assert.equal(IME_SYMBOL_GROUPS.length, 18);
    const imeValues = IME_SYMBOL_GROUPS.flatMap(group => group.characters.map(([value]) => value));
    assert.equal(new Set(imeValues).size, 987);
    const values = SPECIAL_CHARACTERS.map(entry => entry.value);
    assert.equal(new Set(values).size, values.length);
    for (const value of imeValues) assert.ok(values.includes(value), value);
    assert.equal(SPECIAL_CHARACTERS.find(entry => entry.value === '★').name, '별 black star');
    assert.equal(filterCharacters(SPECIAL_CHARACTERS, 'infinity', 'math')[0].value, '∞');
    assert.equal(filterCharacters(EMOJI_CHARACTERS, '고양이')[0].value, '🐱');
});

test('consonant searches and categories retain the familiar IME order, including existing characters', () => {
    for (const key of ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ', 'ㄲ', 'ㄸ', 'ㅃ', 'ㅆ']) {
        const expected = IME_SYMBOL_GROUPS.find(group => group.key === key).characters.map(([value]) => value);
        for (const query of [key, `${key}+한자`, ` ${key} + Hanja `]) {
            assert.deepEqual(filterCharacters(SPECIAL_CHARACTERS, query).map(entry => entry.value), expected);
        }
        assert.deepEqual(filterCharacters(SPECIAL_CHARACTERS, '', `ime:${key}`).map(entry => entry.value), expected);
    }
    assert.deepEqual(filterCharacters(SPECIAL_CHARACTERS, 'ㅉ').map(entry => entry.value), ['ㅉ']);
});

test('group searches combine with literal characters, names and Unicode code points', () => {
    for (const [query, category, expected] of [
        ['제곱미터', 'all', '㎥㎡'], ['U+2460', 'all', '①'], ['㈜', 'ime:ㅁ', '㈜'],
        ['제곱미터', 'ime:ㄹ', '㎥㎡'], ['ㄱ', 'ime:ㅋ', 'ㄱ'], ['あ', 'ime:ㄸ', 'あ'],
        ['ア', 'ime:ㅃ', 'ア'], ['Я', 'ime:ㅆ', 'Яя'],
    ]) assert.equal(filterCharacters(SPECIAL_CHARACTERS, query, category).map(entry => entry.value).join(''), expected);
    assert.deepEqual(filterCharacters(SPECIAL_CHARACTERS, '㎡', 'ime:ㅁ'), []);
    assert.deepEqual(filterCharacters(SPECIAL_CHARACTERS, '', 'ime:ㅉ'), []);
});

test('characters shared between topics and consonants remain available in both groups', () => {
    assert.deepEqual(SPECIAL_CHARACTERS.find(entry => entry.value === 'Ｆ').imeKeys, ['ㄹ', 'ㅍ']);
    for (const category of ['units', 'fullwidthLatin', 'ime:ㄹ', 'ime:ㅍ']) {
        const matches = filterCharacters(SPECIAL_CHARACTERS, 'Ｆ', category).map(entry => entry.value);
        assert.ok(matches.includes('Ｆ'));
        assert.equal(matches.filter(value => value === 'Ｆ').length, 1);
    }
    assert.ok(filterCharacters(SPECIAL_CHARACTERS, '', 'greek').some(entry => entry.value === 'Ω'));
    assert.ok(filterCharacters(SPECIAL_CHARACTERS, '', 'arrows').some(entry => entry.value === '→'));
});

test('invisible character previews are distinct from the Unicode text inserted into the book', () => {
    for (const [value, display] of [['\u3000', '␣'], ['\u00ad', 'SHY']]) {
        const entry = SPECIAL_CHARACTERS.find(item => item.value === value);
        assert.equal(characterDisplay(entry), display);
        assert.equal(characterValue(entry), value);
        assert.ok(entry.name.length > 10);
    }
    const thumb = EMOJI_CHARACTERS.find(entry => entry.value === '👍');
    assert.equal(characterDisplay(thumb, '🏽'), '👍🏽');
});

test('the offline emoji catalog preserves the complete Unicode 17 fully-qualified set', () => {
    assert.equal(EMOJI_CHARACTERS.length, 1914);
    assert.equal(ALL_EMOJI_CHARACTERS.length, 3944);
    const values = ALL_EMOJI_CHARACTERS.map(entry => entry.value);
    assert.equal(new Set(values).size, values.length);
    // Digest of the fully-qualified sequences in the pinned upstream emoji-test.txt.
    assert.equal(createHash('sha256').update(values.sort().join('\n')).digest('hex'), '625c75f8a5068f9a7d7144770bec0a83d8526cd0cb6e9ffec1a56c3f0921a923');
    assert.equal(new Set(EMOJI_CHARACTERS.map(entry => entry.category)).size, 10);
    assert.ok(ALL_EMOJI_CHARACTERS.every(entry => entry.value.length <= 32 && /[가-힣]/u.test(`${entry.name} ${entry.keywords}`)));
    assert.equal(filterCharacters(EMOJI_CHARACTERS, '', 'flags').length, 270);
});

test('expanded emoji search supports Korean names, aliases, English and new categories', () => {
    for (const [query, category, value] of [
        ['태극기', 'flags', '🇰🇷'], ['한국', 'flags', '🇰🇷'], ['South Korea', 'all', '🇰🇷'],
        ['개발자', 'people', '👩‍💻'], ['해파리', 'nature', '🪼'], ['taco', 'food', '🌮'],
        ['테니스', 'activities', '🎾'], ['distorted face', 'faces', '🫪'],
        ['U+1F9ED', 'travel', '🧭'], ['🧑🏽‍💻', 'people', '🧑‍💻'],
    ]) assert.ok(filterCharacters(EMOJI_CHARACTERS, query, category).some(entry => entry.value === value), query);
    assert.ok(filterCharacters(ALL_EMOJI_CHARACTERS, '🫱🏻‍🫲🏿').some(entry => entry.value === '🫱🏻‍🫲🏿'));
    assert.deepEqual(filterCharacters(EMOJI_CHARACTERS, 'ㅁ'), []);
});

test('skin tones use official sequences for professions, gestures and multi-person emoji', () => {
    for (const [value, expected] of [
        ['👍', '👍🏽'], ['✌️', '✌🏽'], ['🧑‍💻', '🧑🏽‍💻'], ['👩‍⚕️', '👩🏽‍⚕️'],
        ['👩‍🦽‍➡️', '👩🏽‍🦽‍➡️'], ['👩‍❤️‍👩', '👩🏽‍❤️‍👩🏽'], ['🇰🇷', '🇰🇷'],
    ]) assert.equal(characterValue(EMOJI_CHARACTERS.find(entry => entry.value === value), '🏽'), expected);
    const official = new Set(ALL_EMOJI_CHARACTERS.map(entry => entry.value));
    for (const entry of EMOJI_CHARACTERS) {
        for (const tone of SKIN_TONES) assert.ok(official.has(characterValue(entry, tone)), `${entry.name}: ${tone}`);
        assert.equal(characterValue(entry, 'invalid'), entry.value);
    }
    const mixed = ALL_EMOJI_CHARACTERS.find(entry => entry.value === '🫱🏻‍🫲🏿');
    assert.equal(characterValue({ ...mixed, tones: false }, '🏽'), mixed.value);
});
