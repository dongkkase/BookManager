const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const SUPPORTED_BUILDER_VERSION = '24.13.3';
const UPSTREAM_TEMPLATE_SHA256 = '80fa75cf8cb68f4999eb92afc9f37f8e5b605cb1c3a077821bbc350a9b907a48';
const ARCH_DEFINES = new Map([[0, '32'], [1, '64'], [3, 'ARM64']]);
const installed = Symbol.for('bookmanager.portable.builderAdapter');

function escapeNsis(value) {
    if (/[\r\n\0]/u.test(value)) throw new Error('Invalid newline or NUL in NSIS path.');
    return value.replaceAll('$', () => '$$').replaceAll('"', () => '$\\"').replaceAll("'", () => "$\\'");
}

function collectRuntimeFiles(root, relative = '') {
    const files = [];
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const entryPath = path.join(relative, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectRuntimeFiles(root, entryPath));
        } else if (entry.isFile()) {
            const size = fs.statSync(path.join(root, entryPath)).size;
            if (size > 0x7fffffff) throw new Error(`Portable runtime file exceeds supported 2 GiB size: ${entryPath}`);
            files.push({ path: entryPath.split(path.sep).join('\\'), size });
        } else {
            throw new Error(`Portable runtime cannot contain links or special files: ${entryPath}`);
        }
    }
    return files;
}

function createValidationMacros(archs) {
    const lines = [];
    for (const [arch, directory] of archs) {
        const suffix = ARCH_DEFINES.get(arch);
        if (!suffix) throw new Error(`Unsupported portable architecture: ${arch}`);
        const files = collectRuntimeFiles(directory);
        if (!files.length) throw new Error(`Empty portable runtime: ${directory}`);
        lines.push(`!macro BM_Validate_${suffix}`);
        for (const file of files) {
            lines.push(`    !insertmacro BM_CheckFile "${escapeNsis(file.path)}" ${file.size}`);
        }
        lines.push('!macroend');
    }
    return `${lines.join('\n')}\n`;
}

function validateSplashBitmap(filePath) {
    const data = fs.readFileSync(filePath);
    const pixelBytes = 700 * 300 * 3;
    // LoadImageW cannot load top-down BMPs on some supported Windows releases.
    if (data.length !== 54 + pixelBytes
        || data.toString('ascii', 0, 2) !== 'BM'
        || data.readUInt32LE(2) !== data.length
        || data.readUInt32LE(10) !== 54
        || data.readUInt32LE(14) !== 40
        || data.readInt32LE(18) !== 700
        || data.readInt32LE(22) !== 300
        || data.readUInt16LE(26) !== 1
        || data.readUInt16LE(28) !== 24
        || data.readUInt32LE(30) !== 0
        || ![0, pixelBytes].includes(data.readUInt32LE(34))) {
        throw new Error('BookManager portable splash must be a complete 700x300 bottom-up 24-bit uncompressed BMP.');
    }
}

function prepareDefines(defines) {
    if (defines.APP_DIR_64 || defines.APP_DIR_32 || defines.APP_DIR_ARM64 || defines.APP_BUILD_DIR || defines.ZIP_COMPRESSION) {
        throw new Error('BookManager portable runtime requires the standard embedded 7z package.');
    }
    if (!defines.SPLASH_IMAGE || !fs.existsSync(defines.SPLASH_IMAGE)) {
        throw new Error('BookManager portable splash bitmap is missing.');
    }
    validateSplashBitmap(defines.SPLASH_IMAGE);
    let count = 0;
    for (const suffix of ARCH_DEFINES.values()) {
        if (!defines[`APP_${suffix}`]) continue;
        const hash = defines[`APP_${suffix}_HASH`];
        if (!/^[a-f0-9]{128}$/iu.test(hash || '')) throw new Error(`Missing SHA-512 for portable ${suffix} package.`);
        defines[`BM_RUNTIME_ID_${suffix}`] = `${hash.slice(0, 32).toLowerCase()}-${suffix.toLowerCase()}`;
        count++;
    }
    if (!count) throw new Error('BookManager portable package has no supported architecture.');
    return defines;
}

function installPortableBuilderAdapter() {
    const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js');
    if (NsisTarget.prototype[installed]) return;
    const version = require('app-builder-lib/package.json').version;
    const upstreamTemplate = fs.readFileSync(require.resolve('app-builder-lib/templates/nsis/portable.nsi'), 'utf8');
    const templateHash = createHash('sha256').update(upstreamTemplate.replaceAll('\r\n', '\n')).digest('hex');
    if (version !== SUPPORTED_BUILDER_VERSION || templateHash !== UPSTREAM_TEMPLATE_SHA256) {
        throw new Error(`BookManager portable launcher requires review after an electron-builder change (app-builder-lib ${version}).`);
    }
    const originalComputeFinalScript = NsisTarget.prototype.computeFinalScript;
    const originalExecuteMakensis = NsisTarget.prototype.executeMakensis;
    if (typeof originalComputeFinalScript !== 'function' || typeof originalExecuteMakensis !== 'function') {
        throw new Error('Unsupported electron-builder NSIS interface.');
    }
    NsisTarget.prototype.computeFinalScript = async function (originalScript, isInstaller, archs) {
        if (!this.isPortable) return originalComputeFinalScript.call(this, originalScript, isInstaller, archs);
        if (!isInstaller || originalScript.replaceAll('\r\n', '\n') !== upstreamTemplate.replaceAll('\r\n', '\n')) {
            throw new Error('Unexpected upstream portable script; refusing to produce an unsafe launcher.');
        }
        const template = fs.readFileSync(path.join(__dirname, 'portable.nsi'), 'utf8');
        return originalComputeFinalScript.call(this, createValidationMacros(archs) + template, isInstaller, archs);
    };
    NsisTarget.prototype.executeMakensis = async function (defines, commands, script) {
        if (this.isPortable) {
            prepareDefines(defines);
            if (!script.includes('BOOKMANAGER_PERSISTENT_PORTABLE')) {
                throw new Error('BookManager persistent portable script was not applied.');
            }
        }
        return originalExecuteMakensis.call(this, defines, commands, script);
    };
    NsisTarget.prototype[installed] = true;
}

module.exports = { collectRuntimeFiles, createValidationMacros, escapeNsis, installPortableBuilderAdapter, prepareDefines };
