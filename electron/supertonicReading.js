const VOICES = new Set(['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5']);
const QUOTES = { '"': '"', '“': '”', '「': '」', '『': '』' };
const CLOSING_QUOTES = new Set(Object.values(QUOTES));
const DIALOGUE_TURN_PAUSE = 0.45;

// Reading presets use the selected voice's existing embedding with a prepared tempo and pause.
export const SUPERTONIC_READING_PRESETS = [
    { id: 'audiobook', speed: 1, pause: 0.3 },
    { id: 'relaxed_audiobook', speed: 0.9, pause: 0.45 },
    { id: 'brisk_audiobook', speed: 1.15, pause: 0.2 },
    { id: 'conversation', speed: 1.05, pause: 0.18 },
    { id: 'calm_conversation', speed: 0.95, pause: 0.25 },
    { id: 'quick_conversation', speed: 1.15, pause: 0.1 },
];

export function supertonicReadingPresetId(profile) {
    if (profile?.customStyle) return '';
    return SUPERTONIC_READING_PRESETS.find(preset => (
        preset.speed === profile?.speed && preset.pause === profile?.pause
    ))?.id || '';
}

export function applySupertonicReadingPreset(profile, presetId) {
    const preset = SUPERTONIC_READING_PRESETS.find(item => item.id === presetId);
    if (!preset) return profile;
    return { ...profile, speed: preset.speed, pause: preset.pause, customStyle: null };
}

function bounded(value, fallback, min, max) {
    if (value === null || value === '' || typeof value === 'boolean') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function validateSupertonicStyle(value) {
    for (const [key, dimensions] of [['style_ttl', [1, 50, 256]], ['style_dp', [1, 8, 16]]]) {
        const tensor = value?.[key];
        if (!Array.isArray(tensor?.dims) || tensor.dims.join(',') !== dimensions.join(',') || !Array.isArray(tensor.data)) {
            throw new Error('Invalid Supertonic 3 voice style.');
        }
        const data = tensor.data.flat(3);
        if (data.length !== dimensions.reduce((a, b) => a * b)
            || data.some(number => typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 1e4)) {
            throw new Error('Invalid Supertonic 3 voice style data.');
        }
    }
    return {
        style_ttl: { dims: [1, 50, 256], data: value.style_ttl.data.flat(3) },
        style_dp: { dims: [1, 8, 16], data: value.style_dp.data.flat(3) },
    };
}

function normalizeProfile(value, speed, pause) {
    const profile = value && typeof value === 'object' ? value : {};
    let customStyle = null;
    if (profile.customStyle?.id && profile.customStyle?.data) {
        try {
            customStyle = {
                id: String(profile.customStyle.id).slice(0, 100),
                name: String(profile.customStyle.name || 'Custom').slice(0, 100),
                data: validateSupertonicStyle(profile.customStyle.data),
            };
        } catch {
            // Invalid saved styles fall back to the selected preset voice.
        }
    }
    const voice = String(profile.voice || '').toUpperCase();
    return {
        voice: VOICES.has(voice) ? voice : '',
        speed: bounded(profile.speed, speed, 0.5, 2),
        pause: bounded(profile.pause, pause, 0, 1.5),
        customStyle,
    };
}

export function normalizeSupertonicReading(value = {}) {
    const settings = value && typeof value === 'object' ? value : {};
    return {
        dialogueEnabled: settings.dialogueEnabled !== false,
        narration: normalizeProfile(settings.narration, 1, 0.3),
        dialogue: normalizeProfile(settings.dialogue, 1.05, 0.18),
        totalStep: Math.round(bounded(settings.totalStep, 8, 2, 12)),
        effectsMode: ['original', 'shorten', 'skip'].includes(settings.effectsMode) ? settings.effectsMode : 'shorten',
        effectsVolume: bounded(settings.effectsVolume, 0.7, 0.1, 1),
        effectsMaxSeconds: bounded(settings.effectsMaxSeconds, 2.5, 0.5, 5),
        effectsSoften: settings.effectsSoften !== false,
    };
}

export function supertonicReadingCacheKey(value) {
    const reading = normalizeSupertonicReading(value);
    return JSON.stringify({
        ...reading,
        narration: { ...reading.narration, customStyle: reading.narration.customStyle?.id || null },
        dialogue: { ...reading.dialogue, customStyle: reading.dialogue.customStyle?.id || null },
    });
}

export function splitSupertonicDialogue(text, initialQuotes = []) {
    const quotes = [...initialQuotes];
    const segments = [];
    let current = '';
    let group = 0;
    let previousGroup = -1;
    const flush = () => {
        if (current) {
            const dialogue = quotes.length > 0;
            const previous = segments.at(-1);
            if (previous?.dialogue === dialogue && previousGroup === group) previous.text += current;
            else segments.push({ text: current, dialogue });
            previousGroup = group;
        }
        current = '';
    };
    for (const character of String(text || '')) {
        if (quotes.length && character === quotes[quotes.length - 1]) {
            flush();
            if (quotes.length === 1 && previousGroup === group && segments.at(-1)?.dialogue) {
                segments.at(-1).closed = true;
            }
            quotes.pop();
            if (!quotes.length) group += 1;
        } else if (QUOTES[character]) {
            flush();
            if (!quotes.length) group += 1;
            quotes.push(QUOTES[character]);
        } else if (CLOSING_QUOTES.has(character)) {
            // A lone closing quote does not turn the following prose into dialogue.
            flush();
            group += 1;
        } else {
            current += character;
        }
    }
    flush();
    return { segments, quotes };
}

function quotedSegment(segment, close = true) {
    return segment.dialogue ? `“${segment.text}${close ? '”' : ''}` : segment.text;
}

export function prepareSupertonicPages(texts) {
    let quotes = [];
    return texts.map(text => {
        const parsed = splitSupertonicDialogue(text, quotes);
        quotes = parsed.quotes;
        return parsed.segments.map(segment => quotedSegment(segment)).join('');
    });
}

export function splitSupertonicRequests(text, maxLength = 900) {
    const limit = Math.max(16, Math.floor(maxLength));
    const requests = [];
    let current = '';
    for (const segment of splitSupertonicDialogue(text).segments) {
        let remaining = segment.text.trim();
        while (remaining) {
            const available = limit - current.length - (current ? 1 : 0) - (segment.dialogue ? 2 : 0);
            if (available < 8) {
                requests.push(current);
                current = '';
                continue;
            }
            let cut = Math.min(remaining.length, available);
            if (remaining.length > available) {
                const boundaries = [...remaining.slice(0, available).matchAll(/[\s.!?。！？]/gu)];
                const last = boundaries.at(-1);
                if (last && last.index >= available * 0.5) cut = last.index + 1;
                const previousCode = remaining.charCodeAt(cut - 1);
                if (previousCode >= 0xD800 && previousCode <= 0xDBFF) cut -= 1;
            }
            const piece = remaining.slice(0, cut).trim();
            if (piece) current += `${current ? ' ' : ''}${quotedSegment({ ...segment, text: piece }, Boolean(cut === remaining.length && segment.closed))}`;
            remaining = remaining.slice(cut).trim();
            if (remaining) {
                requests.push(current);
                current = '';
            }
        }
    }
    if (current) requests.push(current);
    return requests;
}

// Only isolated cries are matched; laughter, ordinary words and surrounding speech remain intact.
const CRY_PATTERN = /(?<![\p{L}\p{N}])(?:[으우꺄꺅끄크]?아{2,}[악앗]?|으{3,}[악아]?|꺄{2,}[악아]?|악{2,}|[꺄꺅]아*[악앗]|으아[악앗]|아[악앗]|[Aa]{3,}[Hh]*|[Aa][Aa][Hh]{2,}|[あぁアァ]{3,}[っッー]*|[きキ][ゃャ][あぁアァ]{2,}[っッー]*)(?![\p{L}\p{N}])[!！?？~〜….-]*/gu;

export function planSupertonicSpeech(text, options = {}, defaultVoice = 'M1') {
    const settings = normalizeSupertonicReading(options);
    const plan = [];
    let canMerge = true;
    const append = (text, profile, effect = false) => {
        const clean = text.trim();
        if (!/[\p{L}\p{N}]/u.test(clean)) return;
        const previous = plan.at(-1);
        const voice = profile.voice || defaultVoice;
        if (canMerge && !effect && previous && !previous.effect && previous.voice === voice
            && previous.customStyle?.id === profile.customStyle?.id
            && previous.speed === profile.speed && previous.pause === profile.pause) {
            previous.text += ` ${clean}`;
            return;
        }
        plan.push({
            text: clean,
            voice,
            customStyle: profile.customStyle,
            speed: profile.speed,
            pause: profile.pause,
            volume: effect ? settings.effectsVolume : 1,
            maxSeconds: effect ? settings.effectsMaxSeconds : null,
            effect,
            soften: effect && settings.effectsSoften,
        });
        canMerge = true;
    };
    for (const segment of splitSupertonicDialogue(text).segments) {
        const profile = settings.dialogueEnabled && segment.dialogue ? settings.dialogue : settings.narration;
        const segmentStart = plan.length;
        // Keep each outer quotation separate even when it uses the same voice and preset.
        canMerge = !settings.dialogueEnabled;
        if (settings.effectsMode === 'original') {
            append(segment.text, profile);
        } else {
            let start = 0;
            for (const match of segment.text.matchAll(CRY_PATTERN)) {
                append(segment.text.slice(start, match.index), profile);
                if (settings.effectsMode === 'shorten') {
                    const shortened = match[0].replace(/([아으꺄악AaHhあぁアァ])\1+/gu, '$1').replace(/[!！?？~〜….-]+$/u, '.');
                    append(shortened, profile, true);
                }
                start = match.index + match[0].length;
            }
            append(segment.text.slice(start), profile);
        }
        if (settings.dialogueEnabled && segment.closed && plan.length > segmentStart) {
            plan.at(-1).pauseAfter = Math.max(profile.pause, DIALOGUE_TURN_PAUSE);
        }
    }
    return plan;
}
