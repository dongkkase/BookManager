import fs from 'fs';

const WINDOWS_DRIVE_LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('');

export function normalizeWindowsDriveRoot(value = '') {
    const match = String(value || '').trim().match(/^([A-Za-z]):[\\/]?$/);
    if (!match) return '';
    return `${match[1].toUpperCase()}:\\`;
}

export function listWindowsDriveRoots(options = {}) {
    const existsSync = options.existsSync || fs.existsSync;
    const driveLetters = options.driveLetters || WINDOWS_DRIVE_LETTERS;
    const roots = [];

    for (const letter of driveLetters) {
        const root = normalizeWindowsDriveRoot(`${letter}:\\`);
        if (!root) continue;

        try {
            if (existsSync(root)) {
                roots.push(root);
            }
        } catch {
            // Unavailable removable or network drives should not break root listing.
        }
    }

    return [...new Set(roots)];
}

export function getDefaultWindowsDriveRoot(systemDrive = process.env.SystemDrive) {
    return normalizeWindowsDriveRoot(systemDrive) || 'C:\\';
}

export function normalizeDirectoryPathForRead(dirPath = '', platform = process.platform) {
    if (platform !== 'win32') return dirPath;
    return normalizeWindowsDriveRoot(dirPath) || dirPath;
}
