import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./hooks/useFileSelection.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export function useFileSelection', 'function useFileSelection');

test('selection inversion preserves displayed order, active item and keyboard anchor', () => {
    const state = [];
    const refs = [];
    let cursor = 0;
    let refCursor = 0;
    const context = vm.createContext({
        useState: initial => {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [state[index], update => { state[index] = typeof update === 'function' ? update(state[index]) : update; }];
        },
        useRef: initial => {
            const index = refCursor++;
            return refs[index] ||= { current: initial };
        },
        useMemo: fn => fn(),
        useCallback: fn => fn,
    });
    vm.runInContext(source, context);
    const files = ['D', 'B', 'A', 'C'].map(path => ({ path }));
    const render = () => { cursor = 0; refCursor = 0; return context.useFileSelection(files); };
    let selection = render();
    selection.selectPaths(['A', 'D']);
    selection = render();
    selection.invertSelection();
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), ['B', 'C']);
    assert.equal(selection.activeSelectedPath, 'C');
    assert.equal(selection.lastSelectedIndex, 3);
    selection.selectAll();
    selection = render();
    selection.invertSelection();
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), []);
    assert.equal(selection.activeSelectedPath, '');
    assert.equal(selection.lastSelectedIndex, -1);
    selection.invertSelection();
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), ['D', 'B', 'A', 'C']);
});
