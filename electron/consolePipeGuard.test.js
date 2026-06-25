import assert from 'node:assert/strict';
import test from 'node:test';
import { installConsolePipeGuard, isBrokenPipeError } from './utils/consolePipeGuard.js';

function createError(code, message = code) {
    const error = new Error(message);
    error.code = code;
    error.syscall = 'write';
    return error;
}

function createFakeStream() {
    const handlers = new Map();
    return {
        on(eventName, handler) {
            handlers.set(eventName, handler);
            return this;
        },
        emitError(error) {
            handlers.get('error')?.(error);
        },
    };
}

function createFakeProcess() {
    const handlers = new Map();
    const addHandler = (eventName, handler, prepend = false) => {
        const list = handlers.get(eventName) || [];
        if (prepend) list.unshift(handler);
        else list.push(handler);
        handlers.set(eventName, list);
        return fakeProcess;
    };
    const fakeProcess = {
        on(eventName, handler) {
            return addHandler(eventName, handler);
        },
        prependListener(eventName, handler) {
            return addHandler(eventName, handler, true);
        },
        listenerCount(eventName) {
            return (handlers.get(eventName) || []).length;
        },
        emitUncaughtException(error) {
            for (const handler of handlers.get('uncaughtException') || []) {
                handler(error);
            }
        },
    };
    return fakeProcess;
}

function createLegacyFakeProcess() {
    const handlers = new Map();
    return {
        on(eventName, handler) {
            handlers.set(eventName, handler);
            return this;
        },
        prependListener(eventName, handler) {
            handlers.set(eventName, handler);
            return this;
        },
        emitUncaughtException(error) {
            handlers.get('uncaughtException')?.(error);
        },
    };
}

test('EPIPE 오류를 broken pipe로 판별한다', () => {
    assert.equal(isBrokenPipeError(createError('EPIPE')), true);
    assert.equal(isBrokenPipeError(createError('EINVAL')), false);
});

test('콘솔 write EPIPE는 예외로 전파하지 않고 해당 스트림을 닫힌 상태로 표시한다', () => {
    const stdout = createFakeStream();
    const stderr = createFakeStream();
    const stateTarget = {};
    let attempts = 0;
    const fakeConsole = {
        log() {
            attempts += 1;
            throw createError('EPIPE', 'write EPIPE');
        },
        error() {},
    };

    const state = installConsolePipeGuard({
        console: fakeConsole,
        stdout,
        stderr,
        processTarget: createFakeProcess(),
        stateTarget,
    });

    assert.doesNotThrow(() => fakeConsole.log('thumbnail ready'));
    assert.equal(state.stdoutBroken, true);
    assert.equal(attempts, 1);

    assert.doesNotThrow(() => fakeConsole.log('skipped after broken pipe'));
    assert.equal(attempts, 1);
});

test('stdout EPIPE 이벤트 이후 stdout 콘솔 출력만 건너뛴다', () => {
    const stdout = createFakeStream();
    const stderr = createFakeStream();
    let logCount = 0;
    let errorCount = 0;
    const fakeConsole = {
        log() {
            logCount += 1;
        },
        error() {
            errorCount += 1;
        },
    };

    installConsolePipeGuard({
        console: fakeConsole,
        stdout,
        stderr,
        processTarget: createFakeProcess(),
        stateTarget: {},
    });

    stdout.emitError(createError('EPIPE', 'write EPIPE'));
    fakeConsole.log('ignored');
    fakeConsole.error('still available');

    assert.equal(logCount, 0);
    assert.equal(errorCount, 1);
});

test('EPIPE가 아닌 오류는 숨기지 않는다', () => {
    const stdout = createFakeStream();
    const stderr = createFakeStream();
    const fakeConsole = {
        warn() {
            throw createError('EINVAL', 'bad write');
        },
    };

    installConsolePipeGuard({
        console: fakeConsole,
        stdout,
        stderr,
        processTarget: createFakeProcess(),
        stateTarget: {},
    });

    assert.throws(() => fakeConsole.warn('warning'), /bad write/);
    assert.throws(() => stderr.emitError(createError('EINVAL', 'bad stream')), /bad stream/);
});

test('uncaughtException으로 올라온 EPIPE는 프로세스 예외로 전파하지 않는다', () => {
    const stdout = createFakeStream();
    const stderr = createFakeStream();
    const fakeProcess = createFakeProcess();
    let logCount = 0;
    const fakeConsole = {
        log() {
            logCount += 1;
        },
    };

    const state = installConsolePipeGuard({
        console: fakeConsole,
        stdout,
        stderr,
        processTarget: fakeProcess,
        stateTarget: {},
    });

    assert.doesNotThrow(() => fakeProcess.emitUncaughtException(createError('EPIPE', 'write EPIPE')));
    assert.equal(state.stdoutBroken, true);
    assert.equal(state.stderrBroken, true);

    fakeConsole.log('ignored after process EPIPE');
    assert.equal(logCount, 0);
});

test('다른 uncaughtException 처리기가 있으면 비-EPIPE 오류 처리를 넘긴다', () => {
    const fakeProcess = createFakeProcess();
    const error = createError('EINVAL', 'main process failure');
    let observed = null;

    installConsolePipeGuard({
        console: { error() {} },
        stdout: createFakeStream(),
        stderr: createFakeStream(),
        processTarget: fakeProcess,
        stateTarget: {},
    });
    fakeProcess.on('uncaughtException', nextError => {
        observed = nextError;
    });

    assert.doesNotThrow(() => fakeProcess.emitUncaughtException(error));
    assert.equal(observed, error);
});

test('listenerCount 없는 프로세스에서는 비-EPIPE 오류를 기존처럼 전파한다', () => {
    const fakeProcess = createLegacyFakeProcess();

    installConsolePipeGuard({
        console: { error() {} },
        stdout: createFakeStream(),
        stderr: createFakeStream(),
        processTarget: fakeProcess,
        stateTarget: {},
    });

    assert.throws(
        () => fakeProcess.emitUncaughtException(createError('EINVAL', 'legacy failure')),
        /legacy failure/,
    );
});
