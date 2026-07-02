const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.BOOKMANAGER_DEV_LOAD_DIST = '1';

let child = null;
let restartTimer = null;
let restarting = false;
let shuttingDown = false;

function spawnElectron() {
    child = spawn(electron, ['.', '--dev'], {
        stdio: 'inherit',
        env,
    });

    child.on('exit', (code, signal) => {
        child = null;
        if (shuttingDown) process.exit(code ?? 0);
        if (restarting) {
            restarting = false;
            spawnElectron();
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
}

function scheduleRestart() {
    if (shuttingDown) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!child) {
            spawnElectron();
            return;
        }
        restarting = true;
        child.kill();
    }, 700);
}

function shutdown() {
    shuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (watcher) watcher.close();
    if (child) {
        child.kill();
        return;
    }
    process.exit(0);
}

const watcher = fs.watch(distDir, { recursive: true }, (eventType, filename) => {
    if (!filename || eventType !== 'change') return;
    if (!/\.(?:html|js|css|json|png|jpe?g|webp|gif|svg|ttf|ico)$/i.test(filename)) return;
    scheduleRestart();
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

spawnElectron();
