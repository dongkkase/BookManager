import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createFileAssociationManager,
    parseMacOSVersion,
    resolveAssociationExecutablePath,
    resolveMacApplicationPath,
    resolveMacFileAssociationHelperPath,
    supportsMacFileAssociations,
} from './fileAssociations.js';

test('macOS system version을 숫자 구성 요소로 파싱한다', () => {
    assert.deepEqual(parseMacOSVersion('12'), { major: 12, minor: 0, patch: 0 });
    assert.deepEqual(parseMacOSVersion(' 14.6.1 '), { major: 14, minor: 6, patch: 1 });
    assert.equal(parseMacOSVersion('Version 14.6'), null);
    assert.equal(parseMacOSVersion(''), null);
});

test('macOS 12 이상에서만 파일 연결 helper를 지원한다', () => {
    assert.equal(supportsMacFileAssociations('11.7.10'), false);
    assert.equal(supportsMacFileAssociations('12.0'), true);
    assert.equal(supportsMacFileAssociations('15.1.2'), true);
    assert.equal(supportsMacFileAssociations(undefined), false);
});

test('portable Windows registration uses the outer executable path', () => {
    assert.equal(resolveAssociationExecutablePath({
        platform: 'win32',
        env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\BookManager.exe' },
        executablePath: 'C:\\Temp\\bookmanager.exe',
    }), 'D:\\Apps\\BookManager.exe');
});

test('macOS app and helper paths resolve inside the packaged bundle', () => {
    assert.equal(
        resolveMacApplicationPath('/Applications/BookManager.app/Contents/MacOS/BookManager'),
        '/Applications/BookManager.app',
    );
    assert.equal(resolveMacFileAssociationHelperPath({
        isPackaged: true,
        resourcesPath: '/Applications/BookManager.app/Contents/Resources',
    }), '/Applications/BookManager.app/Contents/Resources/bin/mac/universal/file-association-helper');
});

test('unpackaged apps report file associations as unsupported', async () => {
    const manager = createFileAssociationManager({
        platform: 'darwin',
        isPackaged: false,
    });
    const status = await manager.getStatus();
    assert.equal(status.supported, false);
    assert.equal(status.reason, 'packaged-app-required');
    assert.equal(status.associations.length, 28);
});

test('unsupported platforms keep the extension inventory visible', async () => {
    const manager = createFileAssociationManager({
        platform: 'linux',
        isPackaged: true,
    });
    const status = await manager.getStatus();
    assert.equal(status.supported, false);
    assert.equal(status.associations.some(item => item.extension === '.cbz'), true);
});

test('macOS 12 미만에서는 helper 실행과 설정 열기를 안전하게 차단한다', async () => {
    let helperCallCount = 0;
    const manager = createFileAssociationManager({
        platform: 'darwin',
        systemVersion: '11.7.10',
        isPackaged: true,
        executablePath: '/Applications/BookManager.app/Contents/MacOS/BookManager',
        resourcesPath: '/Applications/BookManager.app/Contents/Resources',
        existsSync: () => true,
        execFile: () => {
            helperCallCount += 1;
        },
    });

    const status = await manager.getStatus();
    assert.equal(status.supported, false);
    assert.equal(status.reason, 'macos-12-required');
    assert.equal(status.associations.length, 28);
    assert.deepEqual(await manager.apply(['.cbz']), {
        success: false,
        reason: 'macos-12-required',
    });
    assert.deepEqual(await manager.openSettings(), {
        success: false,
        reason: 'macos-12-required',
    });
    assert.equal(helperCallCount, 0);
});

test('macOS apply exposes an extension-level helper error message', async () => {
    const helperPath = '/Applications/BookManager.app/Contents/Resources/bin/mac/universal/file-association-helper';
    const manager = createFileAssociationManager({
        platform: 'darwin',
        systemVersion: '14.6.1',
        isPackaged: true,
        executablePath: '/Applications/BookManager.app/Contents/MacOS/BookManager',
        resourcesPath: '/Applications/BookManager.app/Contents/Resources',
        existsSync: filePath => filePath === helperPath,
        execFile: (_file, _args, _options, callback) => callback(
            Object.assign(new Error('helper failed'), {
                stdout: JSON.stringify({
                    ok: false,
                    results: [{
                        extension: '.cbz',
                        isDefault: false,
                        error: {
                            code: 'apply_failed',
                            message: 'User denied the change.',
                        },
                    }],
                    error: null,
                }),
            }),
            '',
            '',
        ),
    });

    const result = await manager.apply(['.cbz']);
    assert.equal(result.success, false);
    assert.equal(result.error, 'User denied the change.');
});
