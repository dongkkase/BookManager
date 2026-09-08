function timestamp(value) {
    const result = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(result) ? result : 0;
}

export function mergeReadiveResumeState(local = {}, remote = null) {
    if (!remote || timestamp(local.updatedAt) > timestamp(remote.updatedAt)) return local;
    const next = { ...local, updatedAt: remote.updatedAt, readiveLocator: remote.locator || null };
    for (const key of ['pageIndex', 'pageCount', 'scrollPercent', 'positionSeconds', 'durationSeconds']) {
        if (Number.isFinite(remote[key]) && remote[key] >= 0) next[key] = remote[key];
    }
    if (Number.isFinite(remote.locator?.normalizedPosition)) {
        next.scrollPercent = Math.max(0, Math.min(1, remote.locator.normalizedPosition)) * 100;
    }
    return next;
}

export function resolveReadiveResumePage(state = {}, { type, pageCount = 0, epubPages = [], textPages = [] } = {}) {
    const clamp = value => Math.max(0, Math.min(Math.max(0, pageCount - 1), Math.floor(Number(value) || 0)));
    const locator = state.readiveLocator;
    if (!locator || locator.kind === 'page') return clamp(locator?.pageIndex ?? state.pageIndex);
    if (locator.kind === 'epub-text' && locator.sectionHref) {
        const indices = epubPages.flatMap((page, index) => page.name === locator.sectionHref ? [index] : []);
        if (indices.length) {
            let offset = Math.max(0, Number(locator.sourceOffset) || 0);
            for (const index of indices) {
                const length = String(epubPages[index].text || '').length;
                if (offset < length) return clamp(index);
                offset -= length;
            }
            return clamp(indices.at(-1));
        }
    }
    if (type === 'text' && locator.kind === 'text-offset' && Number.isFinite(locator.sourceOffset)) {
        let offset = Math.max(0, locator.sourceOffset);
        for (let index = 0; index < textPages.length; index += 1) {
            if (offset < textPages[index].length) return clamp(index);
            offset -= textPages[index].length;
        }
        return clamp(pageCount - 1);
    }
    const normalized = Number(locator.normalizedPosition);
    if (Number.isFinite(normalized)) return clamp(normalized * Math.max(0, pageCount - 1));
    return clamp(state.pageIndex);
}
