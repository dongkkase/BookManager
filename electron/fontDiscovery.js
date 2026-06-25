import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const WINDOWS_FONT_KEYS = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
];

const FONT_STYLE_SUFFIX = [
    'Regular',
    'Bold',
    'Italic',
    'Oblique',
    'Bold Italic',
    'Bold Oblique',
    'Light',
    'Light Italic',
    'Medium',
    'Medium Italic',
    'SemiBold',
    'Semibold',
    'Semi Bold',
    'DemiBold',
    'Demi Bold',
    'ExtraLight',
    'Extra Light',
    'Thin',
    'Black',
    'Black Italic',
    'ExtraBold',
    'Extra Bold',
    'Condensed',
    'Condensed Bold',
];

const COMMON_SYSTEM_FONTS = {
    win32: [
        'Malgun Gothic',
        'Segoe UI',
        'Yu Gothic UI',
        'Arial',
        'Calibri',
        'Tahoma',
        'Verdana',
        'Times New Roman',
        'Consolas',
    ],
    darwin: [
        'Apple SD Gothic Neo',
        'SF Pro Text',
        'Helvetica Neue',
        'Arial',
        'Menlo',
        'Hiragino Sans',
    ],
    linux: [
        'Noto Sans',
        'DejaVu Sans',
        'Ubuntu',
        'Liberation Sans',
        'Arial',
    ],
};

const FONT_FILE_EXTENSIONS = new Set(['.ttf', '.ttc', '.otf']);

const BUNDLED_FONT_FAMILY_ALIASES = {
    Jua: 'Jua',
    NotoSansKR: 'Noto Sans KR',
    NanumGothic: 'Nanum Gothic',
    NanumGothicCoding: 'Nanum Gothic Coding',
};

function stripStyleSuffix(value = '') {
    let name = String(value || '').trim();
    let previous = '';
    while (name && name !== previous) {
        previous = name;
        for (const suffix of FONT_STYLE_SUFFIX) {
            const pattern = new RegExp(`(?:[-_\\s]+)${suffix.replace(/\s+/g, '[-_\\s]+')}$`, 'i');
            name = name.replace(pattern, '').trim();
        }
    }
    return name;
}

export function normalizeFontFamilyName(value = '') {
    const raw = String(value || '')
        .replace(/\0/g, '')
        .replace(/\s+\((?:TrueType|OpenType|Type 1|Raster|Vector|Collection)\)\s*$/i, '')
        .replace(/\.(?:ttf|ttc|otf|fon|pfm|pfb)$/i, '')
        .trim();
    if (!raw || raw.includes('\uFFFD') || /[\\/]/.test(raw) || raw.length > 80) return '';
    const name = stripStyleSuffix(raw);
    if (!name || name.length < 2 || /\.(?:ttf|ttc|otf|fon)$/i.test(name)) return '';
    return name;
}

export function uniqueFontFamilies(values = []) {
    const seen = new Set();
    const fonts = [];
    for (const value of values) {
        const font = normalizeFontFamilyName(value);
        if (!font) continue;
        const key = font.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        fonts.push(font);
    }
    return fonts.sort((a, b) => a.localeCompare(b));
}

function displayFontFamilyFromFilename(filename = '') {
    const stem = stripStyleSuffix(path.basename(String(filename || ''), path.extname(String(filename || '')))
        .replace(/\[[^\]]+\]$/g, '')
        .replace(/[-_]?VariableFont[-_\s]*[A-Za-z0-9,]+$/i, '')
        .replace(/[_-]+/g, ' ')
        .trim())
        .replace(/\s+/g, '');
    if (!stem) return '';
    if (BUNDLED_FONT_FAMILY_ALIASES[stem]) return BUNDLED_FONT_FAMILY_ALIASES[stem];
    return stem
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

function fontWeightFromFilename(filename = '') {
    const value = String(filename || '').toLowerCase();
    if (/extra[-_\s]?bold/.test(value)) return 800;
    if (/semi[-_\s]?bold|demi[-_\s]?bold/.test(value)) return 600;
    if (/bold/.test(value)) return 700;
    if (/medium/.test(value)) return 500;
    if (/extra[-_\s]?light/.test(value)) return 200;
    if (/light/.test(value)) return 300;
    if (/thin/.test(value)) return 100;
    if (/black|heavy/.test(value)) return 900;
    return 400;
}

function fontStyleFromFilename(filename = '') {
    return /italic|oblique/i.test(String(filename || '')) ? 'italic' : 'normal';
}

export function bundledFontFaceFromFile(filePath = '') {
    const filename = path.basename(String(filePath || ''));
    const ext = path.extname(filename).toLowerCase();
    if (!FONT_FILE_EXTENSIONS.has(ext)) return null;
    const family = displayFontFamilyFromFilename(filename);
    if (!family) return null;
    return {
        family,
        filename,
        path: filePath,
        weight: fontWeightFromFilename(filename),
        style: fontStyleFromFilename(filename),
        format: ext === '.otf' ? 'opentype' : 'truetype',
    };
}

export function listBundledFontFaces(fontDirectories = []) {
    const byKey = new Map();
    for (const directory of fontDirectories) {
        if (!directory || !fs.existsSync(directory)) continue;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            const face = bundledFontFaceFromFile(path.join(directory, entry.name));
            if (!face) continue;
            const key = `${face.family.toLocaleLowerCase()}:${face.weight}:${face.style}`;
            if (!byKey.has(key)) byKey.set(key, face);
        }
    }
    return [...byKey.values()].sort((a, b) => (
        a.family.localeCompare(b.family)
        || a.weight - b.weight
        || a.style.localeCompare(b.style)
        || a.filename.localeCompare(b.filename)
    ));
}

export function parseWindowsFontRegistryOutput(output = '') {
    const values = [];
    for (const line of String(output || '').split(/\r?\n/)) {
        const match = line.match(/^\s{2,}(.+?)\s+REG_\w+\s+(.+)$/);
        if (!match) continue;
        const displayName = match[1].trim();
        for (const part of displayName.split(/\s*&\s*/)) {
            values.push(part);
        }
    }
    return uniqueFontFamilies(values);
}

export function parseFontconfigOutput(output = '') {
    const values = [];
    for (const line of String(output || '').split(/\r?\n/)) {
        for (const family of line.split(',')) values.push(family);
    }
    return uniqueFontFamilies(values);
}

function collectProfilerFontNames(value, result = []) {
    if (!value || typeof value !== 'object') return result;
    if (Array.isArray(value)) {
        for (const item of value) collectProfilerFontNames(item, result);
        return result;
    }
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string' && /^(?:_name|family|fontFamily|displayName|fullName)$/i.test(key)) {
            result.push(item);
        } else if (item && typeof item === 'object') {
            collectProfilerFontNames(item, result);
        }
    }
    return result;
}

export function parseMacSystemProfilerOutput(output = '') {
    try {
        return uniqueFontFamilies(collectProfilerFontNames(JSON.parse(String(output || '{}'))));
    } catch {
        return [];
    }
}

function countReplacementCharacters(value = '') {
    return (String(value || '').match(/\uFFFD/g) || []).length;
}

export function decodeCommandOutput(output = Buffer.alloc(0), encodings = ['utf-8']) {
    const buffer = Buffer.isBuffer(output) ? output : Buffer.from(String(output || ''), 'utf8');
    if (buffer.length >= 2) {
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) return new TextDecoder('utf-16le').decode(buffer);
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) return new TextDecoder('utf-16be').decode(buffer);
    }

    const nullBytes = buffer.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
    if (nullBytes > buffer.length / 4) {
        return new TextDecoder('utf-16le').decode(buffer);
    }

    let bestText = buffer.toString('utf8');
    let bestScore = Number.POSITIVE_INFINITY;
    for (const encoding of encodings) {
        try {
            const text = new TextDecoder(encoding).decode(buffer);
            const score = countReplacementCharacters(text);
            if (score < bestScore) {
                bestText = text;
                bestScore = score;
            }
        } catch {
            // 지원하지 않는 인코딩은 건너뜁니다.
        }
    }
    return bestText;
}

async function execText(command, args = [], encodings = ['utf-8']) {
    const { stdout } = await execFileAsync(command, args, {
        encoding: 'buffer',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 3500,
        windowsHide: true,
    });
    return decodeCommandOutput(stdout || Buffer.alloc(0), encodings);
}

async function listWindowsFonts() {
    const fonts = [];
    for (const key of WINDOWS_FONT_KEYS) {
        try {
            fonts.push(...parseWindowsFontRegistryOutput(await execText('reg', ['query', key], ['utf-8', 'euc-kr'])));
        } catch {
            // 레지스트리 키가 없거나 접근할 수 없으면 다른 위치와 fallback을 사용합니다.
        }
    }
    return fonts;
}

async function listMacFonts() {
    try {
        return parseMacSystemProfilerOutput(await execText('system_profiler', ['SPFontsDataType', '-json']));
    } catch {
        return [];
    }
}

async function listLinuxFonts() {
    try {
        return parseFontconfigOutput(await execText('fc-list', [':', 'family']));
    } catch {
        return [];
    }
}

export async function listSystemFontFamilies(platform = process.platform) {
    const fallback = COMMON_SYSTEM_FONTS[platform] || COMMON_SYSTEM_FONTS.linux;
    const discovered = platform === 'win32'
        ? await listWindowsFonts()
        : platform === 'darwin'
            ? await listMacFonts()
            : await listLinuxFonts();
    return uniqueFontFamilies([...fallback, ...discovered]);
}
