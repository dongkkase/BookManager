const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        env: process.env,
        stdio: 'inherit',
    });

    if (result.error) {
        console.error(result.error);
        return 1;
    }
    return result.status ?? 1;
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
let testExitCode = 1;
let electronRebuildExitCode = 1;

try {
    console.log('[BookManager] Rebuilding native dependencies for Node tests.');
    const nodeRebuildExitCode = run(npmCommand, ['run', 'node:rebuild']);
    if (nodeRebuildExitCode === 0) {
        const testArgs = requestedTestArgs.length > 0 ? requestedTestArgs : collectTestFiles();
        testExitCode = run(process.execPath, ['--test', ...testArgs]);
    }
} finally {
    console.log('[BookManager] Restoring native dependencies for Electron.');
    electronRebuildExitCode = run(npmCommand, ['run', 'electron:rebuild']);
}

process.exit(testExitCode === 0 ? electronRebuildExitCode : testExitCode);
