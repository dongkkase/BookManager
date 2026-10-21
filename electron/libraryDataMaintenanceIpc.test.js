import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
}

test('라이브러리 상태 조회는 느린 경로 접근을 비동기로 기다리고 순서와 누락 상태를 유지한다', async () => {
    const requests = [];
    let handler;
    let closed = false;
    const context = vm.createContext({
        path,
        fs: {
            existsSync() { assert.fail('Library status must not synchronously access a network path.'); },
            promises: { access: folder => new Promise((resolve, reject) => requests.push({ folder, resolve, reject })) },
        },
        ipcMain: { handle: (_name, callback) => { handler = callback; } },
        libraryDbPath: () => '/temporary/library.db',
        LibraryDB: class {
            async getLibraryScanStates() { return [{ library_path: path.resolve('/slow'), file_count: 10 }]; }
            async close() { closed = true; }
        },
        normalizeLibraryScanStateForRenderer: (folder, state, exists) => ({ folder, count: state?.file_count || 0, exists }),
    });
    vm.runInContext(section("  ipcMain.handle('folder:getLibraryScanStates',", "  ipcMain.handle('folder:getLibraryFolderChildren',"), context);
    const pending = handler(null, ['/slow', '/missing', '/slow']);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.equal(closed, false);
    requests[1].reject(Object.assign(new Error('unavailable'), { code: 'ENOENT' }));
    requests[0].resolve();
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)), [
        { folder: path.resolve('/slow'), count: 10, exists: true },
        { folder: path.resolve('/missing'), count: 0, exists: false },
    ]);
    assert.equal(closed, true);
});

test('라이브러리 변경 저장은 이전 범위의 정리가 끝난 뒤 반영하고 일반 설정 저장은 기다리지 않는다', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let waits = 0;
    let runs = 0;
    const saved = [];
    let current = { libraries: ['/old'], language: 'ko' };
    const context = vm.createContext({
        configManager: { getConfig: () => current },
        revokeConfigTelemetryConsent: () => {},
        saveConfigWithTelemetryConsent: (_manager, value) => { saved.push(value); current = value; return value; },
        libraryDataMaintenance: {
            async withIdle(operation) { waits += 1; await pending; return operation(); },
            async run() { runs += 1; },
        },
    });
    const body = section("  ipcMain.handle('config:save', async (_, config) => {", '    const nextLang =')
        .replace("  ipcMain.handle('config:save', async (_, config) => {", '(async (config) => {');
    const save = vm.runInContext(`${body}\nreturn savedConfig; })`, context);
    const changing = save({ libraries: ['/new'] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(waits, 1);
    assert.equal(saved.length, 0);
    current = { ...current, theme: 'updated-during-cleanup' };
    release();
    await changing;
    assert.deepEqual(JSON.parse(JSON.stringify(current.libraries)), ['/new']);
    assert.equal(runs, 1);
    assert.equal(current.theme, 'updated-during-cleanup');
    await save({ last_tab_id: 'tools' });
    assert.equal(waits, 1);
    assert.equal(runs, 1);
    assert.equal(current.last_tab_id, 'tools');
});
