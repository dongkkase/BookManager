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

export function reportTelemetryError(error, source = 'renderer', target = globalThis.window) {
    try {
        return sendToMain('reportTelemetryError', {
            name: boundedString(error?.name, 80) || 'Error',
            message: boundedString(typeof error === 'string' ? error : error?.message, 1024) || 'Unknown renderer error',
            stack: boundedString(error?.stack, 8192),
            source: boundedString(source, 64),
        }, target);
    } catch {
        return false;
    }
}

export function installTelemetryErrorHandlers({ target = globalThis.window, source = 'renderer' } = {}) {
    const onError = event => {
        try {
            if (event?.error || typeof event?.message === 'string') {
                reportTelemetryError(event.error || event.message, source, target);
            }
        } catch {
            // Error reporting must not change the original error handling.
        }
    };
    const onRejection = event => {
        try {
            reportTelemetryError(event?.reason, source, target);
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
