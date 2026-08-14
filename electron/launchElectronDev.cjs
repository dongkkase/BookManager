const { spawn } = require('node:child_process');
const electron = require('electron');

const useUnsafeDevNodeIntegration = process.argv.includes('--unsafe-dev-node');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.BOOKMANAGER_DEV_SERVER_URL = env.BOOKMANAGER_DEV_SERVER_URL || 'http://127.0.0.1:5173';
if (useUnsafeDevNodeIntegration) {
    env.BOOKMANAGER_UNSAFE_DEV_NODE = '1';
}

const electronArgs = ['.', '--dev'];
if (useUnsafeDevNodeIntegration) {
    electronArgs.push('--unsafe-dev-node');
}

const child = spawn(electron, electronArgs, {
    stdio: 'inherit',
    env,
});
let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (child && !child.killed) {
        child.kill(signal);
        return;
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
    if (shuttingDown) {
        process.exit(code ?? 0);
        return;
    }
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});

child.on('error', error => {
    console.error(error);
    process.exit(1);
});
