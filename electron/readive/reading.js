import { fail } from './policy.js';
import { openFrozenAsset } from './manifest.js';

const LOCATOR_KEYS = new Set(['kind', 'normalizedPosition', 'pageIndex', 'pageCount', 'positionSeconds', 'durationSeconds', 'sourceOffset', 'sectionHref']);
const KINDS = new Set(['page', 'normalized', 'audio-time', 'text-offset', 'epub-text']);

export function validateReadingRecord(record, deviceId, now = Date.now()) {
    if (!record || record.deviceId !== deviceId || typeof record.itemId !== 'string' || record.itemId.length > 100
        || !/^[a-f0-9]{64}$/.test(record.contentHash) || !Number.isSafeInteger(record.revision) || record.revision < 1
        || !['unread', 'reading', 'completed'].includes(record.readStatus)) throw fail('invalid_reading_record');
    if (typeof record.updatedAt !== 'string') throw fail('invalid_reading_time');
    for (const value of [record.updatedAt, record.lastReadAt]) {
        if (value === null) continue;
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now + 5 * 60 * 1000) throw fail('invalid_reading_time');
    }
    const locator = record.locator;
    if (!locator || !KINDS.has(locator.kind) || Object.keys(locator).some(key => !LOCATOR_KEYS.has(key))) throw fail('invalid_reading_locator');
    for (const [key, value] of Object.entries(locator)) {
        if (key === 'kind') continue;
        if (key === 'sectionHref') {
            if (typeof value !== 'string' || value.length > 2048) throw fail('invalid_reading_locator');
        } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (key === 'normalizedPosition' && value > 1)) throw fail('invalid_reading_locator');
    }
    if ((locator.kind === 'page' && locator.pageIndex === undefined)
        || (locator.kind === 'normalized' && locator.normalizedPosition === undefined)
        || (locator.kind === 'audio-time' && locator.positionSeconds === undefined)) throw fail('invalid_reading_locator');
    for (const key of ['pageIndex', 'pageCount', 'sourceOffset']) {
        if (locator[key] !== undefined && !Number.isSafeInteger(locator[key])) throw fail('invalid_reading_locator');
    }
    return { itemId: record.itemId, contentHash: record.contentHash, deviceId, revision: record.revision, updatedAt: new Date(record.updatedAt).toISOString(), lastReadAt: record.lastReadAt ? new Date(record.lastReadAt).toISOString() : null, readStatus: record.readStatus, locator: { ...locator } };
}

export function newerReading(left, right) {
    if (!right) return true;
    if (left.deviceId === right.deviceId) return left.revision > right.revision;
    return Date.parse(left.updatedAt) > Date.parse(right.updatedAt)
        || (Date.parse(left.updatedAt) === Date.parse(right.updatedAt) && left.deviceId.localeCompare(right.deviceId) > 0);
}

function rowLocator(row) {
    let locator;
    try { locator = JSON.parse(row.locator_json); } catch { locator = {}; }
    const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    if (row.format === 'audio') return { kind: 'audio-time', positionSeconds: number(row.position_seconds), durationSeconds: number(row.duration_seconds) };
    if (KINDS.has(locator.kind)) {
        if (locator.kind === 'page') return { kind: 'page', pageIndex: Math.floor(number(row.page_index)), pageCount: Math.floor(number(row.page_count)) };
        const clean = { kind: locator.kind };
        for (const key of LOCATOR_KEYS) {
            if (key === 'kind' || locator[key] === null || locator[key] === undefined) continue;
            if (key === 'sectionHref') {
                if (typeof locator[key] === 'string' && locator[key].length <= 2048) clean[key] = locator[key];
            } else {
                const value = number(locator[key]);
                clean[key] = key === 'normalizedPosition' ? Math.min(1, value)
                    : ['pageIndex', 'pageCount', 'sourceOffset'].includes(key) ? Math.floor(value) : value;
            }
        }
        return clean;
    }
    const fraction = row.page_count > 1 ? row.page_index / (row.page_count - 1) : 0;
    if (row.format === 'epub' || row.format === 'text') return { kind: 'normalized', normalizedPosition: Math.min(1, Math.max(0, fraction)) };
    return { kind: 'page', pageIndex: Math.floor(number(row.page_index)), pageCount: Math.floor(number(row.page_count)) };
}

export function readingStateProjection(record, previous = {}) {
    const locator = record.locator;
    const count = locator.pageCount ?? previous.page_count ?? 0;
    return {
        locator,
        updatedAt: record.updatedAt,
        readStatus: record.readStatus,
        pageIndex: locator.pageIndex ?? Math.round((locator.normalizedPosition || 0) * Math.max(0, count - 1)),
        pageCount: count,
        scrollPercent: (locator.normalizedPosition || 0) * 100,
        positionSeconds: locator.positionSeconds || 0,
        durationSeconds: locator.durationSeconds ?? previous.duration_seconds ?? 0,
        status: record.readStatus,
        lastReadAt: record.lastReadAt || record.updatedAt,
    };
}

export function readingRowSignature(row) {
    return JSON.stringify([row.page_index, row.scroll_percent, row.position_seconds, row.status]);
}

function readingSignature(record) {
    return { itemId: record.itemId, contentHash: record.contentHash, deviceId: record.deviceId, revision: record.revision };
}

function knownReadingSignatures(values, allowed, selectedIds) {
    if (values === undefined) return new Map();
    if (!Array.isArray(values) || values.length > 500) throw fail('invalid_known_reading');
    const known = new Map();
    const seen = new Set();
    for (const value of values) {
        if (!value || typeof value.itemId !== 'string' || !value.itemId || value.itemId.length > 100
            || typeof value.deviceId !== 'string' || !value.deviceId || value.deviceId.length > 100
            || !/^[a-f0-9]{64}$/.test(value.contentHash) || !Number.isSafeInteger(value.revision) || value.revision < 1
            || Object.keys(value).some(key => !['itemId', 'contentHash', 'deviceId', 'revision'].includes(key))
            || seen.has(value.itemId)) throw fail('invalid_known_reading');
        seen.add(value.itemId);
        if (selectedIds && !selectedIds.has(value.itemId)) throw fail('unshared_reading_item', 403);
        if (selectedIds && !allowed.has(value.itemId)) continue;
        if (allowed.get(value.itemId)?.contentHash !== value.contentHash) throw fail('unshared_reading_item', 403);
        known.set(value.itemId, value);
    }
    return known;
}

export async function exchangeReading(state, device, records, libraryDb, itemIds, options = {}) {
    if (!Array.isArray(records) || records.length > 2000) throw fail('invalid_reading_batch');
    const sharedItems = Object.values(state.items).filter(item => item.deviceIds.includes(device.id));
    let items = sharedItems;
    let selectedIds;
    if (itemIds !== undefined) {
        if (!Array.isArray(itemIds) || itemIds.length > 500 || itemIds.some(id => typeof id !== 'string' || !id || id.length > 100)
            || new Set(itemIds).size !== itemIds.length) throw fail('invalid_reading_selection');
        const sharedById = new Map(sharedItems.map(item => [item.itemId, item]));
        selectedIds = new Set(itemIds);
        items = itemIds.flatMap(id => sharedById.has(id) ? [sharedById.get(id)] : []);
    }
    if (items.length > 2000) throw fail('too_many_reading_items', 409);
    const available = new Set();
    for (const item of items) {
        try {
            if (item.identity) {
                const handle = await openFrozenAsset(item);
                await handle.close();
            }
            available.add(item.itemId);
        } catch {
            // Keep history for removed or replaced sources without applying it to a different file.
        }
    }
    const allowed = new Map(items.map(item => [item.itemId, item]));
    const valid = records.flatMap(record => {
        const next = validateReadingRecord(record, device.id);
        if (selectedIds && !selectedIds.has(next.itemId)) throw fail('unshared_reading_item', 403);
        // A re-registered device can still send IDs from earlier downloads.
        if (selectedIds && !allowed.has(next.itemId)) return [];
        if (allowed.get(next.itemId)?.contentHash !== next.contentHash) throw fail('unshared_reading_item', 403);
        return [next];
    });
    const known = knownReadingSignatures(options.knownReadings, allowed, selectedIds);
    const report = options.report || {};
    report.changed = false;
    report.readingChanged = false;
    report.acknowledged = [];
    const db = libraryDb?.getConnection();
    for (const item of items) {
        if (!available.has(item.itemId)) continue;
        const row = db?.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(libraryDb.normalizeFilePath(item.sourcePath));
        const applied = state.appliedReadings[item.itemId];
        const baseline = item.localReadingBaseline;
        if (row && baseline && (row.revision <= baseline.revision || readingRowSignature(row) === baseline.signature)) continue;
        if (row && row.deleted_at === '' && (!applied || !matchesAppliedPosition(row, applied.record))) {
            const local = {
                itemId: item.itemId, contentHash: item.contentHash, deviceId: state.serverId,
                revision: row.revision, updatedAt: new Date(row.updated_at).toISOString(),
                lastReadAt: row.last_read_at && Number.isFinite(Date.parse(row.last_read_at)) ? new Date(row.last_read_at).toISOString() : null,
                readStatus: row.status, locator: rowLocator(row),
            };
            const key = `${item.itemId}:${state.serverId}`;
            if (!state.reading[key] || local.revision > state.reading[key].revision) {
                state.reading[key] = local;
                report.changed = true;
                report.readingChanged = true;
            }
            if (item.localReadingBaseline) {
                delete item.localReadingBaseline;
                report.changed = true;
            }
        }
    }
    for (const next of valid) {
        const key = `${next.itemId}:${device.id}`;
        if (!state.reading[key] || next.revision > state.reading[key].revision) {
            state.reading[key] = next;
            report.changed = true;
        }
    }
    const acknowledged = new Map();
    for (const next of valid) {
        const stored = state.reading[`${next.itemId}:${device.id}`];
        if (stored?.revision === next.revision && stored.contentHash === next.contentHash) acknowledged.set(next.itemId, readingSignature(stored));
    }
    report.acknowledged = [...acknowledged.values()];
    const winnersById = new Map();
    for (const record of Object.values(state.reading)) {
        if (allowed.has(record.itemId) && newerReading(record, winnersById.get(record.itemId))) winnersById.set(record.itemId, record);
    }
    const winners = [];
    for (const item of items) {
        const winner = winnersById.get(item.itemId);
        if (!winner) continue;
        const previous = known.get(item.itemId);
        if (!previous || previous.contentHash !== winner.contentHash || previous.deviceId !== winner.deviceId || previous.revision !== winner.revision) winners.push(winner);
        const applied = state.appliedReadings[item.itemId];
        if (libraryDb && available.has(item.itemId) && winner.deviceId !== state.serverId && (!applied || newerReading(winner, applied.record))) {
            const row = db.prepare('SELECT * FROM reading_states WHERE file_path = ?').get(libraryDb.normalizeFilePath(item.sourcePath));
            const saved = await libraryDb.upsertReadingState(item.sourcePath, { ...readingStateProjection(winner, row), format: item.format });
            state.appliedReadings[item.itemId] = { record: winner, localRevision: saved.revision };
            report.changed = true;
            report.readingChanged = true;
        }
    }
    return winners.slice(0, 2000);
}

function matchesAppliedPosition(row, record) {
    const projected = readingStateProjection(record, row);
    return row.page_index === projected.pageIndex
        && row.position_seconds === projected.positionSeconds
        && Math.abs(row.scroll_percent - projected.scrollPercent) < 0.00001
        && row.status === projected.status;
}

export async function getImportedReadingState(state, filePath, libraryDb) {
    const normalizedPath = libraryDb.normalizeFilePath(filePath);
    const candidates = Object.values(state.items).filter(value => libraryDb.normalizeFilePath(value.sourcePath) === normalizedPath).reverse();
    for (const item of candidates) {
        const applied = state.appliedReadings[item.itemId];
        if (!applied) continue;
        if (item.identity) {
            try {
                const handle = await openFrozenAsset(item);
                await handle.close();
            } catch { continue; }
        }
        const row = libraryDb.getConnection().prepare('SELECT * FROM reading_states WHERE file_path = ?').get(normalizedPath);
        if (!row || !matchesAppliedPosition(row, applied.record)) continue;
        return readingStateProjection(applied.record, row);
    }
    return null;
}
