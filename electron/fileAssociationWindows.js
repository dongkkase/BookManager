import os from 'node:os';
import { execFile as systemExecFile } from 'node:child_process';

export const BOOK_MANAGER_REGISTERED_APPLICATION_NAME = 'BookManager';
export const WINDOWS_10_DEFAULT_APPS_URI = 'ms-settings:defaultapps';
export const WINDOWS_ASSOCIATION_CHANGE_POWERSHELL_ARGS = Object.freeze([
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    [
        'Add-Type -Namespace BookManager -Name ShellChangeNotifier',
        "-MemberDefinition '[System.Runtime.InteropServices.DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(uint eventId, uint flags, System.IntPtr item1, System.IntPtr item2);'",
        '; [BookManager.ShellChangeNotifier]::SHChangeNotify(0x08000000, 0, [System.IntPtr]::Zero, [System.IntPtr]::Zero)',
    ].join(' '),
]);

export const WINDOWS_FILE_ASSOCIATION_REGISTRY = Object.freeze({
    registeredApplications: 'HKCU\\Software\\RegisteredApplications',
    capabilities: 'HKCU\\Software\\BookManager\\Capabilities',
    fileAssociations: 'HKCU\\Software\\BookManager\\Capabilities\\FileAssociations',
    classes: 'HKCU\\Software\\Classes',
    userChoiceRoot: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts',
});

const CAPABILITIES_RELATIVE_PATH = 'Software\\BookManager\\Capabilities';
const CANONICAL_EXTENSION_PATTERN = /^\.[a-z0-9]+$/;

function assertNonEmptyString(value, name) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /[\0\r\n]/.test(value)) {
        throw new TypeError(`${name} must be a non-empty string without surrounding whitespace or control characters`);
    }
    return value;
}

export function assertCanonicalExtension(extension, name = 'extension') {
    if (typeof extension !== 'string' || !CANONICAL_EXTENSION_PATTERN.test(extension)) {
        throw new TypeError(`${name} must be a lowercase canonical extension beginning with a dot`);
    }
    return extension;
}

function validateUniqueExtensions(extensions, name) {
    if (!Array.isArray(extensions)) {
        throw new TypeError(`${name} must be an array`);
    }

    const result = extensions.map((extension, index) => (
        assertCanonicalExtension(extension, `${name}[${index}]`)
    ));
    if (new Set(result).size !== result.length) {
        throw new TypeError(`${name} must not contain duplicate extensions`);
    }
    return result;
}

export function validateExtensionSelection(selectedExtensions, allowedExtensions) {
    const allowed = validateUniqueExtensions(allowedExtensions, 'extensions');
    const selected = validateUniqueExtensions(selectedExtensions, 'selectedExtensions');
    const allowedSet = new Set(allowed);
    for (const extension of selected) {
        if (!allowedSet.has(extension)) {
            throw new RangeError(`Unsupported file association extension: ${extension}`);
        }
    }
    return selected;
}

function validateExecutablePath(executablePath) {
    const value = assertNonEmptyString(executablePath, 'executablePath');
    if (!/^(?:[a-zA-Z]:\\|\\\\)[^"<>|?*]+$/.test(value) || value.includes('"')) {
        throw new TypeError('executablePath must be an absolute Windows file path');
    }
    return value;
}

function extensionLabel(extension) {
    return extension.slice(1).toUpperCase();
}

function openCommandValue(executablePath) {
    return `"${executablePath}" "%1"`;
}

export function bookManagerProgId(extension) {
    return `BookManager.${assertCanonicalExtension(extension).slice(1)}`;
}

function progIdRegistryKey(extension) {
    return `${WINDOWS_FILE_ASSOCIATION_REGISTRY.classes}\\${bookManagerProgId(extension)}`;
}

function regAddValue(key, valueName, data) {
    return [
        'add',
        key,
        '/v',
        valueName,
        '/t',
        'REG_SZ',
        '/d',
        data,
        '/f',
    ];
}

function regAddDefaultValue(key, data) {
    return [
        'add',
        key,
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        data,
        '/f',
    ];
}

function regDeleteValue(key, valueName) {
    return ['delete', key, '/v', valueName, '/f'];
}

function regDeleteKey(key) {
    return ['delete', key, '/f'];
}

function command(type, args, extension = null, ignoreMissing = false) {
    return Object.freeze({
        type,
        args: Object.freeze(args),
        extension,
        ignoreMissing,
    });
}

function baseRegistrationCommands(executablePath) {
    return [
        command('registerApplication', regAddValue(
            WINDOWS_FILE_ASSOCIATION_REGISTRY.registeredApplications,
            BOOK_MANAGER_REGISTERED_APPLICATION_NAME,
            CAPABILITIES_RELATIVE_PATH,
        )),
        command('registerCapabilities', regAddValue(
            WINDOWS_FILE_ASSOCIATION_REGISTRY.capabilities,
            'ApplicationName',
            BOOK_MANAGER_REGISTERED_APPLICATION_NAME,
        )),
        command('registerCapabilities', regAddValue(
            WINDOWS_FILE_ASSOCIATION_REGISTRY.capabilities,
            'ApplicationDescription',
            'Open supported files with BookManager',
        )),
        command('registerCapabilities', regAddValue(
            WINDOWS_FILE_ASSOCIATION_REGISTRY.capabilities,
            'ApplicationIcon',
            `"${executablePath}",0`,
        )),
    ];
}

function extensionRegistrationCommands(extension, executablePath) {
    const progId = bookManagerProgId(extension);
    const progIdKey = progIdRegistryKey(extension);
    return [
        command('registerAssociation', regAddValue(
            WINDOWS_FILE_ASSOCIATION_REGISTRY.fileAssociations,
            extension,
            progId,
        ), extension),
        command('registerProgId', regAddDefaultValue(
            progIdKey,
            `BookManager ${extensionLabel(extension)} File`,
        ), extension),
        command('registerDefaultIcon', regAddDefaultValue(
            `${progIdKey}\\DefaultIcon`,
            `"${executablePath}",0`,
        ), extension),
        command('registerOpenCommand', regAddDefaultValue(
            `${progIdKey}\\shell\\open\\command`,
            openCommandValue(executablePath),
        ), extension),
    ];
}

function extensionRemovalCommands(extension) {
    return [
        command('removeAssociation', regDeleteValue(
            WINDOWS_FILE_ASSOCIATION_REGISTRY.fileAssociations,
            extension,
        ), extension, true),
        command('removeProgId', regDeleteKey(progIdRegistryKey(extension)), extension, true),
    ];
}

export function buildWindowsFileAssociationCommands({
    executablePath,
    extensions,
    selectedExtensions,
    retainedExtensions = [],
} = {}) {
    const executable = validateExecutablePath(executablePath);
    const allowed = validateUniqueExtensions(extensions, 'extensions');
    const selected = validateExtensionSelection(selectedExtensions, allowed);
    const retained = validateExtensionSelection(retainedExtensions, allowed);
    const enabled = new Set([...selected, ...retained]);
    const commands = baseRegistrationCommands(executable);

    for (const extension of allowed) {
        if (enabled.has(extension)) {
            commands.push(...extensionRegistrationCommands(extension, executable));
        } else {
            commands.push(...extensionRemovalCommands(extension));
        }
    }
    return commands;
}

function regQueryValue(key, valueName) {
    return ['query', key, '/v', valueName];
}

export function buildWindowsFileAssociationStatusQueries({
    extensions,
    requestedExtensions = extensions,
} = {}) {
    const allowed = validateUniqueExtensions(extensions, 'extensions');
    const requested = validateExtensionSelection(requestedExtensions, allowed);
    return requested.map(extension => Object.freeze({
        extension,
        progId: bookManagerProgId(extension),
        userChoice: Object.freeze(regQueryValue(
            `${WINDOWS_FILE_ASSOCIATION_REGISTRY.userChoiceRoot}\\${extension}\\UserChoice`,
            'ProgId',
        )),
        candidate: Object.freeze(regQueryValue(
            WINDOWS_FILE_ASSOCIATION_REGISTRY.fileAssociations,
            extension,
        )),
        candidateOpenCommand: Object.freeze([
            'query',
            `${progIdRegistryKey(extension)}\\shell\\open\\command`,
            '/ve',
        ]),
    }));
}

export function parseRegQueryValue(stdout, valueName) {
    assertNonEmptyString(valueName, 'valueName');
    const expectedName = valueName.toLocaleLowerCase('en-US');
    const lines = String(stdout || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*(.*?)\s+(REG_[A-Z0-9_]+)\s+(.*?)\s*$/i);
        if (!match || match[1].trim().toLocaleLowerCase('en-US') !== expectedName) continue;
        return match[3].trim();
    }
    return null;
}

export function parseRegQueryDefaultValue(stdout) {
    const lines = String(stdout || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*(.*?)\s+(REG_[A-Z0-9_]+)\s+(.*?)\s*$/i);
        if (!match || match[2].toLocaleUpperCase('en-US') !== 'REG_SZ') continue;
        return match[3].trim();
    }
    return null;
}

function sameProgId(left, right) {
    return typeof left === 'string'
        && typeof right === 'string'
        && left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US');
}

function execFileResult(execFile, file, args, options) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, stdout = '', stderr = '') => {
            if (settled) return;
            settled = true;
            if (error) {
                error.stdout = error.stdout ?? stdout;
                error.stderr = error.stderr ?? stderr;
                reject(error);
                return;
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        };

        let returned;
        try {
            returned = execFile(file, args, options, finish);
        } catch (error) {
            finish(error);
            return;
        }

        if (returned && typeof returned.then === 'function') {
            returned.then(result => {
                if (typeof result === 'string' || Buffer.isBuffer(result)) {
                    finish(null, result, '');
                    return;
                }
                finish(null, result?.stdout || '', result?.stderr || '');
            }, finish);
        }
    });
}

function isMissingRegistryEntryError(error) {
    return Number(error?.code) === 1;
}

async function runReg(execFile, args) {
    const result = await execFileResult(execFile, 'reg.exe', args, {
        encoding: 'utf8',
        windowsHide: true,
    });
    return result.stdout;
}

async function notifyWindowsAssociationChanged(execFile) {
    await execFileResult(
        execFile,
        'powershell.exe',
        WINDOWS_ASSOCIATION_CHANGE_POWERSHELL_ARGS,
        { encoding: 'utf8', windowsHide: true },
    );
}

async function queryRegValue(execFile, args, valueName) {
    try {
        return parseRegQueryValue(await runReg(execFile, args), valueName);
    } catch (error) {
        if (isMissingRegistryEntryError(error)) return null;
        throw error;
    }
}

async function queryRegDefaultValue(execFile, args) {
    try {
        return parseRegQueryDefaultValue(await runReg(execFile, args));
    } catch (error) {
        if (isMissingRegistryEntryError(error)) return null;
        throw error;
    }
}

function notificationErrorMessage(error) {
    const message = String(error?.message || '').trim();
    if (message) return message;
    const code = String(error?.code || '').trim();
    return code || 'Unknown Windows association notification error';
}

export function createWindowsFileAssociationService({
    executablePath,
    extensions,
    execFile = systemExecFile,
} = {}) {
    const executable = validateExecutablePath(executablePath);
    const allowed = validateUniqueExtensions(extensions, 'extensions');
    if (typeof execFile !== 'function') {
        throw new TypeError('execFile must be a function');
    }

    async function readStatus(requestedExtensions = allowed) {
        const queries = buildWindowsFileAssociationStatusQueries({
            extensions: allowed,
            requestedExtensions,
        });
        const result = [];
        for (const query of queries) {
            const currentProgId = await queryRegValue(execFile, query.userChoice, 'ProgId');
            const candidateProgId = await queryRegValue(execFile, query.candidate, query.extension);
            const candidateOpenCommand = await queryRegDefaultValue(
                execFile,
                query.candidateOpenCommand,
            );
            result.push({
                extension: query.extension,
                progId: query.progId,
                currentProgId,
                isDefault: sameProgId(currentProgId, query.progId),
                candidateProgId,
                candidateOpenCommand,
                candidateRegistered: sameProgId(candidateProgId, query.progId)
                    && candidateOpenCommand === openCommandValue(executable),
            });
        }
        return result;
    }

    async function apply(selectedExtensions) {
        const selected = validateExtensionSelection(selectedExtensions, allowed);
        const selectedSet = new Set(selected);
        const unselected = allowed.filter(extension => !selectedSet.has(extension));
        const unselectedQueries = buildWindowsFileAssociationStatusQueries({
            extensions: allowed,
            requestedExtensions: unselected,
        });
        const retainedCurrentDefaults = [];

        for (const query of unselectedQueries) {
            const currentProgId = await queryRegValue(execFile, query.userChoice, 'ProgId');
            if (sameProgId(currentProgId, query.progId)) {
                retainedCurrentDefaults.push(query.extension);
            }
        }

        const commands = buildWindowsFileAssociationCommands({
            executablePath: executable,
            extensions: allowed,
            selectedExtensions: selected,
            retainedExtensions: retainedCurrentDefaults,
        });
        for (const registryCommand of commands) {
            try {
                await runReg(execFile, registryCommand.args);
            } catch (error) {
                if (!registryCommand.ignoreMissing || !isMissingRegistryEntryError(error)) throw error;
            }
        }
        let notificationSucceeded = true;
        let notificationError = null;
        try {
            await notifyWindowsAssociationChanged(execFile);
        } catch (error) {
            notificationSucceeded = false;
            notificationError = notificationErrorMessage(error);
        }

        const retainedSet = new Set(retainedCurrentDefaults);
        return {
            selectedExtensions: [...selected],
            removedExtensions: unselected.filter(extension => !retainedSet.has(extension)),
            retainedCurrentDefaults,
            notificationSucceeded,
            notificationError,
        };
    }

    return Object.freeze({
        extensions: Object.freeze([...allowed]),
        apply,
        getStatus: readStatus,
    });
}

export function buildWindows11DefaultAppsUri(
    registeredApplicationName = BOOK_MANAGER_REGISTERED_APPLICATION_NAME,
) {
    const applicationName = assertNonEmptyString(
        registeredApplicationName,
        'registeredApplicationName',
    );
    return `${WINDOWS_10_DEFAULT_APPS_URI}?registeredAppUser=${encodeURIComponent(applicationName)}`;
}

export function isWindows11Release(windowsRelease) {
    const parts = String(windowsRelease || '').split('.').map(part => Number(part));
    if (parts.length < 3 || parts.some(part => !Number.isInteger(part) || part < 0)) return false;
    if (parts[0] > 10) return true;
    return parts[0] === 10 && parts[2] >= 22000;
}

export function getWindowsDefaultAppsUri({
    windowsRelease = os.release(),
    registeredApplicationName = BOOK_MANAGER_REGISTERED_APPLICATION_NAME,
} = {}) {
    return isWindows11Release(windowsRelease)
        ? buildWindows11DefaultAppsUri(registeredApplicationName)
        : WINDOWS_10_DEFAULT_APPS_URI;
}
