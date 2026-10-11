import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as appShell from './appShell.js';
import * as coverEditorBatch from './coverEditorBatch.js';
import * as metadataTypes from './metadata/metadataTypes.js';
import * as coverReadingState from '../electron/coverReadingState.js';
import * as toolbarState from './toolbarState.js';
import * as coverEditorFolderPaths from './features/fileTools/coverEditor/coverEditorFolderPaths.js';
import * as dropPolicy from './dropPolicy.js';
import * as coverEditorImageTransfer from './coverEditorImageTransfer.js';
import * as interactionPolicy from './interactionPolicy.js';
import * as completionSoundPolicy from './completionSoundPolicy.js';

const compiled = transformSync(fs.readFileSync(new URL('./features/fileTools/coverEditor/CoverEditorTool.jsx', import.meta.url), 'utf8'), {
    loader: 'jsx', format: 'cjs', target: 'es2022',
}).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};

function fixture(t, initialProps = {}) {
    const originalWindow = globalThis.window;
    const originalCustomEvent = globalThis.CustomEvent;
    const slots = [];
    const listeners = new Map();
    const storage = new Map();
    const calls = { toasts: [], preferences: [], picks: [], folderPicks: [], reads: [], stats: [], applies: [], sounds: [], messages: [], events: [], backs: 0, updatesAfterUnmount: 0 };
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let unmounted = false;
    let tree;
    let beforeLeave;
    const props = {
        config: { api_keys: { source: 'configured' }, folder_cover_editor_options: { mode: 'replace', backup: false, renumber: false } },
        saveConfig: patch => calls.preferences.push(patch),
        t: key => key,
        showToast: value => calls.toasts.push(value),
        onBack: () => { calls.backs += 1; },
        registerBeforeLeave(callback) {
            beforeLeave = callback;
            return () => { if (beforeLeave === callback) beforeLeave = undefined; };
        },
        ...initialProps,
    };
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, update => {
                if (unmounted) calls.updatesAfterUnmount += 1;
                const value = typeof update === 'function' ? update(slots[index].value) : update;
                if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
            }];
        },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useCallback(callback, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: callback, deps };
            return slots[index].value;
        },
        useEffect(effect, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) {
                const previous = slots[index];
                slots[index] = { deps };
                effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
            }
        },
    };
    globalThis.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
    const api = {
        async selectFiles(...args) { calls.picks.push(args); return []; },
        async selectFolder(...args) { calls.folderPicks.push(args); return null; },
        async readDir(path) { calls.reads.push(path); return []; },
        async stat(path) { calls.stats.push(path); return { isFile: true }; },
        async applyCoverEditor(request) { calls.applies.push(request); return { success: true, filePath: request.filePath }; },
        async playSound(filename) { calls.sounds.push(filename); },
        async showMessage(options) { calls.messages.push(options); return 'cancel'; },
    };
    globalThis.window = {
        electronAPI: api,
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key),
        },
        addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
        removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
        dispatchEvent(event) {
            calls.events.push(event);
            for (const callback of [...(listeners.get(event.type) || [])]) callback(event);
        },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(name => {
        if (name === 'react') return react;
        if (name === '../../../components/folder/CoverEditorDialog') return { CoverEditorDialog: 'CoverEditorDialog' };
        if (name === '../../../appShell') return appShell;
        if (name === '../../../coverEditorBatch') return coverEditorBatch;
        if (name === '../../../metadata/metadataTypes') return metadataTypes;
        if (name === '../../../../electron/coverReadingState') return coverReadingState;
        if (name === '../../../toolbarState') return toolbarState;
        if (name === './coverEditorFolderPaths') return coverEditorFolderPaths;
        if (name === '../../../components/FileDropHoverOverlay') return { FileDropHoverOverlay: 'FileDropHoverOverlay' };
        if (name === '../../../dropPolicy') return dropPolicy;
        if (name === '../../../coverEditorImageTransfer') return coverEditorImageTransfer;
        if (name === '../../../interactionPolicy') return interactionPolicy;
        if (name === '../../../completionSoundPolicy') return completionSoundPolicy;
        throw new Error(`Unexpected import ${name}`);
    }, module, module.exports);
    const render = () => {
        if (unmounted) return;
        let count = 0;
        do {
            assert.ok(count++ < 20, '렌더가 안정된 상태로 종료되어야 한다');
            cursor = 0;
            dirty = false;
            effects = [];
            tree = module.exports.default(props);
            effects.forEach(effect => effect());
        } while (dirty);
    };
    const unmount = () => {
        if (unmounted) return;
        unmounted = true;
        slots.forEach(slot => slot.cleanup?.());
    };
    render();
    t.after(() => {
        unmount();
        globalThis.window = originalWindow;
        globalThis.CustomEvent = originalCustomEvent;
    });
    return {
        api, calls, props, storage, render, unmount,
        dialog: () => tree.props.children.find(node => node?.type === 'CoverEditorDialog').props,
        paths: () => tree.props.children.find(node => node?.type === 'CoverEditorDialog').props.files.map(file => file.path),
        checkedPaths: () => tree.props.children.find(node => node?.type === 'CoverEditorDialog').props.files.filter(file => file.checked).map(file => file.path),
        toolbar: () => calls.events.filter(event => event.type === 'bookmanager:toolbar-state').at(-1)?.detail,
        metadataEvents: () => calls.events.filter(event => event.type === 'bookmanager:metadata-saved').map(event => event.detail),
        overlay: () => tree.props.children.find(node => node?.type === 'FileDropHoverOverlay')?.props,
        root: () => tree.props,
        beforeLeave: () => beforeLeave?.(),
        listeners: name => listeners.get(name)?.size || 0,
        update(patch) { Object.assign(props, patch); render(); },
        async flush() { await tick(); render(); },
        action(action, activeTab = 'tools') {
            window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: { activeTab, action } }));
            render();
        },
        unload() {
            const event = { type: 'beforeunload', prevented: false, preventDefault() { this.prevented = true; } };
            window.dispatchEvent(event);
            return event;
        },
    };
}

function dragEvent(paths, internal = false, clientY = 400) {
    return {
        clientY,
        prevented: false,
        stopped: false,
        currentTarget: {
            getBoundingClientRect: () => ({ top: 100, height: 600 }),
            contains: () => false,
        },
        dataTransfer: {
            types: [internal ? appShell.BOOKMANAGER_PATHS_MIME : 'Files'],
            files: internal ? [] : paths.map(path => ({ path })),
            getData: type => internal && type === appShell.BOOKMANAGER_PATHS_MIME ? JSON.stringify(paths) : '',
        },
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
    };
}

test('공통 툴바 상태는 선택 수를 반영하고 추가한 파일과 기존 선택을 유지한다', t => {
    const app = fixture(t);
    assert.deepEqual(app.toolbar(), { tabId: 'tools', totalCount: 0, checkedCount: 0, hasItems: false, allChecked: true, fileActionsEnabled: true, fileActionsBusy: false });
    assert.equal(app.dialog().onAddFiles, undefined);
    assert.equal(app.dialog().onClearFiles, undefined);
    app.update({ openRequest: { paths: ['/books/a.cbz', '/books/b.epub'] } });
    assert.equal(app.toolbar().checkedCount, 2);
    assert.equal(app.toolbar().allChecked, true);
    app.dialog().onToggleFile('/books/a.cbz');
    app.render();
    assert.equal(app.toolbar().checkedCount, 1);
    assert.equal(app.toolbar().allChecked, false);
    app.update({ openRequest: { paths: ['/books/a.cbz', '/books/c.pdf'] } });
    assert.deepEqual(app.checkedPaths(), ['/books/b.epub', '/books/c.pdf']);
    assert.equal(app.toolbar().totalCount, 3);
    app.action('toggle-all');
    assert.deepEqual(app.checkedPaths(), app.paths());
    app.action('toggle-all');
    assert.deepEqual(app.checkedPaths(), []);
    assert.equal(app.toolbar().checkedCount, 0);
    app.action('remove-selected');
    assert.equal(app.paths().length, 3);
    app.dialog().onToggleFile('/books/b.epub');
    app.render();
    app.action('remove-selected');
    assert.deepEqual(app.paths(), ['/books/a.cbz', '/books/c.pdf']);
    assert.equal(app.toolbar().checkedCount, 0);
    app.action('clear-all');
    assert.equal(app.toolbar().totalCount, 0);
    assert.equal(app.toolbar().hasItems, false);
});

test('표지 옵션의 전체 선택 버튼은 전체·부분·미선택 상태를 전환하고 옵션과 작업 세션을 유지한다', t => {
    const app = fixture(t, { openRequest: { paths: ['/books/a.cbz', '/books/b.epub'] } });
    const initialDialog = app.dialog();
    app.dialog().onToggleAll();
    app.render();
    assert.deepEqual(app.checkedPaths(), []);
    assert.equal(app.toolbar().checkedCount, 0);
    app.dialog().onToggleAll();
    app.render();
    assert.deepEqual(app.checkedPaths(), app.paths());
    app.dialog().onToggleFile('/books/a.cbz');
    app.render();
    assert.deepEqual(app.checkedPaths(), ['/books/b.epub']);
    app.dialog().onToggleAll();
    app.render();
    assert.deepEqual(app.checkedPaths(), app.paths());
    assert.equal(app.toolbar().allChecked, true);
    assert.equal(app.dialog().key, initialDialog.key);
    assert.equal(app.dialog().preferences, initialDialog.preferences);
    assert.equal(app.dialog().localImageRequest, initialDialog.localImageRequest);
    assert.deepEqual(app.calls.preferences, []);
    assert.deepEqual(app.calls.applies, []);
});

test('행 삭제는 지정한 파일만 목록에서 제거하고 나머지 파일의 체크 상태를 유지한다', t => {
    const app = fixture(t, { openRequest: { paths: ['/books/a.cbz', '/books/b.epub', '/books/c.pdf'] } });
    app.dialog().onToggleFile('/books/b.epub');
    app.render();
    const remaining = app.dialog().files.filter(file => file.path !== '/books/a.cbz');
    app.dialog().onRemoveFile('/books/a.cbz');
    app.render();
    assert.deepEqual(app.paths(), ['/books/b.epub', '/books/c.pdf']);
    assert.deepEqual(app.checkedPaths(), ['/books/c.pdf']);
    assert.equal(app.dialog().files[0], remaining[0]);
    assert.equal(app.dialog().files[1], remaining[1]);
    assert.equal(app.toolbar().totalCount, 2);
    assert.equal(app.toolbar().checkedCount, 1);
    app.dialog().onRemoveFile('/books/b.epub');
    app.render();
    assert.deepEqual(app.paths(), ['/books/c.pdf']);
    assert.deepEqual(app.checkedPaths(), ['/books/c.pdf']);
    app.dialog().onRemoveFile('/books/c.pdf');
    app.render();
    assert.equal(app.toolbar().hasItems, false);
    assert.equal(app.toolbar().checkedCount, 0);
    assert.deepEqual(app.calls.applies, []);
});

test('다른 탭의 공통 파일 동작과 표지 검사 중 파일 변경을 무시한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/a.cbz'] } });
    for (const action of ['add-file', 'add-folder', 'toggle-all', 'remove-selected', 'clear-all']) app.action(action, 'renamer');
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/a.cbz']);
    assert.deepEqual(app.checkedPaths(), ['/books/a.cbz']);
    assert.equal(app.calls.picks.length, 0);
    assert.equal(app.calls.folderPicks.length, 0);
    app.dialog().onBusyChange(true);
    app.render();
    assert.equal(app.toolbar().fileActionsBusy, true);
    for (const action of ['add-file', 'add-folder', 'toggle-all', 'remove-selected', 'clear-all']) app.action(action);
    app.dialog().onToggleFile('/books/a.cbz');
    app.dialog().onToggleAll();
    app.dialog().onRemoveFile('/books/a.cbz');
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/a.cbz']);
    assert.deepEqual(app.checkedPaths(), ['/books/a.cbz']);
    assert.equal(app.calls.picks.length, 0);
    assert.equal(app.calls.folderPicks.length, 0);
    app.dialog().onBusyChange(false);
    app.render();
    assert.equal(app.toolbar().fileActionsBusy, false);
    app.action('remove-selected');
    assert.deepEqual(app.paths(), []);
});

test('공통 폴더 추가는 하위 폴더의 지원 파일을 중복 없이 추가하고 수집 중 파일 변경을 차단한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/a.cbz'] } });
    const pending = deferred();
    app.api.selectFolder = async title => { app.calls.folderPicks.push([title]); return '/books'; };
    app.api.readDir = async path => {
        app.calls.reads.push(path);
        if (path === '/books') return pending.promise;
        if (path === '/books/series') return [{ name: 'b.epub', isFile: true }, { name: 'folder', isDirectory: true }];
        if (path === '/books/series/folder') return [{ name: 'c.pdf', isFile: true }];
        throw new Error(`Unexpected directory ${path}`);
    };
    app.action('add-folder');
    await app.flush();
    assert.equal(app.toolbar().fileActionsBusy, true);
    for (const action of ['add-file', 'add-folder', 'toggle-all', 'remove-selected', 'clear-all']) app.action(action);
    app.dialog().onToggleFile('/books/a.cbz');
    app.dialog().onToggleAll();
    app.dialog().onRemoveFile('/books/a.cbz');
    app.render();
    assert.deepEqual(app.checkedPaths(), ['/books/a.cbz']);
    assert.equal(app.calls.picks.length, 0);
    assert.deepEqual(app.calls.folderPicks, [['add_folder']]);
    pending.resolve([{ name: 'a.cbz', isFile: true }, { name: 'skip.png', isFile: true }, { name: 'series', isDirectory: true }]);
    await app.flush();
    assert.deepEqual(app.calls.reads, ['/books', '/books/series', '/books/series/folder']);
    assert.deepEqual(app.paths(), ['/books/a.cbz', '/books/series/b.epub', '/books/series/folder/c.pdf']);
    assert.deepEqual(app.checkedPaths(), app.paths());
    assert.equal(app.toolbar().checkedCount, 3);
    assert.equal(app.toolbar().fileActionsBusy, false);
    assert.deepEqual(app.calls.toasts, []);
});

test('폴더 선택 취소와 읽기 실패는 기존 목록을 유지하고 공통 툴바 잠금을 해제한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.action('add-folder');
    await app.flush();
    assert.deepEqual(app.calls.reads, []);
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.equal(app.toolbar().fileActionsBusy, false);
    app.api.selectFolder = async () => '/locked';
    app.api.readDir = async () => { throw new Error('permission denied'); };
    app.action('add-folder');
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.equal(app.toolbar().fileActionsBusy, false);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_tool_add_failed', values: ['permission denied'] }]);
});

test('늦은 폴더 선택과 수집 결과는 대상 교체 또는 뒤로 가기 이후 반영하지 않는다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    const selection = deferred();
    app.api.selectFolder = () => selection.promise;
    app.action('add-folder');
    app.update({ openRequest: { paths: ['/books/new.epub'], mode: 'replace' } });
    selection.resolve('/books');
    await app.flush();
    assert.deepEqual(app.calls.reads, []);
    assert.deepEqual(app.paths(), ['/books/new.epub']);
    const read = deferred();
    app.api.selectFolder = async () => '/books';
    app.api.readDir = () => read.promise;
    app.action('add-folder');
    await app.flush();
    app.dialog().onClose();
    read.resolve([{ name: 'late.cbz', isFile: true }]);
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/new.epub']);
    assert.equal(app.calls.backs, 1);
    assert.equal(app.toolbar().fileActionsBusy, false);
    assert.deepEqual(app.calls.toasts, []);
});

test('unmount 이후 폴더 선택 성공과 수집 오류는 목록이나 알림을 갱신하지 않는다', async t => {
    for (const phase of ['select', 'read']) {
        await t.test(phase, async child => {
            const app = fixture(child);
            const pending = deferred();
            app.api.selectFolder = () => phase === 'select' ? pending.promise : Promise.resolve('/books');
            app.api.readDir = () => pending.promise;
            app.action('add-folder');
            await app.flush();
            app.unmount();
            if (phase === 'select') pending.resolve('/books');
            else pending.reject(new Error('folder closed'));
            await app.flush();
            assert.equal(app.calls.updatesAfterUnmount, 0);
            assert.deepEqual(app.calls.toasts, []);
            assert.equal(app.toolbar().fileActionsEnabled, false);
            assert.equal(app.listeners('bookmanager:action'), 0);
        });
    }
});

test('전달 파일은 지원 형식만 추가하고 Windows·유니코드 중복을 제거하며 교체·삭제·초기화한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/가.cbz', '/books/가.cbz'.normalize('NFD'), 'C:/Books/Book.PDF', 'c:\\books\\book.pdf', '/books/no.exe', '/books/no.exe'] } });
    assert.deepEqual(app.paths(), ['/books/가.cbz', 'C:\\Books\\Book.PDF']);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_tool_unsupported', values: [1] }]);
    assert.equal(app.dialog().embedded, true);
    assert.equal(app.dialog().apiKeys, app.props.config.api_keys);
    assert.deepEqual(app.dialog().files[0], { path: '/books/가.cbz', full_path: '/books/가.cbz', name: '가.cbz', checked: true });
    app.update({ openRequest: { paths: ['/books/read.epub', '/books/가.cbz'], mode: 'append' } });
    assert.deepEqual(app.paths(), ['/books/가.cbz', 'C:\\Books\\Book.PDF', '/books/read.epub']);
    app.update({ openRequest: { paths: ['/books/audio.m4b', '/books/read.txt'], mode: 'replace' } });
    assert.deepEqual(app.paths(), ['/books/audio.m4b', '/books/read.txt']);
    app.update({ openRequest: { paths: ['/books/no.exe'], mode: 'replace' } });
    assert.deepEqual(app.paths(), ['/books/audio.m4b', '/books/read.txt']);
    app.dialog().onToggleFile('/books/read.txt');
    app.render();
    app.action('remove-selected');
    const session = app.dialog().key;
    app.dialog().onReset();
    app.render();
    assert.notEqual(app.dialog().key, session);
    assert.deepEqual(app.paths(), ['/books/read.txt']);
    app.action('clear-all');
    assert.deepEqual(app.paths(), []);
});

test('native 파일 선택과 외부·내부 드롭은 대상에 추가하며 작업 중 드롭을 차단한다', async t => {
    const app = fixture(t);
    const selectFiles = app.api.selectFiles;
    app.api.selectFiles = async (...args) => { await selectFiles(...args); return ['/books/first.cbz', '/books/first.cbz', '/books/second.epub']; };
    app.action('add-file');
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/first.cbz', '/books/second.epub']);
    const [title, filters] = app.calls.picks[0];
    assert.equal(title, 'cover_editor_tool_add_files');
    for (const extension of ['cbz', 'epub', 'pdf', 'txt', 'm4b']) assert.ok(filters[0].extensions.includes(extension));
    for (const internal of [false, true]) {
        const event = dragEvent([`/books/${internal ? 'internal' : 'external'}.pdf`], internal);
        app.root().onDragOver(event);
        app.render();
        assert.equal(event.dataTransfer.dropEffect, 'copy');
        assert.match(app.root().className, /is-dragging/);
        await app.root().onDrop(event);
        app.render();
        assert.equal(event.prevented, true);
        assert.equal(event.stopped, true);
    }
    const previous = app.paths();
    app.dialog().onBusyChange(true);
    const event = dragEvent(['/books/blocked.pdf']);
    app.root().onDragOver(event);
    await app.root().onDrop(event);
    app.action('add-file');
    await app.flush();
    assert.equal(event.dataTransfer.dropEffect, 'none');
    assert.deepEqual(app.paths(), previous);
    assert.equal(app.calls.picks.length, 1);
});

test('책 파일 드롭은 공통 분할 안내와 같은 위치에서 목록을 교체하거나 추가한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/old.cbz'] } });
    for (const [clientY, mode, path] of [[100, 'replace', '/books/new.cbz'], [279.99, 'replace', '/books/last.epub'], [280, 'append', '/books/next.pdf']]) {
        const before = app.paths();
        const event = dragEvent([path], false, clientY);
        app.root().onDragOver(event);
        app.render();
        assert.equal(app.overlay().dropMode, mode);
        assert.equal(app.overlay().imageDrop, false);
        const dropping = app.root().onDrop(event);
        app.render();
        assert.equal(app.overlay(), undefined);
        assert.equal(app.dialog().externalBusy, true);
        await dropping;
        app.render();
        assert.deepEqual(app.paths(), mode === 'replace' ? [path] : [...before, path]);
        assert.equal(app.dialog().externalBusy, false);
    }
});

test('이미지 단독 드롭은 목록 대신 표지 요청을 전달하고 내부 경로와 MIME 호버를 구분한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/book.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    for (const internal of [false, true]) {
        const path = `/covers/${internal ? 'internal.PNG' : 'external.jpg'}`;
        const event = dragEvent([path], internal, 150);
        app.root().onDragEnter(event);
        app.render();
        assert.equal(app.overlay().imageDrop, true);
        assert.equal(event.dataTransfer.dropEffect, 'copy');
        await app.root().onDrop(event);
        app.render();
        assert.deepEqual(app.paths(), ['/books/book.cbz']);
        assert.deepEqual(app.dialog().localImageRequest, { id: internal ? 2 : 1, path });
        assert.equal(app.overlay(), undefined);
    }
    const previousRequest = app.dialog().localImageRequest;
    const mimeEvent = dragEvent([]);
    mimeEvent.dataTransfer.items = [{ kind: 'file', type: 'image/webp' }];
    app.root().onDragOver(mimeEvent);
    app.render();
    assert.equal(app.overlay().imageDrop, true);
    assert.equal(mimeEvent.dataTransfer.dropEffect, 'copy');
    app.dialog().onImageDropAvailabilityChange(false);
    app.root().onDragOver(mimeEvent);
    app.render();
    assert.equal(app.overlay(), undefined);
    assert.equal(mimeEvent.dataTransfer.dropEffect, 'none');
    await app.root().onDrop(dragEvent(['/covers/blocked.png']));
    app.render();
    assert.equal(app.dialog().localImageRequest, previousRequest);
    assert.deepEqual(app.paths(), ['/books/book.cbz']);
});

test('책과 이미지 혼합 드롭은 각각 목록과 표지로 전달하며 여러 이미지는 기존 표지를 유지한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/old.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    const mixed = dragEvent(['/covers/cover.jpg', '/books/new.epub'], false, 150);
    app.root().onDragOver(mixed);
    app.render();
    assert.equal(app.overlay().imageDrop, false);
    assert.equal(app.overlay().dropMode, 'replace');
    await app.root().onDrop(mixed);
    app.render();
    assert.deepEqual(app.paths(), ['/books/new.epub']);
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, path: '/covers/cover.jpg' });
    const previousRequest = app.dialog().localImageRequest;
    await app.root().onDrop(dragEvent(['/covers/a.png', '/books/second.pdf', '/covers/b.webp']));
    app.render();
    assert.deepEqual(app.paths(), ['/books/new.epub', '/books/second.pdf']);
    assert.equal(app.dialog().localImageRequest, previousRequest);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_drop_one' }]);
});

test('경로 없는 브라우저 이미지 드롭은 바이트를 읽거나 파일 목록을 변경하지 않고 표지 요청으로 전달한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    const file = { name: 'browser.png', type: 'image/png', arrayBuffer: () => assert.fail('도구 래퍼에서 읽지 않아야 한다') };
    const event = dragEvent([], false, 150);
    event.dataTransfer.files = [file];
    event.dataTransfer.getData = type => type === 'text/uri-list' ? 'https://site.test/page' : '';
    app.root().onDragOver(event);
    app.render();
    assert.equal(app.overlay().imageDrop, true);
    assert.equal(event.dataTransfer.dropEffect, 'copy');
    await app.root().onDrop(event);
    app.render();
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, file });
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.deepEqual(app.calls.stats, []);
    assert.equal(app.dialog().externalBusy, false);
});

test('브라우저 URL 드래그 호버는 다운로드하지 않으며 드롭할 때만 URL을 전달한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    const event = dragEvent([], false, 150);
    event.dataTransfer.types = ['text/html', 'text/uri-list'];
    event.dataTransfer.getData = () => '';
    app.root().onDragOver(event);
    app.render();
    assert.equal(app.overlay().imageDrop, true);
    assert.equal(event.dataTransfer.dropEffect, 'copy');
    assert.equal(app.dialog().localImageRequest, null);
    event.dataTransfer.getData = type => type === 'text/uri-list' ? 'https://images.test/download?id=1' : '';
    await app.root().onDrop(event);
    app.render();
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, url: 'https://images.test/download?id=1' });
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.deepEqual(app.calls.stats, []);
    const lastRequest = app.dialog().localImageRequest;
    event.dataTransfer.getData = type => type === 'text/uri-list' ? 'blob:https://images.test/id' : '';
    await app.root().onDrop(event);
    app.render();
    assert.equal(app.dialog().localImageRequest, lastRequest);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_image_import_failed' }]);
});

test('이미지 여러 개의 붙여넣기와 브라우저 드롭은 오류만 알리고 기존 표지를 유지한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    const event = dragEvent([]);
    event.dataTransfer.files = [{ name: 'first.png', type: 'image/png' }, { name: 'second.png', type: 'image/png' }];
    event.clipboardData = event.dataTransfer;
    event.target = { tagName: 'DIV' };
    app.root().onPaste(event);
    await app.root().onDrop(event);
    app.render();
    assert.equal(event.prevented, true);
    assert.equal(app.dialog().localImageRequest, null);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_drop_one' }, { key: 'cover_editor_drop_one' }]);
});

test('붙여넣기는 클립보드 이미지를 전달하고 일반 텍스트 및 입력창 편집은 방해하지 않는다', t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    const file = { type: 'image/png', arrayBuffer: () => assert.fail('동기적으로 파일만 전달해야 한다') };
    const event = dragEvent([]);
    event.clipboardData = { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] };
    event.target = { tagName: 'DIV' };
    app.root().onPaste(event);
    app.render();
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, file });
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    const lastRequest = app.dialog().localImageRequest;
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { isContentEditable: true }]) {
        const editing = { ...event, prevented: false, stopped: false, target };
        app.root().onPaste(editing);
        app.render();
        assert.equal(editing.prevented, false);
        assert.equal(app.dialog().localImageRequest, lastRequest);
    }
    const text = { ...event, prevented: false, stopped: false, clipboardData: { types: ['text/plain'], getData: type => type === 'text/plain' ? '일반 텍스트' : '' } };
    app.root().onPaste(text);
    app.render();
    assert.equal(text.prevented, false);
    assert.equal(app.dialog().localImageRequest, lastRequest);
    const handled = { ...event, prevented: false, stopped: false, defaultPrevented: true };
    app.root().onPaste(handled);
    app.render();
    assert.equal(handled.prevented, false);
    assert.equal(app.dialog().localImageRequest, lastRequest);
});

test('이미지 주소를 복사해서 붙여넣으면 가져오지만 입력창 안에서는 기존 붙여넣기를 유지한다', t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    const event = dragEvent([]);
    event.clipboardData = {
        types: ['text/plain'],
        getData: type => type === 'text/plain' ? 'https://i.namu.wiki/i/image.webp' : '',
    };
    event.target = { tagName: 'DIV' };
    app.root().onPaste(event);
    app.render();
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, url: 'https://i.namu.wiki/i/image.webp' });
    assert.equal(event.prevented, true);
    const previousRequest = app.dialog().localImageRequest;
    for (const tagName of ['INPUT', 'TEXTAREA']) {
        const editing = { ...event, prevented: false, target: { tagName } };
        app.root().onPaste(editing);
        app.render();
        assert.equal(editing.prevented, false);
        assert.equal(app.dialog().localImageRequest, previousRequest);
    }
});

test('macOS 네이티브 붙여넣기가 BODY에 발생해도 표시 중인 표지 도구로 전달한다', t => {
    const originalDocument = globalThis.document;
    t.after(() => { globalThis.document = originalDocument; });
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    app.root().ref.current = { closest: () => null };
    globalThis.document = { activeElement: { tagName: 'DIV' } };
    const file = { name: 'image.png', type: 'image/png', size: 128 };
    const event = { ...dragEvent([]), type: 'paste', target: { tagName: 'BODY' },
        clipboardData: { files: [file], types: ['Files', 'text/html'] } };
    window.dispatchEvent(event);
    app.render();
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, file });
    assert.equal(event.prevented, true);
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.equal(app.listeners('paste'), 1);

    const alreadyHandled = { ...event, defaultPrevented: true };
    window.dispatchEvent(alreadyHandled);
    app.render();
    assert.equal(app.dialog().localImageRequest.id, 1);
    app.unmount();
    assert.equal(app.listeners('paste'), 0);
    window.dispatchEvent(event);
    assert.equal(app.calls.updatesAfterUnmount, 0);
});

test('BODY 붙여넣기는 숨겨진 도구, 활성 입력창, 모달, 작업 잠금에서 이미지를 가져오지 않는다', t => {
    const originalDocument = globalThis.document;
    t.after(() => { globalThis.document = originalDocument; });
    const app = fixture(t);
    app.dialog().onImageDropAvailabilityChange(true);
    const file = { name: 'image.png', type: 'image/png', size: 128 };
    for (const mode of ['hidden', 'input', 'editable', 'modal', 'busy', 'unavailable']) {
        app.root().ref.current = { closest: () => mode === 'hidden' ? {} : null };
        globalThis.document = { activeElement: {
            tagName: mode === 'input' ? 'INPUT' : 'DIV',
            isContentEditable: mode === 'editable',
            closest: () => mode === 'modal' ? {} : null,
        } };
        app.dialog().onBusyChange(mode === 'busy');
        app.dialog().onImageDropAvailabilityChange(mode !== 'unavailable');
        const event = { ...dragEvent([]), type: 'paste', target: { tagName: 'BODY' }, clipboardData: { files: [file] } };
        window.dispatchEvent(event);
        app.render();
        assert.equal(event.prevented, false, mode);
        assert.equal(app.dialog().localImageRequest, null, mode);
    }
});

test('DOM에 이미지 데이터가 없는 붙여넣기는 시스템 이미지 요청으로 전달하고 일반 텍스트는 유지한다', t => {
    const app = fixture(t);
    app.dialog().onImageDropAvailabilityChange(true);
    app.root().ref.current = { closest: () => null };
    app.api.previewCoverEditorClipboardImage = () => assert.fail('이미지 로딩은 Dialog에서 처리해야 한다');
    const event = { ...dragEvent([]), type: 'paste', target: { tagName: 'BODY' }, clipboardData: { types: [] } };
    window.dispatchEvent(event);
    app.render();
    assert.equal(event.prevented, true);
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, clipboard: true });
    const previous = app.dialog().localImageRequest;
    const text = { ...event, prevented: false, clipboardData: { types: ['text/plain'], getData: type => type === 'text/plain' ? '일반 텍스트' : '' } };
    window.dispatchEvent(text);
    app.render();
    assert.equal(text.prevented, false);
    assert.equal(app.dialog().localImageRequest, previous);
});

test('브라우저 임시 경로가 없으면 드롭 시 확보한 이미지 URL로 불러온다', async t => {
    for (const statFailure of ['missing', 'error']) {
        await t.test(statFailure, async child => {
            const app = fixture(child, { openRequest: { paths: ['/books/current.cbz'] } });
            app.dialog().onImageDropAvailabilityChange(true);
            const pending = deferred();
            app.api.stat = () => pending.promise;
            const event = dragEvent(['/tmp/promised.webp']);
            event.dataTransfer.files[0] = { path: '/tmp/promised.webp', name: 'promised.webp', type: 'image/webp', size: 0 };
            event.dataTransfer.getData = type => type === 'text/uri-list' ? 'https://i.namu.wiki/i/image.webp' : '';
            const dropping = app.root().onDrop(event);
            event.dataTransfer.getData = () => '';
            event.dataTransfer.files = [];
            if (statFailure === 'missing') pending.resolve(null);
            else pending.reject(new Error('promised file unavailable'));
            await dropping;
            app.render();
            assert.deepEqual(app.dialog().localImageRequest, { id: 1, url: 'https://i.namu.wiki/i/image.webp' });
            assert.deepEqual(app.paths(), ['/books/current.cbz']);
            assert.equal(app.dialog().externalBusy, false);
            assert.deepEqual(app.calls.toasts, []);
        });
    }
});

test('브라우저 임시 경로가 없어도 실제 File 데이터가 있으면 해당 이미지를 전달한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    app.api.stat = async () => null;
    const event = dragEvent(['/tmp/promised.webp']);
    const file = { path: '/tmp/promised.webp', name: 'promised.webp', type: 'image/webp', size: 128 };
    event.dataTransfer.files[0] = file;
    await app.root().onDrop(event);
    app.render();
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, file });
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.deepEqual(app.calls.toasts, []);
});

test('작업 또는 모달 결과 잠금 중에는 클립보드와 브라우저 이미지 요청을 보내지 않는다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    const file = { name: 'image.png', type: 'image/png' };
    const event = dragEvent([]);
    event.dataTransfer.files = [file];
    event.clipboardData = event.dataTransfer;
    event.target = { tagName: 'DIV' };
    for (const busy of [true, false]) {
        app.dialog().onBusyChange(busy);
        app.dialog().onImageDropAvailabilityChange(busy);
        app.root().onPaste(event);
        app.root().onDragOver(event);
        await app.root().onDrop(event);
        app.render();
        assert.equal(app.dialog().localImageRequest, null);
        assert.equal(event.dataTransfer.dropEffect, 'none');
    }
    assert.deepEqual(app.calls.toasts, []);
});

test('로컬 파일 경로는 같은 드래그에 포함된 브라우저 주소보다 우선한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    const event = dragEvent(['/covers/local.png']);
    event.dataTransfer.types.push('text/uri-list');
    event.dataTransfer.getData = type => type === 'text/uri-list' ? 'https://images.test/remote' : '';
    await app.root().onDrop(event);
    app.render();
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, path: '/covers/local.png' });
    assert.deepEqual(app.calls.stats, ['/covers/local.png']);
});

test('저장 완료 후 혼합 드롭은 작업 목록이 실제로 바뀔 때만 새 이미지 요청을 전달한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/saved.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(false);
    await app.root().onDrop(dragEvent(['/books/saved.cbz', '/covers/ignored.jpg']));
    app.render();
    assert.deepEqual(app.paths(), ['/books/saved.cbz']);
    assert.equal(app.dialog().localImageRequest, null);
    await app.root().onDrop(dragEvent(['/books/new.epub', '/covers/new.jpg']));
    app.render();
    assert.deepEqual(app.paths(), ['/books/saved.cbz', '/books/new.epub']);
    assert.deepEqual(app.dialog().localImageRequest, { id: 1, path: '/covers/new.jpg' });
    const appendedImage = app.dialog().localImageRequest;
    await app.root().onDrop(dragEvent(['/books/new.epub', '/covers/duplicate.jpg']));
    app.render();
    assert.deepEqual(app.paths(), ['/books/saved.cbz', '/books/new.epub']);
    assert.equal(app.dialog().localImageRequest, appendedImage);
    await app.root().onDrop(dragEvent(['/books/new.epub', '/covers/replaced.jpg'], false, 150));
    app.render();
    assert.deepEqual(app.paths(), ['/books/new.epub']);
    assert.deepEqual(app.dialog().localImageRequest, { id: 2, path: '/covers/replaced.jpg' });
    const replacedImage = app.dialog().localImageRequest;
    await app.root().onDrop(dragEvent(['/books/new.epub', '/covers/same-list.jpg'], false, 150));
    app.render();
    assert.deepEqual(app.paths(), ['/books/new.epub']);
    assert.equal(app.dialog().localImageRequest, replacedImage);
    assert.deepEqual(app.calls.toasts, []);
});

test('폴더 드롭은 실제 파일 종류를 조회하고 하위 책 파일만 목록에 추가한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/old.cbz'] } });
    app.api.stat = async path => { app.calls.stats.push(path); return path === '/incoming' ? { isDirectory: true } : { isFile: true }; };
    app.api.readDir = async path => {
        app.calls.reads.push(path);
        return path === '/incoming'
            ? [{ name: 'a.cbz', isFile: true }, { name: 'sub', isDirectory: true }, { name: 'cover.png', isFile: true }]
            : [{ name: 'b.epub', isFile: true }, { name: 'other.exe', isFile: true }];
    };
    await app.root().onDrop(dragEvent(['/incoming', '/incoming/a.cbz', '/incoming/unsupported.exe'], false, 150));
    app.render();
    assert.deepEqual(app.calls.stats, ['/incoming', '/incoming/a.cbz', '/incoming/unsupported.exe']);
    assert.deepEqual(app.calls.reads, ['/incoming', '/incoming/sub']);
    assert.deepEqual(app.paths(), ['/incoming/a.cbz', '/incoming/sub/b.epub']);
    assert.equal(app.dialog().localImageRequest, null);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_tool_unsupported', values: [1] }]);
});

test('호버 안내는 영역을 벗어나거나 드래그가 끝나거나 작업이 시작되면 사라진다', t => {
    const app = fixture(t);
    const event = dragEvent(['/books/book.cbz']);
    app.root().onDragEnter(event);
    app.render();
    assert.ok(app.overlay());
    app.root().onDragLeave({ currentTarget: { contains: () => true }, relatedTarget: {} });
    app.render();
    assert.ok(app.overlay());
    app.root().onDragLeave(event);
    app.render();
    assert.equal(app.overlay(), undefined);
    app.root().onDragOver(event);
    app.render();
    app.root().onDragEnd();
    app.render();
    assert.equal(app.overlay(), undefined);
    app.root().onDragOver(event);
    app.render();
    app.dialog().onBusyChange(true);
    app.render();
    assert.equal(app.overlay(), undefined);
});

test('작업 중 드롭은 파일 조회와 이미지 요청을 시작하지 않는다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.dialog().onImageDropAvailabilityChange(true);
    app.dialog().onBusyChange(true);
    app.render();
    for (const path of ['/books/new.epub', '/covers/new.png']) {
        const event = dragEvent([path], false, 150);
        app.root().onDragOver(event);
        await app.root().onDrop(event);
        app.render();
        assert.equal(event.dataTransfer.dropEffect, 'none');
        assert.equal(app.overlay(), undefined);
    }
    assert.deepEqual(app.calls.stats, []);
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.equal(app.dialog().localImageRequest, null);
});

test('지연된 드롭은 대상 변경·작업 시작·이탈·unmount 이후 목록과 이미지를 갱신하지 않는다', async t => {
    for (const invalidation of ['replace', 'busy', 'back', 'unmount']) {
        await t.test(invalidation, async child => {
            const app = fixture(child, { openRequest: { paths: ['/books/current.cbz'] } });
            app.dialog().onImageDropAvailabilityChange(true);
            const pending = deferred();
            app.api.stat = () => pending.promise;
            const event = dragEvent(['/books/late.epub', '/covers/late.png'], false, 150);
            const dropping = app.root().onDrop(event);
            app.render();
            assert.equal(app.dialog().externalBusy, true);
            if (invalidation === 'replace') app.update({ openRequest: { paths: ['/books/latest.pdf'], mode: 'replace' } });
            if (invalidation === 'busy') app.dialog().onBusyChange(true);
            if (invalidation === 'back') app.dialog().onClose();
            if (invalidation === 'unmount') app.unmount();
            pending.resolve({ isFile: true });
            await dropping;
            app.render();
            assert.deepEqual(app.paths(), invalidation === 'replace' ? ['/books/latest.pdf'] : ['/books/current.cbz']);
            assert.equal(app.dialog().localImageRequest, null);
            assert.deepEqual(app.calls.toasts, []);
            assert.equal(app.calls.updatesAfterUnmount, 0);
            if (invalidation !== 'unmount') assert.equal(app.dialog().externalBusy, false);
            else assert.equal(app.toolbar().fileActionsEnabled, false);
        });
    }
});

test('드롭 파일 조회 실패는 기존 목록을 유지하며 수집 잠금을 해제한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/current.cbz'] } });
    app.api.stat = async () => { throw new Error('unavailable file'); };
    await app.root().onDrop(dragEvent(['/books/removed.epub'], false, 150));
    app.render();
    assert.deepEqual(app.paths(), ['/books/current.cbz']);
    assert.equal(app.dialog().externalBusy, false);
    assert.equal(app.toolbar().fileActionsBusy, false);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_tool_add_failed', values: ['unavailable file'] }]);
});

test('작업 중 전달 요청을 순서대로 보관하고 작업 종료 후 한 번만 반영한다', t => {
    const app = fixture(t, { openRequest: { paths: ['/books/initial.cbz'] } });
    app.dialog().onBusyChange(true);
    app.render();
    assert.equal(app.beforeLeave(), false);
    app.update({ openRequest: { paths: ['/books/discarded.epub'], mode: 'append' } });
    app.update({ openRequest: { paths: ['/books/replaced.pdf'], mode: 'replace' } });
    const lastRequest = { paths: ['/books/final.txt'], mode: 'append' };
    app.update({ openRequest: lastRequest });
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    app.dialog().onBusyChange(false);
    app.render();
    assert.equal(app.beforeLeave(), true);
    assert.deepEqual(app.paths(), ['/books/replaced.pdf', '/books/final.txt']);
    app.action('clear-all');
    app.update({ openRequest: lastRequest });
    assert.deepEqual(app.paths(), []);
});

test('폴더에서 빈 목록으로 전달하거나 지원 파일이 없으면 추가 방식을 묻지 않는다', t => {
    const app = fixture(t, { openRequest: { paths: ['/books/initial.cbz'], source: 'folder' } });
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    app.update({ openRequest: { paths: ['/books/unsupported.png'], source: 'folder' } });
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_tool_unsupported', values: [1] }]);
    app.update({ openRequest: { paths: ['/books/navigation.epub'], source: 'navigation' } });
    app.update({ openRequest: { paths: ['/books/drop.pdf'], source: 'drop' } });
    assert.deepEqual(app.paths(), ['/books/initial.cbz', '/books/navigation.epub', '/books/drop.pdf']);
    assert.deepEqual(app.calls.messages, []);
});

test('폴더 전달의 추가·교체·취소 선택을 적용하고 기존 선택과 편집 설정을 유지한다', async t => {
    for (const choice of ['append', 'replace', 'cancel', undefined]) {
        await t.test(String(choice), async t => {
            const app = fixture(t, { config: { language: 'en' }, openRequest: { paths: ['/books/initial.cbz', '/books/shared.epub'] } });
            app.dialog().onToggleFile('/books/shared.epub');
            app.render();
            const session = app.dialog().key;
            const initialFiles = app.dialog().files;
            const preferences = { mode: 'add', backup: false, renumber: true };
            app.dialog().onPreferencesChange(preferences);
            app.render();
            app.api.showMessage = async options => { app.calls.messages.push(options); return choice; };
            app.update({ openRequest: { paths: ['/books/shared.epub', '/books/new.pdf'], source: 'folder' } });
            assert.deepEqual(app.dialog().files, initialFiles);
            await app.flush();
            assert.deepEqual(app.calls.messages, [{
                type: 'question', title: 'dialog_add_mode_title', message: 'cover_editor_tool_existing_files',
                buttons: 'append-replace-cancel', defaultChoice: 'append', language: 'en',
            }]);
            const expected = choice === 'append' ? ['/books/initial.cbz', '/books/shared.epub', '/books/new.pdf']
                : choice === 'replace' ? ['/books/shared.epub', '/books/new.pdf'] : ['/books/initial.cbz', '/books/shared.epub'];
            assert.deepEqual(app.paths(), expected);
            assert.equal(app.dialog().files.find(file => file.path === '/books/shared.epub').checked, false);
            if (choice !== 'append' && choice !== 'replace') assert.equal(app.dialog().files, initialFiles);
            assert.equal(app.dialog().key, session);
            assert.equal(app.dialog().preferences, preferences);
            assert.equal(app.toolbar().fileActionsBusy, false);
        });
    }
});

test('검사 중 도착한 폴더 요청은 완료 후 하나씩 묻고 선택한 순서대로 적용한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/initial.cbz'] } });
    const choices = [deferred(), deferred()];
    app.api.showMessage = options => {
        const index = app.calls.messages.length;
        app.calls.messages.push(options);
        return choices[index].promise;
    };
    app.dialog().onBusyChange(true);
    app.render();
    app.update({ openRequest: { paths: ['/books/first.epub'], source: 'folder' } });
    assert.equal(app.calls.messages.length, 0);
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    app.dialog().onBusyChange(false);
    app.render();
    assert.equal(app.calls.messages.length, 1);
    app.update({ openRequest: { paths: ['/books/second.pdf'], source: 'folder' } });
    assert.equal(app.calls.messages.length, 1);
    choices[0].resolve('replace');
    await app.flush();
    assert.equal(app.calls.messages.length, 2);
    assert.deepEqual(app.paths(), ['/books/first.epub']);
    choices[1].resolve('append');
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/first.epub', '/books/second.pdf']);
    assert.equal(app.toolbar().fileActionsBusy, false);
});

test('선택 대기 중 검사가 시작되면 응답을 보관하고 검사 종료 후 다시 묻지 않고 적용한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/initial.cbz'] } });
    const choice = deferred();
    app.api.showMessage = options => { app.calls.messages.push(options); return choice.promise; };
    app.update({ openRequest: { paths: ['/books/replacement.epub'], source: 'folder' } });
    app.dialog().onBusyChange(true);
    app.render();
    choice.resolve('replace');
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    assert.equal(app.toolbar().fileActionsBusy, true);
    app.dialog().onBusyChange(false);
    app.render();
    assert.deepEqual(app.paths(), ['/books/replacement.epub']);
    assert.equal(app.calls.messages.length, 1);
    assert.equal(app.toolbar().fileActionsBusy, false);
});

test('폴더 수집 중 받은 전달은 수집 완료 후 기존 목록과 함께 확인한다', async t => {
    const app = fixture(t);
    const read = deferred();
    app.api.selectFolder = async () => '/books';
    app.api.readDir = () => read.promise;
    app.action('add-folder');
    await app.flush();
    app.update({ openRequest: { paths: ['/books/transferred.epub'], source: 'folder' } });
    assert.deepEqual(app.calls.messages, []);
    assert.deepEqual(app.paths(), []);
    read.resolve([{ name: 'collected.cbz', isFile: true }]);
    await app.flush();
    assert.equal(app.calls.messages.length, 1);
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/collected.cbz']);
    assert.equal(app.toolbar().fileActionsBusy, false);
});

test('추가 방식 선택 중 목록 조작·저장·이탈을 막고 늦은 파일 선택을 무시한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/initial.cbz'] } });
    const picker = deferred();
    const choice = deferred();
    app.api.selectFiles = () => { app.calls.picks.push([]); return picker.promise; };
    app.action('add-file');
    app.api.showMessage = options => { app.calls.messages.push(options); return choice.promise; };
    app.update({ openRequest: { paths: ['/books/new.epub'], source: 'folder' } });
    assert.equal(app.toolbar().fileActionsBusy, true);
    assert.equal(app.beforeLeave(), false);
    const session = app.dialog().key;
    app.dialog().onClose();
    app.dialog().onReset();
    app.dialog().onToggleFile('/books/initial.cbz');
    app.dialog().onRemoveFile('/books/initial.cbz');
    for (const action of ['add-file', 'add-folder', 'clear-all', 'remove-selected', 'toggle-all']) app.action(action);
    assert.deepEqual(await app.dialog().onExecute({ filePath: '/books/initial.cbz' }), { success: false, error: 'cover_editor_saving' });
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    assert.deepEqual(app.checkedPaths(), ['/books/initial.cbz']);
    assert.equal(app.dialog().key, session);
    assert.equal(app.calls.backs, 0);
    assert.equal(app.calls.picks.length, 1);
    assert.equal(app.calls.folderPicks.length, 0);
    assert.deepEqual(app.calls.applies, []);
    picker.resolve(['/books/stale.pdf']);
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    choice.resolve('append');
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/initial.cbz', '/books/new.epub']);
    assert.equal(app.beforeLeave(), true);
    assert.equal(app.toolbar().fileActionsBusy, false);
});

test('추가 방식 대화상자 실패 시 목록을 보존하고 다음 요청은 처리한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/initial.cbz'] } });
    app.api.showMessage = async () => { throw new Error('dialog closed'); };
    app.update({ openRequest: { paths: ['/books/rejected.epub'], source: 'folder' } });
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/initial.cbz']);
    assert.deepEqual(app.calls.toasts, [{ key: 'cover_editor_tool_add_failed', values: ['dialog closed'] }]);
    assert.equal(app.toolbar().fileActionsBusy, false);
    app.api.showMessage = async () => 'replace';
    app.update({ openRequest: { paths: ['/books/accepted.pdf'], source: 'folder' } });
    await app.flush();
    assert.deepEqual(app.paths(), ['/books/accepted.pdf']);
});

test('unmount 이후 추가 방식 응답이나 실패로 상태와 알림을 갱신하지 않는다', async t => {
    for (const reject of [false, true]) {
        await t.test(reject ? 'failure' : 'success', async t => {
            const app = fixture(t, { openRequest: { paths: ['/books/initial.cbz'] } });
            const choice = deferred();
            app.api.showMessage = () => choice.promise;
            app.update({ openRequest: { paths: ['/books/new.epub'], source: 'folder' } });
            app.unmount();
            if (reject) choice.reject(new Error('window closed'));
            else choice.resolve('replace');
            await app.flush();
            assert.equal(app.calls.updatesAfterUnmount, 0);
            assert.deepEqual(app.calls.toasts, []);
            assert.deepEqual(app.paths(), ['/books/initial.cbz']);
        });
    }
});

test('늦게 도착한 파일 선택은 최신 대상 변경과 뒤로 가기 이후 무시한다', async t => {
    const app = fixture(t);
    for (const invalidate of [
        () => app.update({ openRequest: { paths: ['/books/current.cbz'], mode: 'replace' } }),
        () => app.dialog().onRemoveFile('/books/current.cbz'),
        () => app.action('clear-all'),
        () => app.dialog().onClose(),
        () => app.dialog().onBusyChange(true),
    ]) {
        const pending = deferred();
        app.api.selectFiles = () => pending.promise;
        app.action('add-file');
        invalidate();
        app.render();
        const previous = app.paths();
        pending.resolve(['/books/stale.epub']);
        await app.flush();
        assert.deepEqual(app.paths(), previous);
    }
    assert.equal(app.calls.backs, 1);
    assert.deepEqual(app.calls.toasts, []);
});

test('unmount 시 이탈·창 닫기 listener를 해제하고 native 선택의 늦은 성공·오류를 무시한다', async t => {
    const app = fixture(t);
    const oldSelection = deferred();
    const newSelection = deferred();
    let count = 0;
    app.api.selectFiles = () => count++ ? newSelection.promise : oldSelection.promise;
    app.action('add-file');
    app.action('add-file');
    assert.equal(app.listeners('beforeunload'), 1);
    assert.equal(app.listeners('bookmanager:action'), 1);
    app.unmount();
    oldSelection.resolve(['/books/stale.cbz']);
    newSelection.reject(new Error('window closed'));
    await app.flush();
    assert.equal(app.listeners('beforeunload'), 0);
    assert.equal(app.listeners('bookmanager:action'), 0);
    assert.deepEqual(app.toolbar(), { tabId: 'tools', totalCount: 0, checkedCount: 0, hasItems: false, allChecked: true, fileActionsEnabled: false });
    assert.equal(app.beforeLeave(), undefined);
    assert.equal(app.calls.updatesAfterUnmount, 0);
    assert.deepEqual(app.calls.toasts, []);
});

test('저장된 false 설정을 전달하고 새 전체 옵션을 즉시 유지하며 저장 실패를 알린다', async t => {
    const app = fixture(t);
    assert.deepEqual(app.dialog().preferences, { mode: 'replace', backup: false, renumber: false });
    const first = { mode: 'add', backup: true, renumber: true };
    const last = { mode: 'add', backup: false, renumber: false };
    app.dialog().onPreferencesChange(first);
    app.dialog().onPreferencesChange(last);
    app.render();
    assert.equal(app.dialog().preferences, last);
    await app.flush();
    assert.deepEqual(app.calls.preferences, [{ folder_cover_editor_options: first }, { folder_cover_editor_options: last }]);
    app.update({ config: { folder_cover_editor_options: first } });
    assert.equal(app.dialog().preferences, last);
    app.props.saveConfig = async () => { throw new Error('disk full'); };
    app.render();
    app.dialog().onPreferencesChange(last);
    await app.flush();
    assert.deepEqual(app.calls.toasts, [{ key: 'config_save_failed', values: { msg: 'disk full' } }]);
});

test('저장 중 동기 이탈·닫기·중복 실행·대상 변경을 막고 완료 후 보호를 해제한다', async t => {
    const app = fixture(t, { openRequest: { paths: ['/books/a.cbz'] } });
    const pending = deferred();
    app.api.applyCoverEditor = request => { app.calls.applies.push(request); return pending.promise; };
    const request = { filePath: '/books/a.cbz', image: { id: 'selected' }, mode: 'replace' };
    const saving = app.dialog().onExecute(request);
    assert.equal(app.beforeLeave(), false);
    const unload = app.unload();
    assert.equal(unload.prevented, true);
    assert.equal(unload.returnValue, '');
    const session = app.dialog().key;
    app.dialog().onClose();
    app.dialog().onToggleFile('/books/a.cbz');
    app.dialog().onToggleAll();
    app.dialog().onRemoveFile('/books/a.cbz');
    app.action('remove-selected');
    app.action('clear-all');
    app.action('toggle-all');
    app.dialog().onReset();
    app.action('add-file');
    app.action('add-folder');
    assert.deepEqual(await app.dialog().onExecute(request), { success: false, error: 'cover_editor_saving' });
    app.render();
    assert.deepEqual(app.paths(), ['/books/a.cbz']);
    assert.equal(app.dialog().key, session);
    assert.equal(app.calls.backs, 0);
    assert.equal(app.calls.picks.length, 0);
    assert.equal(app.calls.folderPicks.length, 0);
    assert.deepEqual(app.checkedPaths(), ['/books/a.cbz']);
    assert.deepEqual(app.calls.applies, [request]);
    pending.resolve({ success: true, filePath: '/books/a.cbz' });
    assert.equal((await saving).success, true);
    assert.equal(app.beforeLeave(), true);
    assert.equal(app.unload().prevented, false);
    app.dialog().onClose();
    assert.equal(app.calls.backs, 1);
});

test('배치 저장은 순차 진행하고 취소 이후 대상을 건너뛰며 실제 출력 경로의 읽기 상태와 갱신 이벤트를 반영한다', async t => {
    const app = fixture(t);
    const sourcePath = '/books/source.cbr';
    const filePath = '/books/source.cbz';
    app.storage.set(`bookmanager-viewer-state:${sourcePath}`, JSON.stringify({ pageIndex: 1, pageCount: 2, locator: { kind: 'page', pageIndex: 1 } }));
    app.storage.set(`bookmanager-viewer-bookmarks:${sourcePath}`, JSON.stringify([{ pageIndex: 1, label: '2p - saved' }]));
    app.storage.set(`bookmanager-viewer-comic-flow:${sourcePath}`, JSON.stringify(['old.jpg']));
    const pending = deferred();
    app.api.applyCoverEditor = request => { app.calls.applies.push(request); return pending.promise; };
    const progress = [];
    let cancelled = false;
    const saving = app.dialog().onExecute([
        { filePath: sourcePath }, { filePath: sourcePath }, { filePath: '/books/next.epub' }, { filePath: '/books/last.pdf' },
    ], { shouldCancel: () => cancelled, onProgress: update => { progress.push(update); cancelled = true; } });
    assert.equal(app.calls.applies.length, 1);
    pending.resolve({ success: true, filePath, readingAdjustment: { sourcePath, filePath, format: 'comic', pageIndexMap: [1, 2], pageCount: 3, entryMap: { 'old.jpg': '0002.jpg' } } });
    const result = await saving;
    assert.equal(result.successCount, 1);
    assert.equal(result.failureCount, 0);
    assert.equal(result.cancelledCount, 2);
    assert.deepEqual(app.calls.sounds, []);
    assert.equal(app.calls.applies.length, 1);
    assert.equal(progress.length, 1);
    assert.deepEqual({ completed: progress[0].completed, total: progress[0].total, filePath: progress[0].filePath }, { completed: 1, total: 3, filePath: sourcePath });
    const state = JSON.parse(app.storage.get(`bookmanager-viewer-state:${filePath}`));
    assert.equal(state.pageIndex, 2);
    assert.equal(state.locator.pageIndex, 2);
    assert.equal(state.pageCount, 3);
    assert.deepEqual(JSON.parse(app.storage.get(`bookmanager-viewer-bookmarks:${filePath}`)), [{ pageIndex: 2, coverEditPageIndex: 2, label: '3p - saved' }]);
    assert.deepEqual(JSON.parse(app.storage.get(`bookmanager-viewer-comic-flow:${filePath}`)), ['0002.jpg']);
    assert.equal(JSON.parse(app.storage.get(`bookmanager-viewer-state:${sourcePath}`)).pageIndex, 1);
    assert.deepEqual(app.calls.events.filter(event => event.type === 'bookmanager:metadata-saved').map(event => event.detail), [{ paths: [filePath] }]);
});

test('배치 일부 실패 이후 다음 저장을 계속하고 성공 출력만 갱신한다', async t => {
    const app = fixture(t);
    app.api.applyCoverEditor = async request => {
        app.calls.applies.push(request);
        if (request.filePath.endsWith('bad.pdf')) throw new Error('locked');
        if (request.filePath.endsWith('failed.epub')) return { success: false, error: 'invalid archive' };
        return { success: true, filePath: '/books/converted.cbz' };
    };
    const progress = [];
    const result = await app.dialog().onExecute(['/books/bad.pdf', '/books/failed.epub', '/books/good.cbr'].map(filePath => ({ filePath })), { onProgress: update => progress.push(update.completed) });
    assert.equal(result.failureCount, 2);
    assert.equal(result.successCount, 1);
    assert.deepEqual(app.calls.sounds, ['Default.wav']);
    assert.deepEqual(progress, [1, 2, 3]);
    assert.deepEqual(app.metadataEvents(), [{ paths: ['/books/converted.cbz'] }]);
    assert.equal(app.beforeLeave(), true);
});

test('읽기 상태 저장 실패는 표지 저장 성공을 유지하며 단일 저장 예외도 이탈 보호를 해제한다', async t => {
    const app = fixture(t);
    const filePath = '/books/book.cbz';
    app.storage.set(`bookmanager-viewer-state:${filePath}`, JSON.stringify({ pageIndex: 0, pageCount: 1 }));
    const original = window.localStorage.setItem;
    let failOnce = true;
    window.localStorage.setItem = (key, value) => { if (failOnce) { failOnce = false; throw new Error('quota exceeded'); } original(key, value); };
    app.api.applyCoverEditor = async () => ({ success: true, filePath, readingAdjustment: { sourcePath: filePath, filePath, format: 'comic', pageOffset: 1, pageCount: 2 } });
    const saved = await app.dialog().onExecute({ filePath });
    assert.equal(saved.success, true);
    assert.equal(saved.readingWarning, 'cover_editor_reading_save_failed quota exceeded');
    assert.deepEqual(app.metadataEvents(), [{ paths: [filePath] }]);
    assert.equal(JSON.parse(app.storage.get(`bookmanager-viewer-state:${filePath}`)).pageIndex, 0);
    app.api.applyCoverEditor = async () => { throw new Error('write failed'); };
    await assert.rejects(app.dialog().onExecute({ filePath }), /write failed/);
    assert.equal(app.beforeLeave(), true);
    assert.equal(app.unload().prevented, false);
    assert.equal(app.calls.events.filter(event => event.type === 'bookmanager:metadata-saved').length, 1);
});

test('단일 표지 저장 완료음은 현재 설정의 파일과 활성화 여부를 따른다', async t => {
    const app = fixture(t, { config: { play_sound: true, completion_sound: 'Bell.wav' } });
    const request = { filePath: '/books/book.cbz' };
    assert.equal((await app.dialog().onExecute(request)).success, true);
    assert.deepEqual(app.calls.sounds, ['Bell.wav']);
    app.update({ config: { play_sound: false, completion_sound: 'Bell.wav' } });
    assert.equal((await app.dialog().onExecute(request)).success, true);
    assert.deepEqual(app.calls.sounds, ['Bell.wav']);
    app.update({ config: {} });
    assert.equal((await app.dialog().onExecute(request)).success, true);
    assert.deepEqual(app.calls.sounds, ['Bell.wav', 'Default.wav']);
});

test('일괄 표지 저장 완료음은 모든 파일을 처리한 뒤 한 번만 재생한다', async t => {
    const app = fixture(t);
    const pending = deferred();
    const apply = app.api.applyCoverEditor;
    app.api.applyCoverEditor = request => request.filePath.endsWith('last.cbz') ? pending.promise : apply(request);
    const saving = app.dialog().onExecute([{ filePath: '/books/first.cbz' }, { filePath: '/books/last.cbz' }]);
    await app.flush();
    assert.deepEqual(app.calls.sounds, []);
    pending.resolve({ success: true, filePath: '/books/last.cbz' });
    assert.equal((await saving).successCount, 2);
    assert.deepEqual(app.calls.sounds, ['Default.wav']);
});

test('저장 성공이 없거나 취소된 작업에는 완료음을 재생하지 않는다', async t => {
    const app = fixture(t);
    const request = { filePath: '/books/book.cbz' };
    app.api.applyCoverEditor = async () => ({ success: false, error: 'write failed' });
    assert.equal((await app.dialog().onExecute(request)).success, false);
    assert.equal((await app.dialog().onExecute([request])).failureCount, 1);
    assert.equal((await app.dialog().onExecute([])).successCount, 0);
    app.api.applyCoverEditor = async () => ({ success: false, cancelled: true });
    assert.equal((await app.dialog().onExecute(request)).cancelled, true);
    assert.equal((await app.dialog().onExecute([request], { shouldCancel: () => true })).cancelledCount, 1);
    app.api.applyCoverEditor = async () => { throw new Error('write failed'); };
    await assert.rejects(app.dialog().onExecute(request), /write failed/);
    await app.flush();
    assert.deepEqual(app.calls.sounds, []);
});

test('완료음 지연이나 재생 오류는 표지 저장 결과와 이탈 보호 해제를 방해하지 않는다', async t => {
    for (const failure of ['rejection', 'throw']) {
        await t.test(failure, async child => {
            const app = fixture(child);
            const pending = deferred();
            app.api.playSound = () => {
                if (failure === 'throw') throw new Error('audio unavailable');
                return pending.promise;
            };
            const filePath = '/books/book.cbz';
            assert.deepEqual(await app.dialog().onExecute({ filePath }), { success: true, filePath });
            assert.equal(app.beforeLeave(), true);
            assert.deepEqual(app.metadataEvents(), [{ paths: [filePath] }]);
            if (failure === 'rejection') pending.reject(new Error('audio unavailable'));
            await app.flush();
            assert.deepEqual(app.calls.toasts, []);
        });
    }
});
