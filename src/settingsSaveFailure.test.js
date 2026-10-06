import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleSettingsClose =');
const end = source.indexOf('  const handleSettingsLanguagePreview =', start);
assert.ok(start >= 0 && end > start);
const handlerSource = `${source.slice(start, end)}\nreturn handleSettingsClose;`;

function createFixture(options = {}) {
    const calls = { visible: [], languages: [], saves: [], reloads: 0, effects: 0, toasts: [] };
    const scope = {
        useCallback: callback => callback,
        config: { language: options.language || 'ko', telemetry_error_reports: true, telemetry_usage_stats: true },
        setShowSettings: visible => calls.visible.push(visible),
        changeLanguage: async language => { calls.languages.push(language); },
        setConfig: async updates => {
            calls.saves.push(updates);
            if (options.save) return options.save(updates);
            throw Object.assign(new Error('CONFIG_SAVE_FAILED: Could not save settings.'), { code: 'CONFIG_SAVE_FAILED' });
        },
        reloadConfig: async () => {
            calls.reloads += 1;
            await options.reload?.();
        },
        settingsEffects: () => {
            calls.effects += 1;
            return {};
        },
        showToast: (message, duration) => calls.toasts.push({ message, duration }),
        t: key => key,
    };
    return {
        calls,
        close: new Function(...Object.keys(scope), handlerSource)(...Object.values(scope)),
    };
}

test('설정 저장 실패 시 언어를 복원하고 최신 설정을 다시 읽은 뒤 재시도할 수 있다', async () => {
    let finishReload;
    const pendingReload = new Promise(resolve => { finishReload = resolve; });
    const { calls, close } = createFixture({ language: 'ko', reload: () => pendingReload });
    const updates = { language: 'en', telemetry_error_reports: false, telemetry_usage_stats: false };
    const saving = close(updates);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.languages, ['en', 'ko']);
    assert.equal(calls.reloads, 1);
    assert.deepEqual(calls.visible, [false]);
    assert.equal(calls.effects, 0);
    finishReload();
    await saving;
    assert.deepEqual(calls.visible, [false, true]);
    assert.deepEqual(calls.saves, [updates]);
    assert.match(calls.toasts[0].message, /저장하지 못했습니다/);
    assert.match(calls.toasts[0].message, /다시 저장/);
    assert.match(calls.toasts[0].message, /앱을 닫을 때까지 꺼진 상태/);
});

test('설정 저장 오류 안내는 저장된 한국어·영어·일본어로 표시한다', async () => {
    for (const [language, message] of [['ko', /저장하지 못했습니다/], ['en', /Could not save settings/], ['ja', /設定を保存できませんでした/]]) {
        const { calls, close } = createFixture({ language });
        await close({ language: 'en' });
        assert.match(calls.toasts[0].message, message);
        assert.equal(calls.languages.at(-1), language);
        assert.equal(calls.effects, 0);
    }
});

test('전송 중단 안내는 끄기 요청이 확인된 설정 저장 실패에서만 표시한다', async () => {
    const unavailable = createFixture({ save: () => { throw new Error('IPC unavailable'); } });
    await unavailable.close({ telemetry_error_reports: false });
    assert.doesNotMatch(unavailable.calls.toasts[0].message, /꺼진 상태/);

    const noOptOut = createFixture();
    await noOptOut.close({ telemetry_error_reports: true, telemetry_usage_stats: true });
    assert.doesNotMatch(noOptOut.calls.toasts[0].message, /꺼진 상태/);

    const serializedError = createFixture({
        language: 'en',
        save: () => { throw new Error("Error invoking remote method 'config:save': Error: CONFIG_SAVE_FAILED: Could not save settings."); },
    });
    await serializedError.close({ telemetry_usage_stats: false });
    assert.match(serializedError.calls.toasts[0].message, /stays off until the app closes/);
});

test('설정 저장 성공과 취소에는 실패 복구 동작을 실행하지 않는다', async () => {
    const success = createFixture({ save: updates => updates });
    await success.close({ language: 'en' });
    assert.deepEqual(success.calls.visible, [false]);
    assert.equal(success.calls.effects, 1);
    assert.equal(success.calls.reloads, 0);
    assert.deepEqual(success.calls.toasts, []);

    const cancelled = createFixture({ language: 'ja' });
    await cancelled.close(null);
    assert.deepEqual(cancelled.calls.languages, ['ja']);
    assert.deepEqual(cancelled.calls.saves, []);
    assert.equal(cancelled.calls.reloads, 0);
    assert.deepEqual(cancelled.calls.visible, [false]);
});
