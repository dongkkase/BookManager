import { updateTelemetryConsent } from './telemetry.js';

const CONSENT_KEYS = ['telemetry_error_reports', 'telemetry_usage_stats'];

export function revokeConfigTelemetryConsent(configManager, nextConfig, applyConsent = updateTelemetryConsent) {
    const current = configManager.getConfig() || {};
    const revoked = { ...current };
    for (const key of CONSENT_KEYS) {
        if (nextConfig[key] === false) {
            current[key] = false;
            revoked[key] = false;
        }
    }
    // Keep revocation active even if preparation or persistence fails.
    applyConsent(revoked);
}

export function saveConfigWithTelemetryConsent(configManager, nextConfig, applyConsent = updateTelemetryConsent) {
    revokeConfigTelemetryConsent(configManager, nextConfig, applyConsent);
    if (!configManager.saveConfig(nextConfig)) {
        const failure = configManager.getLastSaveFailure?.();
        throw Object.assign(new Error('CONFIG_SAVE_FAILED: Could not save settings.', { cause: failure?.error }), {
            code: 'CONFIG_SAVE_FAILED',
            telemetryStage: failure?.stage || 'config-write',
        });
    }
    const saved = configManager.getConfig();
    applyConsent(saved);
    return saved;
}
