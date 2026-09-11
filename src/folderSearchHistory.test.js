import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as historyPolicy from './folderSearchHistory.js';

const { SEARCH_HISTORY_LIMIT, addSearchHistory, normalizeSearchHistory, removeSearchHistory } = historyPolicy;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('검색 기록은 문자열만 받아 앞뒤 공백과 빈 항목 및 정확히 일치하는 중복을 제거한다', () => {
    assert.deepEqual(normalizeSearchHistory(['  책  ', '', '   ', null, 12, {}, '책', 'Book', 'book', 'a  b', 'a b']), [
        '책', 'Book', 'book', 'a  b', 'a b',
    ]);
    assert.deepEqual(normalizeSearchHistory(undefined), []);
    assert.deepEqual(normalizeSearchHistory('책'), []);
    assert.deepEqual(addSearchHistory(undefined, ' 새 책 '), ['새 책']);
});

test('최근 20개 검색어를 보관하고 기존 검색어를 다시 사용하면 맨 앞으로 옮긴다', () => {
    const values = Array.from({ length: 25 }, (_, index) => `검색 ${index}`);
    assert.equal(SEARCH_HISTORY_LIMIT, 20);
    assert.deepEqual(normalizeSearchHistory(values), values.slice(0, 20));
    assert.deepEqual(addSearchHistory(values.slice(0, 20), ' 검색 12 '), [
        '검색 12', ...values.slice(0, 12), ...values.slice(13, 20),
    ]);
    assert.deepEqual(addSearchHistory(values.slice(0, 20), '새 검색'), ['새 검색', ...values.slice(0, 19)]);
    assert.equal(values.length, 25);
});

test('빈 검색어는 기록하지 않고 개별 삭제는 다른 기록과 순서를 보존한다', () => {
    const values = ['책', 'Book', 'book'];
    assert.deepEqual(addSearchHistory(values, '  '), values);
    assert.deepEqual(removeSearchHistory(values, ' Book '), ['책', 'book']);
    assert.deepEqual(removeSearchHistory(values, '없음'), values);
    assert.deepEqual(removeSearchHistory(undefined, '책'), []);
    assert.deepEqual(values, ['책', 'Book', 'book']);
});

const hookSource = transformSync(readFileSync(new URL('./hooks/useFolderSearchHistory.js', import.meta.url), 'utf8'), {
    format: 'cjs', target: 'es2022',
}).code;

function fixture(initialConfig = {}) {
    const slots = [];
    const requests = [];
    const errors = [];
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let config = initialConfig;
    const same = (left, right) => left && right && left.length === right.length
        && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, next => {
                const value = typeof next === 'function' ? next(slots[index].value) : next;
                if (!Object.is(slots[index].value, value)) dirty = true;
                slots[index].value = value;
            }];
        },
        useRef(initial) {
            const index = cursor++;
            return slots[index] ??= { current: initial };
        },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
                slots[index] = { value: callback, dependencies };
            }
            return slots[index].value;
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
                const old = slots[index];
                slots[index] = { dependencies };
                effects.push(() => {
                    old?.cleanup?.();
                    slots[index].cleanup = effect();
                });
            }
        },
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', hookSource)(module, module.exports, name => {
        if (name === 'react') return react;
        if (name === '../folderSearchHistory.js') return historyPolicy;
        throw new Error(`Unexpected import: ${name}`);
    });
    const saveConfig = patch => new Promise((resolve, reject) => {
        requests.push({
            patch,
            resolve(saved = { ...config, ...patch }) {
                config = saved;
                render();
                resolve(saved);
            },
            reject,
        });
    });
    function render() {
        let value;
        do {
            cursor = 0;
            dirty = false;
            value = module.exports.useFolderSearchHistory(config, saveConfig, error => errors.push(error));
            const pending = effects;
            effects = [];
            pending.forEach(effect => effect());
        } while (dirty);
        return value;
    }
    render();
    return {
        requests, errors, render,
        get history() { return render().searchHistory; },
        load(nextConfig) { config = nextConfig; return render(); },
        unmount() { slots.forEach(slot => slot.cleanup?.()); },
    };
}

test('늦게 로드된 검색 기록을 복원하며 초기 로드만으로 저장하지 않는다', async () => {
    const f = fixture(null);
    assert.deepEqual(f.history, []);
    f.load({ folder_search_history: [' 이전 책 ', '이전 책', '두 번째'] });
    assert.deepEqual(f.history, ['이전 책', '두 번째']);
    await tick();
    assert.equal(f.requests.length, 0);
    f.unmount();
});

test('설정 로드 전에 입력한 검색 및 삭제를 기존 기록에 적용한 뒤 저장한다', async () => {
    const f = fixture(null);
    f.render().rememberSearchQuery('새 책');
    f.render().rememberSearchQuery('오래된 책');
    f.render().removeSearchQuery('새 책');
    await tick();
    assert.equal(f.requests.length, 0);
    f.load({ folder_search_history: ['이전 책', '오래된 책'] });
    assert.deepEqual(f.history, ['오래된 책', '이전 책']);
    await tick();
    assert.deepEqual(f.requests[0].patch, { folder_search_history: ['오래된 책', '이전 책'] });
    f.requests[0].resolve();
    await tick();
    f.unmount();
});

test('빠른 연속 검색과 삭제는 즉시 반영되고 저장 응답이 삭제한 기록을 복구하지 않는다', async () => {
    const f = fixture({ folder_search_history: ['이전 책'] });
    f.render().rememberSearchQuery('첫 책');
    f.render().rememberSearchQuery('다음 책');
    f.render().removeSearchQuery('첫 책');
    assert.deepEqual(f.history, ['다음 책', '이전 책']);
    await tick();
    const expected = [
        ['첫 책', '이전 책'],
        ['다음 책', '첫 책', '이전 책'],
        ['다음 책', '이전 책'],
    ];
    for (let index = 0; index < expected.length; index += 1) {
        assert.equal(f.requests.length, index + 1);
        assert.deepEqual(f.requests[index].patch, { folder_search_history: expected[index] });
        f.requests[index].resolve();
        await tick();
        assert.deepEqual(f.history, ['다음 책', '이전 책']);
    }
    f.load({ language: 'en', folder_search_history: ['첫 책', '이전 책'] });
    assert.deepEqual(f.history, ['다음 책', '이전 책']);
    f.unmount();
});

test('전체 삭제와 이후 검색도 저장 순서를 지키며 비거나 변하지 않은 검색은 저장하지 않는다', async () => {
    const f = fixture({ folder_search_history: ['이전 책'] });
    f.render().rememberSearchQuery(' ');
    f.render().rememberSearchQuery(' 이전 책 ');
    f.render().removeSearchQuery('없음');
    await tick();
    assert.equal(f.requests.length, 0);
    f.render().clearSearchHistory();
    f.render().rememberSearchQuery('새 책');
    await tick();
    assert.deepEqual(f.history, ['새 책']);
    assert.deepEqual(f.requests[0].patch, { folder_search_history: [] });
    f.requests[0].resolve();
    await tick();
    assert.deepEqual(f.history, ['새 책']);
    assert.deepEqual(f.requests[1].patch, { folder_search_history: ['새 책'] });
    f.requests[1].resolve();
    await tick();
    f.unmount();
});

test('저장 실패를 알리고 다음 저장은 최신 검색과 삭제를 포함하여 계속 실행한다', async () => {
    const f = fixture({ folder_search_history: ['이전 책'] });
    f.render().rememberSearchQuery('새 책');
    f.render().removeSearchQuery('이전 책');
    await tick();
    const error = new Error('disk unavailable');
    f.requests[0].reject(error);
    await tick();
    assert.deepEqual(f.errors, [error]);
    assert.deepEqual(f.requests[1].patch, { folder_search_history: ['새 책'] });
    f.requests[1].resolve();
    await tick();
    assert.deepEqual(f.history, ['새 책']);
    f.unmount();
});

test('IPC가 이전 설정을 반환하는 저장 실패도 알리고 검색 기록은 유지한다', async () => {
    const f = fixture({ folder_search_history: ['이전 책'] });
    f.render().rememberSearchQuery('새 책');
    await tick();
    f.requests[0].resolve({ folder_search_history: ['이전 책'] });
    await tick();
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.history, ['새 책', '이전 책']);
    f.unmount();
});

test('컴포넌트 해제 뒤에도 대기 중인 기록 삭제를 저장한다', async () => {
    const f = fixture({ folder_search_history: ['이전 책'] });
    f.render().rememberSearchQuery('새 책');
    f.render().clearSearchHistory();
    await tick();
    f.unmount();
    f.requests[0].reject(new Error('offline'));
    await tick();
    assert.equal(f.errors.length, 0);
    assert.deepEqual(f.requests[1].patch, { folder_search_history: [] });
    f.requests[1].resolve();
    await tick();
});
