import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TEXT_CLEANER_OPTIONS } from './textCleanerPolicy.js';
import {
    MAX_TEXT_CLEANER_PRESETS,
    MAX_TEXT_CLEANER_PRESET_NAME_LENGTH,
    normalizeTextCleanerOptions,
    readTextCleanerSettings,
    removeTextCleanerPreset,
    TEXT_CLEANER_SETTINGS_KEY,
    upsertTextCleanerPreset,
    writeTextCleanerSettings,
} from './textCleanerSettings.js';

function storageFixture(initial = null) {
    const values = new Map();
    if (initial !== null) values.set(TEXT_CLEANER_SETTINGS_KEY, initial);
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
}

test('설정은 허용된 규칙과 자료형만 보관하고 들여쓰기 폭을 정규화한다', () => {
    const options = normalizeTextCleanerOptions({
        trimLeadingWhitespace: false,
        collapseRepeatedSpaces: 'false',
        joinBrokenLines: 0,
        removeBlankLines: true,
        indentParagraphs: true,
        paragraphIndentSize: 30,
        indentExcludeQuotes: null,
        lineJoinMode: 'word',
        backup: false,
        text: '본문',
        filePath: '/private/book.txt',
        unknown: true,
    });
    assert.deepEqual(options, {
        ...DEFAULT_TEXT_CLEANER_OPTIONS,
        trimLeadingWhitespace: false,
        removeBlankLines: true,
        indentParagraphs: true,
        paragraphIndentSize: 8,
        lineJoinMode: 'word',
    });
    assert.equal(normalizeTextCleanerOptions({ paragraphIndentSize: -3 }).paragraphIndentSize, 1);
    for (const paragraphIndentSize of [3.5, '4', Infinity, NaN, null, true]) {
        assert.equal(normalizeTextCleanerOptions({ paragraphIndentSize }).paragraphIndentSize,
            DEFAULT_TEXT_CLEANER_OPTIONS.paragraphIndentSize);
    }
    for (const lineJoinMode of ['always', false, null, 1]) {
        assert.equal(normalizeTextCleanerOptions({ lineJoinMode }).lineJoinMode,
            DEFAULT_TEXT_CLEANER_OPTIONS.lineJoinMode);
    }
    for (const value of [null, false, [], 'text']) {
        assert.deepEqual(normalizeTextCleanerOptions(value), DEFAULT_TEXT_CLEANER_OPTIONS);
    }
    assert.deepEqual(normalizeTextCleanerOptions(Object.create({ trimLeadingWhitespace: false })),
        DEFAULT_TEXT_CLEANER_OPTIONS);
});

test('마지막 설정과 이름 있는 프리셋을 함께 복원하고 본문과 백업 설정은 저장하지 않는다', () => {
    const storage = storageFixture();
    const presets = upsertTextCleanerPreset([], '  스캔 글  ', { lineJoinMode: 'word', backup: false });
    assert.equal(writeTextCleanerSettings({
        options: { indentParagraphs: true, paragraphIndentSize: 4, backup: false, text: '비공개 본문' },
        presets,
        filePath: '/private/book.txt',
    }, storage), true);
    const raw = storage.getItem(TEXT_CLEANER_SETTINGS_KEY);
    assert.doesNotMatch(raw, /backup|비공개|filePath|private/);
    assert.equal(JSON.parse(raw).version, 1);
    assert.deepEqual(readTextCleanerSettings(storage), {
        options: { ...DEFAULT_TEXT_CLEANER_OPTIONS, indentParagraphs: true, paragraphIndentSize: 4 },
        presets: [{ name: '스캔 글', options: { ...DEFAULT_TEXT_CLEANER_OPTIONS, lineJoinMode: 'word' } }],
    });
});

test('이전 설정에 없는 규칙은 기본값을 사용하며 손상된 프리셋과 중복 이름을 걸러낸다', () => {
    const storage = storageFixture(JSON.stringify({
        version: 1,
        options: { removeBlankLines: true },
        presets: [
            null, {}, { name: ' ', options: {} }, { name: '옵션 없음' },
            { name: '잘못된 옵션', options: [] },
            { name: '너'.repeat(MAX_TEXT_CLEANER_PRESET_NAME_LENGTH + 1), options: {} },
            { name: '  일반 글 ', options: { joinBrokenLines: false }, backup: false },
            { name: '일반 글', options: { joinBrokenLines: true } },
            { name: '스캔 글', options: { lineJoinMode: 'word', text: '비공개' } },
        ],
    }));
    assert.deepEqual(readTextCleanerSettings(storage), {
        options: { ...DEFAULT_TEXT_CLEANER_OPTIONS, removeBlankLines: true },
        presets: [
            { name: '일반 글', options: { ...DEFAULT_TEXT_CLEANER_OPTIONS, joinBrokenLines: false } },
            { name: '스캔 글', options: { ...DEFAULT_TEXT_CLEANER_OPTIONS, lineJoinMode: 'word' } },
        ],
    });
});

test('손상 JSON과 잘못된 문서는 기본값으로 열고 유효한 설정으로 다시 저장할 수 있다', () => {
    for (const raw of [null, '{broken', 'null', '[]', 'true', '{}']) {
        const storage = storageFixture(raw);
        assert.deepEqual(readTextCleanerSettings(storage), { options: DEFAULT_TEXT_CLEANER_OPTIONS, presets: [] });
        assert.equal(writeTextCleanerSettings({ options: { removeBlankLines: true }, presets: [] }, storage), true);
        assert.equal(readTextCleanerSettings(storage).options.removeBlankLines, true);
    }
});

test('알 수 없는 저장 버전은 기본값으로 열지만 저장된 원문을 덮어쓰지 않는다', () => {
    for (const version of [0, 2, '1', null]) {
        const raw = JSON.stringify({ version, options: { removeBlankLines: true }, presets: [] });
        const storage = storageFixture(raw);
        assert.deepEqual(readTextCleanerSettings(storage), { options: DEFAULT_TEXT_CLEANER_OPTIONS, presets: [] });
        assert.equal(writeTextCleanerSettings({ options: {}, presets: [] }, storage), false);
        assert.equal(storage.getItem(TEXT_CLEANER_SETTINGS_KEY), raw);
    }
});

test('저장소 읽기와 쓰기 실패는 예외를 전파하지 않는다', () => {
    const unavailable = {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
    };
    assert.deepEqual(readTextCleanerSettings(unavailable), { options: DEFAULT_TEXT_CLEANER_OPTIONS, presets: [] });
    assert.equal(writeTextCleanerSettings({ options: {}, presets: [] }, unavailable), false);
    const storage = storageFixture(JSON.stringify({ version: 1, options: { removeBlankLines: true }, presets: [] }));
    const previous = storage.getItem(TEXT_CLEANER_SETTINGS_KEY);
    storage.setItem = () => { throw new Error('quota'); };
    assert.equal(writeTextCleanerSettings({ options: {}, presets: [] }, storage), false);
    assert.equal(storage.getItem(TEXT_CLEANER_SETTINGS_KEY), previous);
    assert.deepEqual(readTextCleanerSettings(null), { options: DEFAULT_TEXT_CLEANER_OPTIONS, presets: [] });
    assert.equal(writeTextCleanerSettings({}, null), false);
});

test('기본 저장소 접근 자체가 차단되어도 정리기를 열고 사용할 수 있다', t => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() { throw new Error('blocked storage'); },
    });
    t.after(() => {
        if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
        else delete globalThis.localStorage;
    });
    assert.deepEqual(readTextCleanerSettings(), { options: DEFAULT_TEXT_CLEANER_OPTIONS, presets: [] });
    assert.equal(writeTextCleanerSettings({ options: {}, presets: [] }), false);
});

test('설정과 프리셋 복사본은 이후 편집이나 덮어쓰기 및 삭제에 영향을 받지 않는다', () => {
    const options = { ...DEFAULT_TEXT_CLEANER_OPTIONS, removeBlankLines: true };
    const first = upsertTextCleanerPreset([], '일반 글', options);
    options.removeBlankLines = false;
    const second = upsertTextCleanerPreset(first, '스캔 글', { lineJoinMode: 'word' });
    const updated = upsertTextCleanerPreset(second, '  일반 글  ', { indentParagraphs: true });
    assert.deepEqual(updated.map(preset => preset.name), ['일반 글', '스캔 글']);
    assert.equal(first[0].options.removeBlankLines, true);
    assert.equal(second[0].options.indentParagraphs, false);
    assert.equal(updated[0].options.indentParagraphs, true);
    const deleted = removeTextCleanerPreset(updated, '일반 글');
    assert.equal(updated.length, 2);
    assert.deepEqual(deleted.map(preset => preset.name), ['스캔 글']);
    deleted[0].options.lineJoinMode = 'space';
    assert.equal(updated[1].options.lineJoinMode, 'word');
    const unchanged = removeTextCleanerPreset(updated, '없는 이름');
    assert.deepEqual(unchanged, updated);
    assert.notEqual(unchanged, updated);
    const storage = storageFixture();
    writeTextCleanerSettings({ options, presets: updated }, storage);
    const loaded = readTextCleanerSettings(storage);
    loaded.options.removeBlankLines = true;
    loaded.presets[0].options.indentParagraphs = false;
    assert.equal(readTextCleanerSettings(storage).options.removeBlankLines, false);
    assert.equal(readTextCleanerSettings(storage).presets[0].options.indentParagraphs, true);
    assert.notEqual(normalizeTextCleanerOptions(null), DEFAULT_TEXT_CLEANER_OPTIONS);
});

test('프리셋은 최대 20개이며 꽉 찬 목록에서도 기존 이름을 덮어쓸 수 있다', () => {
    let presets = [];
    for (let index = 0; index < MAX_TEXT_CLEANER_PRESETS; index += 1) {
        presets = upsertTextCleanerPreset(presets, `설정 ${index}`, {});
    }
    assert.throws(() => upsertTextCleanerPreset(presets, '새 설정', {}), { code: 'PRESET_LIMIT_EXCEEDED' });
    const updated = upsertTextCleanerPreset(presets, '설정 0', { removeBlankLines: true });
    assert.equal(updated.length, MAX_TEXT_CLEANER_PRESETS);
    assert.equal(updated[0].options.removeBlankLines, true);
    assert.equal(presets[0].options.removeBlankLines, false);
    const storage = storageFixture(JSON.stringify({
        version: 1,
        options: {},
        presets: [...presets, { name: '초과', options: {} }],
    }));
    assert.equal(readTextCleanerSettings(storage).presets.length, MAX_TEXT_CLEANER_PRESETS);
});

test('프리셋 이름의 빈 값과 길이 제한은 구별 가능한 오류 코드로 반환한다', () => {
    for (const name of ['', '  ', null, 123, '줄\n바꿈', '숨김\0문자']) {
        assert.throws(() => upsertTextCleanerPreset([], name, {}), { code: 'INVALID_PRESET_NAME' });
    }
    const maximum = '가'.repeat(MAX_TEXT_CLEANER_PRESET_NAME_LENGTH);
    assert.equal(upsertTextCleanerPreset([], ` ${maximum} `, {})[0].name, maximum);
    assert.throws(() => upsertTextCleanerPreset([], `${maximum}가`, {}), { code: 'PRESET_NAME_TOO_LONG' });
});
