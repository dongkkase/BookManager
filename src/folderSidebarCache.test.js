import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as treeState from './folderTreeState.js';
import * as libraryStatus from './folderLibraryStatus.js';
import * as libraryPresentation from './libraryPresentation.js';
import { createFolderTreeLoader } from './folderTreeLoader.js';
import { buildFolderTreeRows } from './folderTreeRows.js';

const compiled = transformSync(fs.readFileSync(new URL('./components/folder/FolderSidebar.jsx', import.meta.url), 'utf8'), {
    loader: 'jsx', format: 'cjs', target: 'es2022',
}).code;
const nodes = node => node && typeof node === 'object'
    ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ indexed = false } = {}) {
    const slots = [];
    const frames = [];
    const calls = [];
    const children = new Map([
        ['/Library', ['Parent']],
        ['/Library/Parent', ['First', 'Second']],
        ['/Other', ['Other child']],
        ['/Added', ['Added child']],
    ]);
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let tree;
    const same = (left, right) => left && right && left.length === right.length
        && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        Fragment: Symbol('Fragment'),
        createElement: (type, props, ...childNodes) => ({ type, props: { ...props, children: childNodes } }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, update => {
                const next = typeof update === 'function' ? update(slots[index].value) : update;
                if (!Object.is(next, slots[index].value)) dirty = true;
                slots[index].value = next;
            }];
        },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useMemo(compute, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: compute(), deps };
            return slots[index].value;
        },
        useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
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
    };
    react.useLayoutEffect = react.useEffect;
    const mocks = {
        react,
        'react-dom': { createPortal: node => node },
        '../FaIcon': { FaIcon: 'FaIcon' },
        '../../folderTreeState': treeState,
        '../../folderLibraryStatus': libraryStatus,
        '../../selectionVisualFeedback': {
            applyImmediateSingleSelection: () => {},
            scheduleAfterNextPaint: callback => { callback(); return () => {}; },
        },
        '../../libraryPresentation.js': libraryPresentation,
        '../../folderTreeLoader.js': { createFolderTreeLoader },
        './FolderTree.jsx': { default: 'FolderTree', __esModule: true },
    };
    const storage = new Map();
    const window = {
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
        },
        electronAPI: {
            getRoots: async () => [],
            getSpecialPaths: async () => ({}),
            readDir: async path => {
                calls.push({ path });
                return (children.get(path) || []).map(name => ({ name, isDirectory: true }));
            },
        },
    };
    if (indexed) {
        window.electronAPI.getLibraryFolderChildren = async (root, path) => {
            calls.push({ root, path });
            return {
                indexed: true,
                children: (children.get(path) || []).map(name => ({
                    name,
                    path: `${path}/${name}`,
                    childFolderCount: children.get(`${path}/${name}`)?.length || 0,
                })),
            };
        };
    }
    const module = { exports: {} };
    new Function('module', 'exports', 'require', 'window', compiled)(module, module.exports, name => {
        assert.ok(name in mocks, `Unexpected import: ${name}`);
        return mocks[name];
    }, window);
    const props = {
        t: key => key,
        libraries: ['/Library', '/Other'],
        libraryEntries: [{ path: '/Library', alias: '', group: '' }, { path: '/Other', alias: '', group: '' }],
        selectedFolderPath: '/Library/Parent/First',
        refreshToken: 0,
    };
    const render = () => {
        cursor = 0;
        dirty = false;
        tree = module.exports.FolderSidebar(props);
        const folderTree = nodes(tree).find(node => node.type === 'FolderTree').props;
        frames.push(folderTree);
        const pending = effects;
        effects = [];
        pending.forEach(effect => effect());
    };
    const flush = async () => {
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
        assert.fail('FolderSidebar did not settle');
    };
    return {
        calls,
        frames,
        children,
        props,
        current: () => frames.at(-1),
        rendered: () => nodes(tree),
        count: path => calls.filter(call => call.path === path).length,
        async update(updates = {}) {
            Object.assign(props, updates);
            render();
            await flush();
        },
        dispose: () => slots.forEach(slot => slot.cleanup?.()),
    };
}

function assertKeptReady(frames, paths) {
    assert.ok(frames.length > 0);
    for (const frame of frames) {
        for (const path of paths) assert.equal(frame.entries[path]?.status, 'ready', `${path} lost its cached children`);
        const rows = buildFolderTreeRows(frame.roots, frame.entries, frame.expandedPaths);
        assert.ok(rows.every(row => row.kind !== 'loading'), 'The expanded tree flashed a loading row');
    }
}

for (const indexed of [false, true]) {
    test(`${indexed ? '인덱스' : '파일 시스템'} 트리는 폴더 선택 후 설정이 새 객체로 전달되어도 부모 캐시를 유지한다`, async t => {
        const f = fixture({ indexed });
        t.after(f.dispose);
        await f.update();
        assert.equal(f.count('/Library'), 1);
        assert.equal(f.count('/Library/Parent'), 1);
        const before = f.calls.slice();
        const frameCount = f.frames.length;

        await f.update({
            libraries: [...f.props.libraries],
            libraryEntries: f.props.libraryEntries.map(entry => ({ ...entry })),
            selectedFolderPath: '/Library/Parent/Second',
        });

        assert.deepEqual(f.calls, before);
        assert.equal(f.current().selectedPath, '/Library/Parent/Second');
        assertKeptReady(f.frames.slice(frameCount), ['/Library', '/Library/Parent', '/Other']);
    });
}

test('라이브러리 별칭, 그룹과 표시 순서 변경은 화면에 반영하고 트리 캐시는 유지한다', async t => {
    const f = fixture({ indexed: true });
    t.after(f.dispose);
    await f.update();
    const before = f.calls.slice();
    const frameCount = f.frames.length;

    await f.update({
        libraries: ['/Other', '/Library'],
        libraryEntries: [{ path: '/Other', alias: 'Other renamed', group: 'New group' }, { path: '/Library', alias: 'Library renamed', group: 'New group' }],
    });

    assert.deepEqual(f.calls, before);
    assert.deepEqual(f.current().roots.map(root => [root.path, root.name]), [['/Other', 'Other renamed'], ['/Library', 'Library renamed']]);
    assert.ok(f.rendered().some(node => node.props.className === 'library-group-header' && node.props.children.includes('New group')));
    assertKeptReady(f.frames.slice(frameCount), ['/Library', '/Library/Parent', '/Other']);
});

test('명시적인 새로고침은 펼쳐진 부모와 하위 폴더 내용을 다시 조회한다', async t => {
    const f = fixture();
    t.after(f.dispose);
    await f.update();
    f.children.set('/Library/Parent', ['First', 'Second', 'New child']);
    const frameCount = f.frames.length;

    await f.update({ refreshToken: 1 });

    assert.equal(f.count('/Library'), 2);
    assert.equal(f.count('/Library/Parent'), 2);
    assert.equal(f.count('/Other'), 2);
    assert.ok(f.current().entries['/Library/Parent'].children.some(child => child.path === '/Library/Parent/New child'));
    assert.ok(f.frames.slice(frameCount).some(frame => frame.entries['/Library']?.status === 'loading'));
});

test('실제 라이브러리 경로 추가와 제거는 캐시 및 인덱스 조회 기준을 갱신한다', async t => {
    const f = fixture({ indexed: true });
    t.after(f.dispose);
    await f.update();

    await f.update({ libraries: ['/Library', '/Library/Parent', '/Added'] });
    assert.deepEqual(f.current().roots.map(root => root.path), ['/Library', '/Library/Parent', '/Added']);
    assert.equal(f.current().entries['/Other'], undefined);
    assert.equal(f.current().entries['/Added'].status, 'ready');
    assert.deepEqual(f.calls.filter(call => call.path === '/Library/Parent').at(-1), { root: '/Library/Parent', path: '/Library/Parent' });

    await f.update({ libraries: ['/Library', '/Added'] });
    assert.deepEqual(f.current().roots.map(root => root.path), ['/Library', '/Added']);
    assert.equal(f.count('/Library/Parent'), 3);
    assert.deepEqual(f.calls.filter(call => call.path === '/Library/Parent').at(-1), { root: '/Library', path: '/Library/Parent' });
    assert.equal(f.current().entries['/Library/Parent'].status, 'ready');
});
