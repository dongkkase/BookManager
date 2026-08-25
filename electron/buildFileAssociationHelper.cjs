const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER_NAME = 'file-association-helper';
const MINIMUM_MACOS_VERSION = '12.0';

function createBuildPaths(projectRoot) {
    const binaryRoot = path.join(projectRoot, 'bin', 'mac');
    return {
        sourcePath: path.join(projectRoot, 'electron', 'native', 'FileAssociationHelper.swift'),
        x64Directory: path.join(binaryRoot, 'x64'),
        x64Path: path.join(binaryRoot, 'x64', HELPER_NAME),
        arm64Directory: path.join(binaryRoot, 'arm64'),
        arm64Path: path.join(binaryRoot, 'arm64', HELPER_NAME),
        universalDirectory: path.join(binaryRoot, 'universal'),
        universalPath: path.join(binaryRoot, 'universal', HELPER_NAME),
    };
}

function createBuildCommands(projectRoot, options = {}) {
    const swiftCommand = options.swiftCommand || 'swiftc';
    const lipoCommand = options.lipoCommand || 'lipo';
    const paths = createBuildPaths(projectRoot);
    const commonSwiftArgs = [
        paths.sourcePath,
        '-framework',
        'AppKit',
        '-framework',
        'UniformTypeIdentifiers',
    ];

    return [
        {
            command: swiftCommand,
            args: [
                ...commonSwiftArgs,
                '-target',
                `x86_64-apple-macosx${MINIMUM_MACOS_VERSION}`,
                '-o',
                paths.x64Path,
            ],
        },
        {
            command: swiftCommand,
            args: [
                ...commonSwiftArgs,
                '-target',
                `arm64-apple-macosx${MINIMUM_MACOS_VERSION}`,
                '-o',
                paths.arm64Path,
            ],
        },
        {
            command: lipoCommand,
            args: [
                '-create',
                paths.x64Path,
                paths.arm64Path,
                '-output',
                paths.universalPath,
            ],
        },
    ];
}

function formatCommand(command, args) {
    return [command, ...args].map(value => JSON.stringify(value)).join(' ');
}

function buildFileAssociationHelper(options = {}) {
    const platform = options.platform || process.platform;
    if (platform !== 'darwin') {
        return {
            skipped: true,
            reason: 'The file association helper can only be built on macOS.',
        };
    }

    const projectRoot = options.projectRoot || path.join(__dirname, '..');
    const spawn = options.spawnSyncImpl || spawnSync;
    const makeDirectory = options.mkdirSyncImpl || fs.mkdirSync;
    const removeFile = options.rmSyncImpl || fs.rmSync;
    const paths = createBuildPaths(projectRoot);
    const commands = createBuildCommands(projectRoot, options);

    for (const directory of [
        paths.x64Directory,
        paths.arm64Directory,
        paths.universalDirectory,
    ]) {
        makeDirectory(directory, { recursive: true });
    }

    removeFile(paths.universalPath, { force: true });
    try {
        for (const command of commands) {
            const result = spawn(command.command, command.args, {
                cwd: projectRoot,
                stdio: 'inherit',
            });
            if (result.error) {
                throw result.error;
            }
            if (result.status !== 0) {
                throw new Error(
                    `File association helper build failed (${result.status}): ${formatCommand(command.command, command.args)}`,
                );
            }
        }
    } finally {
        removeFile(paths.x64Path, { force: true });
        removeFile(paths.arm64Path, { force: true });
    }

    return {
        skipped: false,
        outputPath: paths.universalPath,
    };
}

if (require.main === module) {
    try {
        const result = buildFileAssociationHelper();
        if (result.skipped) {
            console.log(`[BookManager] ${result.reason}`);
        } else {
            console.log(`[BookManager] Built ${result.outputPath}`);
        }
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

module.exports = {
    HELPER_NAME,
    MINIMUM_MACOS_VERSION,
    buildFileAssociationHelper,
    createBuildCommands,
    createBuildPaths,
    formatCommand,
};
