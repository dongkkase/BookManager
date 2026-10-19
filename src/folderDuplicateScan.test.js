import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./hooks/useFolderScan.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const options = {
    includeSubfolders: false,
    includeDirectories: true,
    fastInitial: true,
    enableDupCheck: true,
    dupFolders: ['/Library'],
};
const file = (folder = '/A', dupCount = 0) => ({
    path: `${folder}/Book.cbz`,
    full_path: `${folder}/Book.cbz`,
    name: 'Book.cbz',
    mtime: 123,
    dup_count: dupCount,
    max_ratio: dupCount ? 100 : 0,
    duplicate_matches: dupCount ? [{ path: '/Library/Book.cbz', name: 'Book.cbz', ratio: 100 }] : [],
});

function fixture() {
    const slots = [];
    const calls = [];
    const timers = new Map();
    const listeners = new Map();
    const errors = [];
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let timerId = 0;
    let hook;
    const same = (left, right) => left && right && left.length === right.length
        && left.every((value, index) => Object.is(value, right[index]));
    const useMemo = (compute, deps) => {
        const index = cursor++;
        if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: compute(), deps };
        return slots[index].value;
    };
    const listen = name => callback => {
        listeners.set(name, callback);
        return () => listeners.delete(name);
    };
    const context = vm.createContext({
        AUDIO_EXTENSIONS: [],
        resolveBookType: () => 'comic',
        joinPath: (folder, name) => `${folder}/${name}`,
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, update => {
                const next = typeof update === 'function' ? update(slots[index].value) : update;
                if (!Object.is(next, slots[index].value)) dirty = true;
                slots[index].value = next;
            }];
        },
        useRef: initial => slots[cursor++] ??= { current: initial },
        useCallback: (callback, deps) => useMemo(() => callback, deps),
        useEffect(effect, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) {
                const previous = slots[index];
                slots[index] = { deps };
                effects.push(() => {
                    previous?.cleanup?.();
                    slots[index].cleanup = effect();
                });
            }
        },
        startTransition: callback => callback(),
        console: { ...console, error: (...args) => errors.push(args) },
        window: {
            setTimeout: (callback, delay) => {
                timers.set(++timerId, { callback, delay });
                return timerId;
            },
            clearTimeout: id => timers.delete(id),
            electronAPI: {
                readDir: async folder => folder === '/A' ? [{ name: 'Book.cbz', isFile: true }] : [],
                scanFolder: (folderPath, requestOptions) => {
                    let resolve;
                    let reject;
                    const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
                    calls.push({ folderPath, options: requestOptions, resolve, reject });
                    return promise;
                },
                stopTask: async () => {},
                onFolderFileReady: listen('ready'),
                onScanComplete: listen('complete'),
            },
        },
    });
    vm.runInContext(source, context);
    const translate = key => key;
    const render = () => {
        cursor = 0;
        dirty = false;
        hook = context.useFolderScan(translate);
        const pending = effects;
        effects = [];
        pending.forEach(effect => effect());
    };
    render();
    return {
        calls,
        timers,
        errors,
        current: () => hook,
        scan: (path, scanOptions = options) => hook.scanFolder(path, scanOptions),
        files: (path = '/A', scanOptions = options) => hook.getCachedFiles(path, scanOptions),
        emit(name, call, values) {
            const cacheKey = Object.keys(hook.fileDataCache).find(key => {
                const scope = JSON.parse(key);
                return scope.folderPath === call.folderPath && scope.enableDupCheck === call.options.enableDupCheck;
            });
            listeners.get(name)?.({ folderPath: call.folderPath, cacheKey, requestId: call.options.requestId, ...values });
        },
        flushTimers() {
            const pending = [...timers.values()];
            timers.clear();
            pending.forEach(timer => timer.callback());
        },
        async flush() {
            let idle = 0;
            for (let attempt = 0; attempt < 30; attempt += 1) {
                if (dirty) {
                    render();
                    idle = 0;
                    continue;
                }
                await tick();
                if (!dirty && ++idle === 2) return;
            }
            assert.fail('Folder scan updates did not settle');
        },
        dispose: () => slots.forEach(slot => slot.cleanup?.()),
    };
}

async function beginDuplicateScan(f, scanOptions = options) {
    const start = f.calls.length;
    const scan = f.scan('/A', scanOptions);
    await f.flush();
    assert.equal(f.calls[start].options.enableDupCheck, false);
    f.calls[start].resolve([file()]);
    await f.flush();
    await scan;
    const metadata = f.calls[start + 1];
    assert.equal(metadata.options.enableDupCheck, scanOptions.enableDupCheck);
    assert.equal(f.files('/A', scanOptions).length, 1);
    assert.equal(f.current().scanning, false);
    return metadata;
}

test('빠른 목록 뒤 최종 중복 결과는 대기 중이거나 늦게 도착한 파일 준비 이벤트로 덮이지 않는다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const metadata = await beginDuplicateScan(f);
    f.emit('ready', metadata, { file: file() });
    assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [180]);
    metadata.resolve([file('/A', 1)]);
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);

    f.flushTimers();
    await f.flush();
    f.emit('ready', metadata, { file: file() });
    f.flushTimers();
    await f.flush();

    assert.equal(f.files()[0].dup_count, 1);
    assert.equal(f.files()[0].duplicate_matches.length, 1);
    assert.equal(f.files()[0].max_ratio, 100);
});

test('묶음 메타데이터 이벤트는 함께 반영하고 최종 결과 이후의 늦은 묶음은 무시한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const metadata = await beginDuplicateScan(f);
    f.emit('ready', metadata, { files: [null, {}, { ...file(), title: 'Updated title' }] });
    f.flushTimers();
    await f.flush();
    assert.equal(f.files()[0].title, 'Updated title');

    f.emit('ready', metadata, { files: [{ ...file(), title: 'Queued title' }] });
    metadata.resolve([{ ...file('/A', 1), title: 'Final title' }]);
    await f.flush();
    f.flushTimers();
    f.emit('ready', metadata, { files: [{ ...file(), title: 'Late title' }] });
    f.flushTimers();
    await f.flush();
    assert.equal(f.files()[0].title, 'Final title');
    assert.equal(f.files()[0].dup_count, 1);
});

test('대형 목록의 메타데이터 묶음은 화면 갱신을 모아서 처리하고 기존 표지를 보존한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const scan = f.scan('/A');
    await f.flush();
    const initial = Array.from({ length: 10000 }, (_, index) => ({
        ...file(), path: `/A/Book-${index}.cbz`, name: `Book-${index}.cbz`, cover: `cover-${index}`,
    }));
    f.calls[0].resolve(initial);
    await f.flush();
    await scan;
    const metadata = f.calls[1];
    const updates = initial.slice(0, 128).map(entry => ({ ...entry, cover: '', title: `Metadata: ${entry.name}` }));
    f.emit('ready', metadata, { files: updates });
    assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [600]);
    f.flushTimers();
    await f.flush();
    for (let index = 0; index < 128; index += 1) {
        assert.equal(f.files()[index].title, updates[index].title);
        assert.equal(f.files()[index].cover, initial[index].cover);
    }
    assert.equal(f.files()[128], initial[128]);
    metadata.resolve(initial);
    await f.flush();
});

test('폴더를 바꾸면 대기 중인 이전 메타데이터 묶음을 반영하지 않는다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const metadata = await beginDuplicateScan(f);
    const initialTitle = f.files()[0].title;
    f.emit('ready', metadata, { files: [{ ...file(), title: 'Stale title' }] });
    const next = f.scan('/B');
    await f.flush();
    f.flushTimers();
    await f.flush();
    assert.equal(f.files()[0].title, initialTitle);
    metadata.resolve([{ ...file(), title: 'Stale final title' }]);
    f.calls[2].resolve([file('/B')]);
    await f.flush();
    await next;
    assert.equal(f.files('/B')[0].path, '/B/Book.cbz');
    assert.equal(f.files()[0].title, initialTitle);
    f.calls[3].resolve([file('/B')]);
    await f.flush();
});

test('일반 스캔의 완료 이벤트와 최종 응답도 늦은 중간 결과보다 우선한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const regularOptions = { ...options, fastInitial: false };
    const scan = f.scan('/A', regularOptions);
    await f.flush();
    const call = f.calls[0];
    const cacheKey = JSON.stringify({ folderPath: '/A', includeSubfolders: false, enableDupCheck: true, dupFolders: ['/Library'], skipArchiveExtraction: false, includeDirectories: true });
    f.emit('ready', call, { cacheKey, file: file() });
    f.emit('complete', call, { cacheKey, files: [file('/A', 1)] });
    await f.flush();
    f.flushTimers();
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);
    call.resolve([file('/A', 1)]);
    await scan;
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);
});

test('별도 라이브러리 인덱싱에서 온 메타데이터 갱신은 완료된 폴더 스캔과 구분한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const metadata = await beginDuplicateScan(f);
    metadata.resolve([file('/A', 1)]);
    await f.flush();

    f.emit('ready', metadata, {
        requestId: undefined,
        libraryPhase: 'metadata',
        file: { ...file(), title: 'Updated title' },
    });
    f.flushTimers();
    await f.flush();

    assert.equal(f.files()[0].title, 'Updated title');
    assert.equal(f.files()[0].dup_count, 1);
    assert.equal(f.files()[0].duplicate_matches.length, 1);
    assert.equal(f.files()[0].max_ratio, 100);
});

test('표지와 메타데이터 갱신은 중복 검사 ON/OFF 캐시의 판정 결과를 각각 보존한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const enabled = await beginDuplicateScan(f);
    enabled.resolve([file('/A', 1)]);
    await f.flush();
    const offOptions = { ...options, enableDupCheck: false };
    const disabled = await beginDuplicateScan(f, offOptions);
    disabled.resolve([file()]);
    await f.flush();

    f.current().updateCachedFiles('/A', offOptions, [{ ...file(), cover: 'new-cover', title: 'New metadata' }]);
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);
    assert.equal(f.files()[0].duplicate_matches.length, 1);
    assert.equal(f.files()[0].max_ratio, 100);
    assert.equal(f.files('/A', offOptions)[0].dup_count, 0);
    assert.equal(f.files()[0].cover, 'new-cover');
    assert.equal(f.files('/A', offOptions)[0].title, 'New metadata');

    f.current().updateCachedFiles('/A', options, [{ ...file('/A', 9), cover: 'late-cover' }]);
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);
    assert.equal(f.files('/A', offOptions)[0].dup_count, 0);
    assert.equal(f.files('/A', offOptions)[0].duplicate_matches.length, 0);
    assert.equal(f.files('/A', offOptions)[0].max_ratio, 0);
    assert.equal(f.files()[0].cover, 'late-cover');
});

test('새 검사의 최종 0건 결과는 이전 중복 판정을 정상적으로 지운다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const previous = await beginDuplicateScan(f);
    previous.resolve([file('/A', 1)]);
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);

    const scan = f.scan('/A', { ...options, fastInitial: false, force: true });
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);
    f.calls.at(-1).resolve([file()]);
    await scan;
    await f.flush();
    assert.equal(f.files()[0].dup_count, 0);
    assert.equal(f.files()[0].duplicate_matches.length, 0);
    assert.equal(f.files()[0].max_ratio, 0);
});

test('인덱스 갱신 뒤 목록을 새로 읽을 때 메타데이터 강제 추출 없이 기존 목록을 교체한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const scanOptions = { ...options, fastInitial: false };
    const initial = f.scan('/A', scanOptions);
    await f.flush();
    f.calls[0].resolve([{ ...file('/A', 1), title: 'Old title', cover: 'old-cover' }, { ...file(), path: '/A/Removed.cbz' }]);
    await initial;
    await f.flush();

    const refreshed = f.scan('/A', { ...scanOptions, refresh: true, force: false });
    await f.flush();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.force, false);
    f.calls[1].resolve([{ ...file(), title: 'Updated title', cover: '' }]);
    await refreshed;
    await f.flush();

    assert.equal(f.files().length, 1);
    assert.equal(f.files()[0].title, 'Updated title');
    assert.equal(f.files()[0].cover, '');
    assert.equal(f.files()[0].dup_count, 0);
    const cached = await f.scan('/A', scanOptions);
    assert.equal(cached[0].title, 'Updated title');
    assert.equal(f.calls.length, 2);

    const forced = f.scan('/A', { ...scanOptions, force: true });
    await f.flush();
    assert.equal(f.calls[2].options.force, true);
    f.calls[2].resolve([file()]);
    await forced;
});

test('진행 중인 목록 조회 뒤 갱신 요청은 한 번 더 읽고 백엔드 캐시는 재사용한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const scanOptions = { ...options, fastInitial: false };
    const initial = f.scan('/A', scanOptions);
    await f.flush();
    const refreshed = f.scan('/A', { ...scanOptions, refresh: true });
    await f.flush();
    assert.equal(f.calls.length, 1);
    f.calls[0].resolve([{ ...file(), title: 'Before index' }]);
    await initial;
    await f.flush();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.force, false);
    f.calls[1].resolve([{ ...file(), title: 'After index' }]);
    await refreshed;
    await f.flush();
    assert.equal(f.files()[0].title, 'After index');
});

test('인덱스 갱신 후 목록을 읽는 중에도 명시한 강제 추출 요청은 유지한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const scanOptions = { ...options, fastInitial: false };
    const refreshed = f.scan('/A', { ...scanOptions, refresh: true });
    await f.flush();
    const forced = f.scan('/A', { ...scanOptions, force: true });
    await f.flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.force, false);
    f.calls[0].resolve([file()]);
    await refreshed;
    await f.flush();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.force, true);
    f.calls[1].resolve([file()]);
    await forced;
});

test('대기 중인 목록 갱신에 강제 추출 요청이 추가되면 한 번의 강제 스캔으로 처리한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const scanOptions = { ...options, fastInitial: false };
    const initial = f.scan('/A', scanOptions);
    await f.flush();
    const refreshed = f.scan('/A', { ...scanOptions, refresh: true });
    const forced = f.scan('/A', { ...scanOptions, force: true });
    await f.flush();
    assert.equal(f.calls.length, 1);
    f.calls[0].resolve([file()]);
    await initial;
    await f.flush();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].options.force, true);
    f.calls[1].resolve([file()]);
    await Promise.all([refreshed, forced]);
    await f.flush();
    assert.equal(f.calls.length, 2);
});

for (const includeSubfolders of [false, true]) {
    test(`중복 검사 중 A→B→A 이동 시 미완성 캐시를 재검사한다 (하위 폴더 ${includeSubfolders})`, async t => {
        const f = fixture();
        t.after(f.dispose);
        const scanOptions = { ...options, includeSubfolders };
        const previous = await beginDuplicateScan(f, scanOptions);
        const other = f.scan('/B', scanOptions);
        await f.flush();
        f.calls.at(-1).resolve([]);
        await other;
        await f.flush();

        const current = await beginDuplicateScan(f, scanOptions);
        assert.ok(current.options.requestId > previous.options.requestId);
        previous.resolve([file('/A', 7)]);
        f.emit('ready', previous, { file: file('/A', 7) });
        await f.flush();
        f.flushTimers();
        await f.flush();
        assert.equal(f.files('/A', scanOptions)[0].dup_count, 0);

        current.resolve([file('/A', 1)]);
        await f.flush();
        const callCount = f.calls.length;
        const cached = await f.scan('/A', scanOptions);
        await f.flush();
        assert.equal(cached[0].dup_count, 1);
        assert.equal(f.calls.length, callCount);
    });
}

test('중복 검사를 끈 뒤 이전 검사의 응답과 준비 이벤트는 현재 목록에 반영하지 않는다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const enabled = await beginDuplicateScan(f);
    const offOptions = { ...options, enableDupCheck: false, force: true };
    const disabled = await beginDuplicateScan(f, offOptions);
    disabled.resolve([file()]);
    await f.flush();
    enabled.resolve([file('/A', 1)]);
    f.emit('ready', enabled, { file: file('/A', 1) });
    await f.flush();
    f.flushTimers();
    await f.flush();

    assert.equal(f.files('/A', offOptions)[0].dup_count, 0);
    const retry = await beginDuplicateScan(f);
    retry.resolve([file('/A', 1)]);
    await f.flush();
    assert.equal(f.files()[0].dup_count, 1);
});

test('중복 검사 실패와 취소 후에는 빠른 목록을 완료된 결과로 재사용하지 않는다', async t => {
    for (const cancelled of [false, true]) {
        const f = fixture();
        t.after(f.dispose);
        const metadata = await beginDuplicateScan(f);
        if (cancelled) {
            await f.current().cancelScan();
            metadata.resolve([file('/A', 1)]);
        } else {
            metadata.reject(new Error('Duplicate check failed'));
        }
        await f.flush();
        const retry = await beginDuplicateScan(f);
        retry.resolve([file('/A', 1)]);
        await f.flush();
        assert.equal(f.files()[0].dup_count, 1);
    }
});

test('검사할 파일이 없는 폴더는 완료된 빈 캐시를 재사용한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    const scan = f.scan('/B');
    await f.flush();
    f.calls[0].resolve([]);
    await scan;
    await f.flush();
    assert.equal(f.calls.length, 1);
    assert.equal((await f.scan('/B')).length, 0);
    await f.flush();
    assert.equal(f.calls.length, 1);
});
