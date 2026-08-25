import assert from 'node:assert/strict';
import test from 'node:test';

import {
    FILE_ASSOCIATION_EXTENSIONS,
    configuredViewerTypeForAssociatedPath,
    fileAssociationGroupForExtension,
    isSupportedFileAssociationExtension,
    normalizeFileAssociationExtensions,
    viewerTypeForAssociatedPath,
} from './fileAssociationPolicy.js';

test('file association policy contains every internal viewer family', () => {
    assert.equal(FILE_ASSOCIATION_EXTENSIONS.length, 28);
    assert.equal(fileAssociationGroupForExtension('.CBZ'), 'comic');
    assert.equal(fileAssociationGroupForExtension('epub'), 'document');
    assert.equal(fileAssociationGroupForExtension('.md'), 'text');
    assert.equal(fileAssociationGroupForExtension('m4b'), 'audio');
});

test('file association extension normalization rejects unsupported values and duplicates', () => {
    assert.deepEqual(
        normalizeFileAssociationExtensions(['CBZ', '.cbz', '.EPUB', '.exe', '', null]),
        ['.cbz', '.epub'],
    );
    assert.equal(isSupportedFileAssociationExtension('.pdf'), true);
    assert.equal(isSupportedFileAssociationExtension('.exe'), false);
});

test('associated paths resolve internal and configured external viewer types', () => {
    assert.equal(viewerTypeForAssociatedPath('/books/a.cb7'), 'comic');
    assert.equal(viewerTypeForAssociatedPath('/books/a.epub'), 'epub');
    assert.equal(viewerTypeForAssociatedPath('/books/a.pdf'), 'pdf');
    assert.equal(viewerTypeForAssociatedPath('/books/a.log'), 'text');
    assert.equal(viewerTypeForAssociatedPath('/books/a.m4b'), 'audio');
    assert.equal(viewerTypeForAssociatedPath('/books/a.exe'), '');
    assert.equal(configuredViewerTypeForAssociatedPath('/books/a.m4b'), '');
    assert.equal(configuredViewerTypeForAssociatedPath('/books/a.pdf'), 'pdf');
});
