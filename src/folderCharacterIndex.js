const HANGUL_INITIALS = 'ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ';
const HANGUL_FINALS = 'ㄱㄱㄱㄴㄴㄴㄷㄹㄹㄹㄹㄹㄹㄹㄹㅁㅂㅂㅅㅅㅇㅈㅊㅋㅌㅍㅎ';
const HANGUL_INDEX_ORDER = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
const KANA_ROWS = [
    ['あ', 'ぁあぃいぅうぇえぉお'],
    ['か', 'かきくけこゕゖ'],
    ['さ', 'さしすせそ'],
    ['た', 'たちっつてと'],
    ['な', 'なにぬねの'],
    ['は', 'はひふへほ'],
    ['ま', 'まみむめも'],
    ['や', 'ゃやゅゆょよ'],
    ['ら', 'らりるれろ'],
    ['わ', 'ゎわゐゑをん'],
];
const KANA_INDEX_ORDER = KANA_ROWS.map(([label]) => label).join('');
const SMALL_KATAKANA = 'くしすとぬはひふへほむらりるれろ';
const SCRIPT_INDEX_GROUPS = [
    { representative: 'ㄱ', pattern: /^\p{Script=Hangul}/u },
    { representative: 'あ', pattern: /^[\p{Script=Hiragana}\p{Script=Katakana}]/u },
    { representative: 'A', pattern: /^\p{Script=Latin}/u },
    { representative: 'Α', pattern: /^\p{Script=Greek}/u },
    { representative: 'А', pattern: /^\p{Script=Cyrillic}/u },
    { representative: '一', pattern: /^\p{Script=Han}/u },
];

function createIndexContext(locale) {
    let collator;
    try {
        collator = new Intl.Collator(locale, { sensitivity: 'base' });
    } catch {
        collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    }
    const resolvedLocale = collator.resolvedOptions().locale;
    return {
        locale: resolvedLocale,
        collator,
        sortCollator: new Intl.Collator(resolvedLocale, { numeric: true }),
        segmenter: typeof Intl.Segmenter === 'function'
            ? new Intl.Segmenter(resolvedLocale, { granularity: 'grapheme' })
            : null,
    };
}

function firstGrapheme(value, segmenter) {
    if (segmenter) return segmenter.segment(value)[Symbol.iterator]().next().value?.segment || '';
    return value.match(/^\P{Mark}\p{Mark}*/u)?.[0] || Array.from(value)[0] || '';
}

function characterIndexLabel(name, context) {
    const grapheme = firstGrapheme(name.trimStart().normalize('NFKC'), context.segmenter);
    const first = Array.from(grapheme.normalize('NFD'))[0] || '';
    const codePoint = first.codePointAt(0);

    if (codePoint >= 0x1100 && codePoint <= 0x1112) return HANGUL_INITIALS[codePoint - 0x1100];
    if (codePoint >= 0x11a8 && codePoint <= 0x11c2) return HANGUL_FINALS[codePoint - 0x11a8];

    let kana = first;
    if (codePoint >= 0x30a1 && codePoint <= 0x30f6) kana = String.fromCodePoint(codePoint - 0x60);
    if (codePoint >= 0x31f0 && codePoint <= 0x31ff) kana = SMALL_KATAKANA[codePoint - 0x31f0];
    const kanaRow = KANA_ROWS.find(([, characters]) => characters.includes(kana) && kana);
    if (kanaRow) return kanaRow[0];

    if (/^\p{Number}/u.test(grapheme)) return '0–9';
    if (!/^\p{Letter}/u.test(grapheme)) return '#';

    const uppercase = grapheme.toLocaleUpperCase(context.locale).normalize('NFC');
    if (/^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(grapheme)) {
        // Cyrillic Ё/Й/Ї are distinct letters even when a base-strength collator equates them.
        const normalization = /^\p{Script=Cyrillic}/u.test(grapheme) ? 'NFC' : 'NFD';
        const base = uppercase.normalize(normalization).replace(/\p{Mark}/gu, '');
        // Preserve letters such as Swedish Å/Ä/Ö when the locale treats them as distinct.
        if (context.collator.compare(uppercase, base) === 0) {
            return firstGrapheme(base, context.segmenter);
        }
    }
    return uppercase;
}

function compareIndexLabels(left, right, collator) {
    const specialOrder = ['#', '0–9'];
    const leftSpecial = specialOrder.indexOf(left);
    const rightSpecial = specialOrder.indexOf(right);
    if (leftSpecial !== -1 || rightSpecial !== -1) {
        return (leftSpecial === -1 ? specialOrder.length : leftSpecial)
            - (rightSpecial === -1 ? specialOrder.length : rightSpecial);
    }
    const leftGroup = SCRIPT_INDEX_GROUPS.find(group => group.pattern.test(left));
    const rightGroup = SCRIPT_INDEX_GROUPS.find(group => group.pattern.test(right));
    if (leftGroup !== rightGroup) {
        if (!leftGroup) return 1;
        if (!rightGroup) return -1;
        // Fixed script representatives keep Korean Han readings out of the Hangul rail.
        return collator.compare(leftGroup.representative, rightGroup.representative)
            || SCRIPT_INDEX_GROUPS.indexOf(leftGroup) - SCRIPT_INDEX_GROUPS.indexOf(rightGroup);
    }
    for (const order of [HANGUL_INDEX_ORDER, KANA_INDEX_ORDER]) {
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
    }
    return collator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

export function buildFolderCharacterIndex(files = [], locale) {
    if (!Array.isArray(files) || files.length === 0) return [];
    const context = createIndexContext(locale);
    const entries = new Map();

    for (const file of files) {
        if (typeof file?.name !== 'string' || !file.name || typeof file.path !== 'string' || !file.path) continue;
        const label = characterIndexLabel(file.name, context);
        const existing = entries.get(label);
        if (existing) {
            existing.count += 1;
        } else {
            entries.set(label, { key: label, label, path: file.path, count: 1 });
        }
    }

    return Array.from(entries.values()).sort((left, right) => compareIndexLabels(left.label, right.label, context.sortCollator));
}
