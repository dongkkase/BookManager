const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const MINIMUM_MACOS_VERSION = '12.0';
const NAPI_VERSION = 8;

function createBuildPaths(projectRoot = path.join(__dirname, '..')) {
    const buildDirectory = path.join(projectRoot, 'electron', 'native', 'build');
    return {
        sourcePath: path.join(projectRoot, 'electron', 'native', 'MacCursorCompat.mm'),
        buildDirectory,
        outputPath: path.join(buildDirectory, 'MacCursorCompat.node'),
        manifestPath: path.join(buildDirectory, 'MacCursorCompat.build.json'),
    };
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: 'inherit', ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`macOS cursor helper build failed: ${command} (exit ${result.status}).`);
    return result;
}

function findNodeGyp() {
    try {
        return require.resolve('node-gyp/bin/node-gyp.js');
    } catch {
        const candidates = [
            process.env.npm_execpath && path.resolve(path.dirname(process.env.npm_execpath), '..', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
            path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
        ];
        const npmRoot = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' });
        if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
            candidates.push(path.join(npmRoot.stdout.trim(), 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'));
        }
        const installed = candidates.find(candidate => candidate && fs.existsSync(candidate));
        if (installed) return installed;
        throw new Error('Install Node.js with npm or node-gyp to build the macOS cursor helper.');
    }
}

function resolveHeaders(projectRoot, electronVersion, headersDirectory) {
    const candidates = [
        headersDirectory,
        path.join(os.homedir(), 'Library', 'Caches', 'node-gyp', electronVersion, 'include', 'node'),
        path.join(os.homedir(), '.electron-gyp', electronVersion, 'include', 'node'),
        path.join(projectRoot, 'build', 'electron-headers', electronVersion, 'include', 'node'),
    ];
    const installed = candidates.find(directory => directory && fs.existsSync(path.join(directory, 'node_api.h')));
    if (installed) return installed;
    if (headersDirectory) throw new Error(`Electron headers were not found in ${headersDirectory}.`);

    const cache = path.join(projectRoot, 'build', 'electron-headers');
    run(process.execPath, [findNodeGyp(), 'install', '--ensure', `--target=${electronVersion}`,
        '--dist-url=https://electronjs.org/headers', `--devdir=${cache}`], { cwd: projectRoot });
    const downloaded = path.join(cache, electronVersion, 'include', 'node');
    if (!fs.existsSync(path.join(downloaded, 'node_api.h'))) throw new Error('Electron header installation did not produce node_api.h.');
    return downloaded;
}

function buildMacCursorCompat({ platform = process.platform, projectRoot = path.join(__dirname, '..'), arch = 'universal', headersDirectory } = {}) {
    if (platform !== 'darwin') return { skipped: true, reason: 'The macOS cursor helper can only be built on macOS.' };
    if (!['universal', 'x64', 'arm64'].includes(arch)) throw new Error(`Unsupported macOS cursor helper architecture: ${arch}`);
    const paths = createBuildPaths(projectRoot);
    const electronVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
    const fingerprint = crypto.createHash('sha256')
        .update(fs.readFileSync(paths.sourcePath))
        .update(fs.readFileSync(__filename))
        .update(JSON.stringify({ arch, electronVersion, minimumMacOS: MINIMUM_MACOS_VERSION, napi: NAPI_VERSION }))
        .digest('hex');
    try {
        if (JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8')).fingerprint === fingerprint && fs.statSync(paths.outputPath).size > 0) {
            return { skipped: false, cached: true, outputPath: paths.outputPath };
        }
    } catch {
        // Missing or stale build artifacts are rebuilt before launch or packaging.
    }

    const headers = resolveHeaders(projectRoot, electronVersion, headersDirectory);
    fs.mkdirSync(paths.buildDirectory, { recursive: true });
    const architectures = arch === 'universal' ? ['x64', 'arm64'] : [arch];
    const intermediates = architectures.map(value => path.join(paths.buildDirectory, `.MacCursorCompat-${value}-${process.pid}.node`));
    const output = path.join(paths.buildDirectory, `.MacCursorCompat-${process.pid}.node`);
    try {
        for (let index = 0; index < architectures.length; index++) {
            run('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-fblocks', '-dynamiclib',
                '-undefined', 'dynamic_lookup', '-DNODE_GYP_MODULE_NAME=MacCursorCompat', `-DNAPI_VERSION=${NAPI_VERSION}`,
                '-arch', architectures[index] === 'x64' ? 'x86_64' : 'arm64', `-mmacosx-version-min=${MINIMUM_MACOS_VERSION}`,
                '-I', headers, paths.sourcePath, '-framework', 'AppKit', '-framework', 'QuartzCore', '-o', intermediates[index]],
            { cwd: projectRoot });
        }
        if (architectures.length > 1) run('xcrun', ['lipo', '-create', ...intermediates, '-output', output]);
        else fs.renameSync(intermediates[0], output);
        fs.renameSync(output, paths.outputPath);
        fs.writeFileSync(paths.manifestPath, JSON.stringify({ fingerprint, electronVersion, arch, napi: NAPI_VERSION }) + '\n');
    } finally {
        for (const file of [...intermediates, output]) fs.rmSync(file, { force: true });
    }
    return { skipped: false, cached: false, outputPath: paths.outputPath };
}

if (require.main === module) {
    try {
        const result = buildMacCursorCompat();
        console.log(result.skipped ? `[BookManager] ${result.reason}` : `[BookManager] macOS cursor helper ${result.cached ? 'is current' : 'built'}: ${result.outputPath}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { buildMacCursorCompat, createBuildPaths, MINIMUM_MACOS_VERSION };
