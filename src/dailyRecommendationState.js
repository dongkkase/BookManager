import { readingStatePathKey } from './folderReadingStates.js';
import { createRecommendationPreferenceMatcher } from './recommendationPreferencesState.js';

export const DAILY_RECOMMENDATION_STORAGE_KEY = 'bookmanager.dashboard.dailyRecommendation';
export const DAILY_RECOMMENDATION_LIMIT = 8;
const RECOMMENDATION_BATCH_SIZE = 50;

export function dailyRecommendationDay(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function nextRecommendationDelay(date = new Date()) {
    return Math.max(1, new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - date.getTime());
}

export function readDailyRecommendation(storage) {
    try {
        const value = JSON.parse(storage?.getItem(DAILY_RECOMMENDATION_STORAGE_KEY) || 'null');
        return value?.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(value.day)
            && typeof value.path === 'string' && typeof value.previousPath === 'string'
            && (value.paths === undefined || (Array.isArray(value.paths) && value.paths.length <= DAILY_RECOMMENDATION_LIMIT
                && value.paths.every(path => typeof path === 'string' && path.length > 0)
                && new Set(value.paths).size === value.paths.length
                && (value.paths.length ? value.paths.includes(value.path) : value.path === '')))
            && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 0xffffffff ? value : null;
    } catch {
        return null;
    }
}

function candidateRank(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    return (hash ^ (hash >>> 16)) >>> 0;
}

function compareCandidates(left, right) {
    return left.rank - right.rank || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function siftDown(heap, start) {
    let parent = start;
    while (parent * 2 + 1 < heap.length) {
        let child = parent * 2 + 1;
        if (child + 1 < heap.length && compareCandidates(heap[child + 1], heap[child]) < 0) child += 1;
        if (compareCandidates(heap[parent], heap[child]) <= 0) break;
        [heap[parent], heap[child]] = [heap[child], heap[parent]];
        parent = child;
    }
}

function takeCandidate(heap) {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
        heap[0] = last;
        siftDown(heap, 0);
    }
    return first;
}

function recommendationText(value) {
    return String(value ?? '').normalize('NFKC').trim();
}

function metadataVolumeStart(value) {
    const text = recommendationText(value);
    if (/^(?:단권|단독권|one[ -]?shot|standalone)$/i.test(text)) return 1;
    const match = text.match(/^(?:(?:vol(?:ume)?|v|book)\.?\s*|제\s*)?([+-]?\d+(?:\.\d+)?)(?:\s*[권巻卷])?(?:\s*[~–-]\s*\d+(?:\.\d+)?(?:\s*[권巻卷])?)?$/i);
    return match ? Number(match[1]) : NaN;
}

function titleVolumeStart(value, series) {
    const text = recommendationText(value).replace(/\((?:19|20)\d{2}\)|\[(?:19|20)\d{2}\]/gu, '').trim();
    const marked = text.match(/(?:^|[\s_([{-])(?:vol(?:ume)?|v|book|part|ch(?:apter)?)\.?\s*(\d+(?:\.\d+)?|[ivxlcdm]+)(?=$|[^\p{L}\p{N}])/iu)
        || text.match(/(?:제\s*)?(\d+(?:\.\d+)?)(?:\s*[~–-]\s*\d+(?:\.\d+)?)?\s*(?:권|巻|卷|화|話)/u);
    if (marked) return marked[1].toLowerCase() === 'i' ? 1 : Number(marked[1]);
    const bracketed = text.match(/\S\s*[[(](\d+(?:\.\d+)?)(?:\s*[~–-]\s*\d+(?:\.\d+)?)?[\])]\s*(?:\[.*?\]|\(.*?\))?$/u);
    if (bracketed) return Number(bracketed[1]);
    // Unmarked digits need a series prefix; numeric book titles are not volume numbers.
    const prefix = recommendationText(series);
    if (prefix && text.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
        const suffix = text.slice(prefix.length).replace(/^[\s_.-]+/, '').replace(/\s*(?:\[.*?\]|\(.*?\))\s*$/u, '');
        if (/^\d+(?:\.\d+)?(?:\s*[~–-]\s*\d+(?:\.\d+)?)?$/u.test(suffix)) return metadataVolumeStart(suffix);
    }
    return null;
}

export function isDailyRecommendationEntryVolume(file) {
    const sources = [file, file?.metadata, file?.full_meta];
    const field = (...keys) => sources.flatMap(source => keys.map(key => source?.[key]))
        .find(value => value !== undefined && value !== null && recommendationText(value) !== '');
    const series = field('series', 'Series');
    const filename = String(file?.name || file?.full_path || file?.path || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const title = field('title', 'Title');
    const volume = field('volume', 'Volume');
    const numericTitle = recommendationText(filename).match(/^(\d+(?:\p{L}+\d+)*)$/u);
    const trailingDigits = numericTitle?.[1].match(/\d+$/u)?.[0];
    // The scanner also stores inferred volumes: 1984 -> 1984 and 1Q84 -> 84.
    if ((file?.has_metadata === false || file?.has_metadata === 0) && !file.metadata_override && trailingDigits
        && ![file.metadata?.Volume, file.full_meta?.Volume].some(value => recommendationText(value))
        && recommendationText(title) === numericTitle[1]
        && recommendationText(series) === numericTitle[1].slice(0, -trailingDigits.length)
        && Number(volume) === Number(trailingDigits)) return true;
    const positions = [filename, title].map(value => titleVolumeStart(value, series)).filter(value => value !== null);
    if (volume !== undefined) positions.push(metadataVolumeStart(volume));
    // Number can contain a text book's total chapter count, so it is not a volume signal.
    return positions.every(position => position === 1);
}

export function createDailyRecommendationIndex(files = [], platform = '', preferences) {
    const candidates = new Map();
    const matchesPreferences = createRecommendationPreferenceMatcher(preferences, platform);
    for (const file of Array.isArray(files) ? files : []) {
        const path = file?.full_path || file?.path;
        if (typeof path !== 'string' || !path || file.isDirectory || file.is_folder || file.exists === false
            || !matchesPreferences(file) || !isDailyRecommendationEntryVolume(file)) continue;
        const key = readingStatePathKey(path, platform);
        if (!candidates.has(key)) candidates.set(key, { file, path, key });
    }
    return candidates;
}

export async function findDailyRecommendation({
    files = [], day = dailyRecommendationDay(), record = null, seed = 0,
    request, readStatus, platform = '', isCurrent = () => true,
    preferDifferentFrom = '',
    candidates = createDailyRecommendationIndex(files, platform),
}) {
    if (!isCurrent()) return null;
    if (!candidates.size) return { file: null, sourceFile: null, record: null };
    if (typeof request !== 'function' || typeof readStatus !== 'function') throw new Error('reading_state_unavailable');

    const previousPath = record?.day === day ? record.previousPath : record?.path || '';
    const previousKey = readingStatePathKey(preferDifferentFrom || previousPath, platform);
    const savedKey = !preferDifferentFrom && record?.day === day ? readingStatePathKey(record.path, platform) : '';
    const result = (candidate, file) => ({
        file,
        sourceFile: candidate?.file || null,
        record: { version: 1, day, path: candidate?.path || '', previousPath, seed },
    });
    const checkBatch = async (batch, keepSelected = false) => {
        if (!isCurrent()) return null;
        const rows = await request(batch.map(candidate => candidate.path));
        if (!isCurrent()) return null;
        if (!Array.isArray(rows)) throw new Error('reading_state_unavailable');
        const states = new Map(rows.filter(row => row && typeof row.filePath === 'string' && !row.deletedAt)
            .map(row => [readingStatePathKey(row.filePath, platform), row]));
        for (const candidate of batch) {
            const file = { ...candidate.file, readingState: states.get(candidate.key) || null };
            const viewerStatus = readStatus(file);
            if (keepSelected || (!viewerStatus.isCompleted && !viewerStatus.hasReadingProgress)) {
                return result(candidate, { ...file, viewerStatus });
            }
        }
        return null;
    };

    const saved = candidates.get(savedKey);
    if (saved) {
        // Reading today's pick updates its status without choosing another book.
        const selected = await checkBatch([saved], true);
        if (!isCurrent()) return null;
        if (selected) return selected;
    }
    const previous = candidates.get(previousKey);
    const heap = [];
    for (const candidate of candidates.values()) {
        if (candidate.key !== savedKey && candidate.key !== previousKey) {
            heap.push({ ...candidate, rank: candidateRank(`${seed}|${day}|${candidate.key}`) });
        }
    }
    for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index -= 1) siftDown(heap, index);
    while (heap.length && isCurrent()) {
        const batch = [];
        while (heap.length && batch.length < RECOMMENDATION_BATCH_SIZE) batch.push(takeCandidate(heap));
        const selected = await checkBatch(batch);
        if (!isCurrent()) return null;
        if (selected) return selected;
    }
    if (previous && previous.key !== savedKey && isCurrent()) {
        const selected = await checkBatch([previous]);
        if (!isCurrent()) return null;
        if (selected) return selected;
    }
    return isCurrent() ? result(null, null) : null;
}

export async function findDailyRecommendations({
    files = [], day = dailyRecommendationDay(), record = null, seed = 0,
    request, readStatus, platform = '', isCurrent = () => true,
    preferDifferentFrom = '', count = DAILY_RECOMMENDATION_LIMIT, redraw = false,
    candidates = createDailyRecommendationIndex(files, platform),
}) {
    if (!isCurrent()) return null;
    if (!candidates.size) return { files: [], sourceFiles: [], file: null, sourceFile: null, record: null };
    if (typeof request !== 'function' || typeof readStatus !== 'function') throw new Error('reading_state_unavailable');

    const limit = Number.isInteger(count) ? Math.max(1, Math.min(DAILY_RECOMMENDATION_LIMIT, count)) : DAILY_RECOMMENDATION_LIMIT;
    const previousPath = record?.day === day ? record.previousPath : record?.path || '';
    const previousKey = readingStatePathKey(preferDifferentFrom || (redraw ? record?.path : '') || previousPath, platform);
    const priorPaths = record?.paths || (record?.path ? [record.path] : []);
    const priorKeys = new Set(redraw ? priorPaths.map(path => readingStatePathKey(path, platform)) : []);
    const sameDay = !redraw && !preferDifferentFrom && record?.day === day;
    const savedPaths = sameDay ? record.paths || [record.path] : [];
    const savedKeys = new Set();
    const saved = [];
    for (const path of savedPaths) {
        const key = readingStatePathKey(path, platform);
        const candidate = candidates.get(key);
        if (candidate && !savedKeys.has(key) && saved.length < limit) {
            savedKeys.add(key);
            saved.push(candidate);
        }
    }
    const selected = [];
    const checkBatch = async (batch, keepSelected = false) => {
        if (!isCurrent()) return;
        const rows = await request(batch.map(candidate => candidate.path));
        if (!isCurrent()) return;
        if (!Array.isArray(rows)) throw new Error('reading_state_unavailable');
        const states = new Map(rows.filter(row => row && typeof row.filePath === 'string' && !row.deletedAt)
            .map(row => [readingStatePathKey(row.filePath, platform), row]));
        for (const candidate of batch) {
            const file = { ...candidate.file, readingState: states.get(candidate.key) || null };
            const viewerStatus = readStatus(file);
            if (keepSelected || (!viewerStatus.isCompleted && !viewerStatus.hasReadingProgress)) {
                selected.push({ candidate, file: { ...file, viewerStatus } });
                if (selected.length === limit) break;
            }
        }
    };

    if (saved.length) await checkBatch(saved, true);
    if (!isCurrent()) return null;
    if (selected.length < limit) {
        const heaps = [[], []];
        for (const candidate of candidates.values()) {
            if (!savedKeys.has(candidate.key) && candidate.key !== previousKey) {
                heaps[priorKeys.has(candidate.key) ? 1 : 0].push({ ...candidate, rank: candidateRank(`${seed}|${day}|${candidate.key}`) });
            }
        }
        for (const heap of heaps) {
            if (selected.length === limit || !isCurrent()) break;
            for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index -= 1) siftDown(heap, index);
            while (heap.length && selected.length < limit && isCurrent()) {
                const batch = [];
                while (heap.length && batch.length < RECOMMENDATION_BATCH_SIZE) batch.push(takeCandidate(heap));
                await checkBatch(batch);
            }
        }
        const previous = candidates.get(previousKey);
        if (previous && !savedKeys.has(previousKey) && selected.length < limit && isCurrent()) await checkBatch([previous]);
    }
    if (!isCurrent()) return null;
    if (redraw && selected.length > 1 && selected.length === priorPaths.length
        && selected.every((entry, index) => entry.candidate.key === readingStatePathKey(priorPaths[index], platform))) {
        const offset = selected.findIndex((entry, index) => index > 0 && entry.candidate.key !== previousKey);
        selected.push(...selected.splice(0, offset > 0 ? offset : 1));
    }
    const activeKey = sameDay ? readingStatePathKey(record.path, platform) : '';
    const active = selected.find(entry => entry.candidate.key === activeKey) || selected[0];
    return {
        files: selected.map(entry => entry.file),
        sourceFiles: selected.map(entry => entry.candidate.file),
        file: active?.file || null,
        sourceFile: active?.candidate.file || null,
        record: { version: 1, day, path: active?.candidate.path || '', previousPath, seed,
            paths: selected.map(entry => entry.candidate.path) },
    };
}
