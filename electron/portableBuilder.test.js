import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { collectRuntimeFiles, createValidationMacros, escapeNsis, installPortableBuilderAdapter, prepareDefines } = require('./portable/builderAdapter.cjs');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bitmap = path.join(projectRoot, 'electron/portable/splash.bmp');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-portable-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test('runtime identity follows embedded bytes, including same-version rebuilds and architecture', () => {
    const first = prepareDefines({ SPLASH_IMAGE: bitmap, APP_64: 'first.7z', APP_64_HASH: 'A'.repeat(128) });
    const second = prepareDefines({ SPLASH_IMAGE: bitmap, APP_64: 'second.7z', APP_64_HASH: 'B'.repeat(128) });
    const arm = prepareDefines({ SPLASH_IMAGE: bitmap, APP_ARM64: 'arm.7z', APP_ARM64_HASH: 'A'.repeat(128) });
    assert.notEqual(first.BM_RUNTIME_ID_64, second.BM_RUNTIME_ID_64);
    assert.notEqual(first.BM_RUNTIME_ID_64, arm.BM_RUNTIME_ID_ARM64);
    assert.match(first.BM_RUNTIME_ID_64, /^[a-f0-9]{32}-64$/u);
    assert.throws(() => prepareDefines({ SPLASH_IMAGE: bitmap, APP_64: 'app.7z' }), /SHA-512/u);
    assert.throws(() => prepareDefines({ SPLASH_IMAGE: bitmap, APP_DIR_64: 'runtime' }), /embedded 7z/u);
});

test('manifest includes nested and Unicode files, escapes NSIS input, and rejects links', t => {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, 'resources'));
    fs.writeFileSync(path.join(root, 'BookManager.exe'), 'executable');
    fs.writeFileSync(path.join(root, 'resources', '한글 $file.txt'), 'data');
    const files = collectRuntimeFiles(root);
    assert.deepEqual(files, [{ path: 'BookManager.exe', size: 10 }, { path: 'resources\\한글 $file.txt', size: 4 }]);
    assert.match(createValidationMacros(new Map([[1, root]])), /resources\\한글 \$\$file.txt/u);
    assert.equal(escapeNsis('a"b'), 'a$\\"b');
    assert.throws(() => escapeNsis('bad\npath'), /Invalid/u);
    if (process.platform !== 'win32') {
        fs.symlinkSync(path.join(root, 'BookManager.exe'), path.join(root, 'linked.exe'));
        assert.throws(() => collectRuntimeFiles(root), /links/u);
    }
});

test('builder adapter replaces only the verified portable template and never edits the dependency', async t => {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, 'BookManager.exe'), 'fixture');
    const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
    const upstreamPath = require.resolve('app-builder-lib/templates/nsis/portable.nsi');
    const before = fs.readFileSync(upstreamPath, 'utf8');
    installPortableBuilderAdapter();
    installPortableBuilderAdapter();
    const target = Object.create(NsisTarget.prototype);
    target.name = 'portable';
    target.options = {};
    target.packager = { info: { cancellationToken: { cancelled: false } }, getResource: async () => null, resourceList: Promise.resolve([]) };
    const script = await target.computeFinalScript(before, true, new Map([[1, root]]));
    assert.match(script, /BOOKMANAGER_PERSISTENT_PORTABLE/u);
    assert.match(script, /BM_CheckFile "BookManager.exe" 7/u);
    await assert.rejects(target.computeFinalScript('unexpected upstream script', true, new Map()), /Unexpected upstream/u);
    assert.equal(fs.readFileSync(upstreamPath, 'utf8'), before);
});

test('the configured artifact hook installs the adapter without wrapper preloading', t => {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, 'BookManager.exe'), 'fixture');
    const program = `
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        const { Packager } = require('app-builder-lib/out/packager.js');
        const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
        const packageConfig = require('./package.json');
        const original = NsisTarget.prototype.computeFinalScript;
        const info = { appInfo: { type: packageConfig.type }, config: packageConfig.build };
        (async () => {
            await Packager.prototype.callArtifactBuildStarted.call(info, { targetPresentableName: 'zip', file: 'fixture.zip' });
            assert.equal(NsisTarget.prototype.computeFinalScript, original);
            await Packager.prototype.callArtifactBuildStarted.call(info, { targetPresentableName: 'portable', file: 'fixture.exe' });
            assert.notEqual(NsisTarget.prototype.computeFinalScript, original);
            const target = Object.create(NsisTarget.prototype);
            target.name = 'portable';
            target.options = {};
            target.packager = { info: { cancellationToken: { cancelled: false } }, getResource: async () => null, resourceList: Promise.resolve([]) };
            const upstream = fs.readFileSync(require.resolve('app-builder-lib/templates/nsis/portable.nsi'), 'utf8');
            const script = await target.computeFinalScript(upstream, true, new Map([[1, process.argv[2]]]));
            assert.ok(script.includes('BOOKMANAGER_PERSISTENT_PORTABLE'));
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['--input-type=commonjs', '-', root], {
        cwd: projectRoot,
        input: program,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('splash bitmap is a bottom-up 700 by 300 uncompressed image for Windows LoadImage', () => {
    const data = fs.readFileSync(bitmap);
    assert.equal(data.toString('ascii', 0, 2), 'BM');
    assert.equal(data.readInt32LE(18), 700);
    assert.equal(data.readInt32LE(22), 300);
    assert.equal(data.readUInt16LE(28), 24);
    assert.equal(data.readUInt32LE(30), 0);
});

test('portable builds reject top-down, incompatible, and truncated splash bitmaps', t => {
    const root = fixture(t);
    const original = fs.readFileSync(bitmap);
    const invalidPath = path.join(root, 'invalid.bmp');
    const cases = [
        data => { data.writeInt32LE(-300, 22); return data; },
        data => { data.writeInt32LE(699, 18); return data; },
        data => { data.writeUInt16LE(32, 28); return data; },
        data => { data.writeUInt32LE(1, 30); return data; },
        data => data.subarray(0, data.length - 1),
    ];
    for (const mutate of cases) {
        fs.writeFileSync(invalidPath, mutate(Buffer.from(original)));
        assert.throws(() => prepareDefines({
            SPLASH_IMAGE: invalidPath,
            APP_64: 'app.7z',
            APP_64_HASH: 'A'.repeat(128),
        }), /700x300 bottom-up 24-bit uncompressed BMP/u);
    }
});

test('portable launcher compiles with the real NSIS toolchain and a small fixture payload', { skip: process.env.BOOKMANAGER_NSIS_TESTS !== '1' }, async t => {
    const root = fixture(t);
    const runtime = path.join(root, 'runtime');
    fs.mkdirSync(path.join(runtime, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(runtime, 'BookManager.exe'), 'fixture executable');
    fs.writeFileSync(path.join(runtime, 'resources', "한글 $file's.txt"), 'fixture resource');
    const archive = path.join(root, 'app.7z');
    const result = spawnSync(require('7zip-bin').path7za, ['a', '-t7z', archive, '.'], { cwd: runtime, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const nsisRoot = process.env.ELECTRON_BUILDER_NSIS_DIR || path.join(projectRoot, '.electron-builder-cache/nsis/nsis-3.0.4.1');
    const cacheRoot = process.env.ELECTRON_BUILDER_CACHE || path.dirname(path.dirname(nsisRoot));
    assert.ok(fs.existsSync(path.join(cacheRoot, 'nsis/nsis-resources-3.4.1/plugins/x86-unicode')), 'The NSIS resource cache must exist before running this offline compile test.');
    const previousNsis = process.env.ELECTRON_BUILDER_NSIS_DIR;
    const previousCache = process.env.ELECTRON_BUILDER_CACHE;
    process.env.ELECTRON_BUILDER_NSIS_DIR = nsisRoot;
    process.env.ELECTRON_BUILDER_CACHE = cacheRoot;
    t.after(() => {
        if (previousNsis === undefined) delete process.env.ELECTRON_BUILDER_NSIS_DIR;
        else process.env.ELECTRON_BUILDER_NSIS_DIR = previousNsis;
        if (previousCache === undefined) delete process.env.ELECTRON_BUILDER_CACHE;
        else process.env.ELECTRON_BUILDER_CACHE = previousCache;
    });
    installPortableBuilderAdapter();
    const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
    const target = Object.create(NsisTarget.prototype);
    target.name = 'portable';
    target.options = {};
    target.packager = {
        info: { cancellationToken: { cancelled: false }, buildResourcesDir: path.join(root, 'build') },
        getResource: async () => null,
        getTempFile: async name => path.join(root, `builder-${name}`),
        resourceList: Promise.resolve([]),
        debugLogger: { isEnabled: false },
    };
    const upstreamPath = require.resolve('app-builder-lib/templates/nsis/portable.nsi');
    const header = await target.computeCommonInstallerScriptHeader();
    const script = await target.computeFinalScript(fs.readFileSync(upstreamPath, 'utf8'), true, new Map([[1, runtime]]));
    await target.executeMakensis({
        PRODUCT_NAME: 'BookManager', PRODUCT_FILENAME: 'BookManager', APP_FILENAME: 'BookManager',
        VERSION: '1.0.0', REQUEST_EXECUTION_LEVEL: 'user', SPLASH_IMAGE: bitmap,
        APP_64: archive, APP_64_HASH: createHash('sha512').update(fs.readFileSync(archive)).digest('hex').toUpperCase(),
    }, { Unicode: 'true', OutFile: `"${path.join(root, 'BookManager.exe')}"`, SetCompressor: 'zlib' }, `${header}\n${script}`);
    assert.ok(fs.statSync(path.join(root, 'BookManager.exe')).size > 0);

    // Exercise a fresh direct CLI process, which skips beforePack for --prepackaged.
    const outputDir = path.join(root, 'direct-cli');
    const cliResult = spawnSync(process.execPath, [
        require.resolve('electron-builder/out/cli/cli.js'),
        '--win', '--prepackaged', runtime, '--publish', 'never',
        '--config.win.signAndEditExecutable=false',
        '--config.compression=store',
        `--config.directories.output=${outputDir}`,
    ], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, NODE_OPTIONS: '', CSC_IDENTITY_AUTO_DISCOVERY: 'false', DEBUG: 'electron-builder' },
    });
    assert.equal(cliResult.status, 0, `${cliResult.stdout}\n${cliResult.stderr}`);
    const debugInfo = require('js-yaml').load(fs.readFileSync(path.join(outputDir, 'builder-debug.yml'), 'utf8'));
    assert.match(debugInfo.nsis.script, /BOOKMANAGER_PERSISTENT_PORTABLE/u);
    assert.match(debugInfo.nsis.script, /BOOKMANAGER_STARTUP_READY_FILE/u);
    assert.doesNotMatch(debugInfo.nsis.script, /BgImage::SetBg/u);
    assert.ok(fs.statSync(path.join(outputDir, 'BookManager.exe')).size > 0);
});
