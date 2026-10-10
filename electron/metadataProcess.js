import { spawn } from 'child_process';

const MAX_STDERR_BYTES = 64 * 1024;

function withProcessDetails(error, options, exitCode, signal) {
    if (options.telemetryTool === '7z') error.telemetryTool = '7z';
    if (Number.isInteger(exitCode)) error.exitCode = exitCode;
    if (signal) error.signal = signal;
    return error;
}

export function runMetadataProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const requestedMaxBytes = Number(options.maxBytes);
        const maxBytes = Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
            ? requestedMaxBytes
            : Infinity;
        const chunks = [];
        let stdoutBytes = 0;
        let stderr = Buffer.alloc(0);
        let failure = null;
        let killTimer = null;
        let cancelTimer = null;
        let settled = false;
        const cleanup = () => {
            clearTimeout(killTimer);
            clearInterval(cancelTimer);
        };
        const stop = (message, code) => {
            if (failure || settled) return;
            failure = withProcessDetails(Object.assign(new Error(message), { code }), options);
            chunks.length = 0;
            child.stdout.destroy();
            child.stderr.destroy();
            child.kill();
            killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
            killTimer.unref?.();
        };
        const checkCancellation = () => {
            if (options.shouldCancel?.()) stop('Metadata process cancelled', 'TASK_CANCELLED');
        };
        if (options.shouldCancel) {
            cancelTimer = setInterval(checkCancellation, 100);
            cancelTimer.unref?.();
            checkCancellation();
        }
        child.stdout.on('data', data => {
            if (failure) return;
            if (data.length > maxBytes - stdoutBytes) {
                stop(`Metadata process output exceeds ${maxBytes} bytes`, 'PROCESS_OUTPUT_TOO_LARGE');
                return;
            }
            stdoutBytes += data.length;
            chunks.push(data);
        });
        child.stderr.on('data', data => {
            if (failure) return;
            stderr = data.length >= MAX_STDERR_BYTES
                ? Buffer.from(data.subarray(data.length - MAX_STDERR_BYTES))
                : Buffer.concat([stderr.subarray(Math.max(0, stderr.length + data.length - MAX_STDERR_BYTES)), data]);
        });
        child.once('error', error => {
            if (settled) return;
            settled = true;
            cleanup();
            chunks.length = 0;
            reject(failure || withProcessDetails(error, options));
        });
        child.once('close', (code, signal) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (failure) {
                reject(failure);
                return;
            }
            const buffer = Buffer.concat(chunks, stdoutBytes);
            chunks.length = 0;
            const errorText = stderr.toString('utf8');
            if (code !== 0 && code !== 1) {
                const error = new Error(errorText || (options.binary ? '' : buffer.toString('utf8')) || `${command} exited with ${code}`);
                error.code = 'PROCESS_FAILED';
                reject(withProcessDetails(error, options, code, signal));
                return;
            }
            resolve(options.binary
                ? { code, stderr: errorText, buffer }
                : { code, stderr: errorText, stdout: buffer.toString('utf8') });
        });
    });
}
