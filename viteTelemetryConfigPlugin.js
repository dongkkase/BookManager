import { loadEnv } from 'vite';
import { telemetryServiceConfigFromEnv } from './electron/observabilityConfig.js';

export default function telemetryConfigPlugin() {
    let serviceConfig;
    return {
        name: 'bookmanager-telemetry-config',
        configResolved(config) {
            serviceConfig = telemetryServiceConfigFromEnv({
                ...loadEnv(config.mode, config.envDir, 'BOOKMANAGER_'),
                ...process.env,
            });
        },
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'telemetry-config.json',
                source: JSON.stringify(serviceConfig),
            });
        },
    };
}
