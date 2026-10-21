import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hasPrimaryModifier, isShortcutKey, isTextEntryTarget, shouldHandleGlobalShortcut } from './interactionPolicy.js';
import { adjacentSelectionAfterRemoval } from './metadataPolicy.js';

const organizerSource = readFileSync(new URL('./tabs/OrganizerTab.jsx', import.meta.url), 'utf8');
const metadataSource = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');

function between(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `Missing handler: ${startMarker}`);
    return source.slice(start, end);
}

function loadHandler(source, name, endMarker, scope, helpers = '') {
    const body = between(source, `const ${name} =`, endMarker);
    return new Function(...Object.keys(scope), `${helpers}\n${body}\nreturn ${name};`)(...Object.values(scope));
}

function supportDialogDocument() {
    const layer = { classes: new Set(['app-support-dialog-layer']) };
    return {
        setOpen(open) {
            if (open) layer.classes.add('is-open');
            else layer.classes.delete('is-open');
        },
        querySelector(selector) {
            assert.ok(selector.startsWith('.'), `Unexpected selector: ${selector}`);
            return selector.slice(1).split('.').every(name => layer.classes.has(name)) ? layer : null;
        },
    };
}

function keyEvent(key, extra = {}) {
    return {
        key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
        target: { tagName: 'DIV' }, defaultPrevented: false, repeat: false,
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...extra,
    };
}

function metadataHelpers() {
    return between(metadataSource, 'function isMetadataTextInput(', 'function groupItems(')
        + between(metadataSource, 'function metadataTreeNodeKey(', 'function metadataModifiedDate(');
}

test('정리 화면 단축키는 닫힌 Git스타 레이어를 허용하고 열린 동안만 차단한다', () => {
    for (const runtimePlatform of ['MacIntel', 'Win32']) {
        const document = supportDialogDocument();
        const calls = [];
        const handler = loadHandler(organizerSource, 'handleOrganizerKeyDown', 'const handleTreeBodyKeyDown', {
            document, runtimePlatform, hasPrimaryModifier, isShortcutKey, shouldHandleGlobalShortcut,
            useCallback: callback => callback, isWorking: false, showVolumeRenameDialog: false,
            selectedVolumeRows: [{}],
            handleSelectAllItemRows: () => calls.push('select-all'),
            moveItemSelection: direction => calls.push(`move:${direction}`),
            setSelectedItemsExpanded: expanded => { calls.push(`expand:${expanded}`); return true; },
            selectEdgeItem: edge => calls.push(edge),
            handleRemoveHighlighted: () => calls.push('remove'),
            setShowVolumeRenameDialog: () => calls.push('rename'),
        });
        const primary = runtimePlatform === 'MacIntel' ? { metaKey: true } : { ctrlKey: true };
        for (const open of [false, true, false]) {
            document.setOpen(open);
            for (const [key, modifiers, expected] of [
                ['a', primary, 'select-all'], ['ArrowDown', {}, 'move:1'],
                ['ArrowRight', {}, 'expand:true'], ['End', {}, 'end'],
                ['Delete', {}, 'remove'], ['r', { shiftKey: true }, 'rename'],
            ]) {
                calls.length = 0;
                const event = keyEvent(key, modifiers);
                assert.equal(handler(event), !open);
                assert.equal(event.defaultPrevented, !open);
                assert.deepEqual(calls, open ? [] : [expected]);
            }
        }
    }
});

test('메타데이터 검색·저장·적용 단축키는 Git스타를 닫으면 즉시 복구된다', () => {
    for (const platform of ['MacIntel', 'Win32']) {
        const document = supportDialogDocument();
        const calls = [];
        const handler = loadHandler(metadataSource, 'handleShortcut', "window.addEventListener('keydown', handleShortcut", {
            document, navigator: { platform }, isTextEntryTarget, hasPlatformPrimaryModifier: hasPrimaryModifier,
            apiSearch: { open: false }, isWorking: false, activeItem: {}, checkedCount: 2, searchQuery: 'book',
            apiSearchInputRef: { current: { focus: () => calls.push('focus-search') } },
            handleSave: all => calls.push(`save:${all}`), handleSearchApi: page => calls.push(`search:${page}`),
            handleLoadLatest: () => calls.push('latest'), handleApplyBatchToActive: () => calls.push('apply-active'),
            handleApplyBatchToSeries: () => calls.push('apply-series'),
        }, metadataHelpers());
        const primary = platform === 'MacIntel' ? { metaKey: true } : { ctrlKey: true };
        for (const open of [false, true, false]) {
            document.setOpen(open);
            for (const [key, modifiers, expected] of [
                ['f', primary, 'focus-search'], ['s', primary, 'save:false'],
                ['s', { ...primary, shiftKey: true }, 'save:true'], ['s', {}, 'search:1'],
                ['d', {}, 'latest'], ['x', {}, 'apply-active'], ['c', {}, 'apply-series'],
            ]) {
                calls.length = 0;
                const event = keyEvent(key, modifiers);
                handler(event);
                assert.equal(event.defaultPrevented, !open);
                assert.deepEqual(calls, open ? [] : [expected]);
            }
        }
    }
});

test('메타데이터 트리 이동과 삭제도 Git스타의 실제 열림 상태를 따른다', async () => {
    const document = supportDialogDocument();
    const calls = [];
    const scope = {
        document, isTextEntryTarget, apiSearch: { open: false }, isWorking: false,
        metadataTreeKeyboardActiveRef: { current: true },
        visibleTreeNodes: [{ type: 'group', groupName: 'Books' }, { type: 'file', groupName: 'Books', id: 'one' }],
        selectedTreeKey: 'group:Books', selectedFileId: 'one', selectedGroup: '',
        selectTreeNode: node => calls.push(`select:${node.id}`),
        setGroupCollapsed: (_group, collapsed) => calls.push(`collapse:${collapsed}`),
        setSelectedFileId: () => {}, setSelectedGroup: () => {}, adjacentSelectionAfterRemoval,
        setEpubImagesByFilePath: update => update({}),
        setFileList: update => calls.push(update([{ id: 'one' }, { id: 'two' }]).map(item => item.id)),
    };
    const tree = loadHandler(metadataSource, 'handleMetadataTreeKeyDown', "window.addEventListener('keydown', handleMetadataTreeKeyDown", scope, metadataHelpers());
    const remove = loadHandler(metadataSource, 'handleDelete', "window.addEventListener('keydown', handleDelete", scope, metadataHelpers());
    for (const open of [false, true, false]) {
        document.setOpen(open);
        for (const [handler, key, expected] of [[tree, 'ArrowDown', 'select:one'], [tree, 'ArrowRight', 'collapse:false'], [remove, 'Delete', ['two']]]) {
            calls.length = 0;
            const event = keyEvent(key);
            await handler(event);
            assert.equal(event.defaultPrevented, !open);
            assert.deepEqual(calls, open ? [] : [expected]);
        }
    }
});
