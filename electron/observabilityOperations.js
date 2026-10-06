import { captureTelemetrySession, isTelemetrySessionCurrent, reportTelemetryError, trackTelemetryEvent } from './telemetry.js';

const CANCEL_CODES = new Set(['ABORT_ERR', 'CANCELED', 'CANCELLED', 'ERR_CANCELED', 'OPERATION_CANCELLED', 'TASK_CANCELLED']);
const EXPECTED_CODES = new Set([
    'ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'SESSION_CLOSED', 'PROJECT_BUSY',
    'INVALID_TARGET', 'INVALID_OPERATION', 'TEXT_SINGLE_FILE_REQUIRED', 'TEXT_FILE_REQUIRED',
    'TEXT_TOO_LARGE', 'TEXT_CHARACTERS_TOO_LARGE', 'TEXT_PARAGRAPHS_TOO_LARGE',
    'SOURCE_CHANGED', 'FILE_TOO_LARGE', 'OUTPUT_TOO_LARGE', 'ENCODING_UNDETECTED',
    'SYMLINK_UNSUPPORTED', 'NOT_A_FILE', 'INVALID_PATH', 'INVALID_CONTENT', 'UNSUPPORTED_FILE',
    'EPUB_INVALID', 'EPUB_TOO_LARGE', 'EPUB_ENCRYPTED', 'EPUB_RESOURCE_MISSING', 'EPUB_UNSUPPORTED_DOCUMENT',
]);

export function isCancelledOperation(value) {
    return value?.cancelled === true || value?.canceled === true
        || value?.name === 'AbortError' || CANCEL_CODES.has(value?.code)
        || CANCEL_CODES.has(value?.error?.code);
}

export function operationOutcome(result) {
    if (isCancelledOperation(result)) return 'feature_cancelled';
    if (result?.ok === false || result?.success === false || result?.stats?.error?.length > 0) {
        return 'feature_failed';
    }
    return 'feature_completed';
}

export function reportOperationError(error, feature, report = reportTelemetryError) {
    if (isCancelledOperation(error) || EXPECTED_CODES.has(error?.code)) return;
    report(error, { feature, source: 'ipc' });
}

export async function observeOperation(feature, action, options = {}) {
    const track = options.track || trackTelemetryEvent;
    const report = options.report || reportTelemetryError;
    const now = options.now || Date.now;
    const session = captureTelemetrySession();
    const isCurrent = options.isSessionCurrent || (channel => isTelemetrySessionCurrent(session, channel));
    const started = now();
    const properties = { feature, ...(options.format ? { format: options.format } : {}) };
    const accepted = track({ event: 'feature_started', ...properties });
    try {
        const result = await action();
        const outcome = operationOutcome(result);
        if (accepted && isCurrent('usage')) {
            track({ event: outcome, ...properties, ...(options.resultFormat ? { format: options.resultFormat(result) } : {}), duration_ms: Math.max(0, now() - started) });
        }
        if (outcome === 'feature_failed' && isCurrent('errors')) {
            reportOperationError(typeof result?.error === 'object' ? result.error : { name: 'Error', code: 'TASK_FAILED' }, feature, report);
        }
        return result;
    } catch (error) {
        if (accepted && isCurrent('usage')) {
            track({ event: isCancelledOperation(error) ? 'feature_cancelled' : 'feature_failed', ...properties, duration_ms: Math.max(0, now() - started) });
        }
        if (isCurrent('errors')) reportOperationError(error, feature, report);
        throw error;
    }
}

export function registerObservedHandler(ipcMain, channel, feature, handler) {
    ipcMain.handle(channel, (...args) => {
        const featureId = typeof feature === 'function' ? feature(...args) : feature;
        return featureId ? observeOperation(featureId, () => handler(...args)) : handler(...args);
    });
}
