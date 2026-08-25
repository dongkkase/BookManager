import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    buildFileAssociationHelper,
    createBuildCommands,
    createBuildPaths,
    formatCommand,
} = require('./buildFileAssociationHelper.cjs');

test('macOS 파일 연결 helper 빌드 경로를 프로젝트 루트 아래에 만든다', () => {
    const projectRoot = path.join(path.sep, 'workspace', 'BookManager');
    const paths = createBuildPaths(projectRoot);

    assert.equal(
        paths.sourcePath,
        path.join(projectRoot, 'electron', 'native', 'FileAssociationHelper.swift'),
    );
    assert.equal(
        paths.universalPath,
        path.join(projectRoot, 'bin', 'mac', 'universal', 'file-association-helper'),
    );
});

test('x64와 arm64 helper를 빌드한 뒤 universal binary로 결합한다', () => {
    const projectRoot = path.join(path.sep, 'workspace', 'BookManager');
    const paths = createBuildPaths(projectRoot);
    const commands = createBuildCommands(projectRoot);

    assert.equal(commands.length, 3);
    assert.equal(commands[0].command, 'swiftc');
    assert.equal(commands[0].args.includes('x86_64-apple-macosx12.0'), true);
    assert.equal(commands[0].args.at(-1), paths.x64Path);
    assert.equal(commands[1].command, 'swiftc');
    assert.equal(commands[1].args.includes('arm64-apple-macosx12.0'), true);
    assert.equal(commands[1].args.at(-1), paths.arm64Path);
    assert.deepEqual(commands[2], {
        command: 'lipo',
        args: [
            '-create',
            paths.x64Path,
            paths.arm64Path,
            '-output',
            paths.universalPath,
        ],
    });
});

test('macOS가 아니면 helper 빌드를 실행하지 않는다', () => {
    let spawnCount = 0;
    const result = buildFileAssociationHelper({
        platform: 'win32',
        spawnSyncImpl: () => {
            spawnCount += 1;
            return { status: 0 };
        },
    });

    assert.equal(result.skipped, true);
    assert.equal(spawnCount, 0);
});

test('macOS 빌드는 spawnSync에 인자 배열을 전달한다', () => {
    const projectRoot = path.join(path.sep, 'workspace', 'BookManager');
    const calls = [];
    const directories = [];
    const removedFiles = [];
    const result = buildFileAssociationHelper({
        platform: 'darwin',
        projectRoot,
        mkdirSyncImpl: (directory, options) => directories.push({ directory, options }),
        rmSyncImpl: (filePath, options) => removedFiles.push({ filePath, options }),
        spawnSyncImpl: (command, args, options) => {
            calls.push({ command, args, options });
            return { status: 0 };
        },
    });

    assert.equal(directories.length, 3);
    assert.equal(calls.length, 3);
    assert.equal(calls.every(call => Array.isArray(call.args)), true);
    assert.equal(calls.every(call => call.options.cwd === projectRoot), true);
    assert.deepEqual(removedFiles, [
        { filePath: createBuildPaths(projectRoot).universalPath, options: { force: true } },
        { filePath: createBuildPaths(projectRoot).x64Path, options: { force: true } },
        { filePath: createBuildPaths(projectRoot).arm64Path, options: { force: true } },
    ]);
    assert.equal(result.skipped, false);
    assert.equal(result.outputPath, createBuildPaths(projectRoot).universalPath);
});

test('빌드 실패에는 실패한 명령을 포함한다', () => {
    assert.throws(
        () => buildFileAssociationHelper({
            platform: 'darwin',
            projectRoot: path.join(path.sep, 'workspace', 'BookManager'),
            mkdirSyncImpl: () => {},
            spawnSyncImpl: () => ({ status: 7 }),
        }),
        /File association helper build failed \(7\): "swiftc"/,
    );

    assert.equal(formatCommand('swiftc', ['file with spaces.swift']), '"swiftc" "file with spaces.swift"');
});
