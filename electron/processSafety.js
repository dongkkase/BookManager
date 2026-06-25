import fs from 'fs';
import path from 'path';

import { isBrokenPipeError } from './utils/consolePipeGuard.js';

const DEFAULT_MAX_LOG_BYTES = 1024 * 1024;
const CLEAN_RENDERER_EXIT_REASON = 'clean-exit';

function safeJson(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, item) => {
        if (!item || typeof item !== 'object') return item;
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
        return item;
    }, 2);
}

export function formatFaultDetails(details) {
    if (details instanceof Error || details?.stack || details?.message) {
        const message = details.stack || `${details.name || 'Error'}: ${details.message || ''}`;
        const extra = {};
        for (const key of Object.keys(details)) {
            extra[key] = details[key];
        }
        return Object.keys(extra).length > 0
            ? `${message}\n${safeJson(extra)}`
            : message;
    }

    if (typeof details === 'string') return details;
    try {
        return safeJson(details);
    } catch {
        return String(details);
    }
}

export function writeProcessFaultLog(logPath, eventName, details, context = {}, options = {}) {
    if (!logPath) return false;

    const fsTarget = options.fs || fs;
    const now = options.now || (() => new Date());
    const maxBytes = options.maxBytes || DEFAULT_MAX_LOG_BYTES;

    try {
        fsTarget.mkdirSync(path.dirname(logPath), { recursive: true });
        try {
            const stats = fsTarget.statSync(logPath);
            if (stats.size > maxBytes) {
                fsTarget.rmSync(`${logPath}.1`, { force: true });
                fsTarget.renameSync(logPath, `${logPath}.1`);
            }
        } catch {
            // Missing or temporarily inaccessible logs should not interrupt the app.
        }

        const contextText = context && Object.keys(context).length > 0
            ? `\ncontext:\n${formatFaultDetails(context)}`
            : '';
        const entry = [
            `[${now().toISOString()}] ${eventName}`,
            formatFaultDetails(details),
            contextText,
            '',
        ].join('\n');
        fsTarget.appendFileSync(logPath, entry, 'utf8');
        return true;
    } catch {
        return false;
    }
}

export function createProcessFaultReporter(options = {}) {
    const consoleTarget = options.console || console;
    const writeLog = options.writeLog || writeProcessFaultLog;
    const getLogPath = options.getLogPath;
    const logPath = options.logPath;

    return (eventName, details, context = {}) => {
        const resolvedLogPath = typeof getLogPath === 'function' ? getLogPath() : logPath;
        if (resolvedLogPath) {
            writeLog(resolvedLogPath, eventName, details, context);
        }

        try {
            consoleTarget?.error?.(`[BookManager] ${eventName}:`, details);
        } catch {
            // Logging must never become the reason the process exits.
        }
    };
}

function addListener(target, eventName, handler, disposers) {
    if (!target || typeof target.on !== 'function') return;
    target.on(eventName, handler);
    disposers.push(() => {
        if (typeof target.off === 'function') {
            target.off(eventName, handler);
        } else if (typeof target.removeListener === 'function') {
            target.removeListener(eventName, handler);
        }
    });
}

export function installProcessSafetyHandlers(options = {}) {
    const processTarget = options.processTarget || process;
    const appTarget = options.appTarget;
    const reportFault = options.reportFault || createProcessFaultReporter(options);
    const disposers = [];

    addListener(processTarget, 'uncaughtException', error => {
        if (isBrokenPipeError(error)) return;
        reportFault('uncaughtException', error);
    }, disposers);

    addListener(processTarget, 'unhandledRejection', reason => {
        if (isBrokenPipeError(reason)) return;
        reportFault('unhandledRejection', reason);
    }, disposers);

    addListener(appTarget, 'child-process-gone', (_event, details) => {
        reportFault('child-process-gone', details);
    }, disposers);

    addListener(appTarget, 'gpu-process-crashed', (_event, killed) => {
        reportFault('gpu-process-crashed', { killed: Boolean(killed) });
    }, disposers);

    return {
        uninstall() {
            for (const dispose of disposers.splice(0)) dispose();
        },
    };
}

export function shouldReloadRendererAfterGone(details = {}, reloadCount = 0, maxReloads = 1) {
    if (reloadCount >= maxReloads) return false;
    return String(details?.reason || '') !== CLEAN_RENDERER_EXIT_REASON;
}

export function attachWindowSafetyHandlers(windowTarget, options = {}) {
    const webContents = windowTarget?.webContents;
    if (!webContents || typeof webContents.on !== 'function') {
        return { uninstall() {} };
    }

    const reportFault = options.reportFault || createProcessFaultReporter(options);
    const setTimeoutFn = options.setTimeout || setTimeout;
    const reloadDelayMs = Number.isFinite(options.reloadDelayMs) ? options.reloadDelayMs : 500;
    const maxReloads = Number.isFinite(options.maxReloads) ? options.maxReloads : 1;
    const disposers = [];
    let reloadCount = 0;

    const onRenderProcessGone = (_event, details = {}) => {
        reportFault('render-process-gone', details);
        if (!shouldReloadRendererAfterGone(details, reloadCount, maxReloads)) return;

        reloadCount += 1;
        setTimeoutFn(() => {
            try {
                if (windowTarget?.isDestroyed?.()) return;
                windowTarget?.webContents?.reload?.();
            } catch (error) {
                reportFault('renderer-reload-failed', error);
            }
        }, reloadDelayMs);
    };

    const onUnresponsive = () => {
        reportFault('renderer-unresponsive', {});
    };

    const onDidFailLoad = (_event, errorCode, errorDescription, validatedURL) => {
        reportFault('renderer-load-failed', {
            errorCode,
            errorDescription,
            validatedURL,
        });
    };

    addListener(webContents, 'render-process-gone', onRenderProcessGone, disposers);
    addListener(webContents, 'unresponsive', onUnresponsive, disposers);
    addListener(webContents, 'did-fail-load', onDidFailLoad, disposers);

    return {
        uninstall() {
            for (const dispose of disposers.splice(0)) dispose();
        },
    };
}
