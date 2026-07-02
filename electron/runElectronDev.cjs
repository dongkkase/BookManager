const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const useUnsafeDevNodeIntegration = process.argv.includes('--unsafe-dev-node');
const useDistWatch = process.argv.includes('--dist-watch');
const requestedDevServerUrl = new URL(process.env.BOOKMANAGER_DEV_SERVER_URL || 'http://127.0.0.1:5173/');
const devServerHost = requestedDevServerUrl.hostname || '127.0.0.1';
const devServerPort = Number(requestedDevServerUrl.port || (requestedDevServerUrl.protocol === 'https:' ? 443 : 80));
const launcherArgs = [path.join('electron', 'launchElectronDev.cjs')];
if (useUnsafeDevNodeIntegration) {
    launcherArgs.push('--unsafe-dev-node');
}

let electronProcess = null;
let viteServer = null;
let buildWatcher = null;
let activeDevServerUrl = requestedDevServerUrl;
let restartingElectron = false;
let shuttingDown = false;

function stopExistingDevElectronInstances() {
    if (process.platform !== 'win32') return;
    const electronPath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
    const script = [
        '$target = [System.IO.Path]::GetFullPath($env:BOOKMANAGER_DEV_ELECTRON_PATH)',
        'Get-CimInstance Win32_Process -Filter "Name = \'electron.exe\'" |',
        '  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($target) -and $_.CommandLine.Contains(" --dev") } |',
        '  ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }',
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        encoding: 'utf8',
        env: {
            ...process.env,
            BOOKMANAGER_DEV_ELECTRON_PATH: electronPath,
        },
    });
    if (result.error) {
        console.warn('[BookManager] Existing dev Electron cleanup failed.', result.error.message);
    } else if (result.stderr?.trim()) {
        console.warn(result.stderr.trim());
    }
}

function stopProcess(child) {
    if (!child || child.killed || !child.pid) return;
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
                stdio: 'ignore',
            });
            return;
        }
        child.kill();
    } catch {
        // Process may already have exited.
    }
}

async function closeViteServer() {
    if (!viteServer) return;
    const server = viteServer;
    viteServer = null;
    await server.close();
}

async function closeBuildWatcher() {
    if (!buildWatcher) return;
    const watcher = buildWatcher;
    buildWatcher = null;
    await Promise.resolve(watcher.close?.());
}

async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    stopProcess(electronProcess);
    try {
        await closeBuildWatcher();
        await closeViteServer();
    } catch (error) {
        console.error(error);
    }
    process.exit(code);
}

function startElectron() {
    if (electronProcess) return;
    const launchTarget = useDistWatch ? 'dist' : activeDevServerUrl.href;
    console.log(`[BookManager] Starting Electron (${launchTarget})`);
    electronProcess = spawn(process.execPath, launcherArgs, {
        cwd: projectRoot,
        stdio: 'inherit',
        env: {
            ...process.env,
            BOOKMANAGER_DEV_SERVER_URL: activeDevServerUrl.href,
            ...(useDistWatch ? { BOOKMANAGER_DEV_LOAD_DIST: '1' } : {}),
        },
    });
    electronProcess.on('exit', (code, signal) => {
        electronProcess = null;
        if (restartingElectron && !shuttingDown) {
            restartingElectron = false;
            startElectron();
            return;
        }
        if (signal) {
            void shutdown(1);
            return;
        }
        void shutdown(code ?? 0);
    });
    electronProcess.on('error', error => {
        console.error(error);
        void shutdown(1);
    });
}

function restartElectron() {
    if (!electronProcess) {
        startElectron();
        return;
    }
    restartingElectron = true;
    stopProcess(electronProcess);
}

function resolveActiveDevServerUrl(server) {
    const localUrl = server.resolvedUrls?.local?.[0];
    if (localUrl) return new URL(localUrl);

    const address = server.httpServer?.address?.();
    if (address && typeof address === 'object' && address.port) {
        const resolved = new URL(requestedDevServerUrl.href);
        resolved.port = String(address.port);
        return resolved;
    }
    return requestedDevServerUrl;
}

async function startDevServer() {
    stopExistingDevElectronInstances();
    const { createServer } = await import('vite');
    viteServer = await createServer({
        root: projectRoot,
        server: {
            host: devServerHost,
            port: devServerPort,
            strictPort: false,
            headers: {
                'Cache-Control': 'no-store',
            },
        },
    });
    await viteServer.listen();
    activeDevServerUrl = resolveActiveDevServerUrl(viteServer);
    if (activeDevServerUrl.port !== requestedDevServerUrl.port) {
        console.warn(`[BookManager] Port ${requestedDevServerUrl.port} is in use. Using ${activeDevServerUrl.href}`);
    }
    viteServer.printUrls();
    startElectron();
}

async function startDistWatch() {
    stopExistingDevElectronInstances();
    const { build } = await import('vite');
    console.log('[BookManager] Starting renderer dist watcher.');
    buildWatcher = await build({
        root: projectRoot,
        mode: 'development',
        build: {
            emptyOutDir: true,
            minify: false,
            sourcemap: false,
            watch: {},
        },
    });

    if (!buildWatcher || typeof buildWatcher.on !== 'function') {
        startElectron();
        return;
    }

    buildWatcher.on('event', event => {
        if (event.code === 'START') {
            console.log('[BookManager] Building renderer...');
            return;
        }
        if (event.code === 'ERROR') {
            console.error('[BookManager] Renderer build failed.');
            console.error(event.error || event);
            return;
        }
        if (event.code !== 'END') return;
        if (electronProcess) {
            console.log('[BookManager] Renderer rebuilt. Restarting Electron.');
            restartElectron();
            return;
        }
        startElectron();
    });
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

const start = useDistWatch ? startDistWatch : startDevServer;

start().catch(error => {
    console.error('[BookManager] Failed to start dev runner.');
    console.error(error);
    void shutdown(1);
});
