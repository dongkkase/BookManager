const emptyState = (deviceId = '', running = false) => ({ deviceId, running, page: null, trail: [], loading: false, error: false, selection: null });

export function createReadiveDestinationBrowser({ requestPage, isDeviceActive = () => true }) {
    let state = emptyState();
    let generation = 0;
    let disposed = false;
    const listeners = new Set();
    const cursors = new Set();
    const publish = next => {
        state = { ...state, ...next };
        listeners.forEach(listener => listener(state));
    };
    const active = () => !disposed && state.running && Boolean(state.deviceId) && isDeviceActive(state.deviceId);
    const load = async (parentId, trail, cursor = null) => {
        if (!active() || state.loading) return;
        const current = ++generation;
        const deviceId = state.deviceId;
        const previous = cursor ? state.page : null;
        if (!cursor) cursors.clear();
        publish({ loading: true, error: false, selection: null, page: previous, trail });
        const isCurrent = () => current === generation && state.deviceId === deviceId && active();
        try {
            const result = await requestPage({ deviceId, parentId, cursor });
            if (!isCurrent()) return;
            if (!result || result.parentId !== parentId || typeof result.name !== 'string' || !result.name.trim()
                || typeof result.revision !== 'string' || !result.revision || !Array.isArray(result.entries)
                || result.entries.length > 100 || (result.nextCursor !== null && (typeof result.nextCursor !== 'string' || !result.nextCursor))) throw new Error('invalid_page');
            if (result.entries.some(entry => !entry || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string'
                || !['directory', 'file'].includes(entry.kind) || (entry.size !== null && (!Number.isSafeInteger(entry.size) || entry.size < 0)))) throw new Error('invalid_entry');
            if (new Set(result.entries.map(entry => entry.id)).size !== result.entries.length) throw new Error('duplicate_entry');
            if ((cursor && previous?.revision !== result.revision) || (result.nextCursor && (result.nextCursor === cursor || cursors.has(result.nextCursor)))) throw new Error('changed_page');
            const entries = [...new Map([...(previous?.entries ?? []), ...result.entries].map(entry => [entry.id, entry])).values()];
            if (entries.length > 100000 || cursors.size >= 1000) throw new Error('page_limit');
            if (cursor) cursors.add(cursor);
            const nextTrail = trail.length ? [...trail.slice(0, -1), { id: parentId, name: result.name }] : [{ id: parentId, name: result.name }];
            publish({ page: { ...result, entries }, trail: nextTrail });
        } catch {
            if (isCurrent()) publish({ error: true, selection: null });
        } finally {
            if (isCurrent()) publish({ loading: false });
        }
    };
    return {
        getSnapshot: () => state,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        setDevice(deviceId, running) {
            if (disposed || (state.deviceId === deviceId && state.running === running)) return;
            generation += 1;
            cursors.clear();
            publish(emptyState(deviceId, running));
            if (active()) void load(null, []);
        },
        open(id) {
            if (!active() || state.loading || state.error) return false;
            const entry = state.page?.entries.find(value => value.id === id && value.kind === 'directory');
            if (!entry) return false;
            void load(entry.id, [...state.trail, { id: entry.id, name: entry.name }]);
            return true;
        },
        back() {
            if (!active() || state.loading || state.trail.length < 2) return;
            const trail = state.trail.slice(0, -1);
            void load(trail.at(-1).id, trail);
        },
        refresh() {
            if (!active() || state.loading) return;
            void load(state.trail.at(-1)?.id ?? null, state.trail);
        },
        more() {
            if (!active() || state.loading || state.error || !state.page?.nextCursor) return;
            void load(state.page.parentId, state.trail, state.page.nextCursor);
        },
        choose() {
            if (!active() || state.loading || state.error || !state.page) return null;
            const name = state.trail.map(entry => entry.name).join(' / ').slice(0, 512).replace(/[\uD800-\uDBFF]$/, '');
            const selection = { deviceId: state.deviceId, collectionId: state.page.parentId, name, revision: state.page.revision };
            publish({ selection });
            return selection;
        },
        dispose() {
            disposed = true;
            generation += 1;
            state = emptyState();
            listeners.clear();
        },
    };
}
