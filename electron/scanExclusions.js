import path from 'path';

export function isHiddenDirectoryName(name = '') {
  const value = String(name || '');
  return value.length > 1 && value.startsWith('.');
}

export function shouldSkipScanDirectoryEntry(entry = {}) {
  return Boolean(entry?.isDirectory?.() && isHiddenDirectoryName(entry.name));
}

export function pathHasHiddenDirectorySegment(targetPath, rootPath = '') {
  const relativePath = rootPath ? path.relative(rootPath, targetPath) : targetPath;
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return false;
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .some(segment => isHiddenDirectoryName(segment));
}
