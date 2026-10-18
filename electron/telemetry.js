import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { classifyRendererErrorMessage, isTelemetryIpcChannelAllowed, isTelemetryRejectionTypeAllowed } from './rendererErrorDiagnostics.js';
import { isWindowsControlExit } from './processSafety.js';

const EVENTS = new Set(['app_active', 'menu_opened', 'tool_opened', 'feature_started', 'feature_completed', 'feature_failed', 'feature_cancelled', 'viewer_tts_used']);
const MENUS = new Set(['folder', 'organizer', 'renamer', 'metadata', 'tools', 'sharing', 'releases', 'settings']);
const TOOLS = new Set(['text-cleaner', 'epub-editor', 'cover-editor', 'epub-optimizer']);
const FEATURES = new Set(['archive-organizer', 'archive-renamer', 'metadata-save', 'text-cleaner', 'epub-export', 'epub-save', 'epub-import', 'epub-optimize', 'viewer-open', 'viewer-tts', 'sharing-start']);
const FORMATS = new Set(['comic', 'epub', 'pdf', 'text', 'audio']);
const APP_LANGUAGES = new Set(['ko', 'en', 'ja']);
const TTS_MODELS = new Map([
    ['system', new Set(['system'])],
    ['supertonic', new Set(['supertonic-3'])],
    ['openai', new Set(['gpt-4o-mini-tts', 'tts-1'])],
    ['google', new Set(['google-cloud-default'])],
]);
const SOURCES = new Set(['main', 'ipc', 'renderer', 'viewer', 'react', 'renderer-react', 'viewer-react', 'viewer-load', 'menu', 'navigation', 'catalog', 'drop', 'uncaughtException', 'unhandledRejection', 'child-process-gone', 'gpu-process-crashed', 'render-process-gone', 'associated-file-open-failed', 'renderer-unresponsive', 'renderer-load-failed']);
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'AbortError']);
const ERROR_KINDS = new Map([
    ['uncaught-error', 'Uncaught JavaScript error'],
    ['unhandled-rejection', 'Unhandled promise rejection'],
]);
const BROWSER_ERRORS = new Map([
    ['resize-observer-loop', 'ResizeObserver loop notifications were deferred'],
    ['script-error', 'Script error details were hidden by the browser'],
]);
const PROCESS_GONE_SOURCES = new Set(['render-process-gone', 'child-process-gone']);
const PROCESS_REASONS = new Map([
    ['clean-exit', 'Process exited normally'],
    ['abnormal-exit', 'Process exited with a non-zero exit code'],
    ['killed', 'Process was terminated externally'],
    ['crashed', 'Process crashed'],
    ['oom', 'Process ran out of memory'],
    ['launch-failed', 'Process failed to launch'],
    ['integrity-failure', 'Process failed a Windows code integrity check'],
    ['memory-eviction', 'Process was terminated to prevent memory exhaustion'],
]);
const PROCESS_TYPES = new Set(['Utility', 'Zygote', 'Sandbox helper', 'GPU', 'Pepper Plugin', 'Pepper Plugin Broker', 'Unknown']);
const WINDOW_TYPES = new Set(['main', 'viewer']);
const APP_LIFECYCLES = new Set(['running', 'quitting']);
const ERROR_DESCRIPTIONS = new Map([
    ['EACCES', 'Permission denied'],
    ['ENOENT', 'File or directory not found'],
    ['EPERM', 'Operation not permitted'],
    ['EIO', 'Input or output operation failed'],
    ['ENOSPC', 'No space left on device'],
    ['EMFILE', 'Too many open files'],
    ['EBUSY', 'Resource is busy'],
    ['EEXIST', 'File or directory already exists'],
    ['ENOTDIR', 'A path component is not a directory'],
    ['EISDIR', 'A file operation received a directory'],
    ['ENOTEMPTY', 'Directory is not empty'],
    ['ENAMETOOLONG', 'File path is too long'],
    ['EINVAL', 'Invalid operation argument'],
    ['EXDEV', 'Operation cannot cross filesystem boundaries'],
    ['ENOMEM', 'Insufficient memory'],
    ['EPIPE', 'Process pipe is closed'],
    ['ETIMEDOUT', 'Operation timed out'],
    ['ECONNRESET', 'Connection was reset'],
    ['ECONNREFUSED', 'Connection was refused'],
    ['ERR_MODULE_NOT_FOUND', 'Required module was not found'],
    ['ERR_DLOPEN_FAILED', 'Native module could not be loaded'],
    ['SQLITE_BUSY', 'Database is busy'],
    ['SQLITE_CORRUPT', 'Database is corrupt'],
    ['SQLITE_FULL', 'Database storage is full'],
    ['TASK_FAILED', 'Operation failed'],
    ['PROCESS_FAILED', 'External tool failed'],
    ['PROCESS_OUTPUT_TOO_LARGE', 'External tool output exceeded the size limit'],
    ['TOOL_MISSING', 'Required tool was not found'],
    ['ARCHIVE_NO_IMAGES', 'Archive contains no images'],
    ['ARCHIVE_NO_ENTRIES', 'No archive entries would remain'],
]);
const ERROR_STAGE_DESCRIPTIONS = new Map([
    ['prepare', 'Operation preparation failed'],
    ['extract', 'Archive extraction failed'],
    ['extract-nested', 'Nested archive extraction failed'],
    ['inspect', 'Archive inspection failed'],
    ['convert-images', 'Image conversion failed'],
    ['optimize-images', 'Image optimization failed'],
    ['rename-entries', 'Archive entry rename failed'],
    ['delete-entries', 'Archive entry removal failed'],
    ['flatten', 'Archive layout conversion failed'],
    ['pack', 'Archive creation failed'],
    ['write-output', 'Output write failed'],
    ['write-metadata', 'Metadata write failed'],
    ['write-database', 'Database write failed'],
    ['backup', 'Backup creation failed'],
    ['remove-source', 'Source removal failed'],
    ['cleanup', 'Temporary file cleanup failed'],
    ['direct-copy', 'Archive copy failed'],
    ['direct-rename', 'Archive rename failed'],
]);
const ERROR_REASON_DESCRIPTIONS = new Map([
    ['password-required', 'Archive requires a password'],
    ['unsupported-method', 'Archive compression method is unsupported'],
    ['invalid-archive', 'File is not a supported archive'],
    ['corrupt-data', 'Archive data is damaged'],
    ['access-denied', 'External tool could not access a file'],
    ['disk-full', 'External tool ran out of storage space'],
    ['path-too-long', 'External tool encountered a path that is too long'],
    ['file-in-use', 'External tool could not access a file in use'],
    ['path-not-found', 'External tool could not find a file or path'],
    ['invalid-path', 'External tool encountered an invalid path'],
    ['io-error', 'External tool encountered a device I/O error'],
    ['out-of-memory', 'External tool ran out of memory'],
    ['file-open-failed', 'External tool could not open a file'],
]);
const ERROR_TOOLS = new Set(['7z', 'cwebp']);
const ERROR_SIGNALS = new Set(['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGIOT', 'SIGBUS', 'SIGFPE', 'SIGKILL', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGPIPE', 'SIGALRM', 'SIGTERM', 'SIGCHLD', 'SIGCONT', 'SIGSTOP', 'SIGTSTP', 'SIGTTIN', 'SIGTTOU', 'SIGURG', 'SIGXCPU', 'SIGXFSZ', 'SIGVTALRM', 'SIGPROF', 'SIGWINCH', 'SIGIO', 'SIGPWR', 'SIGSYS', 'SIGINFO', 'SIGBREAK']);
const ERROR_SYSCALLS = new Set(['access', 'chmod', 'chown', 'close', 'copyfile', 'fstat', 'fsync', 'ftruncate', 'link', 'lstat', 'mkdir', 'open', 'opendir', 'read', 'readdir', 'readlink', 'realpath', 'rename', 'rmdir', 'scandir', 'spawn', 'stat', 'symlink', 'unlink', 'utime', 'write']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_PENDING = 40;
const MAX_CONCURRENT = 2;

export function isTelemetryTtsModelAllowed(engine, model) {
    return TTS_MODELS.get(engine)?.has(model) === true;
}

function allowedProperties(input = {}) {
    const properties = {};
    for (const [key, values] of [['menu', MENUS], ['tool', TOOLS], ['feature', FEATURES], ['format', FORMATS], ['source', SOURCES]]) {
        if (values.has(input[key])) properties[key] = input[key];
    }
    if (input.event === 'viewer_tts_used' && isTelemetryTtsModelAllowed(input.tts_engine, input.tts_model)) {
        properties.tts_engine = input.tts_engine;
        properties.tts_model = input.tts_model;
    }
    if (typeof input.duration_ms === 'number' && Number.isFinite(input.duration_ms) && input.duration_ms >= 0) {
        properties.duration_ms = Math.min(Math.round(input.duration_ms), 86400000);
    }
    return properties;
}

function allowedErrorDiagnostics(input = {}) {
    const tags = {};
    for (const [key, values] of [['error_code', ERROR_DESCRIPTIONS], ['error_kind', ERROR_KINDS], ['error_stage', ERROR_STAGE_DESCRIPTIONS], ['error_reason', ERROR_REASON_DESCRIPTIONS], ['error_tool', ERROR_TOOLS], ['signal', ERROR_SIGNALS], ['syscall', ERROR_SYSCALLS]]) {
        if (values.has(input[key])) tags[key] = input[key];
    }
    if (Number.isInteger(input.exit_code) && input.exit_code >= -2147483648 && input.exit_code <= 4294967295) {
        tags.exit_code = input.exit_code;
    }
    if (isTelemetryIpcChannelAllowed(input.ipc_channel)) tags.ipc_channel = input.ipc_channel;
    if (tags.error_kind === 'uncaught-error' && BROWSER_ERRORS.has(input.browser_error)) {
        tags.browser_error = input.browser_error;
    }
    if (tags.error_kind === 'unhandled-rejection' && isTelemetryRejectionTypeAllowed(input.rejection_type)) {
        tags.rejection_type = input.rejection_type;
    }
    if (PROCESS_GONE_SOURCES.has(input.source)) {
        for (const [key, values] of [['process_reason', PROCESS_REASONS], ['process_type', PROCESS_TYPES], ['window_type', WINDOW_TYPES], ['app_lifecycle', APP_LIFECYCLES]]) {
            if (values.has(input[key])) tags[key] = input[key];
        }
    }
    return tags;
}

export function getRendererErrorDiagnostics(payload = {}) {
    const parsed = classifyRendererErrorMessage(payload.message, { errorNames: ERROR_NAMES, errorCodes: ERROR_DESCRIPTIONS, errorKind: payload.error_kind });
    return {
        name: ERROR_NAMES.has(payload.name) && payload.name !== 'Error' ? payload.name : parsed.name || 'Error',
        code: ERROR_DESCRIPTIONS.has(payload.code) ? payload.code : parsed.code || '',
        ...allowedErrorDiagnostics({
            error_kind: payload.error_kind,
            ipc_channel: parsed.ipc_channel,
            browser_error: parsed.browser_error,
            rejection_type: payload.rejection_type,
        }),
    };
}

function cleanServiceConfig(value = {}) {
    let sentryDsn = '';
    let posthogHost = '';
    try {
        const url = new URL(value.sentryDsn);
        if (url.protocol === 'https:' && /^[a-z0-9]+$/i.test(url.username) && !url.password && !url.search && !url.hash && /\/\d+$/.test(url.pathname)) {
            sentryDsn = url.href;
        }
    } catch {
        // Missing credentials leave the corresponding service disabled.
    }
    try {
        const url = new URL(value.posthogHost || 'https://us.i.posthog.com');
        if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') {
            posthogHost = url.origin;
        }
    } catch {
        // Invalid hosts must not fall back to another data region.
    }
    const posthogToken = typeof value.posthogToken === 'string' && /^[a-z0-9_-]{8,256}$/i.test(value.posthogToken) ? value.posthogToken : '';
    return { sentryDsn, posthogHost, posthogToken };
}

export function createTelemetry(options = {}) {
    const fsTarget = options.fs || fs;
    const fetchTarget = options.fetch || globalThis.fetch;
    const loadSentry = options.loadSentry || (() => import('@sentry/node'));
    const uuid = options.randomUUID || randomUUID;
    const now = options.now || Date.now;
    const env = options.env || process.env;
    const platform = ['win32', 'darwin', 'linux'].includes(options.platform || process.platform) ? (options.platform || process.platform) : 'other';
    const appRoot = String(options.appRoot || APP_ROOT).replace(/\\/g, '/').replace(/\/$/, '');
    const requestTimeoutMs = options.requestTimeoutMs || 3000;
    let configuration = {};
    let services = cleanServiceConfig();
    let storageDir = '';
    let version = 'unknown';
    let runtimeAllowed = false;
    let environment = 'production';
    let installationId = '';
    let ignoreStoredInstallationId = false;
    let lastActiveDay = '';
    let client = null;
    let clientLoading = null;
    let outstandingErrors = 0;
    const epochs = { usage: 0, errors: 0 };
    const queue = [];
    const active = new Set();
    const pending = new Set();
    const errorJobs = new Set();
    const sessions = new WeakMap();
    const rate = { usage: { since: 0, count: 0 }, errors: { since: 0, count: 0 } };

    function getTelemetryStatus() {
        const errorReportingConfigured = Boolean(services.sentryDsn);
        const usageAnalyticsConfigured = Boolean(services.posthogHost && services.posthogToken);
        return {
            errorReportingConfigured,
            usageAnalyticsConfigured,
            errorReportsEnabled: runtimeAllowed && errorReportingConfigured && configuration.telemetry_error_reports === true,
            usageStatsEnabled: runtimeAllowed && usageAnalyticsConfigured && configuration.telemetry_usage_stats === true,
        };
    }

    function enabled(channel, epoch = epochs[channel]) {
        const status = getTelemetryStatus();
        return epoch === epochs[channel] && (channel === 'errors' ? status.errorReportsEnabled : status.usageStatsEnabled);
    }

    function captureTelemetrySession() {
        const token = Object.freeze({});
        sessions.set(token, { usage: enabled('usage') ? epochs.usage : null, errors: enabled('errors') ? epochs.errors : null });
        return token;
    }

    function isTelemetrySessionCurrent(token, channel = 'usage') {
        const session = token && typeof token === 'object' ? sessions.get(token) : null;
        return Boolean(session && ['usage', 'errors'].includes(channel) && session[channel] !== null && enabled(channel, session[channel]));
    }

    function cancel(channel) {
        epochs[channel] += 1;
        for (let index = queue.length - 1; index >= 0; index -= 1) {
            if (queue[index].channel === channel) queue.splice(index, 1)[0].resolve(false);
        }
        for (const item of active) {
            if (item.channel === channel) item.controller.abort();
        }
        if (channel === 'errors') {
            client = null;
            clientLoading = null;
        }
    }

    function removeInstallationId() {
        installationId = '';
        ignoreStoredInstallationId = true;
        lastActiveDay = '';
        if (!storageDir) return;
        try {
            fsTarget.unlinkSync(path.join(storageDir, 'telemetry-state.json'));
        } catch {
            // Consent changes also work when the optional state file is absent.
        }
    }

    function updateTelemetryConsent(config = {}) {
        const previous = getTelemetryStatus();
        const language = config.language || config.lang;
        configuration = {
            telemetry_error_reports: config.telemetry_error_reports === true,
            telemetry_usage_stats: config.telemetry_usage_stats === true,
            language: APP_LANGUAGES.has(language) ? language : 'ko',
        };
        const next = getTelemetryStatus();
        if (!next.errorReportsEnabled) cancel('errors');
        if (!next.usageStatsEnabled) {
            cancel('usage');
            if (!configuration.telemetry_usage_stats) ignoreStoredInstallationId = true;
            if (previous.usageStatsEnabled) removeInstallationId();
        }
        if (!previous.usageStatsEnabled && next.usageStatsEnabled) trackTelemetryEvent({ event: 'app_active' });
        return next;
    }

    function configureTelemetry(input = {}) {
        cancel('errors');
        cancel('usage');
        installationId = '';
        lastActiveDay = '';
        configuration = {};
        services = cleanServiceConfig(input.serviceConfig);
        storageDir = typeof input.storageDir === 'string' ? input.storageDir : '';
        version = typeof input.appVersion === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(input.appVersion) ? input.appVersion : 'unknown';
        runtimeAllowed = input.isPackaged === true || env.BOOKMANAGER_TELEMETRY_DEV === '1';
        environment = input.isPackaged === true ? 'production' : 'development';
        return updateTelemetryConsent(input.config);
    }

    function consumeRate(channel) {
        const bucket = rate[channel];
        if (now() - bucket.since >= 60000) {
            bucket.since = now();
            bucket.count = 0;
        }
        if (bucket.count >= (channel === 'errors' ? 20 : 120)) return false;
        bucket.count += 1;
        return true;
    }

    function getInstallationId() {
        if (installationId) return installationId;
        if (storageDir && !ignoreStoredInstallationId) {
            try {
                const stored = JSON.parse(fsTarget.readFileSync(path.join(storageDir, 'telemetry-state.json'), 'utf8'));
                if (UUID_PATTERN.test(stored.installationId)) installationId = stored.installationId;
            } catch {
                // Statistics can use a session ID if storage is unavailable.
            }
        }
        if (installationId) return installationId;
        installationId = uuid();
        if (!UUID_PATTERN.test(installationId)) throw new Error('Invalid installation ID');
        if (storageDir) {
            try {
                fsTarget.mkdirSync(storageDir, { recursive: true });
                fsTarget.writeFileSync(path.join(storageDir, 'telemetry-state.json'), JSON.stringify({ version: 1, installationId }), { encoding: 'utf8', mode: 0o600 });
                ignoreStoredInstallationId = false;
            } catch {
                // The app must remain usable with a read-only settings directory.
            }
        }
        return installationId;
    }

    function drain() {
        while (active.size < MAX_CONCURRENT && queue.length > 0) {
            const item = queue.shift();
            if (!enabled(item.channel, item.epoch)) {
                item.resolve(false);
                continue;
            }
            item.controller = new AbortController();
            active.add(item);
            const timer = setTimeout(() => item.controller.abort(), requestTimeoutMs);
            timer.unref?.();
            const aborted = new Promise(resolve => item.controller.signal.addEventListener('abort', () => resolve(null), { once: true }));
            const request = Promise.resolve().then(() => {
                if (!enabled(item.channel, item.epoch) || item.controller.signal.aborted) return null;
                return fetchTarget(item.url, {
                    method: 'POST',
                    headers: { 'Content-Type': item.contentType },
                    body: item.body,
                    signal: item.controller.signal,
                    redirect: 'error',
                    credentials: 'omit',
                    cache: 'no-store',
                });
            }).catch(() => null);
            Promise.race([request, aborted]).then(response => {
                item.resolve(Boolean(response?.ok));
                try { response?.body?.cancel?.()?.catch?.(() => {}); } catch { /* Response disposal is best effort. */ }
            }).catch(() => item.resolve(false)).finally(() => {
                clearTimeout(timer);
                active.delete(item);
                drain();
            });
        }
    }

    function enqueue(channel, epoch, url, body, contentType) {
        if (!enabled(channel, epoch) || pending.size >= MAX_PENDING || typeof fetchTarget !== 'function') return Promise.resolve(false);
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        pending.add(promise);
        promise.finally(() => pending.delete(promise));
        queue.push({ channel, epoch, url, body, contentType, resolve });
        drain();
        return promise;
    }

    function trackTelemetryEvent(input = {}) {
        try {
            if (!enabled('usage') || !EVENTS.has(input.event) || pending.size >= MAX_PENDING) return false;
            const properties = allowedProperties(input);
            if (input.event === 'menu_opened' && !properties.menu) return false;
            if (input.event === 'tool_opened' && !properties.tool) return false;
            if (input.event.startsWith('feature_') && !properties.feature) return false;
            if (input.event === 'viewer_tts_used' && (properties.feature !== 'viewer-tts'
                || !['epub', 'text'].includes(properties.format) || !properties.tts_model)) return false;
            const day = new Date(now()).toISOString().slice(0, 10);
            if (input.event === 'app_active' && lastActiveDay === day) return false;
            if (input.event !== 'app_active' && lastActiveDay !== day) trackTelemetryEvent({ event: 'app_active' });
            if (pending.size >= MAX_PENDING) return false;
            if (!consumeRate('usage')) return false;
            const body = JSON.stringify({
                api_key: services.posthogToken,
                event: input.event,
                uuid: uuid(),
                properties: {
                    ...properties,
                    distinct_id: getInstallationId(),
                    app_version: version,
                    app_language: configuration.language,
                    os: platform,
                    $process_person_profile: false,
                    $geoip_disable: true,
                    $ip: null,
                },
                timestamp: new Date(now()).toISOString(),
            });
            void enqueue('usage', epochs.usage, `${services.posthogHost}/capture/`, body, 'application/json');
            if (input.event === 'app_active') lastActiveDay = day;
            return true;
        } catch {
            return false;
        }
    }

    function trustedFilename(value) {
        if (typeof value !== 'string') return null;
        let filename = value;
        try {
            if (filename.startsWith('file:')) filename = fileURLToPath(filename);
            else if (filename.startsWith('app:///')) filename = `${appRoot}/${filename.slice(7)}`;
            else if (/^https?:/.test(filename)) {
                const url = new URL(filename);
                if (!['localhost', '127.0.0.1'].includes(url.hostname) || !runtimeAllowed || env.BOOKMANAGER_TELEMETRY_DEV !== '1') return null;
                filename = `${appRoot}${decodeURIComponent(url.pathname)}`;
            }
        } catch {
            return null;
        }
        filename = filename.replace(/\\/g, '/');
        const rootPrefix = `${appRoot}/`;
        if (platform === 'win32' ? !filename.toLowerCase().startsWith(rootPrefix.toLowerCase()) : !filename.startsWith(rootPrefix)) return null;
        const relative = filename.slice(appRoot.length + 1);
        if (!/^(?:electron|src|dist\/assets)\/[a-z0-9_./-]+\.(?:js|jsx|mjs|cjs)$/i.test(relative) || relative.split('/').includes('..')) return null;
        try {
            if (!fsTarget.statSync(`${appRoot}/${relative}`).isFile()) return null;
        } catch {
            return null;
        }
        return `app:///${relative}`;
    }

    function stackFrames(stack) {
        if (typeof stack !== 'string') return [];
        const frames = [];
        for (const line of stack.slice(0, 32768).split('\n').slice(1, 65)) {
            const location = line.match(/(?:\(|\bat\s+)((?:file:\/\/\/|app:\/\/\/|https?:\/\/|\/|[a-z]:[\\/]).+):(\d+):(\d+)\)?$/i);
            if (!location) continue;
            const filename = trustedFilename(location[1]);
            const lineno = Number(location[2]);
            const colno = Number(location[3]);
            if (filename && lineno > 0 && lineno <= 10000000 && colno > 0 && colno <= 10000000) frames.push({ filename, lineno, colno, in_app: true });
        }
        return frames.slice(0, 32).reverse();
    }

    function trustedFrame(frame) {
        const filename = trustedFilename(frame?.filename);
        const lineno = frame?.lineno;
        const colno = frame?.colno;
        if (!filename || !Number.isSafeInteger(lineno) || lineno <= 0 || lineno > 10000000
            || (colno !== undefined && (!Number.isSafeInteger(colno) || colno < 0 || colno > 10000000))) return null;
        return { filename, lineno, ...(colno > 0 ? { colno } : {}), in_app: true };
    }

    function errorFrames(error) {
        const frames = stackFrames(error?.stack);
        if (frames.length) return frames;
        const frame = trustedFrame(error);
        return frame ? [frame] : [];
    }

    function sanitizeSentryEvent(event = {}) {
        const exception = event.exception?.values?.[0] || {};
        const type = ERROR_NAMES.has(exception.type) ? exception.type : 'Error';
        const diagnostics = allowedErrorDiagnostics(event.tags);
        const code = diagnostics.error_code;
        const frames = [];
        for (const frame of (exception.stacktrace?.frames || []).slice(-32)) {
            const trusted = trustedFrame(frame);
            if (trusted) frames.push(trusted);
        }
        const tags = { ...allowedProperties(event.tags), os: platform, ...diagnostics };
        delete tags.duration_ms;
        const reasonDescription = code === 'PROCESS_FAILED' ? ERROR_REASON_DESCRIPTIONS.get(tags.error_reason) : '';
        let processDescription = '';
        if (PROCESS_GONE_SOURCES.has(tags.source)) {
            const controlExit = isWindowsControlExit(tags.exit_code, platform)
                && (!tags.process_reason || ['abnormal-exit', 'killed'].includes(tags.process_reason));
            const gpuContextLost = platform === 'win32' && tags.source === 'child-process-gone'
                && tags.process_type === 'GPU' && tags.exit_code === 34
                && (!tags.process_reason || ['crashed', 'abnormal-exit'].includes(tags.process_reason));
            processDescription = gpuContextLost ? 'GPU process exited after losing its graphics context (RESULT_CODE_GPU_EXIT_ON_CONTEXT_LOST)'
                : controlExit ? 'Windows console control termination (STATUS_CONTROL_C_EXIT)'
                    : PROCESS_REASONS.get(tags.process_reason) || 'Process exited unexpectedly';
        }
        const description = reasonDescription || ERROR_DESCRIPTIONS.get(code) || ERROR_STAGE_DESCRIPTIONS.get(tags.error_stage) || processDescription || (tags.error_tool ? 'External tool failed' : tags.ipc_channel ? 'IPC invocation failed' : BROWSER_ERRORS.get(tags.browser_error) || ERROR_KINDS.get(tags.error_kind) || 'details omitted');
        const diagnosticFingerprint = ['error_kind', 'browser_error', 'error_stage', 'error_reason', 'error_tool', 'exit_code', 'signal', 'syscall', 'ipc_channel', 'process_reason', 'process_type', 'window_type', 'app_lifecycle'].filter(key => tags[key] !== undefined).map(key => `${key}:${tags[key]}`);
        if (!frames.length && tags.rejection_type) diagnosticFingerprint.push(`rejection_type:${tags.rejection_type}`);
        const fingerprint = !frames.length
            ? ['bookmanager', tags.feature || 'app', tags.source || 'unknown', type, code || 'unknown', ...diagnosticFingerprint]
            : diagnosticFingerprint.length ? ['{{ default }}', code || 'unknown', ...diagnosticFingerprint] : null;
        return {
            event_id: /^[0-9a-f]{32}$/i.test(event.event_id) ? event.event_id : uuid().replace(/-/g, ''),
            timestamp: now() / 1000,
            platform: 'node',
            level: 'error',
            release: `bookmanager@${version}`,
            environment,
            tags,
            ...(fingerprint ? { fingerprint } : {}),
            exception: { values: [{ type, value: `${type}${code ? ` (${code})` : ''}: ${description}`, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
        };
    }

    async function ensureClient(epoch) {
        if (!enabled('errors', epoch)) return null;
        if (client) return client;
        if (clientLoading) return clientLoading;
        const loading = Promise.resolve().then(loadSentry).then(sdk => {
            if (!enabled('errors', epoch)) return null;
            const next = new sdk.NodeClient({
                dsn: services.sentryDsn,
                integrations: [],
                defaultIntegrations: false,
                sendDefaultPii: false,
                includeServerName: false,
                sendClientReports: false,
                tracesSampleRate: 0,
                sampleRate: 1,
                maxBreadcrumbs: 0,
                autoSessionTracking: false,
                beforeSend: event => enabled('errors', epoch) ? sanitizeSentryEvent(event) : null,
                transport: transportOptions => ({
                    send: async envelope => {
                        if (!enabled('errors', epoch)) return { statusCode: 200 };
                        const item = envelope?.[1]?.find(([header]) => header?.type === 'event');
                        if (!item) return { statusCode: 200 };
                        const event = sanitizeSentryEvent(item[1]);
                        const body = [JSON.stringify({ event_id: event.event_id, sent_at: new Date(now()).toISOString() }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
                        const sent = await enqueue('errors', epoch, transportOptions.url, body, 'application/x-sentry-envelope');
                        return { statusCode: sent ? 200 : 503 };
                    },
                    flush: timeout => waitPending(timeout),
                }),
            });
            client = next;
            return next;
        }).catch(() => null).finally(() => {
            if (clientLoading === loading) clientLoading = null;
        });
        clientLoading = loading;
        return loading;
    }

    function reportTelemetryError(error, context = {}) {
        try {
            if (!enabled('errors') || outstandingErrors >= 20 || pending.size >= MAX_PENDING || !consumeRate('errors')) return false;
            const type = ERROR_NAMES.has(error?.name) ? error.name : 'Error';
            const frames = errorFrames(error);
            const tags = {
                ...allowedProperties(context),
                ...allowedErrorDiagnostics({
                    source: context.source,
                    error_code: error?.code,
                    error_kind: context.error_kind,
                    browser_error: context.browser_error,
                    ipc_channel: context.ipc_channel,
                    rejection_type: context.rejection_type,
                    error_stage: error?.telemetryStage,
                    error_reason: error?.telemetryReason,
                    error_tool: error?.telemetryTool,
                    exit_code: error?.exitCode,
                    signal: error?.signal,
                    syscall: error?.syscall,
                    process_reason: error?.reason,
                    process_type: context.source === 'child-process-gone' ? error?.type : undefined,
                    window_type: context.window_type,
                    app_lifecycle: context.app_lifecycle,
                }),
            };
            const event = sanitizeSentryEvent({
                tags,
                exception: { values: [{ type, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
            });
            const epoch = epochs.errors;
            outstandingErrors += 1;
            const job = ensureClient(epoch).then(readyClient => {
                if (readyClient && enabled('errors', epoch)) readyClient.captureEvent(event);
            }).catch(() => {}).finally(() => {
                outstandingErrors -= 1;
                errorJobs.delete(job);
            });
            errorJobs.add(job);
            return true;
        } catch {
            return false;
        }
    }

    async function waitPending(timeout = 1500) {
        let timer;
        try {
            return await Promise.race([
                Promise.all([...pending]).then(() => true),
                new Promise(resolve => { timer = setTimeout(() => resolve(false), Math.max(1, Math.min(timeout, 5000))); }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    async function flushTelemetry(timeout = 1500) {
        let timer;
        try {
            const work = async () => {
                await Promise.all([...errorJobs]);
                if (client) await client.flush(timeout);
                return waitPending(timeout);
            };
            return await Promise.race([
                work().catch(() => false),
                new Promise(resolve => { timer = setTimeout(() => resolve(false), Math.max(1, Math.min(timeout, 5000))); }),
            ]);
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    return { configureTelemetry, updateTelemetryConsent, getTelemetryStatus, captureTelemetrySession, isTelemetrySessionCurrent, trackTelemetryEvent, reportTelemetryError, flushTelemetry };
}

const telemetry = createTelemetry();
export const configureTelemetry = telemetry.configureTelemetry;
export const updateTelemetryConsent = telemetry.updateTelemetryConsent;
export const getTelemetryStatus = telemetry.getTelemetryStatus;
export const captureTelemetrySession = telemetry.captureTelemetrySession;
export const isTelemetrySessionCurrent = telemetry.isTelemetrySessionCurrent;
export const trackTelemetryEvent = telemetry.trackTelemetryEvent;
export const reportTelemetryError = telemetry.reportTelemetryError;
export const flushTelemetry = telemetry.flushTelemetry;
