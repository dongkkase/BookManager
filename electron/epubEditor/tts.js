import { parseMediaUrl } from './authoring.js';

export const TTS_LIMITS = Object.freeze({ dictionary: 500, source: 200, replacement: 2000 });

const ID = /^[a-z][a-z0-9_-]{0,79}$/i;
const INVALID_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u;
const BRACKETED_TEXT = /\([^()]*\)|\[[^[\]]*\]|\{[^{}]*\}|（[^（）]*）|［[^［］]*］|【[^【】]*】/gu;
const BRACKET_CHARACTERS = /[()\[\]{}（）［］【】]/gu;

function validText(value, max, required = false) {
    return typeof value === 'string' && value.length <= max && !INVALID_CHARACTERS.test(value) && (!required || Boolean(value.trim()));
}

export function validTtsMark(attrs) {
    return Boolean(attrs && typeof attrs.id === 'string' && ID.test(attrs.id) && ['read', 'replace', 'skip'].includes(attrs.mode)
        && validText(attrs.text ?? '', TTS_LIMITS.replacement, attrs.mode === 'replace'));
}

export function validTtsSettings(settings) {
    if (!settings || !Array.isArray(settings.dictionary) || settings.dictionary.length > TTS_LIMITS.dictionary) return false;
    const ids = new Set();
    const sources = new Set();
    return settings.dictionary.every(entry => {
        if (!entry || typeof entry.id !== 'string' || !ID.test(entry.id) || ids.has(entry.id) || sources.has(entry.source)
            || !validText(entry.source, TTS_LIMITS.source, true) || !validText(entry.replacement, TTS_LIMITS.replacement, true)) return false;
        ids.add(entry.id);
        sources.add(entry.source);
        return true;
    });
}

function normalizeWhitespace(text) {
    return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeAutomaticText(text, preserveDialogue, tokens) {
    let result = String(text || '');
    const remove = match => tokens ? ` ${(match.match(tokens) || []).join(' ')} ` : ' ';
    let next = result.replace(BRACKETED_TEXT, remove);
    while (next !== result) {
        result = next;
        next = result.replace(BRACKETED_TEXT, remove);
    }
    return normalizeWhitespace(next.replace(BRACKET_CHARACTERS, ' ')
        .replace(preserveDialogue ? /[^\p{L}\p{N}\s.,!?;:。！？、'‘’`"“”「」『』]/gu : /[^\p{L}\p{N}\s.,!?;:。！？、'’]/gu, ' '));
}

export function normalizeTtsText(text = '', preserveDialogue = false) {
    return normalizeAutomaticText(text, preserveDialogue);
}

// Protected selections survive automatic bracket and symbol removal, including inside a parenthesis.
export function renderTtsSegments(segments, { preserveDialogue = false } = {}) {
    const source = segments.map(segment => String(segment.text || '')).join('');
    let prefix = 'BMttsProtected';
    while (source.includes(prefix)) prefix += 'X';
    const protectedText = [];
    const input = segments.map(segment => {
        if (!segment.protected) return String(segment.text || '');
        const index = protectedText.push(String(segment.text || '')) - 1;
        return `${prefix}${index}End`;
    }).join('');
    const tokens = new RegExp(`${prefix}(\\d+)End`, 'g');
    return normalizeWhitespace(normalizeAutomaticText(input, preserveDialogue, tokens)
        .replace(tokens, (_token, index) => protectedText[Number(index)]));
}

function ttsMark(node) {
    return node.marks?.find(mark => mark.type === 'tts' && validTtsMark(mark.attrs));
}

function dictionaryMatcher(dictionary) {
    const entries = dictionary.filter(entry => validText(entry?.source, TTS_LIMITS.source, true)
        && validText(entry?.replacement, TTS_LIMITS.replacement, true));
    if (!entries.length) return null;
    const replacements = new Map(entries.map(entry => [entry.source, entry.replacement]));
    const pattern = [...replacements.keys()].sort((a, b) => b.length - a.length)
        .map(source => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return { pattern: new RegExp(pattern, 'gu'), replacements };
}

// Materialize dictionary matches as inline annotations without changing visible text or formatting.
export function annotateTtsDocument(document, dictionary = [], context = { nextId: 0, usedIds: new Set() }) {
    const matcher = dictionaryMatcher(dictionary);
    if (!matcher) return document;
    const { usedIds } = context;
    const collectIds = node => {
        for (const mark of node.marks || []) if (mark.type === 'tts') usedIds.add(mark.attrs?.id);
        for (const child of node.content || []) collectIds(child);
    };
    const root = Array.isArray(document) ? { type: 'doc', content: document } : document;
    collectIds(root);
    const newId = () => {
        let id;
        do { id = `tts_dictionary_${context.nextId++}`; } while (usedIds.has(id));
        usedIds.add(id);
        return id;
    };
    function annotateRun(nodes) {
        const source = nodes.map(node => node.type === 'text' ? node.text : '\n').join('');
        const matches = [...source.matchAll(matcher.pattern)].map(match => ({
            start: match.index, end: match.index + match[0].length,
            mark: { type: 'tts', attrs: { id: newId(), mode: 'replace', text: matcher.replacements.get(match[0]) } },
        }));
        if (!matches.length) return nodes;
        let offset = 0;
        let matchIndex = 0;
        return nodes.flatMap(node => {
            const text = node.type === 'text' ? node.text : '\n';
            const result = [];
            const end = offset + text.length;
            let position = offset;
            while (position < end) {
                while (matches[matchIndex]?.end <= position) matchIndex += 1;
                const match = matches[matchIndex];
                const active = match && match.start <= position;
                const cut = Math.min(end, active ? match.end : match?.start ?? end);
                const piece = { ...node, ...(node.type === 'text' ? { text: text.slice(position - offset, cut - offset) } : {}) };
                if (active) piece.marks = [...(node.marks || []), match.mark];
                result.push(piece);
                position = cut;
            }
            offset = end;
            return result;
        });
    }
    function visit(node) {
        if (!node.content) return node;
        const content = [];
        let run = [];
        const flush = () => {
            content.push(...annotateRun(run));
            run = [];
        };
        for (const child of node.content) {
            if (['text', 'hardBreak'].includes(child.type) && !ttsMark(child)) run.push(child);
            else {
                flush();
                content.push(visit(child));
            }
        }
        flush();
        return { ...node, content };
    }
    const annotated = visit(root);
    return Array.isArray(document) ? annotated.content : annotated;
}

export function documentTtsPreview(document, dictionary = [], options = {}) {
    const annotated = annotateTtsDocument(document, dictionary);
    const root = Array.isArray(annotated) ? { type: 'doc', content: annotated } : annotated;
    const segments = [];
    const notes = [];
    const assets = new Map((options.assets || []).map(asset => [asset.id, asset]));
    let original = '';
    let previous = null;
    const boundary = () => {
        original += '\n\n';
        segments.push({ text: '\n\n' });
        previous = null;
    };
    const appendField = (value, useDictionary = true) => {
        const content = String(value || '').split('\n').flatMap((line, index) => [...(index ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]);
        const field = annotateTtsDocument({ type: 'doc', content }, useDictionary ? dictionary : []);
        for (const child of field.content) visit(child, true);
    };
    function visit(node, insideBlock = false) {
        if (!node) return;
        if (node.type === 'text' || node.type === 'hardBreak') {
            const text = node.type === 'text' ? node.text : '\n';
            original += text;
            const mark = ttsMark(node)?.attrs;
            if (!mark) {
                segments.push({ text });
                previous = null;
            } else {
                const continued = previous && previous.id === mark.id && previous.mode === mark.mode && previous.text === mark.text;
                segments.push({ text: mark.mode === 'read' ? text : mark.mode === 'replace' && !continued ? mark.text : '', protected: true });
                previous = mark;
            }
            return;
        }
        if (node.type === 'footnote') {
            const number = String(notes.push(node.attrs?.text || ''));
            original += number;
            segments.push({ text: number });
            previous = null;
            return;
        }
        if (node.type === 'image' || node.type === 'audio' || node.type === 'media') {
            const attrs = node.attrs || {};
            const value = node.type === 'image' ? attrs.caption : node.type === 'audio' ? attrs.title || assets.get(attrs.assetId)?.name : attrs.title || parseMediaUrl(attrs.url)?.provider;
            appendField(value, node.type !== 'media');
            if (!insideBlock && value) boundary();
            return;
        }
        const block = insideBlock || ['blockquote', 'bulletList', 'orderedList', 'table'].includes(node.type);
        for (const child of node.content || []) visit(child, block);
        if (!insideBlock && ['paragraph', 'heading', 'codeBlock', 'horizontalRule', 'blockquote', 'bulletList', 'orderedList', 'table'].includes(node.type)) boundary();
    }
    visit(root);
    notes.forEach((note, index) => {
        appendField(`${index + 1} ↩ `, false);
        appendField(note);
        boundary();
    });
    return { original: original.trim(), text: renderTtsSegments(segments, options) };
}
