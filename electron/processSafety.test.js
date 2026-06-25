import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    attachWindowSafetyHandlers,
    formatFaultDetails,
    installProcessSafetyHandlers,
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
