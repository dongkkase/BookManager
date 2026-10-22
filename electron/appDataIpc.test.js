import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { registerAppDataIpc } from './appDataIpc.js';
import { resolveAppDataDir } from './dataPaths.js';

function register({ getAppDataDir, openPath }) {
    const handlers = new Map();
    registerAppDataIpc({
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
        shell: { openPath },
        getAppDataDir,
    });
    return handlers;
}

for (const { platform, executableDir, env, expected } of [
    {
        platform: 'darwin',
        executableDir: '/Applications/BookManager.app/Contents/MacOS',
        env: { HOME: '/Users/테스트 사용자' },
        expected: path.join('/Users/테스트 사용자', 'Library', 'Application Support', 'BookManager', 'BookManagerData'),
    },
    {
        platform: 'win32',
        executableDir: path.join('C:\\Temp', 'unpacked'),
        env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Apps\\Book Manager' },
        expected: path.join('D:\\Apps\\Book Manager', 'BookManagerData'),
    },
    {
        platform: 'linux',
        executableDir: '/opt/Book Manager',
        env: {},
        expected: path.join('/opt/Book Manager', 'BookManagerData'),
    },
]) {
    test(`${platform} 데이터 폴더 IPC는 저장 정책과 같은 경로를 표시하고 연다`, async () => {
        const opened = [];
        const handlers = register({
            getAppDataDir: () => resolveAppDataDir(executableDir, platform, env),
            openPath: async folderPath => { opened.push(folderPath); return ''; },
        });
        assert.equal(handlers.get('appData:getPath')(), expected);
        assert.deepEqual(await handlers.get('appData:openFolder')({}, '/untrusted/path'), { success: true });
        assert.deepEqual(opened, [expected]);
    });
}

test('폴더 열기가 반환한 오류 문자열과 예외를 실패로 전달한다', async () => {
    for (const openPath of [
        async () => 'Permission denied',
        async () => { throw new Error('Permission denied'); },
    ]) {
        const handlers = register({ getAppDataDir: () => '/fixture/BookManagerData', openPath });
        assert.deepEqual(await handlers.get('appData:openFolder')(), {
            success: false,
            message: 'Permission denied',
        });
    }
});
