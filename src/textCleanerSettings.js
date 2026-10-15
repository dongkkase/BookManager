import { DEFAULT_TEXT_CLEANER_OPTIONS } from './textCleanerPolicy.js';

export const TEXT_CLEANER_SETTINGS_KEY = 'bookmanager.text-cleaner.settings';
export const TEXT_CLEANER_SETTINGS_VERSION = 1;
export const MAX_TEXT_CLEANER_PRESETS = 20;
export const MAX_TEXT_CLEANER_PRESET_NAME_LENGTH = 40;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeTextCleanerOptions(value) {
    const options = { ...DEFAULT_TEXT_CLEANER_OPTIONS };
    if (!isRecord(value)) return options;
    for (const [key, defaultValue] of Object.entries(DEFAULT_TEXT_CLEANER_OPTIONS)) {
        if (!Object.hasOwn(value, key)) continue;
        if (typeof defaultValue === 'boolean' && typeof value[key] === 'boolean') {
            options[key] = value[key];
        }
    }
    if (Object.hasOwn(value, 'paragraphIndentSize') && Number.isInteger(value.paragraphIndentSize)) {
        options.paragraphIndentSize = Math.min(8, Math.max(1, value.paragraphIndentSize));
    }
    if (Object.hasOwn(value, 'lineJoinMode') && ['space', 'word'].includes(value.lineJoinMode)) {
        options.lineJoinMode = value.lineJoinMode;
    }
    return options;
}

function presetNameError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function normalizePresetName(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw presetNameError('INVALID_PRESET_NAME');
    }
    const name = value.trim();
    if (name.length > MAX_TEXT_CLEANER_PRESET_NAME_LENGTH) {
        throw presetNameError('PRESET_NAME_TOO_LONG');
    }
    return name;
}

function normalizePresets(value) {
    if (!Array.isArray(value)) return [];
    const presets = [];
    const names = new Set();
    for (const preset of value) {
        if (!isRecord(preset) || !isRecord(preset.options)) continue;
        let name;
        try {
            name = normalizePresetName(preset.name);
        } catch {
            continue;
        }
        if (names.has(name)) continue;
        names.add(name);
        presets.push({ name, options: normalizeTextCleanerOptions(preset.options) });
        if (presets.length === MAX_TEXT_CLEANER_PRESETS) break;
    }
    return presets;
}

function normalizeSettings(value) {
    return {
        options: normalizeTextCleanerOptions(isRecord(value) ? value.options : null),
        presets: normalizePresets(isRecord(value) ? value.presets : null),
    };
}

export function readTextCleanerSettings(storage) {
    try {
        const source = storage === undefined ? globalThis.localStorage : storage;
        const saved = JSON.parse(source.getItem(TEXT_CLEANER_SETTINGS_KEY));
        if (isRecord(saved) && saved.version === TEXT_CLEANER_SETTINGS_VERSION) {
            return normalizeSettings(saved);
        }
    } catch {
        // Unavailable or damaged settings must not prevent opening the cleaner.
    }
    return normalizeSettings(null);
}

export function writeTextCleanerSettings(value, storage) {
    try {
        const destination = storage === undefined ? globalThis.localStorage : storage;
        const previous = destination.getItem(TEXT_CLEANER_SETTINGS_KEY);
        let saved;
        try {
            saved = JSON.parse(previous);
        } catch {
            // Invalid JSON can be replaced with a valid settings document.
        }
        if (isRecord(saved) && Object.hasOwn(saved, 'version')
            && saved.version !== TEXT_CLEANER_SETTINGS_VERSION) return false;
        destination.setItem(TEXT_CLEANER_SETTINGS_KEY, JSON.stringify({
            version: TEXT_CLEANER_SETTINGS_VERSION,
            ...normalizeSettings(value),
        }));
        return true;
    } catch {
        return false;
    }
}

export function upsertTextCleanerPreset(presets, name, options) {
    const normalizedName = normalizePresetName(name);
    const next = normalizePresets(presets);
    const index = next.findIndex(preset => preset.name === normalizedName);
    const preset = { name: normalizedName, options: normalizeTextCleanerOptions(options) };
    if (index >= 0) {
        next[index] = preset;
    } else {
        if (next.length >= MAX_TEXT_CLEANER_PRESETS) throw presetNameError('PRESET_LIMIT_EXCEEDED');
        next.push(preset);
    }
    return next;
}

export function removeTextCleanerPreset(presets, name) {
    const normalizedName = normalizePresetName(name);
    return normalizePresets(presets).filter(preset => preset.name !== normalizedName);
}
