const EVENT_FIELDS = ['menu', 'tool', 'feature', 'format', 'source'];

function sendToMain(method, payload, target) {
    try {
        let api = target?.electronAPI;
        if (method === 'reportTelemetryError' && typeof api?.[method] !== 'function') api = target?.viewerAPI;
        if (typeof api?.[method] !== 'function') return false;
        Promise.resolve(api[method](payload)).catch(() => {});
        return true;
    } catch {
        return false;
    }
}

function boundedString(value, limit) {
    return typeof value === 'string' ? value.slice(0, limit) : '';
}

export function trackTelemetry(event, properties = {}, target = globalThis.window) {
    try {
        if (typeof event !== 'string' || !event) return false;
        const payload = { event: boundedString(event, 64) };
        for (const field of EVENT_FIELDS) {
            if (typeof properties?.[field] === 'string') {
                payload[field] = boundedString(properties[field], 64);
            }
        }
        if (Number.isFinite(properties?.duration_ms) && properties.duration_ms >= 0) {
            payload.duration_ms = Math.round(properties.duration_ms);
        }
        return sendToMain('trackTelemetry', payload, target);
    } catch {
        return false;
    }
}

export function reportTelemetryError(error, source = 'renderer', target = globalThis.window, diagnostics = {}) {
    try {
        const payload = {
            name: boundedString(error?.name, 80) || 'Error',
            message: boundedString(typeof error === 'string' ? error : error?.message, 1024) || 'Unknown renderer error',
            stack: boundedString(error?.stack, 8192),
            source: boundedString(source, 64),
        };
        const code = boundedString(error?.code, 80);
        if (code) payload.code = code;
        if (diagnostics?.error_kind === 'uncaught-error' || diagnostics?.error_kind === 'unhandled-rejection') {
            payload.error_kind = diagnostics.error_kind;
        }
        if (payload.error_kind === 'unhandled-rejection') {
            payload.rejection_type = error === null ? 'null' : typeof error;
        }
        const filename = boundedString(diagnostics?.filename, 4096);
        if (filename) payload.filename = filename;
        for (const field of ['lineno', 'colno']) {
            const value = diagnostics?.[field];
            if (Number.isSafeInteger(value) && value > 0 && value <= 10000000) {
                payload[field] = value;
            }
        }
        return sendToMain('reportTelemetryError', payload, target);
    } catch {
        return false;
    }
}

export function installTelemetryErrorHandlers({ target = globalThis.window, source = 'renderer' } = {}) {
    const onError = event => {
        try {
            if (event?.error || typeof event?.message === 'string') {
                reportTelemetryError(event.error || event.message, source, target, {
                    error_kind: 'uncaught-error',
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                });
            }
        } catch {
            // Error reporting must not change the original error handling.
        }
    };
    const onRejection = event => {
        try {
            reportTelemetryError(event?.reason, source, target, { error_kind: 'unhandled-rejection' });
        } catch {
            // Rejected telemetry requests must not create another rejection.
        }
    };
    const dispose = () => {
        try {
            target?.removeEventListener?.('error', onError);
            target?.removeEventListener?.('unhandledrejection', onRejection);
        } catch {
            // A destroyed window does not need its error listeners removed.
        }
    };
    try {
        target?.addEventListener?.('error', onError);
        target?.addEventListener?.('unhandledrejection', onRejection);
    } catch {
        dispose();
    }
    return dispose;
}
