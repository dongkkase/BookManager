import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { StringDecoder } from 'node:string_decoder';

import { resolveAppDataDir } from '../dataPaths.js';

export const MAX_RUNTIME_LOG_BYTES = 10 * 1024 * 1024;
export const MAX_RUNTIME_LOG_FILE_BYTES = MAX_RUNTIME_LOG_BYTES / 2;

const MAX_PENDING_STREAM_TEXT = 64 * 1024;
const RENDERER_LOG_LEVELS = ['verbose', 'info', 'warning', 'error'];

function fileSize(filePath, fsTarget = fs) {
    try {
        return fsTarget.statSync(filePath).size;
    } catch {
        return 0;
    }
}

function trimFileToTail(filePath, maxBytes, fsTarget = fs) {
    const size = fileSize(filePath, fsTarget);
    if (size <= maxBytes) return size;

    const source = fsTarget.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(maxBytes);
        fsTarget.readSync(source, buffer, 0, maxBytes, size - maxBytes);
        fsTarget.writeFileSync(filePath, buffer);
    } finally {
        fsTarget.closeSync(source);
    }
    return maxBytes;
}

function formatLogValue(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    return util.inspect(value, {
        colors: false,
        depth: 8,
        maxArrayLength: 100,
        breakLength: 160,
    });
}

export function resolveRuntimeLogPaths(
    executableDir = path.dirname(process.execPath),
    platform = process.platform,
    env = process.env,
) {
    const logDir = path.join(resolveAppDataDir(executableDir, platform, env), 'logs');
    return {
        logDir,
        activePath: path.join(logDir, 'runtime.log'),
        previousPath: path.join(logDir, 'runtime.previous.log'),
    };
}

export function createBoundedLogWriter(options = {}) {
    const fsTarget = options.fs || fs;
    const paths = options.paths || resolveRuntimeLogPaths(
        options.executableDir,
        options.platform,
        options.env,
    );
    const maxFileBytes = Math.max(1024, Number(options.maxFileBytes) || MAX_RUNTIME_LOG_FILE_BYTES);
    const now = options.now || (() => new Date());
    let descriptor = null;
    let activeBytes = 0;
    let closed = false;

    try {
        fsTarget.mkdirSync(paths.logDir, { recursive: true });
        trimFileToTail(paths.previousPath, maxFileBytes, fsTarget);
        activeBytes = trimFileToTail(paths.activePath, maxFileBytes, fsTarget);
        descriptor = fsTarget.openSync(paths.activePath, 'a');
    } catch {
        closed = true;
    }

    const closeDescriptor = () => {
        if (descriptor === null) return;
        try {
            fsTarget.closeSync(descriptor);
        } catch {
            // Log shutdown must not interrupt app shutdown.
        }
        descriptor = null;
    };

    const rotate = () => {
        closeDescriptor();
        fsTarget.rmSync(paths.previousPath, { force: true });
        if (fileSize(paths.activePath, fsTarget) > 0) {
            fsTarget.renameSync(paths.activePath, paths.previousPath);
        }
        descriptor = fsTarget.openSync(paths.activePath, 'a');
        activeBytes = 0;
    };

    const write = value => {
        if (closed || descriptor === null) return false;
        let buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
        if (buffer.length > maxFileBytes) {
            buffer = buffer.subarray(buffer.length - maxFileBytes);
        }

        try {
            if (activeBytes > 0 && activeBytes + buffer.length > maxFileBytes) rotate();
            fsTarget.writeSync(descriptor, buffer, 0, buffer.length, null);
            activeBytes += buffer.length;
            return true;
        } catch {
            closeDescriptor();
            closed = true;
            return false;
        }
    };

    const writeLine = (channel, value) => {
        const timestamp = now().toISOString();
        const text = formatLogValue(value).replace(/\r\n?/g, '\n');
        const entry = text
            .split('\n')
            .map(line => `[${timestamp}] [${channel}] ${line}`)
            .join('\n');
        return write(`${entry}\n`);
    };

    return {
        paths,
        get available() {
            return !closed && descriptor !== null;
        },
        write,
        writeLine,
        close() {
            if (closed) return;
            closeDescriptor();
            closed = true;
        },
    };
}

function createStreamSink(writer, channel) {
    const decoder = new StringDecoder('utf8');
    let pending = '';

    const flushCompleteLines = () => {
        const lines = pending.split(/\r\n|\n|\r/);
        pending = lines.pop() || '';
        for (const line of lines) writer.writeLine(channel, line);
        if (pending.length > MAX_PENDING_STREAM_TEXT) {
            writer.writeLine(channel, pending);
            pending = '';
        }
    };

    return {
        write(chunk, encoding) {
            pending += Buffer.isBuffer(chunk)
                ? decoder.write(chunk)
                : Buffer.from(String(chunk), encoding || 'utf8').toString('utf8');
            flushCompleteLines();
        },
        flush() {
            pending += decoder.end();
            if (pending) writer.writeLine(channel, pending);
            pending = '';
        },
    };
}

function patchStream(stream, writer, channel) {
    if (!stream || typeof stream.write !== 'function') return () => {};
    const sink = createStreamSink(writer, channel);
    const originalWrite = stream.write;
    const patchedWrite = function patchedRuntimeLogWrite(chunk, encoding, callback) {
        try {
            sink.write(chunk, typeof encoding === 'string' ? encoding : undefined);
        } catch {
            // Terminal logging must never block the original stream.
        }
        return Reflect.apply(originalWrite, this, arguments);
    };
    stream.write = patchedWrite;

    return () => {
        sink.flush();
        if (stream.write === patchedWrite) stream.write = originalWrite;
    };
}

function rendererConsoleEntry(level, message, line, sourceId) {
    const levelName = RENDERER_LOG_LEVELS[Number(level)] || `level-${level}`;
    const source = sourceId
        ? ` (${sourceId}${Number(line) > 0 ? `:${line}` : ''})`
        : '';
    return {
        channel: `renderer:${levelName}`,
        message: `${message || ''}${source}`,
    };
}

export function installRuntimeLogging(options = {}) {
    if (options.enabled === false) return null;
    const appTarget = options.appTarget;
    const processTarget = options.processTarget || process;
    const writer = options.writer || createBoundedLogWriter(options);
    if (!writer.available) return null;

    const restoreStdout = patchStream(processTarget.stdout, writer, 'stdout');
    const restoreStderr = patchStream(processTarget.stderr, writer, 'stderr');
    const onWebContentsCreated = (_event, webContents) => {
        webContents?.on?.('console-message', (_consoleEvent, level, message, line, sourceId) => {
            const entry = rendererConsoleEntry(level, message, line, sourceId);
            writer.writeLine(entry.channel, entry.message);
        });
    };
    appTarget?.on?.('web-contents-created', onWebContentsCreated);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        restoreStdout();
        restoreStderr();
        appTarget?.off?.('web-contents-created', onWebContentsCreated);
        writer.writeLine('system', `session-end pid=${processTarget.pid}`);
        writer.close();
    };
    processTarget.once?.('exit', close);

    writer.writeLine('system', `session-start pid=${processTarget.pid} version=${processTarget.version}`);
    console.log(`[BookManager] Runtime log: ${writer.paths.activePath}`);

    return {
        ...writer.paths,
        close,
    };
}
