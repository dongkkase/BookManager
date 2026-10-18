import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    attachWindowSafetyHandlers,
    formatFaultDetails,
    installProcessSafetyHandlers,
    isExpectedProcessExit,
    isWindowsControlExit,
    shouldReloadRendererAfterGone,
    writeProcessFaultLog,
} from './processSafety.js';

function createEmitter() {
    const handlers = new Map();
    return {
        on(eventName, handler) {
            const list = handlers.get(eventName) || [];
            list.push(handler);
            handlers.set(eventName, list);
            return this;
        },
        off(eventName, handler) {
            handlers.set(
                eventName,
                (handlers.get(eventName) || []).filter(item => item !== handler),
            );
            return this;
        },
        emit(eventName, ...args) {
            for (const handler of handlers.get(eventName) || []) {
                handler(...args);
            }
        },
        listenerCount(eventName) {
            return (handlers.get(eventName) || []).length;
        },
    };
}

test('프로세스 fault 로그는 예외와 컨텍스트를 파일에 남긴다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-process-safety-'));
    try {
        const logPath = path.join(root, 'process.log');
        const error = new Error('unexpected shutdown candidate');
        writeProcessFaultLog(logPath, 'uncaughtException', error, { phase: 'test' }, {
            now: () => new Date('2026-06-25T00:00:00.000Z'),
        });

        const output = fs.readFileSync(logPath, 'utf8');
        assert.match(output, /\[2026-06-25T00:00:00.000Z\] uncaughtException/);
        assert.match(output, /unexpected shutdown candidate/);
        assert.match(output, /"phase": "test"/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('fault 상세 포맷은 Error와 일반 객체를 모두 문자열화한다', () => {
    assert.match(formatFaultDetails(new Error('main failed')), /main failed/);
    assert.match(formatFaultDetails({ reason: 'crashed' }), /"reason": "crashed"/);
});

test('프로세스 안전장치는 처리되지 않은 예외와 rejection을 보고한다', () => {
    const processTarget = createEmitter();
    const appTarget = createEmitter();
    const events = [];

    const guard = installProcessSafetyHandlers({
        processTarget,
        appTarget,
        reportFault: (eventName, details) => events.push({ eventName, details }),
    });

    processTarget.emit('uncaughtException', new Error('sync failure'));
    processTarget.emit('unhandledRejection', new Error('async failure'));
    appTarget.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
    appTarget.emit('gpu-process-crashed', {}, true);

    assert.deepEqual(events.map(event => event.eventName), [
        'uncaughtException',
        'unhandledRejection',
        'child-process-gone',
        'gpu-process-crashed',
    ]);

    guard.uninstall();
    processTarget.emit('unhandledRejection', new Error('ignored after uninstall'));
    assert.equal(events.length, 4);
});

test('렌더러 정상 종료는 재로드하지 않고 비정상 종료만 제한적으로 재로드한다', () => {
    assert.equal(shouldReloadRendererAfterGone({ reason: 'clean-exit' }, 0, 1), false);
    assert.equal(shouldReloadRendererAfterGone({ reason: 'crashed' }, 0, 1), true);
    assert.equal(shouldReloadRendererAfterGone({ reason: 'crashed' }, 1, 1), false);
});

test('렌더러가 비정상 종료되면 한 번만 재로드하고 fault를 보고한다', () => {
    const webContents = createEmitter();
    let reloadCount = 0;
    webContents.reload = () => {
        reloadCount += 1;
    };
    const events = [];
    const windowTarget = {
        webContents,
        isDestroyed: () => false,
    };

    attachWindowSafetyHandlers(windowTarget, {
        reportFault: (eventName, details) => events.push({ eventName, details }),
        setTimeout: callback => callback(),
        maxReloads: 1,
        reloadDelayMs: 0,
    });

    webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    webContents.emit('unresponsive');

    assert.equal(reloadCount, 1);
    assert.deepEqual(events.map(event => event.eventName), [
        'render-process-gone',
        'render-process-gone',
        'renderer-unresponsive',
    ]);
});

test('Windows 제어 종료는 부호 있는 코드와 없는 코드만 정확히 판별한다', () => {
    for (const code of [-1073741510, 3221225786]) {
        assert.equal(isWindowsControlExit(code, 'win32'), true);
        assert.equal(isWindowsControlExit(code, 'darwin'), false);
        assert.equal(isWindowsControlExit(code, 'linux'), false);
    }
    for (const code of [0, -1073741819, 3221225477, '-1073741510', 3221225786.5, null, undefined, NaN]) {
        assert.equal(isWindowsControlExit(code, 'win32'), false);
    }
});

test('정상 종료와 종료 확정 후의 외부 종료만 예상된 프로세스 종료로 취급한다', () => {
    assert.equal(isExpectedProcessExit({ reason: 'clean-exit' }), true);
    for (const platform of ['win32', 'darwin', 'linux']) {
        assert.equal(isExpectedProcessExit({ reason: 'killed' }, { platform }), false);
        assert.equal(isExpectedProcessExit({ reason: 'killed' }, { platform, isShuttingDown: true }), true);
        for (const exitCode of [-1073741510, 3221225786]) {
            for (const reason of [undefined, 'abnormal-exit']) {
                assert.equal(isExpectedProcessExit({ reason, exitCode }, { platform }), false);
                assert.equal(isExpectedProcessExit({ reason, exitCode }, { platform, isShuttingDown: true }), platform === 'win32');
            }
            for (const reason of ['crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction', 'unknown']) {
                assert.equal(isExpectedProcessExit({ reason, exitCode }, { platform, isShuttingDown: true }), false);
            }
        }
    }
    for (const details of [null, {}, { reason: 'abnormal-exit', exitCode: -1073741819 }]) {
        assert.equal(isExpectedProcessExit(details, { platform: 'win32', isShuttingDown: true }), false);
    }
});

function createRecoveryHarness(options = {}) {
    const webContents = createEmitter();
    let reloads = 0;
    let shuttingDown = false;
    let destroyed = false;
    webContents.reload = () => { reloads += 1; };
    const windowTarget = { webContents, isDestroyed: () => destroyed };
    const events = [];
    const timers = new Map();
    const cleared = [];
    let nextTimer = 0;
    const guard = attachWindowSafetyHandlers(windowTarget, {
        reportFault: (eventName, details) => events.push({ eventName, details }),
        isShuttingDown: () => shuttingDown,
        setTimeout: callback => {
            const timer = ++nextTimer;
            timers.set(timer, callback);
            return timer;
        },
        clearTimeout: timer => { cleared.push(timer); timers.delete(timer); },
        ...options,
    });
    return {
        guard, events, timers, cleared, webContents,
        get reloads() { return reloads; },
        shutdown() { shuttingDown = true; },
        destroy() { destroyed = true; },
        gone: details => webContents.emit('render-process-gone', {}, details),
        runTimers() {
            for (const [timer, callback] of [...timers]) {
                timers.delete(timer);
                callback();
            }
        },
    };
}

test('종료가 확정되면 원본 fault는 기록하되 재로드를 예약하지 않는다', () => {
    const harness = createRecoveryHarness();
    harness.shutdown();
    const details = { reason: 'crashed', exitCode: -1073741819 };
    harness.gone(details);
    assert.deepEqual(harness.events, [{ eventName: 'render-process-gone', details }]);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.reloads, 0);
});

test('재로드 대기 중 종료가 확정되거나 창이 파괴되면 예약한 복구를 실행하지 않는다', () => {
    for (const transition of ['shutdown', 'destroy']) {
        const harness = createRecoveryHarness();
        harness.gone({ reason: 'crashed' });
        assert.equal(harness.timers.size, 1);
        harness[transition]();
        harness.runTimers();
        assert.equal(harness.reloads, 0);
        assert.equal(harness.events.length, 1);
    }
});

test('중복 종료 이벤트가 대기 중이어도 창당 재로드 횟수 제한을 지킨다', () => {
    const harness = createRecoveryHarness({ maxReloads: 2 });
    for (let index = 0; index < 4; index += 1) harness.gone({ reason: 'crashed' });
    assert.equal(harness.timers.size, 2);
    harness.runTimers();
    assert.equal(harness.reloads, 2);
    harness.gone({ reason: 'crashed' });
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.events.length, 5);
});

test('안전장치 해제는 대기 타이머를 취소하고 이미 큐에 들어간 콜백도 차단한다', () => {
    const harness = createRecoveryHarness({ maxReloads: 2 });
    harness.gone({ reason: 'crashed' });
    harness.gone({ reason: 'crashed' });
    const queuedCallbacks = [...harness.timers.values()];
    harness.guard.uninstall();
    assert.deepEqual(harness.cleared, [1, 2]);
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.webContents.listenerCount('render-process-gone'), 0);
    for (const callback of queuedCallbacks) callback();
    harness.gone({ reason: 'crashed' });
    assert.equal(harness.reloads, 0);
    assert.equal(harness.events.length, 2);
    harness.guard.uninstall();
    assert.deepEqual(harness.cleared, [1, 2]);
});
