import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compareVersions,
    resolveUpdateInfo,
    shouldOpenUpdatePage,
} from './updatePolicy.js';

test('시맨틱 버전을 숫자로 비교한다', () => {
    assert.equal(compareVersions('3.0.0', '2.8.1'), 1);
    assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
    assert.equal(compareVersions('v2.8.1', '2.8.1'), 0);
});

test('현재 버전보다 높은 최신 릴리즈를 선택한다', () => {
    assert.deepEqual(resolveUpdateInfo('2.8.1', [
        { tag: 'v2.9.0', url: 'https://example.com/2.9.0' },
        {
            tag: 'v3.0.0',
            url: 'https://example.com/3.0.0',
            assets: [{ name: 'BookManager-win.zip', downloadUrl: 'https://example.com/win.zip', size: 10 }],
        },
    ]), {
        available: true,
        latestVersion: '3.0.0',
        url: 'https://example.com/3.0.0',
        assets: [{ name: 'BookManager-win.zip', downloadUrl: 'https://example.com/win.zip', size: 10 }],
    });
});

test('현재 버전이 최신이면 업데이트 없음으로 처리한다', () => {
    assert.deepEqual(resolveUpdateInfo('3.0.0', [
        { tag: 'v2.8.1', url: 'https://example.com/2.8.1' },
    ]), {
        available: false,
        latestVersion: '',
        url: '',
        assets: [],
    });
});

test('네트워크 실패 결과와 사전 릴리즈는 업데이트로 처리하지 않는다', () => {
    assert.deepEqual(resolveUpdateInfo('3.0.0', {
        error: 'NETWORK_ERROR',
        releases: [],
    }), {
        available: false,
        latestVersion: '',
        url: '',
        assets: [],
    });
    assert.deepEqual(resolveUpdateInfo('3.0.0', [
        { tag: 'v4.0.0-beta.1', prerelease: true, url: 'https://example.com/beta' },
    ]), {
        available: false,
        latestVersion: '',
        url: '',
        assets: [],
    });
});

test('업데이트 페이지는 명시적으로 동의한 경우에만 연다', () => {
    assert.equal(shouldOpenUpdatePage('yes'), true);
    assert.equal(shouldOpenUpdatePage('no'), false);
    assert.equal(shouldOpenUpdatePage(undefined), false);
});
