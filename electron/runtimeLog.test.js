import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    createBoundedLogWriter,
    resolveRuntimeLogPaths,
} from './utils/runtimeLog.js';

const root = path.dirname(fileURLToPath(import.meta.url));

test('Windows portable 런타임 로그는 원본 EXE 옆 BookManagerData/logs에 저장한다', () => {
    const portableDir = path.join('D:\\Apps', 'BookManager');
    const paths = resolveRuntimeLogPaths(
        path.join(os.tmpdir(), 'portable-extract'),
        'win32',
        { PORTABLE_EXECUTABLE_DIR: portableDir },
    );

    assert.equal(paths.logDir, path.join(portableDir, 'BookManagerData', 'logs'));
    assert.equal(paths.activePath, path.join(paths.logDir, 'runtime.log'));
    assert.equal(paths.previousPath, path.join(paths.logDir, 'runtime.previous.log'));
});

test('런타임 로그는 현재 파일과 이전 파일의 합계 용량을 제한한다', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-runtime-log-'));
    const logDir = path.join(tempDir, 'logs');
    const paths = {
        logDir,
        activePath: path.join(logDir, 'runtime.log'),
        previousPath: path.join(logDir, 'runtime.previous.log'),
    };

    try {
        const writer = createBoundedLogWriter({ paths, maxFileBytes: 1024 });
        writer.write(Buffer.alloc(900, 'a'));
        writer.write(Buffer.alloc(900, 'b'));
        writer.write(Buffer.alloc(900, 'c'));
        writer.close();

        const active = fs.readFileSync(paths.activePath);
        const previous = fs.readFileSync(paths.previousPath);
        assert.equal(active.length, 900);
        assert.equal(previous.length, 900);
        assert.equal(active.every(byte => byte === 'c'.charCodeAt(0)), true);
        assert.equal(previous.every(byte => byte === 'b'.charCodeAt(0)), true);
        assert.equal(active.length + previous.length <= 2048, true);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('패키징 부트스트랩은 console pipe guard보다 먼저 런타임 로그를 설치한다', () => {
    const source = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');
    const runtimeInstallIndex = source.indexOf('installRuntimeLogging({');
    const pipeGuardInstallIndex = source.indexOf('installConsolePipeGuard();');

    assert.notEqual(runtimeInstallIndex, -1);
    assert.notEqual(pipeGuardInstallIndex, -1);
    assert.equal(runtimeInstallIndex < pipeGuardInstallIndex, true);
    assert.match(source, /enabled:\s*app\.isPackaged/);
});
