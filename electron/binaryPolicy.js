import fs from 'fs';
import path from 'path';

const TOOL_ALIASES = {
    '7za': ['7za', '7z'],
    '7z': ['7z', '7za'],
    cwebp: ['cwebp'],
    cjpeg: ['cjpeg'],
    djpeg: ['djpeg'],
    ffmpeg: ['ffmpeg'],
    pngquant: ['pngquant'],
    jpegtran: ['jpegtran'],
};

function executableName(name, platform) {
    return platform === 'win32' && !name.toLowerCase().endsWith('.exe')
        ? `${name}.exe`
        : name;
}

function platformBinaryFolders(platform, arch) {
    if (platform === 'win32') {
        return ['win', `win/${arch}`, ''];
    }
    if (platform === 'darwin') {
        return [`mac/${arch}`, `darwin/${arch}`, 'mac', 'darwin', ''];
    }
    return [`linux/${arch}`, 'linux', ''];
}

function sevenZipBinPlatformFolder(platform) {
    if (platform === 'win32') return 'win';
    if (platform === 'darwin') return 'mac';
    return 'linux';
}

function appendSevenZipPackageCandidates(candidates, root, platform, arch, aliases) {
    if (!root) return;
    const platformPath = platform === 'win32' ? path.win32 : path;
    const packagePlatform = sevenZipBinPlatformFolder(platform);
    for (const alias of aliases) {
        candidates.push(platformPath.join(
            root,
            'node_modules',
            '7zip-bin',
            packagePlatform,
            arch,
            executableName(alias, platform),
        ));
    }
}

function appendFullSevenZipCandidates(candidates, roots, platform, arch) {
    const platformPath = platform === 'win32' ? path.win32 : path;
    const folder = sevenZipBinPlatformFolder(platform);
    const binary = platform === 'win32' ? '7z.exe' : '7zz';
    for (const root of roots) {
        candidates.push(platformPath.join(root, 'bin', folder, arch, binary));
        candidates.push(platformPath.join(root, 'node_modules', '7zip-bin-full', folder, arch, binary));
    }
}

function appendWindowsFfmpegCandidates(candidates, platform, aliases) {
    if (platform !== 'win32') return;
    for (const directory of ['C:\\ffmpeg\\bin']) {
        for (const alias of aliases) {
            candidates.push(path.win32.join(directory, executableName(alias, platform)));
        }
    }
}

export function binaryCandidates(toolName, options = {}) {
    const platform = options.platform || process.platform;
    const platformPath = platform === 'win32' ? path.win32 : path;
    const environment = options.env || process.env;
    const env = platform === 'win32'
        ? Object.fromEntries(Object.entries(environment).map(([key, value]) => [key.toUpperCase(), value]))
        : environment;
    const arch = options.arch || process.arch;
    const aliases = [...(TOOL_ALIASES[toolName] || [toolName])];
    if (platform !== 'win32' && toolName === '7z') aliases.unshift('7zz');
    if (platform !== 'win32' && toolName === '7za') aliases.push('7zz');
    const roots = [
        options.resourcesPath,
        options.executableDir,
        options.projectRoot,
    ].filter(Boolean);
    const platformFolders = platformBinaryFolders(platform, arch);
    const candidates = [];

    if (toolName === '7z') {
        appendFullSevenZipCandidates(candidates, roots, platform, arch);
    }

    for (const root of roots) {
        for (const folder of platformFolders) {
            for (const alias of aliases) {
                candidates.push(platformPath.join(root, 'bin', folder, executableName(alias, platform)));
            }
        }
        if (toolName === '7za' || toolName === '7z') {
            appendSevenZipPackageCandidates(candidates, root, platform, arch, aliases);
        }
    }

    const pathEntries = String(options.pathValue ?? env.PATH ?? '').split(platform === 'win32' ? ';' : path.delimiter);
    for (const entry of pathEntries) {
        const directory = platform === 'win32' ? entry.trim().replace(/^"(.*)"$/, '$1') : entry;
        if (!directory) continue;
        for (const alias of aliases) {
            candidates.push(platformPath.join(directory, executableName(alias, platform)));
        }
    }

    if (platform === 'win32' && (toolName === '7za' || toolName === '7z')) {
        const systemDrive = env.SYSTEMDRIVE || 'C:';
        const directories = [
            env.PROGRAMW6432,
            env.PROGRAMFILES || path.win32.join(systemDrive, 'Program Files'),
            env['PROGRAMFILES(X86)'] || path.win32.join(systemDrive, 'Program Files (x86)'),
        ].filter(Boolean);
        for (const directory of directories) {
            for (const alias of aliases) {
                candidates.push(path.win32.join(directory, '7-Zip', executableName(alias, platform)));
            }
        }
    }

    if (toolName === 'ffmpeg') {
        appendWindowsFfmpegCandidates(candidates, platform, aliases);
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
    if (toolName === '7z') {
        const bundledPath = platform === 'win32'
            ? 'bin/win/<arch>/7z.exe 및 7z.dll'
            : platform === 'darwin' ? 'bin/mac/<arch>/7zz' : 'bin/linux/<arch>/7zz';
        return `7-Zip 실행 파일을 찾을 수 없습니다. 앱의 ${bundledPath}를 확인하거나 7-Zip을 설치하세요.`;
    }
    if (toolName === '7za') {
        return platform === 'win32'
            ? '7-Zip 실행 파일을 찾을 수 없습니다. 앱의 bin/win/7za.exe를 확인하거나 7-Zip을 설치하세요.'
            : '7z 실행 파일을 찾을 수 없습니다. 앱의 bundled bin/mac/<arch>/7za를 확인하거나 Homebrew 등으로 7-Zip을 설치하세요.';
    }
    return `${toolName} 실행 파일을 찾을 수 없습니다. 앱의 bundled 도구 또는 시스템 설치 상태를 확인하세요.`;
}
