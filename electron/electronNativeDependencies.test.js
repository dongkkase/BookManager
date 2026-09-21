import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { ensureElectronNativeDependencies } from './ensureElectronNativeDependencies.cjs';

const require = createRequire(import.meta.url);
const ready = { status: 0, stdout: 'arm64\n', stderr: '' };
const incompatible = { status: 1, stdout: 'arm64\n', stderr: 'ERR_DLOPEN_FAILED: slice is not valid mach-o file' };

function createRunner(results) {
    const calls = [];
    return {
        calls,
        run(command, args, options) {
            calls.push({ command, args, options });
            assert.ok(results.length > 0, 'Unexpected extra process');
            return results.shift();
        },
        log() {},
    };
}

test('정상 네이티브 모듈은 Electron에서 검사하고 재빌드를 건너뛴다', () => {
    const runner = createRunner([ready]);
    ensureElectronNativeDependencies(runner);

    assert.equal(runner.calls.length, 1);
    const [probe] = runner.calls;
    assert.equal(probe.command, require('electron'));
    assert.equal(probe.options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.match(probe.args[1], /new Database\(':memory:'\)/);
    assert.ok(probe.options.timeout > 0);
});

test('다른 플랫폼의 모듈은 설치된 Electron 아키텍처로 재빌드하고 다시 검사한다', () => {
    const runner = createRunner([incompatible, { status: 0 }, ready]);
    ensureElectronNativeDependencies(runner);

    assert.equal(runner.calls.length, 3);
    const [probe, rebuild, recheck] = runner.calls;
    assert.equal(rebuild.command, process.execPath);
    assert.deepEqual(rebuild.args, [
        require.resolve('electron-builder/cli.js'),
        'install-app-deps',
        '--platform', process.platform,
        '--arch', 'arm64',
    ]);
    assert.equal(rebuild.options.cwd, probe.options.cwd);
    assert.deepEqual(recheck, probe);
});

test('재빌드 실패 시 추가 실행 없이 오류를 반환한다', () => {
    const runner = createRunner([incompatible, { status: 1 }]);

    assert.throws(() => ensureElectronNativeDependencies(runner), /rebuild failed: exit code 1/);
    assert.equal(runner.calls.length, 2);
});

test('재빌드가 성공해도 모듈을 로딩할 수 없으면 원래 오류를 반환한다', () => {
    const runner = createRunner([incompatible, { status: 0 }, incompatible]);

    assert.throws(() => ensureElectronNativeDependencies(runner), /probe failed after rebuild: ERR_DLOPEN_FAILED/);
    assert.equal(runner.calls.length, 3);
});

test('Electron 실행 자체가 실패하면 재빌드를 시도하지 않는다', () => {
    const runner = createRunner([{ status: null, error: new Error('spawn ENOENT') }]);

    assert.throws(() => ensureElectronNativeDependencies(runner), /Could not check.*spawn ENOENT/);
    assert.equal(runner.calls.length, 1);
});

test('Electron 검사 프로세스가 중단되면 재빌드를 시도하지 않는다', () => {
    const runner = createRunner([{ status: null, signal: 'SIGTERM', stdout: 'arm64\n' }]);

    assert.throws(() => ensureElectronNativeDependencies(runner), /Could not check.*SIGTERM/);
    assert.equal(runner.calls.length, 1);
});
