import { fileURLToPath } from 'node:url';

const STAGES = {
    starting: { label: '북매니저를 준비하고 있습니다', value: 1 },
    loading: { label: '라이브러리를 준비하고 있습니다', value: 2 },
    ready: { label: '준비가 완료되었습니다', value: 3 },
};
const TRANSITION_DURATION_MS = 220;

function isAlive(window) {
    return window && !window.isDestroyed();
}

function setOpacity(window, value) {
    if (!isAlive(window)) return false;
    try {
        window.setOpacity(value);
        return true;
    } catch {
        return false;
    }
}

export function revealStartupMainWindow({
    mainWindow,
    showMainWindow = () => mainWindow.show(),
    splashWindow = null,
    reducedMotion = false,
    signal,
    timers = globalThis,
    now = () => performance.now(),
} = {}) {
    if (!isAlive(mainWindow)) return Promise.resolve();
    let timer = null;
    let resolveTransition;
    let completed = false;
    const completion = new Promise(resolve => { resolveTransition = resolve; });
    function complete() {
        if (completed) return;
        completed = true;
        timers.clearInterval(timer);
        signal?.removeEventListener('abort', complete);
        setOpacity(mainWindow, 1);
        resolveTransition();
    }
    const animate = !reducedMotion && !signal?.aborted
        && (!splashWindow || isAlive(splashWindow)) && setOpacity(mainWindow, 0);
    try {
        showMainWindow();
    } catch {
        setOpacity(mainWindow, 1);
        if (isAlive(mainWindow)) {
            try { mainWindow.show(); } catch { /* The window may have closed during startup. */ }
        }
        complete();
        return completion;
    }
    if (!animate || signal?.aborted) {
        complete();
        return completion;
    }
    signal?.addEventListener('abort', complete, { once: true });
    const startedAt = now();
    timer = timers.setInterval(() => {
        const progress = Math.min(1, Math.max(0, (now() - startedAt) / TRANSITION_DURATION_MS));
        const eased = 1 - (1 - progress) ** 3;
        const mainVisible = setOpacity(mainWindow, eased);
        const splashVisible = !splashWindow || setOpacity(splashWindow, 1 - eased);
        if (!mainVisible || !splashVisible || progress >= 1) complete();
    }, 16);
    timer.unref?.();
    return completion;
}

export function createStartupSplash({
    BrowserWindow,
    reducedMotion = false,
    timeoutMs = 120000,
    timers = globalThis,
    now = () => performance.now(),
} = {}) {
    const window = new BrowserWindow({
        width: 700,
        height: 364,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        roundedCorners: true,
        hasShadow: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        title: 'BookManager',
        webPreferences: {
            preload: fileURLToPath(new URL('./startupSplash/preload.cjs', import.meta.url)),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
        },
    });
    let stage = 'starting';
    let loaded = false;
    let visible = false;
    let finished = false;
    let finishPromise = null;
    let deadlineTimer = null;
    let readyTimer = null;
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const transitionController = new AbortController();

    function settleReady(wasShown = false) {
        timers.clearTimeout(readyTimer);
        resolveReady?.(wasShown);
        resolveReady = null;
    }

    function destroy() {
        finished = true;
        timers.clearTimeout(deadlineTimer);
        settleReady();
        transitionController.abort();
        if (isAlive(window)) window.destroy();
    }

    function update(nextStage) {
        if (finished || !Object.hasOwn(STAGES, nextStage)) return;
        stage = nextStage;
        if (loaded && isAlive(window)) {
            try {
                window.webContents.send('bookmanager:startup-stage', STAGES[stage]);
            } catch {
                destroy();
            }
        }
    }

    function finish({ mainWindow, showMainWindow = () => mainWindow.show(), reducedMotion: reduce = reducedMotion } = {}) {
        if (finishPromise) return finishPromise;
        update('ready');
        finishPromise = revealStartupMainWindow({
            mainWindow,
            showMainWindow,
            splashWindow: window,
            reducedMotion: reduce || finished || !visible,
            signal: transitionController.signal,
            timers,
            now,
        }).then(destroy);
        return finishPromise;
    }

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.once('did-finish-load', () => {
        loaded = true;
        update(stage);
    });
    window.webContents.once('render-process-gone', destroy);
    window.once('ready-to-show', () => {
        if (finished || !isAlive(window)) return;
        try {
            window.showInactive();
        } catch {
            destroy();
            return;
        }
        visible = true;
        settleReady(true);
    });
    window.once('closed', destroy);
    readyTimer = timers.setTimeout(settleReady, 600);
    readyTimer.unref?.();
    deadlineTimer = timers.setTimeout(destroy, timeoutMs);
    deadlineTimer.unref?.();
    window.loadFile(fileURLToPath(new URL('./startupSplash/index.html', import.meta.url))).catch(destroy);

    return { ready, update, finish, destroy, get window() { return window; } };
}
