import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const handleSettingsClose =');
const end = source.indexOf('const handleSettingsLanguagePreview =', start);
assert.ok(start >= 0 && end > start);
const handlerSource = `${source.slice(start, end)}\nreturn { close: handleSettingsClose, save: handleSettingsSave };`;

function createFixture(options = {}) {
    const calls = {
        visible: [], languages: [], saves: [], reloads: 0, effects: [], toasts: [],
        activeTabs: [], events: [], indexes: [], messages: [], relaunches: 0, errors: [],
    };
    const config = { language: options.language || 'ko', telemetry_error_reports: true, telemetry_usage_stats: true };
    let persistedConfig = { ...config };
    const scope = {
        useCallback: callback => callback,
        config,
        setShowSettings: visible => calls.visible.push(visible),
        changeLanguage: async language => {
            calls.languages.push(language);
            await options.changeLanguage?.(language);
        },
        setConfig: async updates => {
            calls.saves.push(updates);
            if (!options.save) throw Object.assign(new Error('CONFIG_SAVE_FAILED: Could not save settings.'), { code: 'CONFIG_SAVE_FAILED' });
            const saved = await options.save(updates, calls.saves.length);
            persistedConfig = { ...persistedConfig, ...saved };
            return persistedConfig;
        },
        reloadConfig: async () => {
            calls.reloads += 1;
            await options.reload?.();
        },
        settingsEffects: (previous, next) => {
            calls.effects.push({ previous, next });
            return options.effects || {};
        },
        setActiveTab: tab => calls.activeTabs.push(tab),
        showToast: (message, duration) => calls.toasts.push({ message, duration }),
        t: key => key,
        window: {
            dispatchEvent: event => calls.events.push(event),
            electronAPI: {
                updateFolderIndex: async (folders, settings) => {
                    calls.indexes.push({ folders, settings });
                    await options.index?.();
                },
                showMessage: async message => {
                    calls.messages.push(message);
                    return options.message?.() || 'no';
                },
                relaunchApp: async () => { calls.relaunches += 1; },
            },
        },
        CustomEvent: class {
            constructor(type, options) {
                this.type = type;
                this.detail = options.detail;
            }
        },
        console: { error: (...args) => calls.errors.push(args) },
    };
    return {
        calls,
        ...new Function(...Object.keys(scope), handlerSource)(...Object.values(scope)),
    };
}

test('설정 적용 실패 시 창을 유지하고 언어와 최신 설정을 복원한 뒤 재시도하도록 오류를 전달한다', async () => {
    let finishReload;
    const pendingReload = new Promise(resolve => { finishReload = resolve; });
    const { calls, save } = createFixture({ language: 'ko', reload: () => pendingReload });
    const updates = { language: 'en', telemetry_error_reports: false, telemetry_usage_stats: false };
    const saving = save(updates);
    const rejection = assert.rejects(saving, error => error.code === 'CONFIG_SAVE_FAILED' && error.settingsSaveNotified === true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.languages, ['ko']);
    assert.equal(calls.reloads, 1);
    assert.deepEqual(calls.visible, []);
    assert.equal(calls.effects.length, 0);
    finishReload();
    await rejection;
    assert.deepEqual(calls.visible, []);
    assert.deepEqual(calls.saves, [updates]);
    assert.match(calls.toasts[0].message, /저장하지 못했습니다/);
    assert.match(calls.toasts[0].message, /다시 적용/);
    assert.match(calls.toasts[0].message, /앱을 닫을 때까지 꺼진 상태/);
});

test('설정 적용 오류 안내는 저장된 한국어·영어·일본어로 표시한다', async () => {
    for (const [language, message] of [['ko', /저장하지 못했습니다/], ['en', /Could not save settings/], ['ja', /設定を保存できませんでした/]]) {
        const { calls, save } = createFixture({ language });
        await assert.rejects(save({ language: 'en' }));
        assert.match(calls.toasts[0].message, message);
        assert.equal(calls.languages.at(-1), language);
        assert.equal(calls.effects.length, 0);
    }
});

test('전송 중단 안내는 끄기 요청이 확인된 설정 저장 실패에서만 표시한다', async () => {
    const unavailable = createFixture({ save: () => { throw new Error('IPC unavailable'); } });
    await assert.rejects(unavailable.save({ telemetry_error_reports: false }));
    assert.doesNotMatch(unavailable.calls.toasts[0].message, /꺼진 상태/);

    const noOptOut = createFixture();
    await assert.rejects(noOptOut.save({ telemetry_error_reports: true, telemetry_usage_stats: true }));
    assert.doesNotMatch(noOptOut.calls.toasts[0].message, /꺼진 상태/);

    const serializedError = createFixture({
        language: 'en',
        save: () => { throw new Error("Error invoking remote method 'config:save': Error: CONFIG_SAVE_FAILED: Could not save settings."); },
    });
    await assert.rejects(serializedError.save({ telemetry_usage_stats: false }));
    assert.match(serializedError.calls.toasts[0].message, /stays off until the app closes/);
});

test('실패 복구 중 오류가 나도 원래 저장 오류와 안내를 유지한다', async () => {
    const originalError = new Error('CONFIG_SAVE_FAILED: write failed');
    const value = createFixture({
        save: () => { throw originalError; },
        changeLanguage: () => { throw new Error('language unavailable'); },
        reload: () => { throw new Error('reload unavailable'); },
    });
    await assert.rejects(value.save({ language: 'en' }), error => error === originalError && error.settingsSaveNotified);
    assert.equal(value.calls.reloads, 1);
    assert.equal(value.calls.toasts.length, 1);
    assert.deepEqual(value.calls.visible, []);
});

test('설정 적용 성공은 저장된 전체 설정을 반환하고 창을 유지한다', async () => {
    const success = createFixture({ save: updates => ({ ...updates, serverValue: 'retained' }) });
    const saved = await success.save({ language: 'en' });
    assert.deepEqual(saved, {
        language: 'en', telemetry_error_reports: true, telemetry_usage_stats: true, serverValue: 'retained',
    });
    assert.deepEqual(success.calls.visible, []);
    assert.deepEqual(success.calls.languages, ['en']);
    assert.equal(success.calls.effects.length, 1);
    assert.equal(success.calls.reloads, 0);
    assert.deepEqual(success.calls.toasts, []);
    assert.match(source, /onSave=\{handleSettingsSave\}/);
});

test('설정 취소는 저장 없이 창을 닫고 마지막 저장 언어로 복원한다', async () => {
    const cancelled = createFixture({ language: 'ja' });
    await cancelled.close();
    assert.deepEqual(cancelled.calls.languages, ['ja']);
    assert.deepEqual(cancelled.calls.saves, []);
    assert.equal(cancelled.calls.reloads, 0);
    assert.deepEqual(cancelled.calls.visible, [false]);
});

test('적용 후 작업 탭 초기화·라이브러리 갱신·재시작 동작과 최종 저장 결과를 유지한다', async () => {
    const value = createFixture({
        save: updates => updates,
        effects: { resetTaskTabs: true, librariesChanged: true, restartRecommended: true },
        message: () => 'yes',
    });
    const saved = await value.save({ language: 'en', dup_check_folders: ['/library'], last_selected_library: '/library' });
    assert.equal(saved.last_tab_id, 'folder');
    assert.equal(saved.last_tab_index, 0);
    assert.deepEqual(saved.dup_check_folders, ['/library']);
    assert.deepEqual(value.calls.activeTabs, ['folder']);
    assert.deepEqual(value.calls.events.map(event => ({ type: event.type, detail: event.detail })), [{
        type: 'bookmanager:reset-task-tabs', detail: { tabs: ['organizer', 'renamer', 'metadata'] },
    }]);
    assert.deepEqual(value.calls.indexes, [{
        folders: ['/library'], settings: { priorityFolder: '/library', optimizeMetadata: true, forceMetadata: false, mode: 'smart', language: 'en' },
    }]);
    assert.equal(value.calls.messages.length, 1);
    assert.equal(value.calls.relaunches, 1);
    assert.deepEqual(value.calls.visible, []);
});

test('저장 이후 언어·기본 탭·인덱스·재시작 안내 오류로 적용 성공을 실패 처리하지 않는다', async () => {
    const value = createFixture({
        save: (updates, count) => {
            if (count > 1) throw new Error('last tab failed');
            return updates;
        },
        changeLanguage: () => { throw new Error('language failed'); },
        index: () => { throw new Error('index failed'); },
        message: () => { throw new Error('dialog failed'); },
        effects: { librariesChanged: true, restartRecommended: true },
    });
    const saved = await value.save({ language: 'en', dup_check_folders: ['/library'] });
    assert.equal(saved.language, 'en');
    assert.deepEqual(saved.dup_check_folders, ['/library']);
    assert.equal(value.calls.reloads, 0);
    assert.deepEqual(value.calls.toasts, []);
    assert.deepEqual(value.calls.visible, []);
    assert.equal(value.calls.errors.length, 4);
});
