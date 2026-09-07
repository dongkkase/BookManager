import { spawn } from 'child_process';

const MAX_STDERR_BYTES = 64 * 1024;

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
            failure = Object.assign(new Error(message), { code });
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
            reject(failure || error);
        });
        child.once('close', code => {
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
                reject(new Error(errorText || (options.binary ? '' : buffer.toString('utf8')) || `${command} exited with ${code}`));
                return;
            }
            resolve(options.binary
                ? { code, stderr: errorText, buffer }
                : { code, stderr: errorText, stdout: buffer.toString('utf8') });
        });
    });
}
