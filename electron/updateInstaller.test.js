import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    assertTargetDirectoryWritable,
    createWindowsUpdaterLaunchArgs,
    createWindowsUpdaterScript,
    findUpdateAsset,
    getPlatformUpdateSpec,
    isAllowedUpdateDownloadUrl,
    resolveCurrentMacAppPath,
    resolveUpdateTargetPath,
} from './updateInstaller.js';

test('플랫폼별 업데이트 압축 파일명을 선택한다', () => {
    assert.equal(getPlatformUpdateSpec('darwin').assetName, 'BookManager-mac.zip');
    assert.equal(getPlatformUpdateSpec('win32').assetName, 'BookManager-win.zip');
    assert.equal(getPlatformUpdateSpec('linux'), null);
});

test('현재 플랫폼에 맞는 릴리즈 asset만 선택한다', () => {
    const assets = [
        { name: 'BookManager-mac.zip', downloadUrl: 'https://example.com/mac.zip' },
        { name: 'BookManager-win.zip', downloadUrl: 'https://example.com/win.zip' },
    ];

    assert.equal(findUpdateAsset(assets, 'darwin').name, 'BookManager-mac.zip');
    assert.equal(findUpdateAsset(assets, 'win32').name, 'BookManager-win.zip');
    assert.equal(findUpdateAsset(assets, 'linux'), null);
});

test('업데이트 다운로드 URL은 BookManager GitHub 릴리즈 asset만 허용한다', () => {
    assert.equal(
        isAllowedUpdateDownloadUrl(
            'https://github.com/dongkkase/BookManager/releases/download/v1.0.1/BookManager-win.zip',
            'BookManager-win.zip',
        ),
        true,
    );
    assert.equal(
        isAllowedUpdateDownloadUrl(
            'https://github.com/dongkkase/BookManager/releases/download/v1.0.1/Other.zip',
            'BookManager-win.zip',
        ),
        false,
    );
    assert.equal(
        isAllowedUpdateDownloadUrl(
            'https://example.com/dongkkase/BookManager/releases/download/v1.0.1/BookManager-win.zip',
            'BookManager-win.zip',
        ),
        false,
    );
});

test('Windows portable 업데이트 대상은 원본 portable exe 환경변수를 우선한다', () => {
    assert.equal(
        resolveUpdateTargetPath({
            platform: 'win32',
            env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\BookManager.exe' },
            exePath: 'C:\\Temp\\bookmanager\\BookManager.exe',
        }),
        'D:\\Apps\\BookManager.exe',
    );
});

test('macOS 업데이트 대상은 실행 파일 경로에서 app 번들 루트를 찾는다', () => {
    assert.equal(
        resolveCurrentMacAppPath('/Applications/BookManager.app/Contents/MacOS/BookManager'),
        '/Applications/BookManager.app',
    );
    assert.equal(
        resolveUpdateTargetPath({
            platform: 'darwin',
            exePath: '/Users/me/BookManager.app/Contents/MacOS/BookManager',
        }),
        '/Users/me/BookManager.app',
    );
});

test('Windows 업데이트 대상 폴더는 종료 전에 쓰기 가능 여부를 확인한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-update-target-'));
    try {
        assert.doesNotThrow(() => assertTargetDirectoryWritable(path.join(tempDir, 'BookManager.exe'), {
            processId: 1234,
        }));
        assert.deepEqual(fs.readdirSync(tempDir), []);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows 업데이트 실행은 cmd start로 독립 PowerShell을 시작한다', () => {
    const args = createWindowsUpdaterLaunchArgs({
        scriptPath: 'C:\\Temp\\install-update.ps1',
        sourcePath: 'C:\\Temp\\BookManager.exe',
        targetPath: 'D:\\Apps\\BookManager.exe',
        logPath: 'C:\\Temp\\install-update.log',
        processId: 42,
    });

    assert.deepEqual(args.slice(0, 7), [
        '/d',
        '/s',
        '/c',
        'start',
        '',
        '/min',
        'powershell.exe',
    ]);
    assert.equal(args.includes('-LogPath'), true);
    assert.equal(args[args.indexOf('-TargetProcessId') + 1], '42');
});

test('Windows 교체 스크립트는 로그와 복사 검증을 남긴다', () => {
    const script = createWindowsUpdaterScript();

    assert.match(script, /\[string\]\$LogPath/);
    assert.match(script, /Write-UpdateLog "start pid=\$TargetProcessId/);
    assert.match(script, /Get-FileHash -LiteralPath \$FilePath -Algorithm SHA256/);
    assert.match(script, /copied file hash mismatch/);
    assert.match(script, /Start-Process -FilePath \$TargetPath/);
});
