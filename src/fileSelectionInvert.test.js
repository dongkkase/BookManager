import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { nextSelectionIndex } from './folderSelectionState.js';

const source = readFileSync(new URL('./hooks/useFileSelection.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('export function useFileSelection', 'function useFileSelection');

function createSelectionHarness(files) {
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
        nextSelectionIndex,
    });
    vm.runInContext(source, context);
    return (nextFiles = files) => {
        files = nextFiles;
        cursor = 0;
        refCursor = 0;
        return context.useFileSelection(files);
    };
}

test('selection inversion preserves displayed order, active item and keyboard anchor', () => {
    const files = ['D', 'B', 'A', 'C'].map(path => ({ path }));
    const render = createSelectionHarness(files);
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

test('선택 경로 복원은 순서를 유지하며 중간 활성 항목과 Shift 기준점을 복원한다', () => {
    const files = ['D', 'B', 'A', 'C'].map(path => ({ path }));
    const render = createSelectionHarness(files);
    let selection = render();
    selection.selectPaths(['D', 'B', 'C'], { activePath: 'B' });
    selection = render();

    assert.deepEqual(Array.from(selection.selectedFiles), ['D', 'B', 'C']);
    assert.equal(selection.activeSelectedPath, 'B');
    assert.equal(selection.selectedFileData(), files[1]);
    assert.equal(selection.lastSelectedIndex, 1);

    selection.moveActiveSelection(1, true);
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), ['B', 'A']);
    assert.equal(selection.activeSelectedPath, 'A');
    assert.equal(selection.lastSelectedIndex, 2);

    selection.moveActiveSelection(-1, true);
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), ['B']);
    selection.rangeSelect('C', files[3], 3);
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), ['B', 'A', 'C']);
});

test('삭제된 활성 항목을 복원할 때 마지막 남은 선택 항목을 Shift 기준점으로 사용한다', () => {
    const files = ['D', 'B', 'A', 'C'].map(path => ({ path }));
    const render = createSelectionHarness(files);
    let selection = render();
    selection.selectPaths(['D', 'B', 'C'], { activePath: 'B' });
    selection = render(files.filter(file => file.path !== 'B'));
    selection.selectPaths(['D', 'C'], { activePath: 'B' });
    selection = render();

    assert.deepEqual(Array.from(selection.selectedFiles), ['D', 'C']);
    assert.equal(selection.activeSelectedPath, 'C');
    assert.equal(selection.lastSelectedIndex, 2);

    selection.moveActiveSelection(-1, true);
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), ['A', 'C']);
    assert.equal(selection.activeSelectedPath, 'A');
    assert.equal(selection.lastSelectedIndex, 1);
});

test('선택 밖의 활성 경로나 생략된 옵션은 기존 마지막 선택 항목으로 처리한다', () => {
    const render = createSelectionHarness(['D', 'B', 'A', 'C'].map(path => ({ path })));
    let selection = render();
    for (const options of [undefined, {}, { activePath: 'missing' }, { activePath: 'A' }]) {
        selection.selectPaths(['D', 'B', 'C'], options);
        selection = render();
        assert.deepEqual(Array.from(selection.selectedFiles), ['D', 'B', 'C']);
        assert.equal(selection.activeSelectedPath, 'C');
        assert.equal(selection.lastSelectedIndex, 3);
    }

    selection.selectPaths([], { activePath: 'B' });
    selection = render();
    assert.deepEqual(Array.from(selection.selectedFiles), []);
    assert.equal(selection.activeSelectedPath, '');
    assert.equal(selection.lastSelectedIndex, -1);
});
