export function isTextEntryTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const tagName = String(target.tagName || '').toUpperCase();
    return Boolean(target.isContentEditable)
        || tagName === 'INPUT'
        || tagName === 'TEXTAREA'
        || tagName === 'SELECT';
}

export function isApplePlatform(platform = '') {
    return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export function hasPrimaryModifier(event, platform = '') {
    const isMac = isApplePlatform(platform);
    return isMac
        ? Boolean(event?.metaKey && !event?.ctrlKey)
        : Boolean(event?.ctrlKey && !event?.metaKey);
}

export function primaryModifierLabel(platform = '') {
    return isApplePlatform(platform) ? 'Cmd' : 'Ctrl';
}

export function formatPrimaryShortcut(key, platform = '') {
    const suffix = String(key || '').trim();
    return suffix ? `${primaryModifierLabel(platform)}+${suffix}` : primaryModifierLabel(platform);
}

export function shortcutCode(event) {
    if (/^Key[A-Z]$/.test(event?.code || '')) return event.code;
    return `Key${String(event?.key || '').toUpperCase()}`;
}

export function isShortcutKey(event, key) {
    return shortcutCode(event) === `Key${String(key || '').toUpperCase()}`;
}

export function dropdownVerticalPlacement(triggerRect, menuHeight, viewportHeight) {
    const availableBelow = viewportHeight - triggerRect.bottom;
    const availableAbove = triggerRect.top;
    return availableBelow < menuHeight && availableAbove > availableBelow ? 'up' : 'down';
}

export function shouldHandleGlobalShortcut(event) {
    return !event?.defaultPrevented
        && !event?.repeat
        && !isTextEntryTarget(event?.target);
}
