import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createFolderReadingStatesLoader, createReadingStatePathKeyResolver, readingStatePathKey, sameReadingStateFiles } from './folderReadingStates.js';
import { attachViewerStatus, createCachedViewerStatusMapper, createViewerStatusReader } from './viewerStatusState.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('읽기 상태 경로 키는 플랫폼별 정규화와 경로 변경을 반영한다', () => {
    const resolveMacKey = createReadingStatePathKeyResolver('darwin');
    const resolveWindowsKey = createReadingStatePathKeyResolver('win32');
    const path = '/books/한글.txt';
    const file = { path: path.normalize('NFD') };
    assert.equal(resolveMacKey(file), path);
    assert.equal(resolveMacKey(file), path);
    assert.equal(resolveWindowsKey(file), file.path);
    assert.equal(resolveMacKey({ ...file, title: 'Updated' }), path);
    file.full_path = '/books/다른 책.txt'.normalize('NFD');
    assert.equal(resolveMacKey(file), '/books/다른 책.txt');
    assert.equal(resolveMacKey(null), '');
    assert.equal(resolveMacKey({}), '');
});

test('메타데이터 배치에서 참조가 같은 항목의 경로는 다시 비교하지 않는다', () => {
    let reads = 0;
    const unchanged = { get path() { reads += 1; return '/books/1.cbz'; } };
    const updated = { path: '/books/2.cbz', title: 'Before' };
    assert.equal(sameReadingStateFiles([unchanged, updated], [unchanged, { ...updated, title: 'After' }]), true);
    assert.equal(reads, 0);
    assert.equal(sameReadingStateFiles([unchanged, updated], [unchanged, { ...updated, isDirectory: true }]), false);
});

function fixture() {
    const requests = [];
    const updates = [];
    let current;
    const loader = createFolderReadingStatesLoader({
        platform: 'darwin',
        request: paths => new Promise((resolve, reject) => requests.push({ paths, resolve, reject })),
        onChange: state => updates.push(state),
        isCurrent: files => files === current,
    });
    return { loader, requests, updates, setCurrent(files, scopeKey) { current = files; loader.setFiles(files, scopeKey); }, renderOnly(files) { current = files; } };
}

test('500개씩 순차 조회하고 폴더·중복을 제외하며 없는 기록도 명시적으로 비운다', async () => {
    const f = fixture();
    const files = Array.from({ length: 1201 }, (_, index) => ({ path: `/books/${index}.txt` }));
    f.setCurrent([...files, files[0], { path: '/books/folder', isDirectory: true }]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].paths.length, 500);
    f.requests[0].resolve([{ filePath: '/books/0.txt', status: 'reading' }]); await tick();
    assert.equal(f.requests.length, 2);
    assert.equal(f.updates.at(-1).statesByPath.get('/books/0.txt').status, 'reading');
    assert.equal(f.updates.at(-1).statesByPath.get('/books/1.txt'), null);
    f.requests[1].resolve([]); await tick();
    assert.equal(f.requests[2].paths.length, 201);
    f.requests[2].resolve([]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.size, 1201);
    f.loader.dispose();
});

test('폴더 변경·렌더 직후 cleanup 전·해제 뒤의 응답은 반영하지 않고 동시 요청도 늘리지 않는다', async () => {
    const f = fixture();
    const first = [{ path: '/first.txt' }];
    const second = [{ path: '/second.txt' }];
    f.setCurrent(first);
    f.setCurrent(second);
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve([{ filePath: '/first.txt' }]); await tick();
    assert.equal(f.updates.length, 0);
    assert.deepEqual(f.requests[1].paths, ['/second.txt']);
    f.loader.dispose();
    f.requests[1].resolve([{ filePath: '/second.txt' }]); await tick();
    assert.equal(f.updates.length, 0);
});

test('reading:changed는 해당 경로만 다시 읽고 삭제 전 진행 중 응답은 복구하지 않는다', async () => {
    const f = fixture();
    f.setCurrent([{ path: '/a.txt' }, { path: '/b.txt' }]);
    f.loader.refresh({ filePath: '/a.txt', removed: true });
    f.requests[0].resolve([{ filePath: '/a.txt', status: 'reading' }, { filePath: '/b.txt', status: 'reading' }]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.get('/a.txt'), null);
    assert.deepEqual(f.requests[1].paths, ['/a.txt']);
    f.requests[1].resolve([]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.get('/a.txt'), null);
    f.loader.refresh({ filePath: '/outside.txt' });
    assert.equal(f.requests.length, 2);
    f.loader.refresh({ cleared: true });
    assert.deepEqual(f.requests[2].paths, ['/a.txt', '/b.txt']);
    f.requests[2].resolve([]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.get('/b.txt'), null);
    f.loader.dispose();
});

test('NFD 응답을 NFC 파일에 연결하고 오류 후 같은 목록 재조회가 가능하다', async () => {
    const f = fixture();
    const path = '/books/한글.txt';
    f.setCurrent([{ path }]);
    f.requests[0].reject(new Error('offline')); await tick();
    f.loader.refresh();
    f.requests[1].resolve([{ filePath: path.normalize('NFD'), status: 'reading' }]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.get(readingStatePathKey(path, 'darwin')).status, 'reading');
    f.loader.dispose();
});

test('수집 중 목록이 늘어나도 진행 중 조회를 유지하며 이미 읽은 상태를 새 목록에 연결한다', async () => {
    const f = fixture();
    const files = Array.from({ length: 1201 }, (_, index) => ({ path: `/books/${index}.txt` }));
    f.setCurrent(files.slice(0, 600), '/books');
    f.setCurrent(files.slice(0, 900), '/books');
    f.setCurrent(files, '/books');
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve([{ filePath: files[0].path, status: 'reading' }]); await tick();
    assert.equal(f.updates.at(-1).files, files);
    assert.equal(f.updates.at(-1).statesByPath.get(files[0].path).status, 'reading');
    f.requests[1].resolve([]); await tick();
    f.requests[2].resolve([]); await tick();
    const extended = [...files, { path: '/books/new.txt' }];
    f.setCurrent(extended, '/books');
    assert.equal(f.updates.at(-1).files, extended);
    assert.equal(f.updates.at(-1).statesByPath.get(files[0].path).status, 'reading');
    assert.deepEqual(f.requests[3].paths, ['/books/new.txt']);
    f.requests[3].resolve([]); await tick();
    const requestedPaths = f.requests.flatMap(request => request.paths);
    assert.equal(requestedPaths.length, 1202);
    assert.equal(new Set(requestedPaths).size, 1202);
    assert.equal(f.updates.at(-1).statesByPath.size, 1202);
    f.loader.dispose();
});

test('수집 중 읽기 기록 삭제는 이전 응답으로 복구되지 않고 추가된 파일과 함께 다시 조회한다', async () => {
    const f = fixture();
    const a = { path: '/books/a.txt' };
    const b = { path: '/books/b.txt' };
    f.setCurrent([a], '/books');
    f.loader.refresh({ filePath: a.path, removed: true });
    const extended = [a, b];
    f.setCurrent(extended, '/books');
    f.requests[0].resolve([{ filePath: a.path, status: 'reading' }]); await tick();
    assert.equal(f.updates.at(-1).files, extended);
    assert.equal(f.updates.at(-1).statesByPath.get(a.path), null);
    assert.deepEqual(f.requests[1].paths, [a.path, b.path]);
    f.requests[1].resolve([{ filePath: b.path, status: 'completed' }]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.get(a.path), null);
    assert.equal(f.updates.at(-1).statesByPath.get(b.path).status, 'completed');
    f.loader.dispose();
});

test('파일 제거와 재추가 후에는 이전 조회 응답을 재사용하지 않고 없어진 상태도 버린다', async () => {
    const f = fixture();
    const a = { path: '/books/a.txt' };
    const b = { path: '/books/b.txt' };
    f.setCurrent([a, b], '/books');
    f.setCurrent([b], '/books');
    f.setCurrent([a, b], '/books');
    f.requests[0].resolve([{ filePath: a.path, status: 'completed' }, { filePath: b.path, status: 'reading' }]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.has(a.path), false);
    assert.equal(f.updates.at(-1).statesByPath.get(b.path).status, 'reading');
    assert.deepEqual(f.requests[1].paths, [a.path]);
    f.requests[1].resolve([]); await tick();
    const remaining = [a];
    f.setCurrent(remaining, '/books');
    assert.equal(f.updates.at(-1).files, remaining);
    assert.equal(f.updates.at(-1).statesByPath.has(b.path), false);
    assert.equal(f.requests.length, 2);
    f.setCurrent([], '/books');
    assert.equal(f.updates.at(-1).statesByPath.size, 0);
    f.setCurrent([a], '/books');
    assert.deepEqual(f.requests[2].paths, [a.path]);
    f.requests[2].resolve([]); await tick();
    f.loader.dispose();
});

test('목록 객체와 파일 경로가 같아도 폴더 범위가 바뀌면 이전 응답을 무시한다', async () => {
    const f = fixture();
    const files = [{ path: '/books/child/a.txt' }];
    f.setCurrent(files, '/books');
    f.setCurrent(files, '/books/child');
    f.requests[0].resolve([{ filePath: files[0].path, status: 'completed' }]); await tick();
    assert.equal(f.updates.length, 0);
    assert.deepEqual(f.requests[1].paths, [files[0].path]);
    f.requests[1].resolve([]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.get(files[0].path), null);
    f.loader.dispose();
});

test('새 목록 렌더 직후 setFiles 전에 도착한 응답은 반영하지 않고 다음 갱신에서 재조회한다', async () => {
    const f = fixture();
    const a = { path: '/books/a.txt' };
    const extended = [a, { path: '/books/b.txt' }];
    f.setCurrent([a], '/books');
    f.renderOnly(extended);
    f.requests[0].resolve([{ filePath: a.path, status: 'completed' }]); await tick();
    assert.equal(f.updates.length, 0);
    assert.equal(f.requests.length, 1);
    f.setCurrent(extended, '/books');
    assert.deepEqual(f.requests[1].paths, extended.map(file => file.path));
    f.requests[1].resolve([]); await tick();
    assert.equal(f.updates.at(-1).files, extended);
    f.loader.dispose();
});

test('조회 실패는 자동 재시도를 반복하지 않고 다음 수집 배치에서 실패·미조회 경로만 재시도한다', async () => {
    const f = fixture();
    const a = { path: '/books/a.txt' };
    const b = { path: '/books/b.txt' };
    const c = { path: '/books/c.txt' };
    f.setCurrent([a], '/books');
    f.requests[0].resolve([{ filePath: a.path, status: 'reading' }]); await tick();
    f.setCurrent([a, b], '/books');
    f.setCurrent([a, b, c], '/books');
    f.requests[1].reject(new Error('offline')); await tick();
    assert.equal(f.requests.length, 2);
    f.setCurrent([a, b, c], '/books');
    assert.deepEqual(new Set(f.requests[2].paths), new Set([b.path, c.path]));
    f.requests[2].resolve([]); await tick();
    assert.equal(f.updates.at(-1).statesByPath.get(a.path).status, 'reading');
    f.loader.dispose();
});

test('Linux와 Windows에서는 서로 다른 Unicode 파일을 합치지 않는다', async () => {
    for (const platform of ['linux', 'Linux x86_64', 'win32', 'Win32', '']) {
        const requests = [];
        const updates = [];
        const paths = ['/books/á.txt', '/books/á.txt'];
        const loader = createFolderReadingStatesLoader({ platform, request: async batch => { requests.push(batch); return batch.map((filePath, index) => ({ filePath, pageIndex: index + 1 })); }, onChange: value => updates.push(value) });
        loader.setFiles(paths.map(path => ({ path })));
        await tick();
        assert.deepEqual(requests[0], paths);
        assert.equal(updates[0].statesByPath.size, 2);
        assert.equal(updates[0].statesByPath.get(readingStatePathKey(paths[0], platform)).pageIndex, 1);
        assert.equal(updates[0].statesByPath.get(readingStatePathKey(paths[1], platform)).pageIndex, 2);
        loader.dispose();
    }
});

test('10만 파일은 200회 순차 조회하며 매 배치 전체 목록 재렌더를 요청하지 않는다', async () => {
    let requests = 0;
    let updates = 0;
    let active = 0;
    let maximum = 0;
    const files = Array.from({ length: 100000 }, (_, index) => ({ path: `/books/${index}.txt` }));
    let complete;
    const done = new Promise(resolve => { complete = resolve; });
    const loader = createFolderReadingStatesLoader({
        now: () => 0,
        request: async paths => { requests += 1; active += 1; maximum = Math.max(maximum, active); assert.ok(paths.length <= 500); await Promise.resolve(); active -= 1; return []; },
        onChange: snapshot => { updates += 1; if (snapshot.statesByPath.size === files.length) complete(); },
    });
    loader.setFiles(files);
    await done;
    assert.equal(requests, 200);
    assert.equal(maximum, 1);
    assert.equal(updates, 2);
    loader.dispose();
});

function folderFixture(platform = 'MacIntel') {
    const source = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('    const readingScopeRef =');
    const finish = source.indexOf('  const localSearchQuery', start);
    assert.ok(start >= 0 && finish > start);
    const platformDeclaration = source.match(/const runtimePlatform = [^\n]+;/)?.[0];
    assert.ok(platformDeclaration);
    const slots = [];
    const queuedEffects = [];
    const readingListeners = new Set();
    const focusListeners = new Set();
    const requests = [];
    let cursor = 0;
    const changed = (left, right) => !left || left.length !== right.length || left.some((value, index) => value !== right[index]);
    const context = vm.createContext({
        navigator: { platform },
        createFolderReadingStatesLoader, createReadingStatePathKeyResolver, readingStatePathKey, sameReadingStateFiles, attachViewerStatus, createCachedViewerStatusMapper,
        createViewerStatusReader: () => createViewerStatusReader(),
        recentReadingTimeText: () => '최근 읽음',
        useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
        useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
        useMemo(build, dependencies) { const index = cursor++; if (changed(slots[index]?.dependencies, dependencies)) slots[index] = { value: build(), dependencies }; return slots[index].value; },
        useEffect(effect, dependencies) { const index = cursor++; if (changed(slots[index]?.dependencies, dependencies)) { queuedEffects.push(() => { slots[index]?.cleanup?.(); slots[index] = { dependencies, cleanup: effect() }; }); } },
        window: {
            electronAPI: {
                getReadingStates: paths => new Promise(resolve => requests.push({ paths: [...paths], resolve })),
                onRecentReadingChanged(listener) { readingListeners.add(listener); return () => readingListeners.delete(listener); },
            },
            addEventListener(_name, listener) { focusListeners.add(listener); },
            removeEventListener(_name, listener) { focusListeners.delete(listener); },
        },
    });
    vm.runInContext(`function render({activeRawFileData,folderSource='folder',selectedFolderPath='/books',isRecentReading=false}) { const config = {}; const t = key => key; const viewerStatusVersion = 0; const activeDuplicateFileData = activeRawFileData; ${platformDeclaration} ${source.slice(start, finish)} return fileDataWithViewerStatus; }`, context);
    return {
        requests,
        render(props, flush = true) { cursor = 0; const output = context.render(props); if (flush) this.flush(); return output; },
        flush() { for (const effect of queuedEffects.splice(0)) effect(); },
        notify(event) { for (const listener of readingListeners) listener(event); },
        dispose() { for (const slot of slots) slot?.cleanup?.(); assert.equal(readingListeners.size, 0); assert.equal(focusListeners.size, 0); },
    };
}

test('macOS 브라우저의 일반 라이브러리 경로는 DB와 한글 분해 형식이 달라도 최근 읽음과 같은 진행도를 표시한다', async () => {
    for (const platform of ['MacIntel', 'MacARM', 'darwin']) {
        const f = folderFixture(platform);
        try {
            const filePath = '/Volumes/library/한글/책 01권.cbz';
            const databasePath = filePath.normalize('NFD');
            assert.notEqual(filePath, databasePath);
            const readingState = { filePath: databasePath, status: 'reading', locator: { kind: 'normalized', normalizedPosition: 8 / 197 } };
            const recentProps = { folderSource: 'recent-reading', isRecentReading: true, activeRawFileData: [{ path: databasePath, readingState }] };
            const recent = f.render(recentProps)[0].viewerStatus;
            assert.equal(recent.hasReadingProgress, true, platform);
            assert.equal(recent.percent, 4, platform);
            f.requests[0].resolve([readingState]); await tick();
            const folderProps = { selectedFolderPath: '/Volumes/library/한글', activeRawFileData: [{ path: '/Volumes/library/한글', full_path: filePath }] };
            f.render(folderProps);
            assert.deepEqual(f.requests[1].paths, [filePath]);
            f.requests[1].resolve([readingState]); await tick();
            const folder = f.render(folderProps)[0].viewerStatus;
            assert.equal(folder.hasReadingProgress, recent.hasReadingProgress, platform);
            assert.equal(folder.percent, recent.percent, platform);
            f.notify({ filePath: databasePath });
            assert.deepEqual(f.requests[2].paths, [filePath]);
            f.requests[2].resolve([{ ...readingState, locator: { kind: 'normalized', normalizedPosition: 0.2 } }]); await tick();
            assert.equal(f.render(folderProps)[0].viewerStatus.percent, 20, platform);
            f.notify({ filePath: databasePath, removed: true });
            assert.equal(f.render(folderProps)[0].viewerStatus.hasReadingProgress, false, platform);
            f.requests[3].resolve([]); await tick();
        } finally {
            f.dispose();
        }
    }
});

test('실제 FolderTab은 목록을 유지하면서 DB 변경을 반영하고 표지 갱신으로 전체 조회를 반복하지 않는다', async () => {
    const f = folderFixture();
    let props = { activeRawFileData: [{ path: '/books/b.txt' }, { path: '/books/a.txt' }] };
    let files = f.render(props);
    assert.deepEqual(Array.from(files, file => file.path), ['/books/b.txt', '/books/a.txt']);
    assert.equal(files[0].viewerStatus.hasReadingProgress, false);
    f.requests[0].resolve([{ filePath: '/books/b.txt', status: 'reading', locator: { kind: 'normalized', normalizedPosition: 0.04 } }]); await tick();
    files = f.render(props);
    assert.equal(files[0].viewerStatus.percent, 4);
    props = { activeRawFileData: props.activeRawFileData.map(file => ({ ...file, cover: 'new-preview' })) };
    files = f.render(props);
    assert.equal(files[0].viewerStatus.percent, 4);
    assert.equal(f.requests.length, 1);
    f.notify({ filePath: '/books/b.txt' });
    assert.deepEqual(f.requests[1].paths, ['/books/b.txt']);
    f.requests[1].resolve([{ filePath: '/books/b.txt', status: 'reading', locator: { kind: 'normalized', normalizedPosition: 0.2 } }]); await tick();
    assert.equal(f.render(props)[0].viewerStatus.percent, 20);
    f.notify({ filePath: '/books/b.txt', removed: true });
    assert.equal(f.render(props)[0].viewerStatus.hasReadingProgress, false);
    f.requests[2].resolve([]); await tick();
    f.dispose();
});

test('실제 FolderTab은 하위 폴더 수집 배치가 추가되어도 이전 진행도를 유지하고 새 파일만 조회한다', async () => {
    const f = folderFixture();
    const first = { path: '/books/a.txt' };
    let props = { activeRawFileData: [first] };
    f.render(props);
    f.requests[0].resolve([{ filePath: first.path, status: 'reading', locator: { kind: 'normalized', normalizedPosition: 0.2 } }]); await tick();
    assert.equal(f.render(props)[0].viewerStatus.percent, 20);
    props = { activeRawFileData: [first, { path: '/books/child/b.txt' }] };
    f.render(props);
    assert.equal(f.render(props)[0].viewerStatus.percent, 20);
    assert.deepEqual(f.requests[1].paths, ['/books/child/b.txt']);
    f.requests[1].resolve([]); await tick();
    assert.equal(f.render(props)[0].viewerStatus.percent, 20);
    assert.equal(f.requests.length, 2);
    f.dispose();
});

test('실제 FolderTab의 새 경로 렌더부터 이전 비동기 응답을 무시하며 최근 읽음도 즉시 DB 상태를 표시한다', async () => {
    const f = folderFixture();
    f.render({ activeRawFileData: [{ path: '/old/a.txt' }], selectedFolderPath: '/old' });
    const props = { activeRawFileData: [{ path: '/new/b.txt' }], selectedFolderPath: '/new' };
    f.render(props, false);
    f.requests[0].resolve([{ filePath: '/old/a.txt', status: 'completed' }]); await tick();
    assert.equal(f.requests.length, 1);
    f.flush();
    assert.deepEqual(f.requests[1].paths, ['/new/b.txt']);
    assert.equal(f.render(props)[0].viewerStatus.hasReadingProgress, false);
    f.requests[1].resolve([]); await tick();
    const recent = f.render({ folderSource: 'recent-reading', isRecentReading: true, activeRawFileData: [{ path: '/recent.txt', readingState: { status: 'reading', locator: { kind: 'normalized', normalizedPosition: 0.0242424242 } } }] });
    assert.equal(recent[0].viewerStatus.percent, 2);
    assert.equal(recent[0].recentReadingText, '최근 읽음');
    f.dispose();
    f.requests[2].resolve([]); await tick();
});
