import { isTelemetrySenderAllowed } from './observabilityIpc.js';
import {
    captureTelemetrySession,
    isTelemetrySessionCurrent,
    isTelemetryTtsModelAllowed,
    trackTelemetryEvent,
} from './telemetry.js';

export function setupViewerTtsTelemetry({
    ipcMain,
    distIndexPath,
    devServerUrl,
    getSessionForSender,
    track = trackTelemetryEvent,
    captureSession = captureTelemetrySession,
    isSessionCurrent = isTelemetrySessionCurrent,
}) {
    const reported = new WeakMap();
    ipcMain.on('viewer:tts-used', (event, payload) => {
        try {
            if (!isTelemetrySenderAllowed(event, { distIndexPath, devServerUrl }) || !payload) return;
            const session = getSessionForSender(event.sender);
            if (!session || session.id !== payload.sessionId || session.preview
                || !['epub', 'text'].includes(session.type)) return;
            if (!isTelemetryTtsModelAllowed(payload.engine, payload.model)) return;
            const key = `${payload.engine}:${payload.model}`;
            const previous = reported.get(session);
            if (previous?.has(key) && isSessionCurrent(previous.get(key), 'usage')) return;
            const consent = captureSession();
            if (!track({
                event: 'viewer_tts_used',
                feature: 'viewer-tts',
                format: session.type,
                tts_engine: payload.engine,
                tts_model: payload.model,
            })) return;
            const models = previous || new Map();
            models.set(key, consent);
            reported.set(session, models);
        } catch {
            // Telemetry must not interrupt playback or window teardown.
        }
    });
}
