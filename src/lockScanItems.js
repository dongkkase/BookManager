import { SCAN_TARGET_EXTENSIONS } from '../electron/scanTargets.js';

const PLACEHOLDER_LIMIT = 8;
const THUMBNAIL_LIMIT = 24;
const TOTAL_LIMIT = 32;
const QUEUE_LIMIT = 120;
const TARGET_EXTENSION_SET = new Set(SCAN_TARGET_EXTENSIONS);

export function lockScanItemIdentity(item = {}) {
    return item.key || item.path || item.src || item.name || '';
}

export function isLockScanTargetPath(value = '') {
    const cleanValue = String(value || '').split(/[?#]/)[0];
    const filename = cleanValue.split(/[\\/]/).filter(Boolean).pop() || cleanValue;
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0) return false;
    return TARGET_EXTENSION_SET.has(filename.slice(dotIndex).toLowerCase());
}

export function shouldAcceptLockScanItem(item = {}) {
    if (item.src) return true;
    return isLockScanTargetPath(item.path || item.name || item.filename || '');
}

function trimLockScanItems(items = []) {
    const normalized = items.filter(item => lockScanItemIdentity(item));
    const thumbnails = normalized.filter(item => item.src).slice(-THUMBNAIL_LIMIT);
    const thumbnailKeys = new Set(thumbnails.map(lockScanItemIdentity));
    const placeholders = normalized
        .filter(item => !item.src && !thumbnailKeys.has(lockScanItemIdentity(item)))
        .slice(-PLACEHOLDER_LIMIT);

    return [...placeholders, ...thumbnails]
        .sort((left, right) => Number(left.updatedAt || 0) - Number(right.updatedAt || 0))
        .slice(-TOTAL_LIMIT);
}

function createLockScanItem(current = [], item = {}, now = Date.now()) {
    if (!shouldAcceptLockScanItem(item)) return current;

    const name = item.name || item.filename || item.path || '';
    const src = item.src || '';
    const itemPath = item.path || '';
    const key = itemPath || src || name;
    if (!key) return current;

    const existing = current.find(value => (
        value.key === key
        || (itemPath && value.path === itemPath)
        || (src && value.src === src)
    ));
    return {
        key,
        src: src || existing?.src || '',
        name: name || existing?.name || key,
        path: itemPath || existing?.path || '',
        updatedAt: now,
    };
}

function withoutMatchingLockScanItem(current = [], item = {}) {
    const key = lockScanItemIdentity(item);
    const itemPath = item.path || '';
    const src = item.src || '';
    return current.filter(value => (
        value.key !== key
        && (!itemPath || value.path !== itemPath)
        && (!src || value.src !== src)
    ));
}

export function hasMatchingLockScanItem(current = [], item = {}) {
    const key = lockScanItemIdentity(item);
    const itemPath = item.path || '';
    const src = item.src || '';
    if (!key && !itemPath && !src) return false;
    return current.some(value => (
        value.key === key
        || (itemPath && value.path === itemPath)
        || (src && value.src === src)
    ));
}

export function mergeLockScanItem(current = [], item = {}, now = Date.now()) {
    const nextItem = createLockScanItem(current, item, now);
    if (nextItem === current) return current;
    return trimLockScanItems([...withoutMatchingLockScanItem(current, nextItem), nextItem]);
}

export function mergeLockScanQueueItem(current = [], item = {}, now = Date.now(), limit = QUEUE_LIMIT) {
    const nextItem = createLockScanItem(current, item, now);
    if (nextItem === current) return current;
    return [...withoutMatchingLockScanItem(current, nextItem), nextItem].slice(-limit);
}
