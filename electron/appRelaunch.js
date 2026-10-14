export function relaunchApp(app, { platform = process.platform, env = process.env } = {}) {
    const portableExecutable = env?.PORTABLE_EXECUTABLE_FILE;
    if (platform === 'win32' && app.isPackaged === true
        && typeof portableExecutable === 'string' && portableExecutable.trim()) {
        // The portable launcher owns the extracted resources and must start the new instance.
        app.relaunch({ execPath: portableExecutable });
    } else {
        app.relaunch();
    }
    app.quit();
    return true;
}
