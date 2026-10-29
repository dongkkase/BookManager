import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as recommendationState from './dailyRecommendationState.js';
import * as viewerStatus from './viewerStatusState.js';
import * as readingStates from './folderReadingStates.js';
import * as recommendationPreferences from './recommendationPreferencesState.js';
import * as dashboardCatalogCache from './dashboardCatalogCache.js';

const compiled = transformSync(fs.readFileSync(new URL('./hooks/useDailyRecommendation.js', import.meta.url), 'utf8'), { format: 'cjs', target: 'es2022' }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(initialFiles, initialStorage = {}) {
    const slots = [];
    const states = [];
    const previews = [];
    const catalogReads = { options: 0 };
    const values = new Map(Object.entries(initialStorage));
    const timers = new Map();
    let cursor = 0;
    let effects = [];
    let files = initialFiles;
    let result;
    let recentListener;
    let clock = new Date(2026, 9, 26, 23, 59, 59);
    let updates = 0;
    let nextTimer = 0;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        useState(initialValue) {
            const index = cursor++;
            slots[index] ??= { value: typeof initialValue === 'function' ? initialValue() : initialValue };
            return [slots[index].value, update => {
                updates += 1;
                slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;
            }];
        },
        useRef(initialValue) { return slots[cursor++] ??= { current: initialValue }; },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: callback, dependencies };
            return slots[index].value;
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
                const previous = slots[index];
                const current = { dependencies };
                slots[index] = current;
                effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
            }
        },
    };
    const eventTarget = () => {
        const listeners = new Map();
        return {
            listeners,
            addEventListener: (type, listener) => listeners.set(type, listener),
            removeEventListener: type => listeners.delete(type),
            emit: (type, event = {}) => listeners.get(type)?.(event),
        };
    };
    const storage = {
        get length() { return values.size; },
        key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
    const window = {
        ...eventTarget(),
        localStorage: storage,
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        electronAPI: {
            getReadingStates: paths => new Promise((resolve, reject) => states.push({ paths: [...paths], resolve, reject })),
            getFilePreview: path => new Promise((resolve, reject) => previews.push({ path, resolve, reject })),
            onRecentReadingChanged: listener => { recentListener = listener; return () => { recentListener = null; }; },
        },
    };
    const document = { ...eventTarget(), visibilityState: 'visible' };
    const module = { exports: {} };
    const context = vm.createContext({
        module, exports: module.exports, window, document, navigator: { platform: 'MacIntel' },
        require(name) {
            if (name === 'react') return react;
            if (name.endsWith('viewerStatusState.js')) return viewerStatus;
            if (name.endsWith('folderReadingStates.js')) return readingStates;
            if (name.endsWith('recommendationPreferencesState.js')) return recommendationPreferences;
            if (name.endsWith('dashboardCatalogCache.js')) return {
                ...dashboardCatalogCache,
                dashboardRecommendationOptions(files) {
                    catalogReads.options += 1;
                    return dashboardCatalogCache.dashboardRecommendationOptions(files);
                },
            };
            if (name.endsWith('dailyRecommendationState.js')) return {
                ...recommendationState,
                dailyRecommendationDay: () => recommendationState.dailyRecommendationDay(clock),
                nextRecommendationDelay: () => recommendationState.nextRecommendationDelay(clock),
            };
            assert.fail(`Unexpected import: ${name}`);
        },
    });
    vm.runInContext(compiled, context);
    const render = (nextFiles = files, flush = true) => {
        files = nextFiles;
        cursor = 0;
        result = module.exports.useDailyRecommendation(files);
        if (flush) effects.splice(0).forEach(effect => effect());
        return result;
    };
    render();
    return {
        states, previews, render, storage, window, document, timers, catalogReads,
        result: () => result,
        recent: () => recentListener?.(),
        setClock: value => { clock = value; },
        updates: () => updates,
        close: () => slots.forEach(slot => slot.cleanup?.()),
    };
}

test('대시보드 재진입은 카탈로그 캐시를 재사용하되 읽음 상태를 검증하고 취향 옵션은 요청할 때 준비한다', async () => {
    const files = [{ path: '/books/a.epub', genre: 'Fantasy' }];
    const first = await loadedFixture(files);
    assert.equal(first.catalogReads.options, 0);
    const options = first.result().preferenceOptions;
    assert.equal(first.catalogReads.options, 1);
    assert.equal(options.genres[0].title, 'Fantasy');
    const storageKey = recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY;
    const saved = first.storage.getItem(storageKey);
    first.close();

    const revisited = fixture(files, { [storageKey]: saved });
    assert.equal(revisited.catalogReads.options, 0);
    assert.equal(revisited.result().preferenceOptions, options);
    assert.deepEqual(revisited.states[0].paths, ['/books/a.epub']);
    revisited.states[0].resolve([{ path: '/books/a.epub', isCompleted: true }]);
    await tick();
    assert.equal(revisited.render().file.path, '/books/a.epub');
    assert.equal(revisited.storage.getItem(storageKey), saved);
    revisited.close();
});

test('추천 한 권만 미리보기를 읽고 같은 날 상태 갱신에는 재사용하며 새 catalog 메타에는 다시 읽는다', async () => {
    const files = [{ path: '/books/a.epub', title: '원래 제목' }];
    const f = fixture(files);
    f.states[0].resolve([]);
    await tick();
    assert.equal(f.previews.length, 1);
    assert.equal(f.previews[0].path, files[0].path);
    f.previews[0].resolve({ success: true, file: { path: '/wrong.epub', description: '책 소개', title: '상세 제목' } });
    await tick();
    assert.equal(f.render().file.path, files[0].path);
    assert.equal(f.result().file.description, '책 소개');
    f.recent();
    assert.equal(f.render().file.description, '책 소개');
    assert.equal(f.result().loading, false);
    f.states[1].resolve([]);
    await tick();
    assert.equal(f.render().file.description, '책 소개');
    assert.equal(f.previews.length, 1);
    f.render([{ ...files[0], title: '수정한 제목' }]);
    assert.equal(f.result().file.description, '책 소개');
    f.states[2].resolve([]);
    await tick();
    assert.equal(f.previews.length, 2);
    assert.equal(f.render().file.title, '상세 제목');
    assert.equal(f.result().file.description, '책 소개');
    f.previews[1].resolve({ success: true, file: { title: '수정한 제목', description: '수정한 소개' } });
    await tick();
    assert.equal(f.render().file.title, '수정한 제목');
    assert.equal(f.result().file.description, '수정한 소개');
    f.close();
});

test('창 복귀·동일 카탈로그 재조회 중 표지와 소개를 유지하고 일시적 오류에도 카드를 비우지 않는다', async () => {
    const files = [{ path: '/books/a.epub', title: '제목', cover: 'cached-cover' }];
    const f = fixture(files);
    f.states[0].resolve([]);
    await tick();
    f.previews[0].resolve({ success: true, file: { title: '상세 제목', cover: 'preview-cover', description: '책 소개' } });
    await tick();
    const checkVisible = () => {
        const result = f.render();
        assert.equal(result.file.title, '상세 제목');
        assert.equal(result.file.cover, 'preview-cover');
        assert.equal(result.file.description, '책 소개');
        assert.equal(result.loading, false);
        assert.equal(result.error, null);
    };
    f.window.emit('focus');
    checkVisible();
    f.document.emit('visibilitychange');
    checkVisible();
    f.states[1].resolve([]);
    f.states[2].resolve([]);
    await tick();
    checkVisible();
    f.render(files.map(file => ({ ...file })));
    checkVisible();
    f.states[3].resolve([]);
    await tick();
    checkVisible();
    assert.equal(f.previews.length, 2, 'A catalog reload must still check metadata omitted from the catalog');
    f.previews[1].resolve({ success: true, file: { title: '상세 제목', cover: 'preview-cover', description: '책 소개' } });
    await tick();
    checkVisible();
    f.recent();
    f.states[4].reject(new Error('temporary offline'));
    await tick();
    checkVisible();
    f.recent();
    f.states[5].resolve([{ filePath: files[0].path, status: 'reading' }]);
    await tick();
    checkVisible();
    assert.equal(f.result().file.viewerStatus.hasReadingProgress, true);
    f.close();
});

test('읽기 상태 실패는 오류로 표시하고 재시도하며 미리보기 실패는 추천을 유지한다', async () => {
    const f = fixture([{ path: '/books/a.epub', title: '제목' }]);
    f.states[0].reject(new Error('database unavailable'));
    await tick();
    assert.equal(f.render().error.message, 'database unavailable');
    assert.equal(f.result().file, null);
    assert.equal(f.result().loading, false);
    const retry = f.result().refresh();
    assert.equal(f.render().error, null);
    assert.equal(f.result().loading, true);
    f.states[1].resolve([]);
    await tick();
    f.previews[0].reject(new Error('preview unavailable'));
    await retry;
    assert.equal(f.render().file.title, '제목');
    assert.equal(f.result().error, null);
    f.close();
});

test('같은 책의 상세 조회가 실패해도 기존 표지·소개를 유지하고 다음 검증에서 재시도한다', async () => {
    const f = fixture([{ path: '/books/a.epub', title: '제목' }]);
    f.states[0].resolve([]);
    await tick();
    f.previews[0].resolve({ success: true, file: { title: '상세 제목', cover: 'preview-cover', description: '책 소개' } });
    await tick();
    f.render([{ path: '/books/a.epub', title: '수정 제목' }]);
    f.states[1].resolve([]);
    await tick();
    f.previews[1].reject(new Error('temporary preview failure'));
    await tick();
    assert.equal(f.render().file.title, '상세 제목');
    assert.equal(f.result().file.cover, 'preview-cover');
    assert.equal(f.result().file.description, '책 소개');
    assert.equal(f.result().loading, false);
    f.recent();
    f.states[2].resolve([]);
    await tick();
    assert.equal(f.previews.length, 3);
    f.previews[2].resolve({ success: true, file: { title: '수정 제목', cover: 'updated-cover', description: '수정 소개' } });
    await tick();
    assert.equal(f.render().file.title, '수정 제목');
    assert.equal(f.result().file.cover, 'updated-cover');
    assert.equal(f.result().file.description, '수정 소개');
    f.render([{ path: '/books/a.epub', title: '수정 제목', volume: '2' }]);
    assert.equal(f.result().file, null, 'A book that no longer qualifies must not be retained');
    await tick();
    assert.equal(f.render().file, null);
    f.close();
});

test('다른 카탈로그와 언마운트 뒤 도착한 DB 및 미리보기 응답은 버린다', async () => {
    const f = fixture([{ path: '/books/a.epub' }]);
    f.states[0].resolve([]);
    await tick();
    f.render([{ path: '/books/b.epub' }]);
    assert.equal(f.render().file, null);
    f.previews[0].resolve({ success: true, file: { title: '오래된 A 응답' } });
    await tick();
    assert.equal(f.render().file, null);
    f.states[1].resolve([]);
    await tick();
    assert.equal(f.render().file.path, '/books/b.epub');
    f.close();
    const updates = f.updates();
    f.previews[1].resolve({ success: true, file: { title: '언마운트 후 B 응답' } });
    await tick();
    assert.equal(f.updates(), updates);
    assert.equal(f.timers.size, 0);
    assert.equal(f.window.listeners.size, 0);
    assert.equal(f.document.listeners.size, 0);
    f.recent();
    assert.equal(f.states.length, 2);
});

test('자정·포커스·visible 복귀·읽기 저장 이벤트에 다시 검증하며 다음 날은 다른 책을 추천한다', async () => {
    const f = fixture([{ path: '/books/a.epub' }, { path: '/books/b.epub' }]);
    f.states[0].resolve([]);
    await tick();
    const first = f.render().file.path;
    const [timerId, timer] = [...f.timers][0];
    assert.equal(timer.delay, 1020);
    f.setClock(new Date(2026, 9, 27));
    f.timers.delete(timerId);
    timer.callback();
    f.states[1].resolve([]);
    await tick();
    f.states[2].resolve([]);
    await tick();
    assert.notEqual(f.render().file.path, first);
    f.window.emit('focus');
    f.states[3].resolve([]);
    await tick();
    f.document.visibilityState = 'hidden';
    f.document.emit('visibilitychange');
    assert.equal(f.states.length, 4);
    f.document.visibilityState = 'visible';
    f.document.emit('visibilitychange');
    f.states[4].resolve([]);
    await tick();
    f.window.emit('storage', { key: 'unrelated-setting' });
    assert.equal(f.states.length, 5);
    const selected = f.render().file.path;
    f.storage.setItem(`bookmanager-viewer-state:${selected}`, JSON.stringify({ pageIndex: 0 }));
    f.window.emit('storage', { key: `bookmanager-viewer-state:${selected}` });
    f.states[5].resolve([]);
    await tick();
    assert.equal(f.states.length, 6, 'Reading the saved daily pick must not start a replacement search');
    assert.equal(f.render().file.path, selected);
    f.close();
});

async function loadedFixture(files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }]) {
    const f = fixture(files);
    f.states[0].resolve([]);
    await tick();
    f.previews[0].resolve({ success: true, file: { description: '기존 추천 소개', cover: 'current-cover' } });
    await tick();
    f.render();
    return f;
}

async function prepareAlternative(f, readRows = () => []) {
    let stateIndex = f.states.length;
    let previewIndex = f.previews.length;
    let settled = false;
    const promise = f.result().prepareNewRecommendation();
    void promise.then(() => { settled = true; }, () => { settled = true; });
    for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
        while (stateIndex < f.states.length) {
            const request = f.states[stateIndex++];
            request.resolve(readRows(request.paths));
        }
        while (previewIndex < f.previews.length) {
            f.previews[previewIndex++].resolve({ success: true, file: { description: '새 추천 소개', cover: 'new-cover' } });
        }
        await tick();
    }
    assert.ok(settled, 'Preparing new recommendations did not finish');
    return promise;
}

test('8권 목록은 슬라이드 선택과 재시작에도 순서를 유지하고 선택한 표지만 필요할 때 조회한다', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({ path: `/books/pick-${index}.epub`, title: `추천 ${index}` }));
    const f = await loadedFixture(files);
    const paths = Array.from(f.result().recommendations, file => file.path);
    assert.equal(paths.length, 8);
    assert.equal(new Set(paths).size, 8);
    assert.equal(f.previews.length, 1);
    const initial = f.result().file;
    const nextPath = paths[3];
    f.result().selectRecommendation(nextPath);
    assert.equal(f.render().file.path, nextPath);
    assert.equal(f.states.length, 1, 'Slide navigation must not query reading state again');
    await tick();
    assert.equal(f.previews.length, 2);
    assert.equal(f.previews[1].path, nextPath);
    f.previews[1].resolve({ success: true, file: { title: '선택한 책', description: '선택한 소개', cover: 'selected-cover' } });
    await tick();
    assert.equal(f.render().file.description, '선택한 소개');
    f.result().selectRecommendation(initial.path);
    await tick();
    assert.equal(f.render().file.cover, 'current-cover');
    f.result().selectRecommendation(nextPath);
    await tick();
    assert.equal(f.render().file.cover, 'selected-cover');
    assert.equal(f.previews.length, 2, 'Visited slides must reuse their previews');
    const key = recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY;
    const saved = f.storage.getItem(key);
    assert.deepEqual(JSON.parse(saved).paths, paths);
    assert.equal(JSON.parse(saved).path, nextPath);
    f.close();
    const restored = fixture([...files].reverse(), { [key]: saved });
    assert.deepEqual(restored.states[0].paths, paths);
    restored.states[0].resolve([{ filePath: nextPath, status: 'completed' }]);
    await tick();
    assert.equal(restored.render().file.path, nextPath);
    assert.deepEqual(Array.from(restored.result().recommendations, file => file.path), paths);
    assert.equal(restored.result().file.viewerStatus.isCompleted, true);
    restored.close();
});

test('슬라이드의 늦은 미리보기나 백그라운드 검증은 사용자가 새로 선택한 책을 되돌리지 않는다', async () => {
    const files = Array.from({ length: 10 }, (_, index) => ({ path: `/books/slide-${index}.epub` }));
    const f = await loadedFixture(files);
    const [initial, second, third] = f.result().recommendations;
    f.result().selectRecommendation(second.path);
    await tick();
    const secondPreview = f.previews.at(-1);
    f.recent();
    f.result().selectRecommendation(third.path);
    await tick();
    const thirdPreview = f.previews.at(-1);
    secondPreview.resolve({ success: true, file: { cover: 'second-cover' } });
    f.states.at(-1).resolve([]);
    await tick();
    assert.equal(f.render().file.path, third.path);
    thirdPreview.resolve({ success: true, file: { cover: 'third-cover' } });
    await tick();
    assert.equal(f.render().file.path, third.path);
    assert.equal(f.result().file.cover, 'third-cover');
    assert.equal(JSON.parse(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY)).path, third.path);
    f.result().selectRecommendation(initial.path);
    await tick();
    assert.equal(f.render().file.cover, 'current-cover');
    f.close();
});

test('동일한 두 권만 있어도 새로운 추천은 순서를 바꾸고 첫 슬라이드부터 보여 준다', async () => {
    const f = await loadedFixture();
    const before = Array.from(f.result().recommendations, file => file.path);
    const prepared = await prepareAlternative(f);
    const commit = f.result().commitNewRecommendation(prepared);
    f.states.at(-1).resolve([]);
    assert.equal(await commit, true);
    assert.equal(f.render().file.path, prepared.file.path);
    const after = Array.from(f.result().recommendations, file => file.path);
    assert.deepEqual(after, [...before].reverse());
    assert.equal(new Set(after).size, before.length);
    assert.deepEqual(JSON.parse(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY)).paths, after);
    f.close();
});

test('새로운 추천은 충분한 후보가 있으면 8권 전체를 교체하고 첫 책을 공개한다', async () => {
    const files = Array.from({ length: 20 }, (_, index) => ({ path: `/books/replacement-${index}.epub` }));
    const f = await loadedFixture(files);
    const before = Array.from(f.result().recommendations, file => file.path);
    const storageKey = recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY;
    const saved = f.storage.getItem(storageKey);
    f.result().selectRecommendation(before[3]);
    await tick();
    f.previews.at(-1).resolve({ success: false });
    await tick();
    f.render();
    const prepared = await prepareAlternative(f);
    assert.ok(!before.includes(prepared.file.path));
    assert.deepEqual(Array.from(f.render().recommendations, file => file.path), before);
    const commit = f.result().commitNewRecommendation(prepared);
    const validationPaths = f.states.at(-1).paths;
    assert.equal(validationPaths.length, 8);
    assert.ok(validationPaths.every(path => !before.includes(path)));
    f.states.at(-1).resolve([]);
    assert.equal(await commit, true);
    assert.deepEqual(Array.from(f.render().recommendations, file => file.path), validationPaths);
    assert.equal(f.result().file.path, validationPaths[0]);
    assert.equal(f.result().file.cover, 'new-cover');
    const record = JSON.parse(f.storage.getItem(storageKey));
    assert.deepEqual(record.paths, validationPaths);
    assert.notEqual(record.seed, JSON.parse(saved).seed);
    f.close();
});

test('새 후보가 부족하면 기존 미독 책으로 채우고 전체 목록을 첫 위치부터 다시 표시한다', async () => {
    const files = Array.from({ length: 10 }, (_, index) => ({ path: `/books/fill-${index}.epub` }));
    const f = await loadedFixture(files);
    const before = Array.from(f.result().recommendations, file => file.path);
    const outside = files.filter(file => !before.includes(file.path)).map(file => file.path);
    const prepared = await prepareAlternative(f);
    const commit = f.result().commitNewRecommendation(prepared);
    const paths = f.states.at(-1).paths;
    assert.equal(paths.length, 8);
    assert.equal(new Set(paths).size, 8);
    assert.deepEqual(new Set(paths.slice(0, 2)), new Set(outside));
    f.states.at(-1).resolve([]);
    assert.equal(await commit, true);
    assert.equal(f.render().file.path, paths[0]);
    assert.deepEqual(Array.from(f.result().recommendations, file => file.path), paths);
    f.close();
});

test('첫 책이 같아도 추천 목록이 바뀌면 ready로 공개하고 전체 목록을 교체한다', async () => {
    const f = await loadedFixture(Array.from({ length: 8 }, (_, index) => ({ path: `/books/same-first-${index}.epub` })));
    const initial = f.result().file;
    const prepared = await prepareAlternative(f, paths => paths.filter(filePath => filePath !== initial.path)
        .map(filePath => ({ filePath, status: 'completed' })));
    assert.equal(prepared.status, 'ready');
    assert.equal(prepared.file.path, initial.path);
    const commit = f.result().commitNewRecommendation(prepared);
    assert.deepEqual(f.states.at(-1).paths, [initial.path]);
    f.states.at(-1).resolve([]);
    assert.equal(await commit, true);
    assert.deepEqual(Array.from(f.render().recommendations, file => file.path), [initial.path]);
    f.close();
});

test('새 목록의 첫 책 이외 항목도 존재와 읽음 상태를 검증하고 하나라도 바뀌면 전체 확정을 취소한다', async () => {
    for (const changed of ['reading', 'local-reading', 'removed', 'middle-volume']) {
        const files = Array.from({ length: 20 }, (_, index) => ({ path: `/books/atomic-${index}.epub` }));
        const f = await loadedFixture(files);
        const before = Array.from(f.result().recommendations, file => file.path);
        const storageKey = recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY;
        const saved = f.storage.getItem(storageKey);
        const prepared = await prepareAlternative(f);
        const commit = f.result().commitNewRecommendation(prepared);
        const validation = f.states.at(-1);
        const changedPath = validation.paths[4];
        if (changed === 'removed') f.render(files.filter(file => file.path !== changedPath));
        if (changed === 'middle-volume') f.render(files.map(file => file.path === changedPath ? { ...file, volume: '2' } : file));
        if (changed === 'local-reading') f.storage.setItem(`bookmanager-viewer-state:${changedPath}`, JSON.stringify({ pageIndex: 0 }));
        validation.resolve(changed === 'reading' ? [{ filePath: changedPath, status: 'reading' }] : []);
        assert.equal(await commit, false, changed);
        assert.deepEqual(Array.from(f.render().recommendations, file => file.path), before, changed);
        assert.equal(f.storage.getItem(storageKey), saved, changed);
        f.close();
    }
});

test('추천을 읽거나 완독한 뒤 창 복귀·로컬 상태 변경·재시작에도 당일 책과 저장값을 유지한다', async () => {
    const files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }];
    const f = await loadedFixture(files);
    const initial = f.result().file;
    const storageKey = recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY;
    const saved = f.storage.getItem(storageKey);
    const localKey = `bookmanager-viewer-state:${initial.path}`;
    for (const [event, status] of [['recent', 'reading'], ['focus', 'completed'], ['visibility', 'completed'], ['storage', 'completed']]) {
        if (event === 'recent') f.recent();
        if (event === 'focus') f.window.emit('focus');
        if (event === 'visibility') f.document.emit('visibilitychange');
        if (event === 'storage') {
            f.storage.setItem(localKey, JSON.stringify({ status: 'completed', pageIndex: 12, updatedAt: '2026-10-26' }));
            f.window.emit('storage', { key: localKey });
        }
        assert.equal(f.render().file.path, initial.path);
        assert.equal(f.result().file.cover, initial.cover);
        assert.deepEqual(f.states.at(-1).paths, JSON.parse(saved).paths);
        f.states.at(-1).resolve([{ filePath: initial.path, status, updatedAt: '2026-10-26' }]);
        await tick();
        assert.equal(f.render().file.path, initial.path);
        assert.equal(f.result().file.viewerStatus.hasReadingProgress, true);
        assert.equal(f.result().file.viewerStatus.isCompleted, status === 'completed');
        assert.equal(f.result().file.cover, initial.cover);
        assert.equal(f.result().file.description, initial.description);
        assert.equal(f.storage.getItem(storageKey), saved);
    }
    assert.equal(f.previews.length, 1);
    f.close();

    const restored = fixture(files, { [storageKey]: saved, [localKey]: f.storage.getItem(localKey) });
    assert.deepEqual(restored.states[0].paths, JSON.parse(saved).paths);
    restored.states[0].resolve([{ filePath: initial.path, status: 'completed' }]);
    await tick();
    restored.previews[0].resolve({ success: true, file: initial });
    await tick();
    assert.equal(restored.render().file.path, initial.path);
    assert.equal(restored.result().file.viewerStatus.isCompleted, true);
    assert.equal(restored.storage.getItem(storageKey), saved);
    const prepared = await prepareAlternative(restored);
    assert.equal(prepared.status, 'ready');
    assert.notEqual(prepared.file.path, initial.path);
    restored.close();
});

test('재추첨 준비·공개 중 기존 추천과 저장값을 유지하고 마지막 검증 후에만 교체한다', async () => {
    const f = await loadedFixture();
    const initial = f.result().file;
    const saved = f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY);
    const prepared = await prepareAlternative(f);
    assert.equal(prepared.status, 'ready');
    assert.notEqual(prepared.file.path, initial.path);
    assert.equal(prepared.file.description, '새 추천 소개');
    assert.equal(f.render().file, initial);
    assert.equal(f.result().newRecommendationLoading, true);
    assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved);
    const requests = f.states.length;
    f.recent();
    f.window.emit('focus');
    f.document.emit('visibilitychange');
    assert.equal(f.states.length, requests, 'Automatic refresh must wait until the reveal finishes');
    assert.equal(f.render().file, initial);
    assert.equal((await f.result().prepareNewRecommendation()).status, 'cancelled');
    assert.equal(f.states.length, requests, 'A second click must not start another draw');
    const commit = f.result().commitNewRecommendation({ ...prepared });
    assert.equal(f.states.at(-1).paths.length, 2);
    assert.equal(f.states.at(-1).paths[0], prepared.file.path);
    assert.equal(f.render().file, initial);
    f.states.at(-1).resolve([]);
    assert.equal(await commit, true);
    assert.equal(f.render().file.path, prepared.file.path);
    assert.equal(f.result().file.description, '새 추천 소개');
    assert.equal(f.result().newRecommendationLoading, false);
    assert.equal(JSON.parse(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY)).path, prepared.file.path);
    const afterCommitRequests = f.states.length;
    f.result().cancelNewRecommendation();
    f.result().cancelNewRecommendation();
    assert.equal(f.states.length, afterCommitRequests);
    assert.equal(f.render().file.path, prepared.file.path, 'Closing a completed reveal must not undo the new choice');
    f.recent();
    f.states.at(-1).resolve([{ filePath: prepared.file.path, status: 'reading' }]);
    await tick();
    assert.equal(f.render().file.path, prepared.file.path, 'Opening a manually chosen book must retain the confirmed pick');
    assert.equal(f.result().file.viewerStatus.hasReadingProgress, true);
    f.close();
});

test('준비 중 취소하면 늦은 응답과 이전 토큰이 추천이나 저장값을 바꾸지 않는다', async () => {
    const f = await loadedFixture();
    const initial = f.result().file;
    const saved = f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY);
    const pending = f.result().prepareNewRecommendation();
    const held = f.states.at(-1);
    f.result().cancelNewRecommendation();
    const resumed = f.states.at(-1);
    assert.notEqual(held, resumed);
    held.resolve([]);
    assert.equal((await pending).status, 'cancelled');
    resumed.resolve([]);
    await tick();
    assert.equal(f.render().file.path, initial.path);
    assert.equal(f.result().file.cover, initial.cover);
    assert.equal(f.result().newRecommendationLoading, false);
    assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved);
    const prepared = await prepareAlternative(f);
    f.result().cancelNewRecommendation();
    assert.equal(await f.result().commitNewRecommendation(prepared), false);
    assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved);
    f.close();
});

test('다른 미독 후보가 없거나 전체 후보가 읽힌 경우 same·empty를 반환하고 준비만으로 저장하지 않는다', async () => {
    const f = await loadedFixture([{ path: '/books/only.epub' }]);
    const initial = f.result().file;
    const saved = f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY);
    const samePromise = f.result().prepareNewRecommendation();
    f.states.at(-1).resolve([]);
    const same = await samePromise;
    assert.equal(same.status, 'same');
    assert.equal(same.file.path, initial.path);
    assert.equal(f.render().file, initial);
    assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved);
    f.result().cancelNewRecommendation();
    f.states.at(-1).resolve([]);
    await tick();
    const emptyPromise = f.result().prepareNewRecommendation();
    f.states.at(-1).resolve([{ filePath: initial.path, status: 'completed' }]);
    const empty = await emptyPromise;
    assert.equal(empty.status, 'empty');
    assert.equal(empty.file, null);
    assert.equal(f.render().file.path, initial.path);
    assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved);
    f.close();
});

test('공개 중 읽은 책·삭제된 책·중간권으로 바뀐 책은 최종 저장하지 않는다', async () => {
    for (const changed of ['reading', 'local-reading', 'removed', 'middle-volume']) {
        const files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }];
        const f = await loadedFixture(files);
        const saved = f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY);
        const initialPath = f.result().file.path;
        const prepared = await prepareAlternative(f);
        if (changed === 'removed') f.render(files.filter(file => file.path !== prepared.file.path));
        if (changed === 'middle-volume') f.render(files.map(file => file.path === prepared.file.path ? { ...file, volume: '2' } : file));
        const commit = f.result().commitNewRecommendation(prepared);
        if (changed === 'reading') f.states.at(-1).resolve([{ filePath: prepared.file.path, status: 'reading' }]);
        if (changed === 'local-reading') {
            f.storage.setItem(`bookmanager-viewer-state:${prepared.file.path}`, JSON.stringify({ pageIndex: 0 }));
            f.states.at(-1).resolve([]);
        }
        assert.equal(await commit, false, changed);
        assert.equal(f.render().file.path, initialPath, changed);
        assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved, changed);
        assert.equal(f.result().newRecommendationLoading, false, changed);
        f.close();
    }
});

test('날짜 변경·검증 중 취소·검증 중 읽기 이벤트·언마운트는 수동 확정을 무효화한다', async () => {
    for (const changed of ['midnight', 'cancel', 'reading-event', 'unmount']) {
        const f = await loadedFixture();
        const saved = f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY);
        const prepared = await prepareAlternative(f);
        if (changed === 'midnight') f.setClock(new Date(2026, 9, 27));
        const commit = f.result().commitNewRecommendation(prepared);
        const held = f.states.at(-1);
        if (changed === 'cancel') f.result().cancelNewRecommendation();
        if (changed === 'reading-event') f.recent();
        if (changed === 'unmount') f.close();
        if (changed !== 'midnight') held.resolve([]);
        assert.equal(await commit, false, changed);
        assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved, changed);
        if (changed !== 'unmount') f.close();
    }
});

test('수동 준비와 확정의 DB 오류는 호출자에게 전달하고 현재 추천을 보존한다', async () => {
    const f = await loadedFixture();
    const initialPath = f.result().file.path;
    const saved = f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY);
    const preparation = f.result().prepareNewRecommendation();
    f.states.at(-1).reject(new Error('prepare unavailable'));
    await assert.rejects(preparation, /prepare unavailable/);
    assert.equal(f.render().newRecommendationLoading, false);
    assert.equal(f.result().file.path, initialPath);
    f.states.at(-1).resolve([]);
    await tick();
    const prepared = await prepareAlternative(f);
    const commit = f.result().commitNewRecommendation(prepared);
    f.states.at(-1).reject(new Error('commit unavailable'));
    await assert.rejects(commit, /commit unavailable/);
    assert.equal(f.render().newRecommendationLoading, false);
    assert.equal(f.result().file.path, initialPath);
    assert.equal(f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY), saved);
    f.close();
});

test('취향 적용은 저장된 당일 추천을 재선정하며 새 조건을 재실행에도 유지한다', async () => {
    const files = [{ path: '/books/a.epub', genre: 'Fantasy' }, { path: '/books/b.pdf', genre: 'History' }];
    const f = await loadedFixture(files);
    const initial = f.result().file;
    const next = files.find(file => file.path !== initial.path);
    const format = next.path.endsWith('.pdf') ? 'pdf' : 'epub';
    f.result().updatePreferences({ formats: [format] });
    assert.deepEqual(f.states.at(-1).paths, [next.path]);
    f.states.at(-1).resolve([]);
    await tick();
    f.previews.at(-1).resolve({ success: true, file: { cover: 'preferred-cover' } });
    await tick();
    assert.equal(f.render().file.path, next.path);
    assert.deepEqual(f.result().preferences.formats, [format]);
    const saved = {
        [recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY]: f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY),
        [recommendationPreferences.RECOMMENDATION_PREFERENCES_STORAGE_KEY]: f.storage.getItem(recommendationPreferences.RECOMMENDATION_PREFERENCES_STORAGE_KEY),
    };
    f.close();
    const restored = fixture(files, saved);
    assert.deepEqual(restored.states[0].paths, [next.path]);
    restored.states[0].resolve([{ filePath: next.path, status: 'completed' }]);
    await tick();
    restored.previews[0].resolve({ success: false });
    await tick();
    assert.equal(restored.render().file.path, next.path, 'Opening the preferred daily pick must still preserve it');
    restored.close();
});

test('현재 책 제외·복구와 필터 변경은 진행중 추첨 토큰을 무효화한다', async () => {
    const files = [{ path: '/books/a.epub', series: 'Story A' }, { path: '/books/b.epub', series: 'Story B' }];
    const f = await loadedFixture(files);
    const selected = f.result().file;
    const prepared = await prepareAlternative(f);
    f.result().excludeRecommendation('series');
    assert.equal(await f.result().commitNewRecommendation(prepared), false);
    assert.equal(f.render().newRecommendationLoading, false);
    assert.ok(!f.states.at(-1).paths.includes(selected.path));
    f.states.at(-1).resolve([]);
    await tick();
    f.previews.at(-1).resolve({ success: false });
    await tick();
    assert.equal(f.render().file.path, prepared.file.path);
    f.result().excludeRecommendation('book');
    await tick();
    assert.equal(f.render().file, null);
    assert.equal(f.result().loading, false);
    f.result().updatePreferences({ ...f.result().preferences, excludedBooks: [] });
    assert.deepEqual(f.states.at(-1).paths, [prepared.file.path]);
    f.states.at(-1).resolve([]);
    await tick();
    f.previews.at(-1).resolve({ success: false });
    await tick();
    assert.equal(f.render().file.path, prepared.file.path);
    f.close();
});

test('설정 저장 실패는 기존 추천과 취향을 보존하고 다른 창의 변경은 반영한다', async () => {
    const files = [{ path: '/books/a.epub' }, { path: '/books/b.pdf' }];
    const f = await loadedFixture(files);
    const original = f.result().file;
    const save = f.storage.setItem;
    f.storage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => f.result().updatePreferences({ formats: ['pdf'] }), /quota/);
    assert.equal(f.render().file.path, original.path);
    assert.deepEqual(f.result().preferences.formats, []);
    f.storage.setItem = save;
    f.storage.setItem(recommendationPreferences.RECOMMENDATION_PREFERENCES_STORAGE_KEY, JSON.stringify({ formats: ['pdf'] }));
    f.window.emit('storage', { key: recommendationPreferences.RECOMMENDATION_PREFERENCES_STORAGE_KEY });
    assert.deepEqual(f.states.at(-1).paths, ['/books/b.pdf']);
    f.states.at(-1).resolve([]);
    await tick();
    f.previews.at(-1).resolve({ success: false });
    await tick();
    assert.equal(f.render().file.path, '/books/b.pdf');
    assert.deepEqual(f.result().preferences.formats, ['pdf']);
    f.close();
});

test('조건 변경 때는 이전 추천이 조건에 맞더라도 이미 읽었다면 새 미독 책을 고른다', async () => {
    const files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }];
    const f = await loadedFixture(files);
    const original = f.result().file.path;
    f.result().updatePreferences({ libraries: ['/books'] });
    f.states.at(-1).resolve([{ filePath: original, status: 'completed' }]);
    await tick();
    f.previews.at(-1).resolve({ success: false });
    await tick();
    assert.notEqual(f.render().file.path, original);
    f.close();
});

test('후보 없는 조건을 초기화해도 이전 조건의 읽은 추천을 되살리지 않는다', async () => {
    const files = [{ path: '/books/a.epub' }, { path: '/books/b.epub' }];
    const f = await loadedFixture(files);
    const original = f.result().file.path;
    f.result().updatePreferences({ formats: ['audio'] });
    await tick();
    assert.equal(f.render().file, null);
    f.result().updatePreferences({});
    const stored = {
        [recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY]: f.storage.getItem(recommendationState.DAILY_RECOMMENDATION_STORAGE_KEY),
        [recommendationPreferences.RECOMMENDATION_PREFERENCES_STORAGE_KEY]: f.storage.getItem(recommendationPreferences.RECOMMENDATION_PREFERENCES_STORAGE_KEY),
    };
    f.close();
    const restarted = fixture(files, stored);
    restarted.states[0].resolve([{ filePath: original, status: 'completed' }]);
    await tick();
    restarted.previews[0].resolve({ success: false });
    await tick();
    assert.notEqual(restarted.render().file.path, original);
    restarted.close();
});
