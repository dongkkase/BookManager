import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartupPresentation, getStartupReducedMotion } from './startupPresentation.js';

const systemSettings = reduced => ({ getAnimationSettings: () => ({ prefersReducedMotion: reduced }) });
const mainWindow = () => ({ opacity: 1, isDestroyed: () => false, setOpacity(value) { this.opacity = value; } });

test('startup transitions use the app motion policy, including explicit overrides', () => {
    for (const systemReduced of [false, true]) {
        assert.equal(getStartupReducedMotion('system', systemSettings(systemReduced)), systemReduced);
        assert.equal(getStartupReducedMotion('full', systemSettings(systemReduced)), false);
        assert.equal(getStartupReducedMotion('reduced', systemSettings(systemReduced)), true);
    }
    assert.equal(getStartupReducedMotion('system', {}), true);
});

test('macOS waits for the first splash paint and preserves the caller window activation policy', async () => {
    const events = [];
    const splash = {
        ready: Promise.resolve(true),
        update: stage => events.push(stage),
        finish: ({ showMainWindow, reducedMotion }) => {
            assert.equal(reducedMotion, true);
            showMainWindow();
            events.push('finished');
        },
        destroy: () => events.push('destroyed'),
    };
    const presentation = createStartupPresentation({
        platform: 'darwin',
        createSplash: options => {
            assert.equal(options.reducedMotion, true);
            events.push('created');
            return splash;
        },
        signalReady: () => events.push('signaled'),
    });
    await presentation.start({ BrowserWindow: {}, systemPreferences: systemSettings(true) });
    presentation.update('loading');
    const completion = presentation.complete({
        mainWindow: mainWindow(),
        showMainWindow: () => events.push('shown-inactive'),
        motionPreference: 'system',
        systemPreferences: systemSettings(true),
    });
    assert.deepEqual(events, ['created', 'loading', 'shown-inactive', 'signaled', 'finished']);
    await completion;
});

test('Windows portable crossfades only its first window and sends the effective motion setting', async () => {
    const events = [];
    const presentation = createStartupPresentation({
        platform: 'win32',
        env: { BOOKMANAGER_STARTUP_READY_FILE: 'marker' },
        createSplash: () => { throw new Error('Windows already has a native splash'); },
        revealMain: ({ showMainWindow, reducedMotion }) => {
            events.push(['fade', reducedMotion]);
            showMainWindow();
        },
        signalReady: options => events.push(['signal', options.reducedMotion]),
    });
    await presentation.start({ BrowserWindow: {} });
    const options = {
        mainWindow: mainWindow(), showMainWindow: () => events.push('shown'),
        motionPreference: 'full', systemPreferences: systemSettings(true),
    };
    await presentation.complete(options);
    await presentation.complete(options);
    assert.deepEqual(events, [['fade', false], 'shown', ['signal', false], 'shown']);
});

test('splash failure never prevents the main window from becoming visible', async () => {
    const window = mainWindow();
    let shown = 0;
    let destroyed = 0;
    const presentation = createStartupPresentation({
        platform: 'darwin',
        createSplash: () => ({
            ready: Promise.resolve(true),
            finish: () => {
                window.setOpacity(0);
                return Promise.reject(new Error('Transition failed'));
            },
            destroy: () => destroyed++,
        }),
        signalReady: () => {},
    });
    await presentation.start({ BrowserWindow: {} });
    await presentation.complete({ mainWindow: window, showMainWindow: () => shown++, systemPreferences: systemSettings(false) });
    assert.equal(shown, 1);
    assert.equal(window.opacity, 1);
    assert.equal(destroyed, 1);
});

test('shutdown while waiting for first paint disposes the splash and prevents it reopening', async () => {
    let resolveReady;
    let created = 0;
    const presentation = createStartupPresentation({
        platform: 'darwin',
        createSplash: () => {
            created++;
            return {
                ready: new Promise(resolve => { resolveReady = resolve; }),
                destroy: () => resolveReady(false),
            };
        },
    });
    const starting = presentation.start({ BrowserWindow: {} });
    presentation.destroy();
    await starting;
    await presentation.start({ BrowserWindow: {} });
    assert.equal(created, 1);
});

test('ordinary Windows launches show directly without an unnecessary opacity transition', async () => {
    let shown = false;
    const presentation = createStartupPresentation({
        platform: 'win32', env: {},
        revealMain: () => { throw new Error('No launcher transition expected'); },
        signalReady: () => {},
    });
    await presentation.complete({
        mainWindow: mainWindow(), showMainWindow: () => { shown = true; },
        systemPreferences: systemSettings(false),
    });
    assert.equal(shown, true);
});
