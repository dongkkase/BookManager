const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const probeSource = [
    'console.log(process.arch);',
    "const Database = require('better-sqlite3');",
    "const database = new Database(':memory:');",
    'database.close();',
].join(' ');

function failureDetails(result) {
    return result.error?.message || result.stderr?.trim() || result.signal || `exit code ${result.status}`;
}

function ensureElectronNativeDependencies({ run = spawnSync, log = console.log } = {}) {
    const electronCommand = require('electron');
    const probe = () => run(electronCommand, ['-e', probeSource], {
        cwd: projectRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
        timeout: 30000,
    });
    const initialProbe = probe();
    if (initialProbe.status === 0) return;
    if (initialProbe.error || initialProbe.signal || !initialProbe.stdout?.trim()) {
        throw new Error(`Could not check Electron native dependencies: ${failureDetails(initialProbe)}`);
    }

    // Packaging for another platform can replace the native binary in node_modules.
    const electronArch = initialProbe.stdout.trim();
    log(`[BookManager] Rebuilding native dependencies for Electron (${process.platform}/${electronArch}).`);
    const rebuild = run(process.execPath, [
        require.resolve('electron-builder/cli.js'),
        'install-app-deps',
        '--platform', process.platform,
        '--arch', electronArch === 'arm' ? 'armv7l' : electronArch,
    ], {
        cwd: projectRoot,
        env: process.env,
        stdio: 'inherit',
    });
    if (rebuild.error || rebuild.status !== 0) {
        throw new Error(`Electron native dependency rebuild failed: ${failureDetails(rebuild)}`);
    }

    const finalProbe = probe();
    if (finalProbe.error || finalProbe.status !== 0) {
        throw new Error(`Electron native dependency probe failed after rebuild: ${failureDetails(finalProbe)}`);
    }
    log('[BookManager] Electron native dependencies are ready.');
}

module.exports = { ensureElectronNativeDependencies };
