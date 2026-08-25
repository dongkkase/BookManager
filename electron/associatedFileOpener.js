import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
    configuredViewerTypeForAssociatedPath,
    viewerTypeForAssociatedPath,
} from './fileAssociationPolicy.js';

function pathEntryType(filePath, fsTarget = fs) {
    try {
        if (!filePath || !fsTarget.existsSync(filePath)) return '';
        const stat = fsTarget.statSync(filePath);
        if (stat.isFile()) return 'file';
        if (stat.isDirectory()) return 'directory';
        return '';
    } catch {
        return '';
    }
}

function isMacApplicationBundle(viewerPath, entryType, platform) {
    return platform === 'darwin'
        && entryType === 'directory'
        && path.extname(viewerPath).toLowerCase() === '.app';
}

function comparablePath(filePath, platform, fsTarget = fs) {
    let normalized = path.resolve(String(filePath || '')).normalize('NFC');
    const realpath = fsTarget?.realpathSync?.native || fsTarget?.realpathSync;
    if (typeof realpath === 'function') {
        try {
            normalized = String(realpath(normalized)).normalize('NFC');
        } catch {
            // 존재하지 않거나 조회할 수 없는 경로는 정규화한 입력 경로로 비교합니다.
        }
    }
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isBlockedViewerPath(viewerPath, blockedViewerPaths, platform, fsTarget) {
    const viewerKey = comparablePath(viewerPath, platform, fsTarget);
    return (Array.isArray(blockedViewerPaths) ? blockedViewerPaths : [])
        .filter(Boolean)
        .some(blockedPath => comparablePath(blockedPath, platform, fsTarget) === viewerKey);
}

function waitForSpawn(child) {
    if (!child || typeof child.once !== 'function') {
        child?.unref?.();
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const onError = error => {
            child.removeListener?.('spawn', onSpawn);
            reject(error);
        };
        const onSpawn = () => {
            child.removeListener?.('error', onError);
            child.unref?.();
            resolve();
        };
        child.once('error', onError);
        child.once('spawn', onSpawn);
    });
}

export function configuredViewerPathForAssociatedFile(config = {}, filePath = '') {
    const viewerType = configuredViewerTypeForAssociatedPath(filePath);
    return viewerType ? String(config?.viewer_paths?.[viewerType] || '').trim() : '';
}

export async function openAssociatedFile(filePath, options = {}) {
    const {
        getConfig = () => ({}),
        openInternalViewer = async () => ({ success: false }),
        onExternalViewerOpened = async () => {},
        spawnTarget = spawn,
        fsTarget = fs,
        platform = process.platform,
        blockedViewerPaths = [],
    } = options;
    const normalizedPath = path.resolve(String(filePath || '')).normalize('NFC');
    const viewerType = viewerTypeForAssociatedPath(normalizedPath);
    if (!viewerType || pathEntryType(normalizedPath, fsTarget) !== 'file') {
        return { success: false, code: 'UNSUPPORTED_OR_MISSING_FILE', filePath: normalizedPath };
    }

    const viewerPath = configuredViewerPathForAssociatedFile(getConfig() || {}, normalizedPath);
    if (!viewerPath) return openInternalViewer(normalizedPath);
    if (isBlockedViewerPath(viewerPath, blockedViewerPaths, platform, fsTarget)) {
        return openInternalViewer(normalizedPath);
    }
    const viewerEntryType = pathEntryType(viewerPath, fsTarget);
    const macApplicationBundle = isMacApplicationBundle(viewerPath, viewerEntryType, platform);
    if (viewerEntryType !== 'file' && !macApplicationBundle) {
        return {
            success: false,
            code: 'VIEWER_NOT_FOUND',
            filePath: normalizedPath,
            viewerPath,
        };
    }

    const command = macApplicationBundle ? '/usr/bin/open' : viewerPath;
    const args = macApplicationBundle ? ['-a', viewerPath, normalizedPath] : [normalizedPath];
    try {
        const child = spawnTarget(command, args, {
            detached: true,
            stdio: 'ignore',
        });
        await waitForSpawn(child);
    } catch (error) {
        return {
            success: false,
            code: error?.code || 'VIEWER_LAUNCH_FAILED',
            message: error?.message || String(error),
            filePath: normalizedPath,
            viewerPath,
        };
    }
    await onExternalViewerOpened(normalizedPath, viewerType);
    return {
        success: true,
        external: true,
        filePath: normalizedPath,
        viewerPath,
        viewerType,
    };
}
