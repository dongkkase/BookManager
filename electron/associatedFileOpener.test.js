import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
    configuredViewerPathForAssociatedFile,
    openAssociatedFile,
} from './associatedFileOpener.js';

const fakeFiles = new Set(['/library/book.cbz', '/apps/viewer.exe', '/library/book.m4b']);
const fakeDirectories = new Set(['/Applications/Viewer.app']);
const fsTarget = {
    existsSync: filePath => fakeFiles.has(filePath) || fakeDirectories.has(filePath),
    statSync: filePath => ({
        isFile: () => fakeFiles.has(filePath),
        isDirectory: () => fakeDirectories.has(filePath),
    }),
};

test('configured viewer path follows the associated file family', () => {
    const config = {
        viewer_paths: {
            comic: '/apps/comic.exe',
            epub: '/apps/epub.exe',
            pdf: '/apps/pdf.exe',
            text: '/apps/text.exe',
        },
    };
    assert.equal(configuredViewerPathForAssociatedFile(config, '/library/a.cbz'), '/apps/comic.exe');
    assert.equal(configuredViewerPathForAssociatedFile(config, '/library/a.epub'), '/apps/epub.exe');
    assert.equal(configuredViewerPathForAssociatedFile(config, '/library/a.m4b'), '');
});

test('associated file opens configured external viewer', async () => {
    const calls = [];
    const result = await openAssociatedFile('/library/book.cbz', {
        getConfig: () => ({ viewer_paths: { comic: '/apps/viewer.exe' } }),
        fsTarget,
        spawnTarget: (command, args, options) => {
            calls.push({ command, args, options });
            return { unref: () => calls.push({ unref: true }) };
        },
        onExternalViewerOpened: async filePath => calls.push({ recorded: filePath }),
    });

    assert.equal(result.success, true);
    assert.equal(result.external, true);
    assert.deepEqual(calls[0], {
        command: '/apps/viewer.exe',
        args: ['/library/book.cbz'],
        options: { detached: true, stdio: 'ignore' },
    });
    assert.deepEqual(calls.at(-1), { recorded: '/library/book.cbz' });
});

test('associated audio falls back to the internal viewer', async () => {
    const result = await openAssociatedFile('/library/book.m4b', {
        getConfig: () => ({ viewer_paths: { comic: '/apps/viewer.exe' } }),
        fsTarget,
        openInternalViewer: async filePath => ({ success: true, internal: filePath }),
    });
    assert.deepEqual(result, { success: true, internal: '/library/book.m4b' });
});

test('macOS application bundles open through the system open command', async () => {
    const calls = [];
    const result = await openAssociatedFile('/library/book.cbz', {
        platform: 'darwin',
        getConfig: () => ({ viewer_paths: { comic: '/Applications/Viewer.app' } }),
        fsTarget,
        spawnTarget: (command, args, options) => {
            calls.push({ command, args, options });
            return { unref: () => calls.push({ unref: true }) };
        },
    });

    assert.equal(result.success, true);
    assert.deepEqual(calls[0], {
        command: '/usr/bin/open',
        args: ['-a', '/Applications/Viewer.app', '/library/book.cbz'],
        options: { detached: true, stdio: 'ignore' },
    });
});

test('asynchronous viewer launch errors are returned without recording success', async () => {
    let recorded = false;
    const child = new EventEmitter();
    child.unref = () => {};
    const resultPromise = openAssociatedFile('/library/book.cbz', {
        getConfig: () => ({ viewer_paths: { comic: '/apps/viewer.exe' } }),
        fsTarget,
        spawnTarget: () => {
            queueMicrotask(() => {
                const error = new Error('permission denied');
                error.code = 'EACCES';
                child.emit('error', error);
            });
            return child;
        },
        onExternalViewerOpened: async () => {
            recorded = true;
        },
    });

    const result = await resultPromise;
    assert.equal(result.success, false);
    assert.equal(result.code, 'EACCES');
    assert.equal(recorded, false);
});

test('BookManager itself cannot be configured as a recursive external viewer', async () => {
    let spawned = false;
    const result = await openAssociatedFile('/library/book.cbz', {
        platform: 'win32',
        getConfig: () => ({ viewer_paths: { comic: '/apps/viewer.exe' } }),
        fsTarget,
        blockedViewerPaths: ['/APPS/VIEWER.EXE'],
        spawnTarget: () => {
            spawned = true;
            return {};
        },
        openInternalViewer: async filePath => ({
            success: true,
            internal: filePath,
            reason: 'self-viewer-fallback',
        }),
    });

    assert.equal(spawned, false);
    assert.deepEqual(result, {
        success: true,
        internal: '/library/book.cbz',
        reason: 'self-viewer-fallback',
    });
});

test('a symlink to BookManager is blocked as a recursive external viewer', async () => {
    let spawned = false;
    const aliasPath = '/Applications/BookManager Alias.app';
    const applicationPath = '/Applications/BookManager.app';
    const aliasFsTarget = {
        existsSync: filePath => (
            filePath === '/library/book.cbz'
            || filePath === aliasPath
            || filePath === applicationPath
        ),
        statSync: filePath => ({
            isFile: () => filePath === '/library/book.cbz',
            isDirectory: () => filePath === aliasPath || filePath === applicationPath,
        }),
        realpathSync: filePath => (filePath === aliasPath ? applicationPath : filePath),
    };

    const result = await openAssociatedFile('/library/book.cbz', {
        platform: 'darwin',
        getConfig: () => ({ viewer_paths: { comic: aliasPath } }),
        fsTarget: aliasFsTarget,
        blockedViewerPaths: [applicationPath],
        spawnTarget: () => {
            spawned = true;
            return {};
        },
        openInternalViewer: async filePath => ({ success: true, internal: filePath }),
    });

    assert.equal(spawned, false);
    assert.deepEqual(result, { success: true, internal: '/library/book.cbz' });
});
