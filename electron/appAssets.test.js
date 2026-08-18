import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createSingleFileZip } = require('./zipWindowsPortable.cjs');
const afterPackHook = require('./afterPack.cjs');
const packageConfig = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);

function readPngSize(filePath) {
    const data = fs.readFileSync(filePath);
    assert.deepEqual([...data.subarray(1, 4)], [80, 78, 71]);
    return {
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
    };
}

function readZipEntryNames(filePath) {
    const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const data = fs.readFileSync(filePath);
    const names = [];
    let offset = 0;
    while ((offset = data.indexOf(signature, offset)) !== -1) {
        const nameLength = data.readUInt16LE(offset + 28);
        const extraLength = data.readUInt16LE(offset + 30);
        const commentLength = data.readUInt16LE(offset + 32);
        const nameStart = offset + 46;
        names.push(data.toString('utf8', nameStart, nameStart + nameLength));
        offset = nameStart + nameLength + extraLength + commentLength;
    }
    return names;
}

test('macOS 고해상도 앱 아이콘은 1024px 정사각형이다', () => {
    const iconPath = path.join(projectRoot, packageConfig.build.mac.icon);
    assert.deepEqual(readPngSize(iconPath), { width: 1024, height: 1024 });
});

test('macOS 배포본은 고정 파일명의 universal ZIP이다', () => {
    assert.deepEqual(packageConfig.build.mac.target, [{
        target: 'zip',
        arch: ['universal'],
    }]);
    assert.equal(
        packageConfig.build.mac.artifactName,
        'BookManager-mac.${ext}',
    );
});

test('macOS 배포본은 Developer ID 서명과 공증 설정을 사용한다', () => {
    assert.equal(packageConfig.devDependencies['@electron/notarize'], '^2.2.1');
    assert.equal(packageConfig.build.afterSign, 'electron/notarize.cjs');
    assert.equal(packageConfig.build.mac.hardenedRuntime, true);
    assert.equal(packageConfig.build.mac.gatekeeperAssess, false);
    assert.equal(packageConfig.build.mac.entitlements, 'electron/entitlements.mac.plist');
    assert.equal(packageConfig.build.mac.entitlementsInherit, 'electron/entitlements.mac.plist');

    const entitlements = fs.readFileSync(path.join(projectRoot, 'electron', 'entitlements.mac.plist'), 'utf8');
    const notarizeSource = fs.readFileSync(path.join(projectRoot, 'electron', 'notarize.cjs'), 'utf8');

    assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
    assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
    assert.match(notarizeSource, /@electron\/notarize/);
    assert.match(notarizeSource, /APPLE_API_KEY/);
    assert.match(notarizeSource, /APPLE_APP_SPECIFIC_PASSWORD/);
    assert.match(notarizeSource, /APPLE_KEYCHAIN_PROFILE/);
});

test('macOS 배포본은 bundled 7za 리소스를 포함한다', () => {
    assert.equal(packageConfig.devDependencies['7zip-bin'], '^5.2.0');
    assert.equal(packageConfig.build.afterPack, 'electron/afterPack.cjs');
    assert.deepEqual(afterPackHook.MAC_7ZA_RELATIVE_PATHS, [
        path.join('Contents', 'Resources', 'bin', 'mac', 'x64', '7za'),
        path.join('Contents', 'Resources', 'bin', 'mac', 'arm64', '7za'),
    ]);
});

test('macOS afterPack은 bundled 7za를 복사하고 실행 권한을 보정한다', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-afterpack-'));
    try {
        const projectDir = path.join(tempDir, 'project');
        const appOutDir = path.join(tempDir, 'out');
        const appRoot = path.join(appOutDir, 'BookManager.app');
        for (const relativePath of afterPackHook.MAC_7ZA_RELATIVE_PATHS) {
            const arch = path.basename(path.dirname(relativePath));
            const sourcePath = path.join(projectDir, 'node_modules', '7zip-bin', 'mac', arch, '7za');
            fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
            fs.writeFileSync(sourcePath, `7za ${arch}`);
            fs.chmodSync(sourcePath, 0o644);
        }

        await afterPackHook.afterPack({
            electronPlatformName: 'darwin',
            appOutDir,
            packager: {
                projectDir,
                appInfo: {
                    productFilename: 'BookManager',
                },
            },
        });

        for (const relativePath of afterPackHook.MAC_7ZA_RELATIVE_PATHS) {
            const destinationPath = path.join(appRoot, relativePath);
            const mode = fs.statSync(destinationPath).mode;
            assert.equal(fs.readFileSync(destinationPath, 'utf8'), `7za ${path.basename(path.dirname(relativePath))}`);
            assert.equal((mode & 0o111) !== 0, true);
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('macOS universal 임시 앱 afterPack에서는 bundled 7za를 복사하지 않는다', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-afterpack-temp-'));
    try {
        await afterPackHook.afterPack({
            electronPlatformName: 'darwin',
            appOutDir: path.join(tempDir, 'mac-universal-x64-temp'),
            packager: {
                projectDir: tempDir,
                appInfo: {
                    productFilename: 'BookManager',
                },
            },
        });
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows 배포본은 portable exe를 단일 파일 ZIP으로 감싼다', () => {
    assert.deepEqual(packageConfig.build.win.target, [{
        target: 'portable',
        arch: ['x64'],
    }]);
    assert.equal(
        packageConfig.build.win.artifactName,
        'BookManager.exe',
    );
    assert.equal(packageConfig.build.win.signAndEditExecutable, true);
    assert.equal(packageConfig.build.afterAllArtifactBuild, 'electron/zipWindowsPortable.cjs');
});

test('Windows 배포 ZIP에는 BookManager.exe만 포함한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-zip-'));
    try {
        const exePath = path.join(tempDir, 'BookManager.exe');
        const zipPath = path.join(tempDir, 'BookManager-win.zip');
        fs.writeFileSync(exePath, 'portable executable placeholder');
        createSingleFileZip(exePath, zipPath, 'BookManager.exe');

        assert.deepEqual(readZipEntryNames(zipPath), ['BookManager.exe']);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows 빌드와 런타임은 ICO 앱 아이콘을 사용한다', () => {
    const iconPath = path.join(projectRoot, packageConfig.build.win.icon);
    const data = fs.readFileSync(iconPath);

    assert.equal(data.readUInt16LE(0), 0);
    assert.equal(data.readUInt16LE(2), 1);
    assert.equal(path.extname(iconPath), '.ico');
    assert.equal(packageConfig.build.win.signAndEditExecutable, true);
});

test('앱 번들 이름과 식별자는 BookManager 정책을 사용한다', () => {
    assert.equal(packageConfig.build.productName, 'BookManager');
    assert.equal(packageConfig.build.executableName, 'BookManager');
    assert.equal(packageConfig.build.appId, 'com.bookmanager.app');
});

test('Electron 메인 프로세스가 직접 import하는 src 모듈은 app.asar 패키징 대상에 포함한다', () => {
    const utilsFileSet = packageConfig.build.files.find(item => (
        typeof item === 'object'
        && item.from === 'src/utils'
        && item.to === 'src/utils'
    ));
    const metadataFileSet = packageConfig.build.files.find(item => (
        typeof item === 'object'
        && item.from === 'src/metadata'
        && item.to === 'src/metadata'
    ));
    const folderTagFileSet = packageConfig.build.files.find(item => (
        typeof item === 'object'
        && item.from === 'src'
        && item.to === 'src'
    ));

    assert.ok(utilsFileSet);
    assert.equal(utilsFileSet.filter.includes('i18n.js'), true);
    assert.equal(utilsFileSet.filter.includes('i18nData.js'), true);
    assert.equal(utilsFileSet.filter.includes('folderUtils.js'), true);
    assert.ok(metadataFileSet);
    assert.equal(metadataFileSet.filter.includes('metadataTypes.js'), true);
    assert.ok(folderTagFileSet);
    assert.equal(folderTagFileSet.filter.includes('folderTagFilter.js'), true);
});

test('Electron 진입점은 콘솔 파이프 가드를 먼저 설치한다', () => {
    assert.equal(packageConfig.main, 'electron/bootstrap.js');

    const bootstrapSource = fs.readFileSync(path.join(projectRoot, 'electron', 'bootstrap.js'), 'utf8');

    assert.match(bootstrapSource, /installConsolePipeGuard\(\)/);
    assert.match(bootstrapSource, /await import\('\.\/main\.js'\)/);
});

test('Node 테스트는 Electron ABI를 유지한 런타임에서 실행한다', () => {
    const testRunnerSource = fs.readFileSync(path.join(projectRoot, 'electron', 'runNodeTests.cjs'), 'utf8');
    const testPreloadSource = fs.readFileSync(
        path.join(projectRoot, 'electron', 'testElectronPackagePreload.cjs'),
        'utf8',
    );

    assert.equal(packageConfig.scripts.test, 'node electron/runNodeTests.cjs');
    assert.equal(packageConfig.scripts['node:rebuild'], undefined);
    assert.equal(packageConfig.scripts.postinstall, 'electron-builder install-app-deps');
    assert.match(packageConfig.scripts['electron:rebuild'], /electron-builder install-app-deps/);
    assert.match(testRunnerSource, /const electronCommand = require\('electron'\)/);
    assert.match(testRunnerSource, /ELECTRON_RUN_AS_NODE: '1'/);
    assert.match(testRunnerSource, /new Database\(':memory:'\)/);
    assert.match(testRunnerSource, /if \(!electronNativeDependenciesAreReady\(\)\)/);
    assert.match(testRunnerSource, /run\(npmCommand, \['run', 'electron:rebuild'\]\)/);
    assert.doesNotMatch(testRunnerSource, /\['run', 'node:rebuild'\]/);
    assert.match(
        testRunnerSource,
        /\['--require', testElectronPackagePreloadPath, '--test', \.\.\.testArgs\]/,
    );
    assert.match(testPreloadSource, /require\(require\.resolve\('electron'\)\)/);
    assert.match(testPreloadSource, /request === 'electron'/);
    assert.match(testPreloadSource, /Reflect\.apply\(originalLoad/);
});

test('Electron 개발 실행은 ELECTRON_RUN_AS_NODE를 제거한 런처를 사용한다', () => {
    const devScript = packageConfig.scripts['electron:dev'];
    const rebuildDevScript = packageConfig.scripts['electron:dev:rebuild'];
    const unsafeDevScript = packageConfig.scripts['electron:dev:unsafe'];
    const unsafeRebuildDevScript = packageConfig.scripts['electron:dev:unsafe:rebuild'];
    const devRunnerSource = fs.readFileSync(path.join(projectRoot, 'electron', 'runElectronDev.cjs'), 'utf8');
    const launcherSource = fs.readFileSync(path.join(projectRoot, 'electron', 'launchElectronDev.cjs'), 'utf8');
    const fastDevScript = packageConfig.scripts['electron:dev:fast'];
    const watchLauncherSource = fs.readFileSync(path.join(projectRoot, 'electron', 'launchElectronWatch.cjs'), 'utf8');
    const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');

    assert.doesNotMatch(devScript, /npm run electron:rebuild/);
    assert.match(devScript, /node electron\/runElectronDev\.cjs --dist-watch/);
    assert.doesNotMatch(devScript, /wait-on/);
    assert.doesNotMatch(devScript, /&& electron \. --dev/);
    assert.match(rebuildDevScript, /npm run electron:rebuild/);
    assert.match(rebuildDevScript, /npm run electron:dev/);
    assert.match(unsafeDevScript, /node electron\/runElectronDev\.cjs --dist-watch --unsafe-dev-node/);
    assert.doesNotMatch(unsafeDevScript, /wait-on/);
    assert.doesNotMatch(unsafeDevScript, /npm run electron:rebuild/);
    assert.match(unsafeRebuildDevScript, /npm run electron:rebuild/);
    assert.match(unsafeRebuildDevScript, /npm run electron:dev:unsafe/);
    assert.match(devRunnerSource, /useDistWatch/);
    assert.match(devRunnerSource, /startDistWatch/);
    assert.match(devRunnerSource, /build\(\{/);
    assert.match(devRunnerSource, /BOOKMANAGER_DEV_LOAD_DIST/);
    assert.match(devRunnerSource, /restartElectron/);
    assert.match(devRunnerSource, /closeBuildWatcher/);
    assert.match(devRunnerSource, /fs\.watch\(electronSourceDir,\s*\{\s*recursive:\s*true\s*\}/);
    assert.match(devRunnerSource, /isElectronRuntimeSource/);
    assert.match(devRunnerSource, /scheduleElectronRestart/);
    assert.match(devRunnerSource, /closeElectronSourceWatcher/);
    assert.match(devRunnerSource, /electronSourceWatcher\.on\('error'/);
    assert.match(devRunnerSource, /createServer/);
    assert.match(devRunnerSource, /await viteServer\.listen\(\)/);
    assert.match(devRunnerSource, /viteServer\.printUrls\(\)/);
    assert.match(devRunnerSource, /strictPort:\s*false/);
    assert.match(devRunnerSource, /Cache-Control':\s*'no-store'/);
    assert.match(devRunnerSource, /resolveActiveDevServerUrl/);
    assert.match(devRunnerSource, /BOOKMANAGER_DEV_SERVER_URL:\s*activeDevServerUrl\.href/);
    assert.match(devRunnerSource, /stopExistingDevElectronInstances/);
    assert.match(devRunnerSource, /BOOKMANAGER_DEV_ELECTRON_PATH/);
    assert.match(devRunnerSource, /Get-CimInstance Win32_Process/);
    assert.match(devRunnerSource, /taskkill\.exe/);
    assert.match(devRunnerSource, /await server\.close\(\)/);
    assert.doesNotMatch(devRunnerSource, /http\.get\(devServerUrl/);
    assert.doesNotMatch(devRunnerSource, /shell:\s*process\.platform === 'win32'/);
    assert.match(devRunnerSource, /startElectron\(\)/);
    assert.match(devRunnerSource, /launchElectronDev\.cjs/);
    assert.match(launcherSource, /delete env\.ELECTRON_RUN_AS_NODE/);
    assert.match(launcherSource, /BOOKMANAGER_DEV_SERVER_URL/);
    assert.match(launcherSource, /BOOKMANAGER_UNSAFE_DEV_NODE/);
    assert.match(launcherSource, /electronArgs = \['\.',\s*'--dev'\]/);
    assert.match(launcherSource, /electronArgs\.push\('--unsafe-dev-node'\)/);
    assert.match(launcherSource, /spawn\(electron,\s*electronArgs/);
    assert.match(launcherSource, /process\.on\('SIGINT',\s*\(\)\s*=>\s*shutdown\('SIGINT'\)\)/);
    assert.match(launcherSource, /process\.on\('SIGTERM',\s*\(\)\s*=>\s*shutdown\('SIGTERM'\)\)/);
    assert.match(launcherSource, /child\.kill\(signal\)/);
    assert.match(mainSource, /useUnsafeDevNodeIntegration = isDev/);
    assert.match(mainSource, /BOOKMANAGER_DEV_LOAD_DIST/);
    assert.match(mainSource, /useDevServer/);
    assert.match(mainSource, /DEV_SERVER_URL/);
    assert.match(mainSource, /loadURL\(DEV_SERVER_URL\)/);
    assert.match(mainSource, /loadFile\(DIST_INDEX_PATH\)/);
    assert.match(mainSource, /Main window loaded\./);
    assert.match(mainSource, /mainWindow\.show\(\)/);
    assert.match(mainSource, /mainWindow\.focus\(\)/);
    assert.match(mainSource, /contextIsolation:\s*!useUnsafeDevNodeIntegration/);
    assert.match(mainSource, /nodeIntegration:\s*useUnsafeDevNodeIntegration/);
    assert.match(fastDevScript, /vite build --watch/);
    assert.match(fastDevScript, /node electron\/launchElectronWatch\.cjs/);
    assert.match(watchLauncherSource, /delete env\.ELECTRON_RUN_AS_NODE/);
    assert.match(watchLauncherSource, /BOOKMANAGER_DEV_LOAD_DIST/);
    assert.match(watchLauncherSource, /fs\.watch\(distDir,\s*\{\s*recursive:\s*true\s*\}/);
    assert.match(watchLauncherSource, /spawn\(electron,\s*\['\.',\s*'--dev'\]/);
});

test('macOS 메뉴 막대 아이콘은 16px 템플릿 이미지로 생성한다', () => {
    const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');

    assert.match(mainSource, /nativeImage\.createFromPath\(iconPath\)\.resize\(\{/);
    assert.match(mainSource, /width:\s*16/);
    assert.match(mainSource, /height:\s*16/);
    assert.match(mainSource, /setTemplateImage\(true\)/);
    assert.match(mainSource, /new Tray\(trayIcon\)/);
});

test('저장된 썸네일은 제한된 전용 프로토콜로 제공한다', () => {
    const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');

    assert.match(mainSource, /protocol\.registerSchemesAsPrivileged/);
    assert.match(mainSource, /protocol\.handle\('bookmanager-thumbnail'/);
    assert.match(mainSource, /resolveThumbnailDir\(getExecutableDir\(\)\)/);
    assert.match(mainSource, /path\.basename\(requestedName\) !== requestedName/);
});

test('렌더러 CSP는 전용 썸네일 프로토콜 이미지를 허용한다', () => {
    const indexSource = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

    assert.match(indexSource, /script-src[^;]*'unsafe-inline'/);
    assert.match(indexSource, /connect-src[^;]*ws:\/\/127\.0\.0\.1:\*/);
    assert.match(indexSource, /connect-src[^;]*ws:\/\/localhost:\*/);
    assert.match(indexSource, /img-src[^;]*bookmanager-thumbnail:/);
    assert.match(indexSource, /img-src[^;]*bookmanager-comic:/);
    assert.match(indexSource, /img-src[^;]*bookmanager-document:/);
});
