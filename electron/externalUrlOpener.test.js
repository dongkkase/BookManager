import assert from 'node:assert/strict';
import test from 'node:test';
import { openExternalUrl } from './externalUrlOpener.js';
import { READIVE_APP_STORE_URL } from '../src/appShell.js';

test('Mac의 App Store 웹 링크는 기본 HTTPS 브라우저를 지정하고 캠페인 정보를 유지한다', async () => {
    const browserPath = '/Applications/테스트 브라우저.app';
    let command;
    await openExternalUrl(READIVE_APP_STORE_URL, { browser: true }, {
        platform: 'darwin',
        app: { getApplicationInfoForProtocol: async url => {
            assert.equal(url, 'https://example.com');
            return { path: browserPath };
        } },
        shell: { openExternal: () => assert.fail('App Store 앱에 URL을 넘기면 안 됩니다.') },
        runFile: async (...args) => { command = args; },
    });
    assert.deepEqual(command, ['/usr/bin/open', ['-a', browserPath, READIVE_APP_STORE_URL], { timeout: 10000 }]);
    const target = new URL(command[1][2]);
    assert.equal(target.protocol, 'https:');
    assert.equal(target.hostname, 'apps.apple.com');
    assert.equal(target.searchParams.get('ct'), 'BookManager');
    assert.equal(target.searchParams.get('pt'), '822806');
});

test('브라우저 지정이 없는 링크와 Windows·Linux는 기존 외부 링크 처리를 유지한다', async () => {
    for (const [platform, options] of [['darwin', undefined], ['darwin', { browser: false }], ['win32', { browser: true }], ['linux', { browser: true }]]) {
        let opened;
        await openExternalUrl(READIVE_APP_STORE_URL, options, {
            platform,
            app: { getApplicationInfoForProtocol: () => assert.fail('브라우저 조회가 필요하지 않습니다.') },
            shell: { openExternal: async url => { opened = url; } },
            runFile: () => assert.fail('Mac 실행 명령을 사용하면 안 됩니다.'),
        });
        assert.equal(opened, READIVE_APP_STORE_URL);
    }
});

test('기본 브라우저 조회·실행 실패 시 App Store 앱으로 우회하지 않고 오류를 전달한다', async () => {
    for (const failure of ['lookup', 'missing-path', 'launch']) {
        await assert.rejects(openExternalUrl(READIVE_APP_STORE_URL, { browser: true }, {
            platform: 'darwin',
            app: { getApplicationInfoForProtocol: async () => {
                if (failure === 'lookup') throw new Error('Lookup failed');
                return failure === 'missing-path' ? {} : { path: '/Applications/Browser.app' };
            } },
            shell: { openExternal: () => assert.fail('App Store 앱으로 우회하면 안 됩니다.') },
            runFile: async () => { throw new Error('Launch failed'); },
        }), /Lookup failed|Default browser unavailable|Launch failed/);
    }
});
