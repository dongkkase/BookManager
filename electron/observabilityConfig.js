import fs from 'node:fs';
import path from 'node:path';

export function telemetryServiceConfigFromEnv(env = {}) {
    return {
        sentryDsn: String(env.BOOKMANAGER_SENTRY_DSN || '').trim(),
        posthogToken: String(env.BOOKMANAGER_POSTHOG_TOKEN || '').trim(),
        posthogHost: String(env.BOOKMANAGER_POSTHOG_HOST || '').trim(),
    };
}

export function readTelemetryServiceConfig(appPath, env = process.env) {
    let bundled = {};
    try {
        bundled = JSON.parse(fs.readFileSync(path.join(appPath, 'dist', 'telemetry-config.json'), 'utf8'));
    } catch {
        // Builds without service configuration keep reporting unavailable.
    }
    const overrides = telemetryServiceConfigFromEnv(env);
    return Object.fromEntries(Object.entries(overrides).map(([key, value]) => [
        key, value || (typeof bundled?.[key] === 'string' ? bundled[key] : ''),
    ]));
}

export function readTelemetryAppVersion(appPath, fallback) {
    try {
        const version = JSON.parse(fs.readFileSync(path.join(appPath, 'version.json'), 'utf8')).latest_version;
        if (/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) return version;
    } catch {
        // The package version is available even when release metadata is missing.
    }
    return fallback;
}
