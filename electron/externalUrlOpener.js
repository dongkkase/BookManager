import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function openExternalUrl(url, options, {
    app,
    shell,
    platform = process.platform,
    runFile = execFileAsync,
}) {
    if (options?.browser === true && platform === 'darwin') {
        // App Store 같은 연결 앱 대신 기본 HTTPS 브라우저를 명시적으로 선택합니다.
        const browser = await app.getApplicationInfoForProtocol('https://example.com');
        if (!browser?.path) throw new Error('Default browser unavailable');
        await runFile('/usr/bin/open', ['-a', browser.path, url], { timeout: 10000 });
        return;
    }
    await shell.openExternal(url);
}
