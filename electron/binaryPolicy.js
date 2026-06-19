import fs from 'fs';
import path from 'path';

const TOOL_ALIASES = {
    '7za': ['7za', '7z'],
    '7z': ['7z', '7za'],
    cwebp: ['cwebp'],
    pngquant: ['pngquant'],
    jpegtran: ['jpegtran'],
};

function executableName(name, platform) {
    return platform === 'win32' && !name.toLowerCase().endsWith('.exe')
        ? `${name}.exe`
        : name;
}

export function binaryCandidates(toolName, options = {}) {
    const platform = options.platform || process.platform;
    const aliases = TOOL_ALIASES[toolName] || [toolName];
    const roots = [
        options.resourcesPath,
        options.executableDir,
        options.projectRoot,
    ].filter(Boolean);
    const platformFolders = platform === 'win32'
        ? ['win', '']
        : platform === 'darwin'
            ? ['mac', 'darwin', '']
            : ['linux', ''];
    const candidates = [];

    for (const root of roots) {
        for (const folder of platformFolders) {
            for (const alias of aliases) {
                candidates.push(path.join(root, 'bin', folder, executableName(alias, platform)));
            }
        }
    }

    for (const directory of String(options.pathValue ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
        for (const alias of aliases) {
            candidates.push(path.join(directory, executableName(alias, platform)));
        }
    }

    if (platform !== 'win32') {
        for (const directory of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) {
            for (const alias of aliases) {
                candidates.push(path.join(directory, alias));
            }
        }
    }

    return [...new Set(candidates)];
}

export function findBinaryPath(toolName, options = {}) {
    for (const candidate of binaryCandidates(toolName, options)) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // 다음 후보를 확인합니다.
        }
    }
    return null;
}

export function missingBinaryMessage(toolName, platform = process.platform) {
    if (toolName === '7za' || toolName === '7z') {
        return platform === 'win32'
            ? '7-Zip 실행 파일을 찾을 수 없습니다. 앱의 bin/win/7za.exe를 확인하거나 7-Zip을 설치하세요.'
            : '7z 실행 파일을 찾을 수 없습니다. bundled 7z를 확인하거나 Homebrew 등으로 7-Zip을 설치하세요.';
    }
    return `${toolName} 실행 파일을 찾을 수 없습니다. 앱의 bundled 도구 또는 시스템 설치 상태를 확인하세요.`;
}
