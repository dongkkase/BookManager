import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const compiled = transformSync(fs.readFileSync(new URL('./hooks/useAuthorBookDetails.js', import.meta.url), 'utf8'), { format: 'cjs', target: 'es2022' }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ readingStates = true } = {}) {
    const slots = [];
    const previews = [];
    const states = [];
    let cursor = 0;
    let effects = [];
    let props = { enabled: true, scopeKey: 'authors:/books', revision: 1 };
    let result;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        useState(initialValue) {
            const index = cursor++;
            slots[index] ??= { value: initialValue };
            return [slots[index].value, update => { slots[index].value = typeof update === 'function' ? update(slots[index].value) : update; }];
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
    const module = { exports: {} };
    const context = vm.createContext({
        module, exports: module.exports,
        navigator: { platform: 'MacIntel' },
        window: { electronAPI: {
            getFilePreview: (path, options) => new Promise((resolve, reject) => previews.push({ path, options, resolve, reject })),
            ...(readingStates ? { getReadingStates: paths => new Promise((resolve, reject) => states.push({ paths, resolve, reject })) } : {}),
        } },
        require(name) { assert.equal(name, 'react'); return react; },
    });
    vm.runInContext(compiled, context);
    const render = (patch = {}, flush = true) => {
        props = { ...props, ...patch };
        cursor = 0;
        result = module.exports.useAuthorBookDetails(props);
        if (flush) effects.splice(0).forEach(effect => effect());
        return result;
    };
    render();
    return { previews, states, render, result: () => result, close: () => slots.forEach(slot => slot.cleanup?.()) };
}

test('클릭한 한 권만 조회하고 읽기 상태 실패와 무관하게 상세 메타데이터를 표시한다', async () => {
    const f = fixture();
    const selected = { path: '/books/one.epub', title: '간단한 제목' };
    f.result().selectFile(selected);
    assert.equal(f.render().file, selected);
    assert.equal(f.result().loading, true);
    await tick();
    assert.equal(f.previews.length, 1);
    assert.equal(f.previews[0].path, selected.path);
    assert.equal(f.previews[0].options.force, false);
    f.states[0].reject(new Error('unavailable'));
    f.previews[0].resolve({ success: true, file: { path: '/wrong.epub', full_path: '/wrong.epub', description: '책 설명', publisher: '출판사' } });
    await tick();
    const loaded = f.render();
    assert.equal(loaded.file.description, '책 설명');
    assert.equal(loaded.file.full_path, selected.path);
    assert.equal(loaded.file.path, selected.path);
    assert.equal(loaded.loading, false);
    assert.equal(loaded.error, '');
    f.close();
});

test('새 선택·목록 해제·범위 변경·언마운트 뒤 도착한 응답을 무시한다', async () => {
    const f = fixture();
    const select = f.result().selectFile;
    select({ path: '/books/a.epub' }); await tick();
    select({ path: '/books/b.epub' }); await tick();
    f.previews[0].resolve({ success: true, file: { title: 'A 응답' } });
    f.states[0].resolve([{ filePath: '/books/a.epub', status: 'completed' }]);
    await tick();
    assert.equal(f.render().selectedPath, '/books/b.epub');
    assert.equal(f.result().file.title, undefined);
    assert.equal(f.result().selectFile, select);
    assert.equal(f.render({ enabled: false }, false).file, null);
    f.previews[1].resolve({ success: true, file: { title: 'B 응답' } });
    await tick();
    f.render();
    assert.equal(f.render({ enabled: true }).file, null);
    select({ path: '/books/c.epub' }); await tick();
    assert.equal(f.render({ scopeKey: 'authors:/other' }, false).file, null);
    f.previews[2].resolve({ success: true, file: { title: 'C 응답' } }); await tick();
    f.render();
    assert.equal(f.result().file, null);
    select({ path: '/other/d.epub' }); await tick();
    f.close();
    f.previews[3].resolve({ success: true, file: { title: 'D 응답' } }); await tick();
    assert.equal(f.render().file.title, undefined);
});

test('조회 중 평점 변경은 오래된 응답보다 우선하고 카탈로그 revision 변경은 선택한 책만 다시 읽는다', async () => {
    const f = fixture();
    f.result().selectFile({ path: '/books/책.epub', rating: '1' }); await tick();
    f.result().patchFiles([{ filePath: '/books/책.epub'.normalize('NFD'), rating: '8' }, { path: '/other.epub', rating: '9' }]);
    f.previews[0].resolve({ success: true, file: { rating: '2', description: '첫 설명' } });
    f.states[0].resolve([{ filePath: '/books/책.epub'.normalize('NFD'), status: 'completed' }]);
    await tick();
    assert.equal(f.render().file.rating, '8');
    assert.equal(f.result().file.readingState.status, 'completed');
    f.render({ revision: 2 }); await tick();
    assert.equal(f.previews.length, 2);
    f.previews[1].resolve({ success: true, file: { rating: '8', description: '갱신된 설명' } }); await tick();
    assert.equal(f.render().file.description, '갱신된 설명');
    f.close();
});

test('실패 시 간단한 책 정보가 남고 같은 책 선택으로 재시도할 수 있다', async () => {
    const f = fixture({ readingStates: false });
    const file = { path: '/books/a.epub', title: '제목' };
    f.result().selectFile(file); await tick();
    f.previews[0].resolve({ success: false, message: 'missing' }); await tick();
    assert.equal(f.render().error, 'missing');
    assert.equal(f.result().file.title, '제목');
    assert.equal(f.result().loading, false);
    f.result().selectFile(file); await tick();
    f.previews[1].resolve({ success: true, file: { description: '설명' } }); await tick();
    assert.equal(f.render().file.description, '설명');
    assert.equal(f.result().error, '');
    f.result().selectFile(null);
    assert.equal(f.render().file, null);
    f.close();
});

test('같은 책의 더블클릭과 접힌 상세 패널 재열기는 진행 중 조회와 완료 결과를 재사용한다', async () => {
    const f = fixture();
    const file = { path: '/books/a.epub', title: '제목' };
    f.result().selectFile(file);
    f.result().selectFile({ ...file });
    await tick();
    assert.equal(f.previews.length, 1);
    assert.equal(f.states.length, 1);
    f.previews[0].resolve({ success: true, file: { description: '상세 설명' } });
    await tick();
    assert.equal(f.render().file.description, '상세 설명');
    f.result().selectFile({ ...file });
    await tick();
    assert.equal(f.previews.length, 1);
    assert.equal(f.render().file.description, '상세 설명');
    f.close();
});
