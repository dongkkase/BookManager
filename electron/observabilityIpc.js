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

export function setupTelemetryIPC({ ipcMain, distIndexPath, devServerUrl }) {
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
            stack: typeof payload.stack === 'string' ? payload.stack.slice(0, 12000) : '',
        };
        reportTelemetryError(error, {
            source: ['renderer', 'viewer', 'react', 'renderer-react', 'viewer-react', 'viewer-load'].includes(payload.source) ? payload.source : 'renderer',
        });
    });
}
