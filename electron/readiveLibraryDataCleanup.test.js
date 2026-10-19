import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pruneReadiveLibraryData } from './readive/libraryDataCleanup.js';
import { ReadiveStore } from './readive/store.js';

const hashFor = character => character.repeat(64);
const itemFor = (character, sourcePath) => ({
    itemId: `item-${character}`, contentHash: hashFor(character), sourcePath,
    identity: { size: 10, mtimeMs: 1 }, format: 'text', deviceIds: ['phone'],
});
const readingFor = character => ({
    itemId: `item-${character}`, contentHash: hashFor(character), deviceId: 'phone',
    revision: 3, locator: { kind: 'page', pageIndex: 5 },
});

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'readive-library-cleanup-'));
    const libraryPath = path.join(root, 'Books');
    await fs.mkdir(libraryPath);
    const inside = path.join(libraryPath, 'inside.txt');
    const outside = path.join(root, 'outside.txt');
    for (const file of [inside, outside]) await fs.writeFile(file, 'original');
    const store = new ReadiveStore(path.join(root, 'state'));
    await store.load();
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, libraryPath, inside, outside, store };
}

test('Readive 외부 도서 연결과 읽기기록을 정리하고 내부 도서·서버·기기·전송 작업을 보존한다', async t => {
    const { store, libraryPath, inside, outside } = await fixture(t);
    await store.transact(state => {
        state.devices = [{ id: 'phone', tokenHash: 'token' }];
        state.jobs = [{ id: 'job', state: 'accepted', manifest: { files: [{ id: 'file', sha256: hashFor('b') }] },
            assets: { original: { sourcePath: outside, sha256: hashFor('b') } }, fileAssets: { file: { file: 'original' } } }];
        state.entryIds = { [outside]: 'entry' };
        state.items = { [hashFor('a')]: itemFor('a', inside), [hashFor('b')]: itemFor('b', outside) };
        state.pathContentHashes = { [inside]: hashFor('a'), [outside]: hashFor('b') };
        state.reading = { 'item-a:phone': readingFor('a'), 'item-b:phone': readingFor('b'), 'item-c:phone': readingFor('c') };
        state.appliedReadings = Object.fromEntries(['a', 'b', 'c'].map(character => [
            `item-${character}`, { record: readingFor(character), localRevision: 2 },
        ]));
    });
    const before = structuredClone(store.state);

    const result = await pruneReadiveLibraryData(store, [libraryPath]);

    assert.equal(result.deletedItemCount, 1);
    assert.equal(result.deletedPathHashCount, 1);
    assert.equal(result.deletedReadingCount, 2);
    assert.equal(result.deletedAppliedReadingCount, 2);
    assert.deepEqual(store.state.items, { [hashFor('a')]: before.items[hashFor('a')] });
    assert.deepEqual(store.state.pathContentHashes, { [inside]: hashFor('a') });
    assert.deepEqual(store.state.reading, { 'item-a:phone': before.reading['item-a:phone'] });
    assert.deepEqual(store.state.appliedReadings, { 'item-a': before.appliedReadings['item-a'] });
    for (const key of ['serverId', 'version', 'devices', 'jobs', 'entryIds']) assert.deepEqual(store.state[key], before[key]);
    assert.equal(await fs.readFile(outside, 'utf8'), 'original');
    const reopened = new ReadiveStore(store.directory);
    assert.deepEqual(await reopened.load(), store.state);
});

test('같은 해시가 내부 경로에 연결되어 있으면 외부 대표 경로의 공유 도서·읽기기록을 보존한다', async t => {
    const { store, libraryPath, inside, outside } = await fixture(t);
    await store.transact(state => {
        state.items = { [hashFor('a')]: itemFor('a', outside) };
        state.pathContentHashes = { [inside]: hashFor('a'), [outside]: hashFor('a') };
        state.reading = { 'item-a:phone': readingFor('a') };
        state.appliedReadings = { 'item-a': { record: readingFor('a'), localRevision: 4 } };
    });
    const before = structuredClone(store.state);
    const result = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(result.deletedPathHashCount, 1);
    assert.equal(result.preservedSharedItemCount, 1);
    for (const key of ['items', 'reading', 'appliedReadings']) assert.deepEqual(store.state[key], before[key]);
    assert.deepEqual(store.state.pathContentHashes, { [inside]: hashFor('a') });
    assert.equal(store.state.items[hashFor('a')].sourcePath, outside);
});

test('현재 전송 manifest와 원본 asset의 내부 경로도 공유 해시 보존에 사용하고 표지 asset은 제외한다', async t => {
    const { store, libraryPath, inside, outside } = await fixture(t);
    await store.transact(state => {
        state.items = { [hashFor('a')]: itemFor('a', outside), [hashFor('b')]: itemFor('b', outside) };
        state.reading = { 'item-a:phone': readingFor('a'), 'item-b:phone': readingFor('b') };
        state.jobs = [{
            id: 'job', state: 'completed',
            manifest: { files: [{ id: 'a', sha256: hashFor('a') }, { id: 'b', sha256: hashFor('b') }] },
            assets: {
                original: { sourcePath: inside, sha256: hashFor('a') },
                mismatched: { sourcePath: inside, sha256: hashFor('c') },
                cover: { sourcePath: inside, sha256: hashFor('b') },
            },
            fileAssets: { a: { file: 'original', cover: 'cover' }, b: { file: 'mismatched' } },
        }];
    });
    const jobsBefore = structuredClone(store.state.jobs);
    const result = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(result.preservedSharedItemCount, 1);
    assert.equal(result.deletedItemCount, 1);
    assert.equal(result.deletedReadingCount, 1);
    assert.deepEqual(Object.keys(store.state.items), [hashFor('a')]);
    assert.deepEqual(store.state.jobs, jobsBefore);
});

test('Readive 정리는 알 수 없는 등록 설정을 거부하고 명시적 빈 목록만 전체 도서기록을 정리한다', async t => {
    const { store, libraryPath, inside } = await fixture(t);
    await store.transact(state => {
        state.items = { [hashFor('a')]: itemFor('a', inside) };
        state.pathContentHashes = { [inside]: hashFor('a') };
        state.reading = { 'item-a:phone': readingFor('a') };
        state.appliedReadings = { 'item-a': { record: readingFor('a') } };
    });
    const before = structuredClone(store.state);
    for (const invalid of [undefined, null, {}, [null], [''], ['relative'], [libraryPath, 42]]) {
        await assert.rejects(pruneReadiveLibraryData(store, invalid), /invalid_library_paths/);
        assert.deepEqual(store.state, before);
    }
    const result = await pruneReadiveLibraryData(store, []);
    assert.equal(result.changes, 4);
    for (const key of ['items', 'pathContentHashes', 'reading', 'appliedReadings']) assert.deepEqual(store.state[key], {});
    assert.equal(await fs.readFile(inside, 'utf8'), 'original');
});

test('Readive 정리 저장 실패 시 기존 도서·읽기기록을 메모리와 파일에서 보존한다', async t => {
    const { store, libraryPath, outside } = await fixture(t);
    await store.transact(state => {
        state.items = { [hashFor('a')]: itemFor('a', outside) };
        state.reading = { 'item-a:phone': readingFor('a') };
    });
    const before = structuredClone(store.state);
    const bytes = await fs.readFile(store.filePath, 'utf8');
    const save = t.mock.method(store, 'save', async () => { throw new Error('disk unavailable'); });
    await assert.rejects(pruneReadiveLibraryData(store, [libraryPath]), /disk unavailable/);
    assert.deepEqual(store.state, before);
    assert.equal(await fs.readFile(store.filePath, 'utf8'), bytes);
    save.mock.restore();
    const retried = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(retried.skipped, undefined);
    assert.equal(retried.changes, 2);
    assert.deepEqual(store.state.items, {});
    assert.deepEqual(store.state.reading, {});
});

test('Readive 정리는 호출 당시 등록 경로를 사용하고 변경이 없으면 상태 파일을 다시 쓰지 않는다', async t => {
    const { store, libraryPath, inside } = await fixture(t);
    await store.transact(state => { state.items = { [hashFor('a')]: itemFor('a', inside) }; });
    const save = t.mock.method(store, 'save');
    let release;
    store.pending = new Promise(resolve => { release = resolve; });
    const roots = [libraryPath];
    const pruning = pruneReadiveLibraryData(store, roots);
    roots.splice(0);
    release();
    const result = await pruning;
    assert.equal(result.changes, 0);
    assert.equal(save.mock.callCount(), 0);
    assert.deepEqual(Object.keys(store.state.items), [hashFor('a')]);
});

test('변경 없는 Readive 정리는 트랜잭션과 전체 상태 복제에 진입하지 않는다', async t => {
    const { store, libraryPath, inside } = await fixture(t);
    await store.transact(state => { state.items = { [hashFor('a')]: itemFor('a', inside) }; });
    await pruneReadiveLibraryData(store, [libraryPath]);
    t.mock.method(store, 'transact', () => assert.fail('An unchanged cleanup must skip the state clone and traversal.'));
    const result = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(result.skipped, true);
    assert.equal(result.changes, 0);
    assert.equal(result.deletedItemCount, 0);
    assert.deepEqual(Object.keys(store.state.items), [hashFor('a')]);
});

test('SQLite 변경 없이 추가된 전송 도서와 읽기 기록도 다음 Readive 정리에서 제거한다', async t => {
    const { store, libraryPath, inside, outside } = await fixture(t);
    await store.transact(state => { state.items = { [hashFor('a')]: itemFor('a', inside) }; });
    await pruneReadiveLibraryData(store, [libraryPath]);
    await store.transact(state => {
        state.items[hashFor('b')] = itemFor('b', outside);
        state.pathContentHashes = { [outside]: hashFor('b') };
        state.reading['item-b:phone'] = readingFor('b');
        state.appliedReadings['item-b'] = { record: readingFor('b') };
    });
    const result = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(result.skipped, undefined);
    assert.equal(result.changes, 4);
    assert.deepEqual(Object.keys(store.state.items), [hashFor('a')]);
    assert.deepEqual(store.state.pathContentHashes, {});
    assert.deepEqual(store.state.reading, {});
    assert.equal((await pruneReadiveLibraryData(store, [libraryPath])).skipped, true);
});

test('등록 경로가 바뀌거나 빈 목록으로 저장되면 Readive 정리를 다시 실행한다', async t => {
    const { store, root, libraryPath, inside, outside } = await fixture(t);
    await store.transact(state => {
        state.items = { [hashFor('a')]: itemFor('a', inside), [hashFor('b')]: itemFor('b', outside) };
    });
    await pruneReadiveLibraryData(store, [root]);
    const narrowed = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(narrowed.deletedItemCount, 1);
    assert.deepEqual(Object.keys(store.state.items), [hashFor('a')]);
    const removed = await pruneReadiveLibraryData(store, []);
    assert.equal(removed.deletedItemCount, 1);
    assert.deepEqual(store.state.items, {});
});

test('정리보다 먼저 대기 중인 전송 기록의 저장이 끝난 뒤 최신 상태를 정리한다', async t => {
    const { store, libraryPath, outside } = await fixture(t);
    await pruneReadiveLibraryData(store, [libraryPath]);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const mutation = store.transact(async state => {
        await gate;
        state.items[hashFor('a')] = itemFor('a', outside);
    });
    let completed = false;
    const pruning = pruneReadiveLibraryData(store, [libraryPath]).then(result => {
        completed = true;
        return result;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    release();
    await mutation;
    assert.equal((await pruning).deletedItemCount, 1);
    assert.deepEqual(store.state.items, {});
});

test('정리 진행 중 새로 대기한 전송 기록을 정리 완료 캐시에 포함하지 않는다', async t => {
    const { store, libraryPath, outside } = await fixture(t);
    const pruning = pruneReadiveLibraryData(store, [libraryPath]);
    const mutation = store.transact(state => { state.items[hashFor('a')] = itemFor('a', outside); });
    await Promise.all([pruning, mutation]);
    assert.deepEqual(Object.keys(store.state.items), [hashFor('a')]);
    const next = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(next.skipped, undefined);
    assert.equal(next.deletedItemCount, 1);
    assert.deepEqual(store.state.items, {});
});

test('상태 객체가 교체되면 같은 대기열과 등록 경로라도 Readive 정리를 다시 실행한다', async t => {
    const { store, libraryPath, outside } = await fixture(t);
    await pruneReadiveLibraryData(store, [libraryPath]);
    store.state = { ...store.state, items: { [hashFor('a')]: itemFor('a', outside) } };
    const result = await pruneReadiveLibraryData(store, [libraryPath]);
    assert.equal(result.deletedItemCount, 1);
    assert.deepEqual(store.state.items, {});
});
