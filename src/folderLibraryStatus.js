const DEFAULT_SCANNING_HEARTBEAT_TIMEOUT_MS = 120000;

export function normalizeLibraryKey(folderPath = '') {
    return String(folderPath)
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();
}

export function formatLibraryRelativeTime(t, isoValue = '', nowMs = Date.now()) {
    const timestamp = Date.parse(isoValue);
    if (!Number.isFinite(timestamp)) return t('folder_library_never_scanned');
    const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
    if (seconds < 60) return t('folder_library_time_now');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('folder_library_time_minutes', [minutes]);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('folder_library_time_hours', [hours]);
    return t('folder_library_time_days', [Math.floor(hours / 24)]);
}

export function isLibraryScanning(state, options = {}) {
    if (state?.status !== 'scanning') return false;
    const checkedAt = Date.parse(state.lastCheckedAt || state.last_checked_at || '');
    if (!Number.isFinite(checkedAt)) return false;
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const timeoutMs = Number.isFinite(options.heartbeatTimeoutMs)
        ? options.heartbeatTimeoutMs
        : DEFAULT_SCANNING_HEARTBEAT_TIMEOUT_MS;
    return nowMs - checkedAt <= timeoutMs;
}

export function resolveLibraryStatus(state, options = {}) {
    if (!state) return 'pending';
    if (isLibraryScanning(state, options)) return 'scanning';
    if (state.status === 'scanning' || state.status === 'cancelled') return 'cancelled';
    if (state.status === 'error') return 'error';
    if (state.needsScan) return 'needs-scan';
    return 'ready';
}

export function libraryStatusClass(state, options = {}) {
    return resolveLibraryStatus(state, options);
}

export function libraryStatusText(t, state, options = {}) {
    const status = resolveLibraryStatus(state, options);
    if (status === 'pending') return t('folder_library_never_scanned');
    if (status === 'scanning') return t('folder_library_scanning');
    if (status === 'cancelled') return t('folder_library_scan_cancelled');
    if (status === 'error') return t('folder_library_scan_failed');
    if (!state.lastScannedAt) return t('folder_library_never_scanned');
    const relativeTime = formatLibraryRelativeTime(t, state.lastScannedAt, options.nowMs);
    const count = state.indexedCount || state.fileCount || 0;
    if (status === 'needs-scan') return t('folder_library_needs_scan');
    return count > 0
        ? t('folder_library_scan_meta', [count, relativeTime])
        : relativeTime;
}

export function shouldShowLibrarySyncButton(state, options = {}) {
    return ['pending', 'cancelled', 'error', 'needs-scan'].includes(resolveLibraryStatus(state, options));
}
