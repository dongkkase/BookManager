import fs from 'node:fs';
import { resolveConfigPath } from './dataPaths.js';

export function configureHardwareAcceleration(appTarget, executableDir, options = {}) {
    let enabled = true;
    try {
        const configPath = resolveConfigPath(executableDir, options.platform, options.env);
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        enabled = config?.hardware_acceleration !== false;
    } catch {
        // Missing or unreadable settings retain Chromium's default acceleration policy.
    }

    if (!enabled) appTarget.disableHardwareAcceleration();
    return enabled;
}
