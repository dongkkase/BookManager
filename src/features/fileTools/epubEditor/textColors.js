import { closeHistory } from '@tiptap/pm/history';

export const CUSTOM_COLOR_LIMIT = 10;
export const CUSTOM_COLORS_KEY = 'bookmanager.epub-editor.colors.v1';
export const BASIC_TEXT_COLORS = [
    '#000000', '#444444', '#777777', '#aaaaaa', '#dddddd', '#ffffff', '#9f1239', '#dc2626', '#ea580c', '#d97706',
    '#a16207', '#4d7c0f', '#15803d', '#0f766e', '#0891b2', '#2563eb', '#4338ca', '#7e22ce', '#a21caf', '#be185d',
];

export function normalizeHexColor(value) {
    if (typeof value !== 'string') return null;
    const hex = value.trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
    if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map(character => character + character).join('')}`;
    return null;
}

export function normalizePastedColor(value) {
    const hex = normalizeHexColor(value);
    if (hex) return hex;
    const rgb = typeof value === 'string' && /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
    if (!rgb || rgb.slice(1).some(channel => Number(channel) > 255)) return null;
    return '#' + rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
}

export function normalizeCustomColors(value) {
    const seen = new Set();
    return Array.from({ length: CUSTOM_COLOR_LIMIT }, (_, index) => {
        const color = Array.isArray(value) ? normalizeHexColor(value[index]) : null;
        if (!color || seen.has(color)) return null;
        seen.add(color);
        return color;
    });
}

export function readCustomColors(storage) {
    try { return normalizeCustomColors(JSON.parse((storage ?? globalThis.localStorage).getItem(CUSTOM_COLORS_KEY))); }
    catch { return normalizeCustomColors(null); }
}

export function saveCustomColor(storage, current, value, slot = null) {
    const color = normalizeHexColor(value);
    if (!color) throw new Error('COLOR_INVALID');
    const colors = normalizeCustomColors(current);
    const existing = colors.indexOf(color);
    if (existing >= 0) return { colors, slot: existing, existing: true };
    const index = slot == null ? colors.indexOf(null) : slot;
    if (!Number.isInteger(index) || index < 0 || index >= CUSTOM_COLOR_LIMIT) throw new Error('COLOR_LIMIT');
    colors[index] = color;
    storage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
    return { colors, slot: index, existing: false };
}

export function deleteCustomColor(storage, current, slot) {
    const colors = normalizeCustomColors(current);
    if (!Number.isInteger(slot) || slot < 0 || slot >= CUSTOM_COLOR_LIMIT) return colors;
    colors[slot] = null;
    storage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
    return colors;
}

export function applyTextColor(editor, value, background = false) {
    const color = value == null ? null : normalizeHexColor(value);
    if (value != null && !color) return false;
    const chain = editor.chain().command(({ tr }) => { closeHistory(tr); return true; });
    if (background) return color == null ? chain.unsetBackgroundColor().run() : chain.setBackgroundColor(color).run();
    return color == null ? chain.unsetColor().run() : chain.setColor(color).run();
}
