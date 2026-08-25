import fs from 'node:fs';
import path from 'node:path';
import { execFile as systemExecFile } from 'node:child_process';

import {
    FILE_ASSOCIATION_EXTENSIONS,
    fileAssociationGroupForExtension,
    normalizeFileAssociationExtensions,
} from './fileAssociationPolicy.js';
import {
    createWindowsFileAssociationService,
    getWindowsDefaultAppsUri,
} from './fileAssociationWindows.js';

const MAC_HELPER_RELATIVE_PATH = path.join('bin', 'mac', 'universal', 'file-association-helper');

function execFileResult(execFile, file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, options, (error, stdout = '', stderr = '') => {
            if (error) {
                error.stdout = error.stdout ?? stdout;
                error.stderr = error.stderr ?? stderr;
                reject(error);
                return;
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

function parseHelperResponse(stdout = '') {
    try {
        return JSON.parse(String(stdout || '').trim());
    } catch {
        return null;
    }
}

export function parseMacOSVersion(systemVersion = '') {
    const match = String(systemVersion || '').trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: Number(match[2] || 0),
        patch: Number(match[3] || 0),
    };
}

export function supportsMacFileAssociations(systemVersion = '') {
    const version = parseMacOSVersion(systemVersion);
    return Boolean(version && version.major >= 12);
}

export function resolveAssociationExecutablePath({
    platform = process.platform,
    env = process.env,
    executablePath = process.execPath,
} = {}) {
    if (platform === 'win32') {
        return String(env?.PORTABLE_EXECUTABLE_FILE || executablePath || '');
    }
    return String(executablePath || '');
}

export function resolveMacApplicationPath(executablePath = '') {
    let currentPath = path.resolve(String(executablePath || ''));
    while (currentPath && currentPath !== path.dirname(currentPath)) {
        if (path.extname(currentPath).toLowerCase() === '.app') return currentPath;
        currentPath = path.dirname(currentPath);
    }
    return '';
}

export function resolveMacFileAssociationHelperPath({
    isPackaged = false,
    resourcesPath = process.resourcesPath,
    projectRoot = process.cwd(),
} = {}) {
    return isPackaged
        ? path.join(resourcesPath, MAC_HELPER_RELATIVE_PATH)
        : path.join(projectRoot, MAC_HELPER_RELATIVE_PATH);
}

function baseAssociationRows() {
    return FILE_ASSOCIATION_EXTENSIONS.map(extension => ({
        extension,
        group: fileAssociationGroupForExtension(extension),
        isDefault: false,
        isRegistered: false,
        handlerName: '',
    }));
}

function unsupportedStatus(platform, reason = 'unsupported-platform') {
    return {
        platform,
        supported: false,
        directApply: false,
        reason,
        associations: baseAssociationRows(),
    };
}

async function runMacHelper(execFile, helperPath, action, applicationPath, extensions) {
    try {
        const result = await execFileResult(
            execFile,
            helperPath,
            [action, applicationPath, ...extensions],
            { encoding: 'utf8', maxBuffer: 1024 * 1024 },
        );
        const response = parseHelperResponse(result.stdout);
        if (!response) throw new Error('The macOS file association helper returned invalid JSON.');
        return response;
    } catch (error) {
        const response = parseHelperResponse(error?.stdout);
        if (response) return response;
        throw error;
    }
}

function macStatusRows(response = {}) {
    const resultByExtension = new Map(
        (Array.isArray(response.results) ? response.results : [])
            .map(result => [result.extension, result]),
    );
    return baseAssociationRows().map(row => {
        const result = resultByExtension.get(row.extension) || {};
        const handlerPath = String(result.defaultApplicationPath || '');
        return {
            ...row,
            isDefault: Boolean(result.isDefault),
            isRegistered: Boolean(result.contentType),
            handlerName: handlerPath
                ? path.basename(handlerPath, path.extname(handlerPath))
                : String(result.defaultApplicationBundleIdentifier || ''),
            error: result.error || null,
        };
    });
}

function macHelperErrorMessage(response = {}, associations = []) {
    const error = response?.error
        || associations.find(association => association?.error)?.error
        || null;
    if (!error) return null;
    return String(error.message || error.code || error);
}

export function createFileAssociationManager(options = {}) {
    const {
        platform = process.platform,
        isPackaged = false,
        env = process.env,
        executablePath = process.execPath,
        resourcesPath = process.resourcesPath,
        projectRoot = process.cwd(),
        execFile = systemExecFile,
        existsSync = fs.existsSync,
        shell = null,
        windowsRelease,
        systemVersion,
    } = options;

    if (!isPackaged) {
        return Object.freeze({
            getStatus: async () => unsupportedStatus(platform, 'packaged-app-required'),
            apply: async () => ({
                success: false,
                reason: 'packaged-app-required',
            }),
            openSettings: async () => ({ success: false, reason: 'packaged-app-required' }),
        });
    }

    if (platform === 'win32') {
        const associationExecutable = resolveAssociationExecutablePath({
            platform,
            env,
            executablePath,
        });
        const windowsService = createWindowsFileAssociationService({
            executablePath: associationExecutable,
            extensions: FILE_ASSOCIATION_EXTENSIONS,
            execFile,
        });
        return Object.freeze({
            getStatus: async () => {
                const status = await windowsService.getStatus();
                return {
                    platform,
                    supported: true,
                    directApply: false,
                    requiresSystemConfirmation: true,
                    associations: status.map(item => ({
                        extension: item.extension,
                        group: fileAssociationGroupForExtension(item.extension),
                        isDefault: Boolean(item.isDefault),
                        isRegistered: Boolean(item.candidateRegistered),
                        handlerName: item.isDefault ? 'BookManager' : String(item.currentProgId || ''),
                    })),
                };
            },
            apply: async extensions => {
                const selected = normalizeFileAssociationExtensions(extensions);
                if (selected.length === 0) {
                    return { success: false, reason: 'extension-selection-required' };
                }
                const result = await windowsService.apply(selected);
                return {
                    success: true,
                    ...result,
                    requiresSystemConfirmation: true,
                };
            },
            openSettings: async () => {
                if (!shell?.openExternal) return { success: false, reason: 'shell-unavailable' };
                const uri = getWindowsDefaultAppsUri({ windowsRelease });
                await shell.openExternal(uri);
                return { success: true, uri };
            },
        });
    }

    if (platform === 'darwin') {
        if (!supportsMacFileAssociations(systemVersion)) {
            return Object.freeze({
                getStatus: async () => unsupportedStatus(platform, 'macos-12-required'),
                apply: async () => ({ success: false, reason: 'macos-12-required' }),
                openSettings: async () => ({ success: false, reason: 'macos-12-required' }),
            });
        }
        const helperPath = resolveMacFileAssociationHelperPath({
            isPackaged,
            resourcesPath,
            projectRoot,
        });
        const applicationPath = resolveMacApplicationPath(executablePath);
        if (!applicationPath || !existsSync(helperPath)) {
            return Object.freeze({
                getStatus: async () => unsupportedStatus(platform, 'mac-helper-unavailable'),
                apply: async () => ({ success: false, reason: 'mac-helper-unavailable' }),
                openSettings: async () => ({ success: false, reason: 'not-required' }),
            });
        }
        return Object.freeze({
            getStatus: async () => {
                const response = await runMacHelper(
                    execFile,
                    helperPath,
                    'status',
                    applicationPath,
                    FILE_ASSOCIATION_EXTENSIONS,
                );
                return {
                    platform,
                    supported: true,
                    directApply: true,
                    associations: macStatusRows(response),
                };
            },
            apply: async extensions => {
                const selected = normalizeFileAssociationExtensions(extensions);
                if (selected.length === 0) {
                    return { success: false, reason: 'extension-selection-required' };
                }
                const response = await runMacHelper(
                    execFile,
                    helperPath,
                    'apply',
                    applicationPath,
                    selected,
                );
                const associations = macStatusRows(response)
                    .filter(item => selected.includes(item.extension));
                return {
                    success: Boolean(response.ok),
                    requiresUserConfirmation: false,
                    associations,
                    error: macHelperErrorMessage(response, associations),
                };
            },
            openSettings: async () => ({ success: false, reason: 'not-required' }),
        });
    }

    return Object.freeze({
        getStatus: async () => unsupportedStatus(platform),
        apply: async () => ({ success: false, reason: 'unsupported-platform' }),
        openSettings: async () => ({ success: false, reason: 'unsupported-platform' }),
    });
}
