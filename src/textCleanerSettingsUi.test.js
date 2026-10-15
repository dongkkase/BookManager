import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createTextCleanerInput } from './textCleanerInput.js';
import { DEFAULT_TEXT_CLEANER_OPTIONS } from './textCleanerPolicy.js';
import {
    normalizeTextCleanerOptions,
    readTextCleanerSettings,
    removeTextCleanerPreset,
    TEXT_CLEANER_SETTINGS_KEY,
    upsertTextCleanerPreset,
    writeTextCleanerSettings,
} from './textCleanerSettings.js';

const toolSource = fs.readFileSync(new URL('./tabs/TextCleanerTool.jsx', import.meta.url), 'utf8');
const componentSource = toolSource.slice(
    toolSource.indexOf('export default function TextCleanerTool'),
    toolSource.indexOf('\n    if (!fileInfo) {\n        return ('),
).replace('export default ', '').replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const stateNames = [...componentSource.matchAll(/const \[(\w+), \w+\] = useState\(/g)].map(match => match[1]);

function createFixture({ options = {}, presets = [], confirm = true, storageFailure = false } = {}) {
    let raw = JSON.stringify({ version: 1, options, presets });
    let failWrites = storageFailure;
    let writes = 0;
    let confirmations = 0;
    let analysisEffects = 0;
    const updates = [];
    const storage = {
        getItem: key => key === TEXT_CLEANER_SETTINGS_KEY ? raw : null,
        setItem(key, value) {
            assert.equal(key, TEXT_CLEANER_SETTINGS_KEY);
            writes += 1;
            if (failWrites) throw new Error('storage unavailable');
            raw = value;
        },
    };
    const initialOverrides = {
        fileInfo: { filePath: '/test.txt', snapshot: {} },
        manualEdited: true,
        dirty: true,
        backup: false,
    };
    const states = [];
    const refs = [];
    const memoized = [];
    const effects = [];
    let stateIndex = 0;
    let refIndex = 0;
    let memoIndex = 0;
    let effectIndex = 0;
    const sameDependencies = (previous, next) => previous && next
        && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
    function useMemo(callback, dependencies) {
        const index = memoIndex++;
        if (!memoized[index] || !sameDependencies(memoized[index].dependencies, dependencies)) {
            memoized[index] = { value: callback(), dependencies };
        }
        return memoized[index].value;
    }
    const Tool = vm.runInNewContext(`${componentSource}
        return { handleApplyOptions, handleSavePreset, handleDeletePreset, settings, options, presets,
            backup, manualEdited, dirty, settingsSaveFailed, resultTextRef, resultAreaRef };
    }
    TextCleanerTool;`, {
        createTextCleanerInput,
        normalizeTextCleanerOptions,
        readTextCleanerSettings: () => readTextCleanerSettings(storage),
        removeTextCleanerPreset,
        upsertTextCleanerPreset,
        writeTextCleanerSettings: value => writeTextCleanerSettings(value, storage),
        URL,
        DEFAULT_TEXT_CLEANER_OPTIONS,
        DEFAULT_TEXT_SEARCH_OPTIONS: {},
        EMPTY_SEARCH_RESULT: { query: '', matches: [], index: -1, pending: false },
        useState(initial) {
            const index = stateIndex++;
            if (!states[index]) {
                const name = stateNames[index];
                const value = Object.hasOwn(initialOverrides, name) ? initialOverrides[name]
                    : typeof initial === 'function' ? initial() : initial;
                const state = { name, value };
                state.set = update => {
                    const next = typeof update === 'function' ? update(state.value) : update;
                    updates.push({ name, previous: state.value, next });
                    state.value = next;
                };
                states[index] = state;
            }
            return [states[index].value, states[index].set];
        },
        useRef(current) {
            const index = refIndex++;
            if (!refs[index]) refs[index] = { current };
            return refs[index];
        },
        useMemo,
        useCallback: (callback, dependencies) => useMemo(() => callback, dependencies),
        useEffect(callback, dependencies) {
            const index = effectIndex++;
            if (!effects[index] || !sameDependencies(effects[index].dependencies, dependencies)) {
                if (index === 1) analysisEffects += 1;
                effects[index] = { callback, dependencies };
            }
        },
        window: { confirm() { confirmations += 1; return confirm; } },
    });
    const props = { t: key => key };
    const fixture = {
        updates,
        render() {
            stateIndex = refIndex = memoIndex = effectIndex = 0;
            fixture.api = Tool(props);
        },
        get writes() { return writes; },
        get confirmations() { return confirmations; },
        get analysisEffects() { return analysisEffects; },
        get stored() { return readTextCleanerSettings(storage); },
        setStorageFailure(value) { failWrites = value; },
    };
    fixture.render();
    assert.match(effects[1].callback.toString(), /new Worker\(/);
    fixture.api.resultTextRef.current = '사용자가 직접 수정한 본문';
    fixture.api.resultAreaRef.current = { value: '사용자가 직접 수정한 본문' };
    return fixture;
}

function assertEditingPreserved(fixture, options) {
    assert.equal(fixture.api.options, options);
    assert.equal(fixture.api.resultTextRef.current, '사용자가 직접 수정한 본문');
    assert.equal(fixture.api.resultAreaRef.current.value, '사용자가 직접 수정한 본문');
    assert.equal(fixture.api.manualEdited, true);
    assert.equal(fixture.api.dirty, true);
    assert.equal(fixture.api.backup, false);
}

test('여러 프리셋 옵션 적용은 직접 편집 확인과 설정 저장 및 재분석 예약을 한 번씩 수행한다', () => {
    const fixture = createFixture();
    const initialEffects = fixture.analysisEffects;
    const requested = {
        ...DEFAULT_TEXT_CLEANER_OPTIONS,
        lineJoinMode: 'word',
        indentParagraphs: true,
        paragraphIndentSize: 4,
        indentExcludeQuotes: true,
    };
    assert.equal(fixture.api.handleApplyOptions(requested), true);
    fixture.render();
    assert.equal(fixture.confirmations, 1);
    assert.equal(fixture.writes, 1);
    assert.equal(fixture.updates.filter(update => update.name === 'settings').length, 1);
    assert.equal(fixture.analysisEffects, initialEffects + 1);
    assert.deepEqual(fixture.api.options, requested);
    assert.deepEqual(fixture.stored.options, requested);
    assert.equal(fixture.api.backup, false);
});

test('재분석 확인을 취소하면 옵션과 편집 내용 및 저장소를 그대로 유지한다', () => {
    const fixture = createFixture({ confirm: false });
    const initialOptions = fixture.api.options;
    const initialSettings = fixture.api.settings;
    const initialEffects = fixture.analysisEffects;
    assert.equal(fixture.api.handleApplyOptions({ ...initialOptions, lineJoinMode: 'word' }), false);
    fixture.render();
    assert.equal(fixture.confirmations, 1);
    assert.equal(fixture.writes, 0);
    assert.equal(fixture.updates.length, 0);
    assert.equal(fixture.api.settings, initialSettings);
    assert.equal(fixture.analysisEffects, initialEffects);
    assertEditingPreserved(fixture, initialOptions);
});

test('현재와 같은 옵션 적용은 확인이나 저장 및 재분석을 하지 않는다', () => {
    const fixture = createFixture();
    const initialOptions = fixture.api.options;
    const initialEffects = fixture.analysisEffects;
    assert.equal(fixture.api.handleApplyOptions({ ...initialOptions, backup: true, unknown: 'ignored' }), true);
    fixture.render();
    assert.equal(fixture.confirmations, 0);
    assert.equal(fixture.writes, 0);
    assert.equal(fixture.updates.length, 0);
    assert.equal(fixture.analysisEffects, initialEffects);
    assertEditingPreserved(fixture, initialOptions);
});

test('프리셋 저장과 삭제는 적용 중 옵션의 참조 및 직접 편집과 백업 설정을 유지한다', () => {
    const fixture = createFixture({ options: { indentParagraphs: true, paragraphIndentSize: 4 } });
    const initialOptions = fixture.api.options;
    const initialEffects = fixture.analysisEffects;
    assert.equal(fixture.api.handleSavePreset(' 일반 글 '), true);
    fixture.render();
    assert.equal(fixture.api.presets[0].name, '일반 글');
    assert.deepEqual(fixture.api.presets[0].options, initialOptions);
    assertEditingPreserved(fixture, initialOptions);
    assert.equal(fixture.analysisEffects, initialEffects);
    assert.equal(fixture.api.handleDeletePreset('일반 글'), true);
    fixture.render();
    assert.equal(fixture.api.presets.length, 0);
    assert.equal(fixture.confirmations, 0);
    assert.equal(fixture.writes, 2);
    assert.equal(fixture.analysisEffects, initialEffects);
    assertEditingPreserved(fixture, initialOptions);
});

test('설정 저장 실패 시 이번 실행의 옵션은 적용하고 실패 안내 상태를 표시한다', () => {
    const fixture = createFixture({ storageFailure: true });
    const requested = { ...DEFAULT_TEXT_CLEANER_OPTIONS, lineJoinMode: 'word' };
    const initialEffects = fixture.analysisEffects;
    assert.equal(fixture.api.handleApplyOptions(requested), true);
    fixture.render();
    assert.deepEqual(fixture.api.options, requested);
    assert.equal(fixture.api.settingsSaveFailed, true);
    assert.equal(fixture.stored.options.lineJoinMode, 'space');
    assert.equal(fixture.analysisEffects, initialEffects + 1);
    fixture.setStorageFailure(false);
    assert.equal(fixture.api.handleSavePreset('복구된 설정'), true);
    fixture.render();
    assert.equal(fixture.api.settingsSaveFailed, false);
    assert.deepEqual(fixture.stored.options, requested);
});

test('프리셋 저장과 삭제 실패도 현재 목록을 갱신하되 본문 재분석을 유발하지 않는다', () => {
    const fixture = createFixture({ storageFailure: true });
    const initialOptions = fixture.api.options;
    const initialEffects = fixture.analysisEffects;
    assert.equal(fixture.api.handleSavePreset('이번 실행'), false);
    fixture.render();
    assert.equal(fixture.api.presets[0].name, '이번 실행');
    assert.equal(fixture.api.settingsSaveFailed, true);
    assert.equal(fixture.stored.presets.length, 0);
    assertEditingPreserved(fixture, initialOptions);
    assert.equal(fixture.api.handleDeletePreset('이번 실행'), false);
    fixture.render();
    assert.equal(fixture.api.presets.length, 0);
    assert.equal(fixture.api.settingsSaveFailed, true);
    assert.equal(fixture.confirmations, 0);
    assert.equal(fixture.analysisEffects, initialEffects);
    assertEditingPreserved(fixture, initialOptions);
});
