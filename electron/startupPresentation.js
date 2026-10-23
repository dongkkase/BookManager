import fs from 'node:fs';
import { resolveConfigPath } from './dataPaths.js';
import { normalizeMotionPreference, resolveReducedMotion } from '../src/motionPolicy.js';
import { createStartupSplash, revealStartupMainWindow } from './startupSplash.js';
import { signalPortableStartupReady } from './startupSignal.js';

export function readStartupMotionPreference(executableDir) {
    try {
        return normalizeMotionPreference(JSON.parse(fs.readFileSync(resolveConfigPath(executableDir), 'utf8')).motion_preference);
    } catch {
        return 'system';
    }
}

export function getStartupReducedMotion(preference, systemPreferences) {
    let systemReduced = true;
    try {
        systemReduced = systemPreferences.getAnimationSettings().prefersReducedMotion;
    } catch {
        // If OS settings are unavailable, avoid adding an unexpected startup effect.
    }
    return resolveReducedMotion(preference, systemReduced);
}

export function createStartupPresentation({
    platform = process.platform,
    env = process.env,
    createSplash = createStartupSplash,
    revealMain = revealStartupMainWindow,
    signalReady = signalPortableStartupReady,
} = {}) {
    let splash = null;
    let finished = false;

    return {
        async start({ BrowserWindow, systemPreferences, motionPreference = 'system', enabled = true }) {
            if (!enabled || platform !== 'darwin' || finished || splash) return;
            try {
                splash = createSplash({
                    BrowserWindow,
                    reducedMotion: getStartupReducedMotion(motionPreference, systemPreferences),
                });
                await splash.ready;
            } catch {
                splash?.destroy();
                splash = null;
            }
        },
        update(stage) {
            splash?.update(stage);
        },
        complete({ mainWindow, showMainWindow, motionPreference, systemPreferences, animate = true }) {
            const firstWindow = !finished;
            finished = true;
            const reducedMotion = !animate || getStartupReducedMotion(motionPreference, systemPreferences);
            const activeSplash = splash;
            splash = null;
            let shown = false;
            const show = () => {
                if (shown) return;
                showMainWindow();
                shown = true;
                if (firstWindow) void signalReady({ reducedMotion });
            };
            const fallback = () => {
                if (!mainWindow.isDestroyed()) {
                    mainWindow.setOpacity(1);
                    show();
                }
                activeSplash?.destroy();
            };
            try {
                if (activeSplash) {
                    return Promise.resolve(activeSplash.finish({ mainWindow, showMainWindow: show, reducedMotion })).catch(fallback);
                }
                if (firstWindow && platform === 'win32' && env.BOOKMANAGER_STARTUP_READY_FILE) {
                    return Promise.resolve(revealMain({ mainWindow, showMainWindow: show, reducedMotion })).catch(fallback);
                }
                show();
                return Promise.resolve();
            } catch {
                fallback();
                return Promise.resolve();
            }
        },
        destroy() {
            finished = true;
            splash?.destroy();
            splash = null;
        },
    };
}

export const startupPresentation = createStartupPresentation();
