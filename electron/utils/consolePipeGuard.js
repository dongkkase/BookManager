const INSTALL_STATE = Symbol.for('bookmanager.consolePipeGuardState');
const PROCESS_INSTALL_STATE = Symbol.for('bookmanager.consolePipeGuardProcessState');

const CONSOLE_METHOD_STREAM = {
    log: 'stdout',
    info: 'stdout',
    debug: 'stdout',
    warn: 'stderr',
    error: 'stderr',
    trace: 'stderr',
};

export function isBrokenPipeError(error) {
    const message = String(error?.message || '');
    return error?.code === 'EPIPE'
        || error?.errno === 'EPIPE'
        || message.includes('EPIPE')
        || (error?.syscall === 'write' && message.includes('EPIPE'));
}

function markStreamBroken(state, streamName) {
    if (streamName === 'stdout') {
        state.stdoutBroken = true;
    } else if (streamName === 'stderr') {
        state.stderrBroken = true;
    }
}

function markAllStreamsBroken(state) {
    state.stdoutBroken = true;
    state.stderrBroken = true;
}

function isStreamBroken(state, streamName) {
    return streamName === 'stdout' ? state.stdoutBroken : state.stderrBroken;
}

function attachStreamErrorHandler(stream, state, streamName) {
    if (!stream || typeof stream.on !== 'function') return;

    stream.on('error', error => {
        if (isBrokenPipeError(error)) {
            markStreamBroken(state, streamName);
            return;
        }
        throw error;
    });
}

function attachProcessErrorHandler(processTarget, state) {
    if (!processTarget || typeof processTarget.on !== 'function') return;
    if (processTarget[PROCESS_INSTALL_STATE]) return;

    Object.defineProperty(processTarget, PROCESS_INSTALL_STATE, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
    });

    const onUncaughtException = error => {
        if (isBrokenPipeError(error)) {
            markAllStreamsBroken(state);
            return;
        }
        if (
            typeof processTarget.listenerCount === 'function'
            && processTarget.listenerCount('uncaughtException') > 1
        ) {
            return;
        }
        throw error;
    };

    if (typeof processTarget.prependListener === 'function') {
        processTarget.prependListener('uncaughtException', onUncaughtException);
    } else {
        processTarget.on('uncaughtException', onUncaughtException);
    }
}

export function installConsolePipeGuard(options = {}) {
    const targetConsole = options.console || console;
    const stateTarget = options.stateTarget || targetConsole;
    if (stateTarget[INSTALL_STATE]) return stateTarget[INSTALL_STATE];

    const state = {
        stdoutBroken: false,
        stderrBroken: false,
    };
    Object.defineProperty(stateTarget, INSTALL_STATE, {
        value: state,
        configurable: false,
        enumerable: false,
        writable: false,
    });

    attachStreamErrorHandler(options.stdout || process.stdout, state, 'stdout');
    attachStreamErrorHandler(options.stderr || process.stderr, state, 'stderr');
    attachProcessErrorHandler(options.processTarget ?? process, state);

    for (const [method, streamName] of Object.entries(CONSOLE_METHOD_STREAM)) {
        const original = targetConsole[method];
        if (typeof original !== 'function') continue;

        targetConsole[method] = (...args) => {
            if (isStreamBroken(state, streamName)) return undefined;

            try {
                return original.apply(targetConsole, args);
            } catch (error) {
                if (!isBrokenPipeError(error)) throw error;
                markStreamBroken(state, streamName);
                return undefined;
            }
        };
    }

    return state;
}
