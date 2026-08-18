const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = require('electron');
const testElectronPackagePreloadPath = path.join(__dirname, 'testElectronPackagePreload.cjs');
const electronTestEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
};

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        env: options.env || process.env,
        stdio: options.stdio || 'inherit',
    });

    if (result.error) {
        console.error(result.error);
        return 1;
    }
    return result.status ?? 1;
}

function electronNativeDependenciesAreReady() {
    const probeSource = [
        "const Database = require('better-sqlite3');",
        "const database = new Database(':memory:');",
        'database.close();',
    ].join(' ');
    return run(electronCommand, ['-e', probeSource], {
        env: electronTestEnv,
        stdio: 'ignore',
    }) === 0;
}

function collectTestFiles() {
    return ['electron', 'src'].flatMap(directory => {
        const absoluteDirectory = path.join(projectRoot, directory);
        return fs.readdirSync(absoluteDirectory, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
            .map(entry => path.join(directory, entry.name));
    }).sort();
}

const requestedTestArgs = process.argv.slice(2);
if (!electronNativeDependenciesAreReady()) {
    console.log('[BookManager] Rebuilding native dependencies for Electron tests.');
    const electronRebuildExitCode = run(npmCommand, ['run', 'electron:rebuild']);
    if (electronRebuildExitCode !== 0) {
        process.exit(electronRebuildExitCode);
    }
    if (!electronNativeDependenciesAreReady()) {
        console.error('[BookManager] Electron native dependency probe failed after rebuild.');
        process.exit(1);
    }
}

const testArgs = requestedTestArgs.length > 0 ? requestedTestArgs : collectTestFiles();
const testExitCode = run(
    electronCommand,
    ['--require', testElectronPackagePreloadPath, '--test', ...testArgs],
    { env: electronTestEnv },
);
process.exit(testExitCode);
