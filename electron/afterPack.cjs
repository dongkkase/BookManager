const fs = require('node:fs');
const path = require('node:path');

const MAC_7ZA_RELATIVE_PATHS = [
    path.join('Contents', 'Resources', 'bin', 'mac', 'x64', '7za'),
    path.join('Contents', 'Resources', 'bin', 'mac', 'arm64', '7za'),
];
const MAC_FILE_ASSOCIATION_HELPER_RELATIVE_PATH = path.join(
    'Contents',
    'Resources',
    'bin',
    'mac',
    'universal',
    'file-association-helper',
);

function archFromRelativePath(relativePath) {
    return path.basename(path.dirname(relativePath));
}

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

function copyMacSevenZipBinaries(context) {
    const projectDir = resolveProjectDir(context);
    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(context.appOutDir, `${appName}.app`);
    const copiedPaths = [];

    for (const relativePath of MAC_7ZA_RELATIVE_PATHS) {
        const arch = archFromRelativePath(relativePath);
        const sourcePath = path.join(projectDir, 'node_modules', '7zip-bin', 'mac', arch, '7za');
        const destinationPath = path.join(appPath, relativePath);

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`[afterPack] Missing bundled macOS 7za: ${sourcePath}`);
        }

        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
        chmodExecutable(destinationPath);
        copiedPaths.push(destinationPath);
    }

    return copiedPaths;
}

async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin') return;
    if (isUniversalIntermediateApp(context)) return;

    const copiedPaths = copyMacSevenZipBinaries(context);
    if (copiedPaths.length === 0) {
        throw new Error('[afterPack] macOS 7za binaries were not bundled.');
    }
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
module.exports.MAC_7ZA_RELATIVE_PATHS = MAC_7ZA_RELATIVE_PATHS;
module.exports.MAC_FILE_ASSOCIATION_HELPER_RELATIVE_PATH = MAC_FILE_ASSOCIATION_HELPER_RELATIVE_PATH;
module.exports.chmodExecutable = chmodExecutable;
module.exports.copyMacSevenZipBinaries = copyMacSevenZipBinaries;
module.exports.isUniversalIntermediateApp = isUniversalIntermediateApp;
