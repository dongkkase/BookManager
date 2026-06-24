export function normalizeWindowsDriveRoot(value = '') {
  const match = String(value || '').trim().match(/^([A-Za-z]):[\\/]?$/);
  if (!match) return '';
  return `${match[1].toUpperCase()}:\\`;
}

export function parseWindowsLogicalDiskRoots(output = '') {
  const roots = String(output || '')
    .split(/\r?\n/)
    .map(line => normalizeWindowsDriveRoot(line))
    .filter(Boolean);
  return [...new Set(roots)];
}

export function normalizeDirectoryPathForRead(dirPath = '', platform = process.platform) {
  if (platform !== 'win32') return dirPath;
  return normalizeWindowsDriveRoot(dirPath) || dirPath;
}
