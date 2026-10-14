import { pathToFileURL } from 'node:url';
import { getTelemetryStatus, reportTelemetryError, trackTelemetryEvent } from './telemetry.js';

export function isTelemetrySenderAllowed(event, { distIndexPath, devServerUrl }) {
    try {
        if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
        const actual = new URL(event.senderFrame.url);
        const allowed = [pathToFileURL(distIndexPath)];
        if (devServerUrl) allowed.push(new URL(devServerUrl));
        return allowed.some(url => actual.protocol === url.protocol
            && actual.host === url.host && actual.pathname === url.pathname);
    } catch {
        return false;
    }
}

export function setupTelemetryIPC({ ipcMain, distIndexPath, devServerUrl, report = reportTelemetryError }) {
    const isAllowed = event => isTelemetrySenderAllowed(event, { distIndexPath, devServerUrl });
    ipcMain.handle('telemetry:status', event => isAllowed(event) ? getTelemetryStatus() : {});
    ipcMain.on('telemetry:event', (event, payload) => {
        if (!isAllowed(event)) return;
        // Operation results are recorded by the main process, never by arbitrary renderer payloads.
        if (!['menu_opened', 'tool_opened'].includes(payload?.event)) return;
        trackTelemetryEvent(payload);
    });
    ipcMain.on('telemetry:error', (event, payload) => {
        if (!isAllowed(event) || !payload || typeof payload !== 'object') return;
        const error = {
            name: typeof payload.name === 'string' ? payload.name.slice(0, 80) : 'Error',
            code: typeof payload.code === 'string' ? payload.code.slice(0, 80) : '',
            stack: typeof payload.stack === 'string' ? payload.stack.slice(0, 12000) : '',
            filename: typeof payload.filename === 'string' ? payload.filename.slice(0, 4096) : '',
            lineno: payload.lineno,
            colno: payload.colno,
        };
        report(error, {
            source: ['renderer', 'viewer', 'react', 'renderer-react', 'viewer-react', 'viewer-load'].includes(payload.source) ? payload.source : 'renderer',
            error_kind: ['uncaught-error', 'unhandled-rejection'].includes(payload.error_kind) ? payload.error_kind : undefined,
        });
    });
}
