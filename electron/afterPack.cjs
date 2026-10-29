const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

const MAC_SEVEN_ZIP_RELATIVE_PATHS = [
    path.join('Contents', 'Resources', 'bin', 'mac', 'x64', '7zz'),
    path.join('Contents', 'Resources', 'bin', 'mac', 'arm64', '7zz'),
];
const MAC_FILE_ASSOCIATION_HELPER_RELATIVE_PATH = path.join(
    'Contents',
    'Resources',
    'bin',
    'mac',
    'universal',
    'file-association-helper',
);

function chmodExecutable(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const mode = fs.statSync(filePath).mode | 0o755;
    fs.chmodSync(filePath, mode);
    return true;
}

function resolveProjectDir(context) {
    return context.packager?.projectDir
        || context.packager?.info?.projectDir
        || process.cwd();
}

function isUniversalIntermediateApp(context) {
    return /-universal-(x64|arm64)-temp$/.test(path.basename(String(context.appOutDir || '')));
}

function copySevenZipBinaries(context) {
    const projectDir = resolveProjectDir(context);
    const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[context.electronPlatformName];
    const arch = typeof context.arch === 'string' ? context.arch : Arch[context.arch];
    if (!platform || !['ia32', 'x64', 'armv7l', 'arm64', 'universal'].includes(arch)
        || arch === 'universal' && platform !== 'mac') {
        throw new Error(`[afterPack] Unsupported 7-Zip platform or architecture: ${context.electronPlatformName}/${arch}`);
    }
    const architectures = arch === 'universal' ? ['x64', 'arm64'] : [arch];
    const resourcesPath = platform === 'mac'
        ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
        : path.join(context.appOutDir, 'resources');
    const packagePath = path.join(projectDir, 'node_modules', '7zip-bin-full');
    const binaries = platform === 'win' ? ['7z.exe', '7z.dll'] : ['7zz'];
    const copiedPaths = [];

    for (const targetArch of architectures) {
        const sourceDir = path.join(packagePath, platform, targetArch === 'armv7l' ? 'arm' : targetArch);
        const destinationDir = path.join(resourcesPath, 'bin', platform, targetArch);
        const files = [
            ...binaries.map(name => ({ source: path.join(sourceDir, name), name, executable: true })),
            { source: path.join(sourceDir, 'License.txt'), name: 'License.txt' },
            { source: path.join(packagePath, 'LICENSE.txt'), name: '7zip-bin-full-LICENSE.txt' },
        ];
        for (const file of files) {
            if (!fs.existsSync(file.source)) {
                throw new Error(`[afterPack] Missing bundled 7-Zip resource: ${file.source}`);
            }
            const destinationPath = path.join(destinationDir, file.name);
            fs.mkdirSync(destinationDir, { recursive: true });
            fs.copyFileSync(file.source, destinationPath);
            if (file.executable) {
                if (platform !== 'win') chmodExecutable(destinationPath);
                copiedPaths.push(destinationPath);
            }
        }
    }

    return copiedPaths;
}

async function afterPack(context) {
    if (!['darwin', 'win32', 'linux'].includes(context.electronPlatformName)) return;
    if (context.electronPlatformName === 'darwin' && isUniversalIntermediateApp(context)) return;

    copySevenZipBinaries(context);
    if (context.electronPlatformName !== 'darwin') return;
    const appName = context.packager.appInfo.productFilename;
    const helperPath = path.join(
        context.appOutDir,
        `${appName}.app`,
        MAC_FILE_ASSOCIATION_HELPER_RELATIVE_PATH,
    );
    if (!chmodExecutable(helperPath)) {
        throw new Error(`[afterPack] Missing file association helper: ${helperPath}`);
    }
}

module.exports = afterPack;
module.exports.afterPack = afterPack;
module.exports.MAC_SEVEN_ZIP_RELATIVE_PATHS = MAC_SEVEN_ZIP_RELATIVE_PATHS;
module.exports.MAC_FILE_ASSOCIATION_HELPER_RELATIVE_PATH = MAC_FILE_ASSOCIATION_HELPER_RELATIVE_PATH;
module.exports.chmodExecutable = chmodExecutable;
module.exports.copySevenZipBinaries = copySevenZipBinaries;
module.exports.isUniversalIntermediateApp = isUniversalIntermediateApp;
