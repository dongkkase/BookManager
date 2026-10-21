import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { normalizeRenamerOptionsFromConfig, renamerOptionsEqual, serializeRenamerOptions } from './renamerPolicy.js';
import { createDefaultColumnLayout, normalizeColumnLayout, serializeColumnLayout } from './folderColumnLayout.js';
import { normalizeViewScales } from './folderViewState.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const folderSource = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const renamerSource = readFileSync(new URL('./tabs/RenamerTab.jsx', import.meta.url), 'utf8');
const hookSource = transformSync(readFileSync(new URL('./hooks/useConfigSaveNotice.js', import.meta.url), 'utf8'), {
    format: 'cjs', target: 'es2022',
}).code;
const sameDependencies = (previous, next) => previous?.length === next.length
    && previous.every((value, index) => Object.is(value, next[index]));

function noticeFixture() {
    const slots = [];
    let cursor = 0;
    const react = {
        useRef(initial) {
            const index = cursor++;
            return slots[index] ??= { current: initial };
        },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!slots[index] || !sameDependencies(slots[index].dependencies, dependencies)) {
                slots[index] = { callback, dependencies };
            }
            return slots[index].callback;
        },
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', hookSource)(module, module.exports, name => {
        assert.equal(name, 'react');
        return react;
    });
    return {
        render(saveConfig, showToast) {
            cursor = 0;
            return module.exports.useConfigSaveNotice(saveConfig, showToast);
        },
    };
}

function effectFixture(source, context) {
    let previous;
    let cleanup;
    context.useEffect = (effect, dependencies) => {
        if (sameDependencies(previous, dependencies)) return;
        cleanup?.();
        previous = dependencies;
        cleanup = effect();
    };
    return () => new Function(...Object.keys(context), source)(...Object.values(context));
}

function sourceBetween(source, startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

function folderCallback(name, nextName, context) {
    const source = sourceBetween(folderSource, `const ${name} = useCallback`, `const ${nextName} = useCallback`);
    return new Function(...Object.keys(context), `${source}\nreturn ${name};`)(...Object.values(context));
}

test('설정 자동 저장은 비동기 실패를 알리고 재시도하지 않으며 최신 콜백을 사용한다', async () => {
    const fixture = noticeFixture();
    const notices = [];
    const updates = { folder_view_mode: 'thumbnail' };
    let attempts = 0;
    let reject;
    const save = fixture.render(() => {
        attempts += 1;
        return new Promise((resolve, rejectSave) => { reject = rejectSave; });
    }, () => assert.fail('A replaced toast callback must not be used'));
    const pending = save(updates);
    const nextSave = fixture.render(() => { attempts += 1; }, notice => notices.push(notice));
    assert.equal(save, nextSave);
    reject(new Error('disk full'));
    assert.equal(await pending, false);
    await tick();
    assert.equal(attempts, 1);
    assert.deepEqual(notices, [{ key: 'config_save_failed', values: { msg: 'disk full' } }]);
    assert.equal(await nextSave(updates), true);
    assert.equal(attempts, 2);
});

test('동기 저장 콜백과 선택적 콜백을 지원하고 동기 예외도 실패로 알린다', async () => {
    const fixture = noticeFixture();
    const notices = [];
    assert.equal(await fixture.render(undefined, undefined)({}), true);
    const updates = { rename_pattern_idx: 2 };
    assert.equal(await fixture.render(patch => assert.equal(patch, updates), undefined)(updates), true);
    assert.equal(await fixture.render(() => { throw new Error('read only'); }, notice => notices.push(notice))(updates), false);
    assert.deepEqual(notices, [{ key: 'config_save_failed', values: { msg: 'read only' } }]);
});

test('이름 변경 옵션 저장 실패는 선택값을 유지하고 알림 재렌더에서 다시 저장하지 않는다', async () => {
    const fixture = noticeFixture();
    const notices = [];
    const attempts = [];
    const saveConfig = async updates => { attempts.push(updates); throw new Error('disk full'); };
    const context = {
        config: { rename_pattern_idx: 0 },
        currentRenamerOptions: { patternIndex: 3, customText: 'Book', keepName: false, startNum: 7 },
        applyingConfigRef: { current: false },
        normalizeRenamerOptionsFromConfig, renamerOptionsEqual, serializeRenamerOptions,
        saveConfigWithNotice: fixture.render(saveConfig, notice => notices.push(notice)),
    };
    const options = context.currentRenamerOptions;
    const effect = sourceBetween(renamerSource,
        'useEffect(() => {\n    if (!config) return;\n    if (applyingConfigRef.current)',
        '\n\n  useEffect');
    const render = effectFixture(effect, context);
    render();
    await tick();
    assert.deepEqual(attempts, [serializeRenamerOptions(options)]);
    assert.equal(notices.length, 1);
    context.saveConfigWithNotice = fixture.render(saveConfig, notice => notices.push(notice));
    render();
    await tick();
    assert.equal(attempts.length, 1);
    assert.equal(context.currentRenamerOptions, options);
    context.currentRenamerOptions = { ...options, startNum: 8 };
    render();
    await tick();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].start_num, 8);
});

test('폴더 보기 설정의 지연 저장 실패는 알림 한 번으로 끝나고 선택값과 다음 저장을 유지한다', async () => {
    const fixture = noticeFixture();
    const notices = [];
    const attempts = [];
    const timers = new Map();
    let timerId = 0;
    const saveConfig = async updates => { attempts.push(updates); throw new Error('disk full'); };
    const context = {
        restoredViewSettingsRef: { current: true },
        viewMode: 'thumbnail', itemScales: normalizeViewScales({}), sortKey: 'name', sortOrder: 'desc', groupKey: 'none',
        normalizeViewScales,
        saveConfigWithNotice: fixture.render(saveConfig, notice => notices.push(notice)),
        window: {
            setTimeout(callback, delay) { assert.equal(delay, 250); timers.set(++timerId, callback); return timerId; },
            clearTimeout(id) { timers.delete(id); },
        },
    };
    const effect = sourceBetween(folderSource,
        'useEffect(() => {\n    if (!restoredViewSettingsRef.current)',
        '\n\n  useEffect');
    const render = effectFixture(effect, context);
    const runTimers = () => {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(callback => callback());
    };
    render();
    assert.equal(attempts.length, 0);
    runTimers();
    await tick();
    assert.equal(notices.length, 1);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].folder_view_mode, 'thumbnail');
    context.saveConfigWithNotice = fixture.render(saveConfig, notice => notices.push(notice));
    render();
    runTimers();
    await tick();
    assert.equal(attempts.length, 1);
    assert.equal(context.viewMode, 'thumbnail');
    context.sortOrder = 'asc';
    render();
    runTimers();
    await tick();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].folder_sort_order, 'asc');
});

test('저장한 폴더 레이아웃을 적용한 후 저장이 실패해도 화면 선택은 유지되고 오류를 알린다', async () => {
    const fixture = noticeFixture();
    const notices = [];
    const attempts = [];
    const state = {};
    const layout = { sortKey: 'size', sortOrder: 'desc', groupKey: 'none', columns: createDefaultColumnLayout() };
    const handler = folderCallback('handleApplyLayout', 'handleApplyColumnLayout', {
        useCallback: callback => callback,
        config: { folder_saved_layouts: { saved: layout } },
        setSortKey: value => { state.sortKey = value; },
        setSortOrder: value => { state.sortOrder = value; },
        setGroupKey: value => { state.groupKey = value; },
        setColumnLayout: value => { state.columns = value; },
        normalizeColumnLayout, serializeColumnLayout,
        saveConfigWithNotice: fixture.render(async updates => { attempts.push(updates); throw new Error('disk full'); }, notice => notices.push(notice)),
    });
    handler('saved');
    await tick();
    assert.deepEqual(state, layout);
    assert.deepEqual(attempts, [{ folder_column_layout: serializeColumnLayout(layout.columns) }]);
    assert.deepEqual(notices, [{ key: 'config_save_failed', values: { msg: 'disk full' } }]);
});

test('폴더 레이아웃 저장 메뉴에서도 저장 실패를 처리한다', async () => {
    const fixture = noticeFixture();
    const notices = [];
    const handler = folderCallback('handleSaveLayout', 'handleAddLayout', {
        useCallback: callback => callback,
        config: {}, t: key => key, requestTextInput: async () => 'New layout',
        columnLayout: createDefaultColumnLayout(), sortKey: 'name', sortOrder: 'asc', groupKey: 'none',
        serializeColumnLayout,
        saveConfigWithNotice: fixture.render(async () => { throw new Error('disk full'); }, notice => notices.push(notice)),
    });
    await handler();
    assert.deepEqual(notices, [{ key: 'config_save_failed', values: { msg: 'disk full' } }]);
});
