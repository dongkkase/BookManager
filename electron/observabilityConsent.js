import { updateTelemetryConsent } from './telemetry.js';

const CONSENT_KEYS = ['telemetry_error_reports', 'telemetry_usage_stats'];

export function saveConfigWithTelemetryConsent(configManager, nextConfig, applyConsent = updateTelemetryConsent) {
    const current = configManager.getConfig() || {};
    const revoked = { ...current };
    for (const key of CONSENT_KEYS) {
        if (nextConfig[key] === false) revoked[key] = false;
    }
    // Revocation is immediate, even if the settings disk cannot be written.
    applyConsent(revoked);
    if (!configManager.saveConfig(nextConfig)) {
        for (const key of CONSENT_KEYS) {
            if (nextConfig[key] === false) current[key] = false;
        }
        throw Object.assign(new Error('CONFIG_SAVE_FAILED: Could not save settings.'), { code: 'CONFIG_SAVE_FAILED' });
    }
    const saved = configManager.getConfig();
    applyConsent(saved);
    return saved;
}
