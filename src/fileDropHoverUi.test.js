import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canAcceptGlobalDrop, isExternalFileDrag, normalizeDroppedPaths } from './appShell.js';
import { classifyDroppedEntries, resolveMetadataDropPaths } from './dropPolicy.js';
import { translate } from './utils/i18n.js';

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const appStyles = readFileSync(new URL('./styles/App.css', import.meta.url), 'utf8');
const folderSource = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');

function declarationBlock(source, start, end) {
    const startIndex = source.indexOf(`const ${start} =`);
    const endIndex = source.indexOf(`const ${end} =`, startIndex);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} handler block exists`);
    return source.slice(startIndex, endIndex);
}

const dropHandlers = `${declarationBlock(appSource, 'resetFileDropHover', 'handleSettingsClose')}
${declarationBlock(folderSource, 'handleDroppedPaths', 'deleteSelectedFiles')}
return { handleGlobalDragEnter, handleGlobalDragOver, handleGlobalDrop, handleDroppedPaths };`;

function dropFixture(options = {}) {
    let modalOpen = false;
    let hoverTab = null;
    const depth = { current: 0 };
    const calls = { stat: [], dispatch: [], open: [], navigate: [], warning: [], timers: [] };
    const dependencies = {
        document: { querySelector: selector => selector === '.cover-editor-backdrop' && modalOpen ? {} : null },
        window: {
            electronAPI: {
                stat: async filePath => {
                    calls.stat.push(filePath);
                    return options.stat ? options.stat(filePath) : { isFile: true };
                },
                showMessage: async message => {
                    calls.warning.push(message);
                    return options.warning?.(message);
                },
            },
            setTimeout: callback => { calls.timers.push(callback); },
        },
        useCallback: callback => callback,
        useEffect: () => {},
        activeTab: 'folder',
        dropInteractionBlocked: false,
        fileDropHoverEnabled: true,
        fileDragDepthRef: depth,
        setFileDropHoverTab: value => { hoverTab = value; },
        canAcceptGlobalDrop,
        isExternalFileDrag,
        normalizeDroppedPaths,
        classifyDroppedEntries,
        resolveMetadataDropPaths,
        dispatchTabAction: (...args) => calls.dispatch.push(args),
        openFileInViewer: async filePath => { calls.open.push(filePath); },
        handleFolderChange: async filePath => { calls.navigate.push(filePath); },
        showToast: () => {},
        t: key => key,
        language: 'ko',
    };
    const handlers = new Function(...Object.keys(dependencies), dropHandlers)(...Object.values(dependencies));
    return {
        ...handlers, calls, depth,
        setModalOpen: value => { modalOpen = value; },
        hoverTab: () => hoverTab,
    };
}

function fileDrag(paths = ['/library/book.epub']) {
    return {
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        dataTransfer: { types: ['Files'], files: paths.map(path => ({ path })), dropEffect: 'copy' },
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('드롭을 허용하는 작업 탭은 외부 파일 드래그 중 공통 드롭존 오버레이를 표시한다', () => {
    assert.match(appSource, /const dropInteractionBlocked = isAppLocked \|\| showSettings/);
    assert.match(appSource, /fileDropHoverEnabled = canAcceptGlobalDrop\(activeTab, dropInteractionBlocked\)/);
    assert.match(appSource, /canAcceptGlobalDrop\(activeTab, dropInteractionBlocked\)/);
    assert.match(appSource, /isExternalFileDrag\(event\.dataTransfer\)/);
    assert.match(appSource, /showFileDropHover && <FileDropHoverOverlay opensViewer=\{activeTab === 'folder'\} t=\{t\} \/>/);
    assert.match(appSource, /role="status"/);
    assert.match(appSource, /aria-live="polite"/);
});

test('폴더 탭 드롭존은 파일이 뷰어로 열린다는 안내를 구분해 표시한다', () => {
    assert.match(appSource, /name=\{opensViewer \? 'bookOpen' : 'fileCirclePlus'\}/);
    assert.match(appSource, /t\(opensViewer \? 'folder\.drop\.open_in_viewer' : 'drag_drop'\)/);
    assert.match(appSource, /opensViewer \? 'is-viewer-open' : ''/);
    assert.match(appStyles, /\.app-file-drop-hover\.is-viewer-open\s*\{/);

    const expected = {
        ko: '지원 파일은 뷰어로 열고, 폴더는 해당 위치로 이동합니다',
        en: 'Drop a supported file to open it in the viewer, or a folder to navigate to it',
        ja: '対応ファイルはビューアで開き、フォルダーはその場所へ移動します',
    };
    for (const [language, message] of Object.entries(expected)) {
        assert.equal(translate('folder.drop.open_in_viewer', language), message);
        assert.notEqual(translate('folder.drop.first_file_only', language), 'folder.drop.first_file_only');
    }
});

test('중첩 드롭존 이동과 드롭 완료 시 호버 상태를 안정적으로 초기화한다', () => {
    assert.match(appSource, /fileDragDepthRef\.current \+= 1/);
    assert.match(appSource, /Math\.max\(0, fileDragDepthRef\.current - 1\)/);
    assert.match(appSource, /onDragEnter=\{handleGlobalDragEnter\}/);
    assert.match(appSource, /onDragLeave=\{handleGlobalDragLeave\}/);
    assert.match(appSource, /onDragEnd=\{resetFileDropHover\}/);
    assert.match(appSource, /const handleGlobalDrop = useCallback\(async \(event\) => \{\s+event\.preventDefault\(\);\s+resetFileDropHover\(\);/);
});

test('드롭존 효과는 입력을 막지 않고 모션 감소 설정을 따른다', () => {
    assert.match(appStyles, /\.app-file-drop-hover\s*\{[^}]*border:\s*2px dashed[^}]*pointer-events:\s*none/s);
    assert.match(appStyles, /@keyframes app-file-drop-hover-in/);
    assert.match(appStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-file-drop-hover\s*\{\s*animation:\s*none;/);
});

test('커버 모달이 열리면 전역 파일 호버와 드롭을 차단하고 닫으면 다시 허용한다', async () => {
    const value = dropFixture();
    value.handleGlobalDragEnter(fileDrag());
    value.handleGlobalDragEnter(fileDrag());
    assert.equal(value.hoverTab(), 'folder');
    assert.equal(value.depth.current, 2);
    value.setModalOpen(true);
    value.handleGlobalDragEnter(fileDrag());
    assert.equal(value.hoverTab(), null);
    assert.equal(value.depth.current, 0);
    const over = fileDrag();
    value.handleGlobalDragOver(over);
    assert.equal(over.defaultPrevented, true);
    assert.equal(over.dataTransfer.dropEffect, 'none');
    assert.equal(value.hoverTab(), null);
    const drop = fileDrag();
    await value.handleGlobalDrop(drop);
    assert.equal(drop.defaultPrevented, true);
    assert.deepEqual(value.calls.stat, []);
    assert.deepEqual(value.calls.dispatch, []);
    value.setModalOpen(false);
    value.handleGlobalDragEnter(fileDrag());
    value.handleGlobalDragOver(over);
    assert.equal(value.hoverTab(), 'folder');
    assert.equal(over.dataTransfer.dropEffect, 'copy');
    await value.handleGlobalDrop(fileDrag());
    assert.deepEqual(value.calls.dispatch, [['folder', { action: 'drop-paths', activeTab: 'folder', paths: ['/library/book.epub'] }]]);
    assert.equal(value.hoverTab(), null);
    assert.equal(value.depth.current, 0);
});

test('전역 드롭의 파일 조회 또는 경고 응답을 기다리는 동안 열린 커버 모달을 재확인한다', async () => {
    for (const phase of ['stat', 'warning']) {
        const pending = deferred();
        const started = deferred();
        const value = dropFixture({ [phase]: () => { started.resolve(); return pending.promise; } });
        const dropping = value.handleGlobalDrop(fileDrag(['/library/book.epub', '/images/cover.png']));
        await started.promise;
        value.setModalOpen(true);
        pending.resolve({ isFile: true });
        await dropping;
        assert.deepEqual(value.calls.dispatch, [], phase);
        assert.equal(value.calls.warning.length, phase === 'warning' ? 1 : 0);
    }
});

test('폴더 탭의 직접 드롭 요청과 비동기 파일 조회 이후에도 커버 모달 뒤의 뷰어를 열지 않는다', async () => {
    const blocked = dropFixture();
    blocked.setModalOpen(true);
    await blocked.handleDroppedPaths(['/library/book.epub']);
    assert.deepEqual(blocked.calls.stat, []);
    for (const stat of [{ isFile: true }, { isDirectory: true }]) {
        const pending = deferred();
        const value = dropFixture({ stat: () => pending.promise });
        const dropping = value.handleDroppedPaths(['/library/book.epub']);
        value.setModalOpen(true);
        pending.resolve(stat);
        await dropping;
        assert.deepEqual(value.calls.open, []);
        assert.deepEqual(value.calls.navigate, []);
        assert.deepEqual(value.calls.timers, []);
    }
    const value = dropFixture();
    const dropping = value.handleDroppedPaths(['/library/book.epub']);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(value.calls.timers.length, 1);
    value.setModalOpen(true);
    value.calls.timers.shift()();
    await dropping;
    assert.deepEqual(value.calls.open, []);
    value.setModalOpen(false);
    const reopened = value.handleDroppedPaths(['/library/book.epub']);
    await new Promise(resolve => setImmediate(resolve));
    value.calls.timers.shift()();
    await reopened;
    assert.deepEqual(value.calls.open, ['/library/book.epub']);
});
