import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applySuccessfulTxtMetadataSave,
    applyTxtSeriesCover,
    isTxtMetadataItem,
    resetTxtMetadataDraft,
    shouldAutoUseTxtSearchCover,
    successfulTxtMetadataTargets,
    txtMetadataCoverForSeries,
    withTxtCoverChange,
} from './txtMetadataPolicy.js';

test('TXT uses database metadata without introducing a separate book type', () => {
    assert.equal(isTxtMetadataItem({ filepath: '/books/Novel.TXT', bookType: 'book' }), true);
    assert.equal(isTxtMetadataItem({ metadataStorage: 'database', bookType: 'book' }), true);
    assert.equal(isTxtMetadataItem({ filepath: '/books/Novel.epub', bookType: 'book' }), false);
    assert.equal(isTxtMetadataItem(null), false);
});

test('new TXT automatically uses a search cover despite filename-inferred metadata', () => {
    const item = {
        filepath: '/books/Novel.txt',
        hasTextMetadata: false,
        metadata: { Title: 'Novel', Series: 'Novel', LanguageISO: 'ko', Format: 'Novel' },
    };
    assert.equal(shouldAutoUseTxtSearchCover(item), true);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, hasTextMetadata: true }), true);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, hasTextMetadata: undefined }), true);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, filepath: '/books/Novel.epub' }), false);
    assert.equal(shouldAutoUseTxtSearchCover(null), false);
});

test('migrated filename-only TXT metadata still automatically selects a cover', () => {
    const metadata = { Title: '테스트소설1권', Series: '테스트소설', Volume: '1', Writer: '', Publisher: '', LanguageISO: '' };
    const item = {
        filepath: '/books/테스트소설1권.txt'.normalize('NFD'),
        hasTextMetadata: true,
        originalMetadata: metadata,
        metadata: { ...metadata, Writer: '새로 선택한 검색 결과의 작가' },
    };
    assert.equal(shouldAutoUseTxtSearchCover(item), true);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, originalMetadata: { ...metadata, Volume: '01' } }), true);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, originalMetadata: { ...metadata, Writer: '저장된 작가' } }), false);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, originalMetadata: { ...metadata, Title: '직접 입력한 다른 제목' } }), false);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, originalMetadata: { ...metadata, Series: '별도의 시리즈' } }), false);
    assert.equal(shouldAutoUseTxtSearchCover({ ...item, originalMetadata: {} }), true);
});

test('automatic TXT search cover preserves saved covers and pending user choices', () => {
    const item = { filepath: '/books/Novel.txt', hasTextMetadata: false };
    for (const cover of [
        { textCoverPath: '/covers/saved.png' },
        { coverOverridePath: '/covers/saved.png' },
        { coverDataUrl: 'data:image/png;base64,preview' },
        { txtCoverChange: { type: 'file', filePath: '/covers/chosen.png' } },
        { txtCoverChange: { type: 'reset' } },
    ]) {
        assert.equal(shouldAutoUseTxtSearchCover({ ...item, ...cover }), false);
    }
    const saved = applySuccessfulTxtMetadataSave(item, { ...item, metadata: { Title: 'Stored title' } });
    assert.equal(saved.hasTextMetadata, true);
    assert.equal(shouldAutoUseTxtSearchCover(saved), false);
});

test('removing or cancelling a TXT cover invalidates the preview without removing the saved cover', () => {
    const original = {
        filepath: '/books/Novel.txt',
        textCoverPath: '/thumbs/txt/abc.png',
        coverDataUrl: 'data:image/png;base64,saved',
        coverLoadedAt: 123,
    };
    const replacement = withTxtCoverChange(original, { type: 'file', filePath: '/new.png' }, 'data:image/png;base64,new');
    const removal = withTxtCoverChange(replacement, { type: 'reset' });
    const cancellation = withTxtCoverChange(removal, null);

    assert.equal(replacement.coverDataUrl, 'data:image/png;base64,new');
    assert.deepEqual(removal.txtCoverChange, { type: 'reset' });
    assert.equal(removal.coverDataUrl, undefined);
    assert.equal(removal.coverLoadedAt, undefined);
    assert.equal(cancellation.txtCoverChange, undefined);
    assert.equal(cancellation.coverDataUrl, undefined);
    assert.equal(cancellation.textCoverPath, original.textCoverPath);
    assert.equal(cancellation.textCoverRevision, 3);
    assert.equal(original.coverDataUrl, 'data:image/png;base64,saved');
});

test('resetting TXT metadata discards both field and cover drafts', () => {
    const originalMetadata = { Title: 'Saved title', Writer: 'Saved writer' };
    const item = {
        metadata: { Title: 'Draft title' },
        originalMetadata,
        txtCoverChange: { type: 'file', filePath: '/new.png' },
        coverDataUrl: 'new preview',
    };
    const reset = resetTxtMetadataDraft(item);

    assert.deepEqual(reset.metadata, originalMetadata);
    assert.notEqual(reset.metadata, originalMetadata);
    assert.equal(reset.txtCoverChange, undefined);
    assert.equal(reset.coverDataUrl, undefined);
    assert.equal(item.metadata.Title, 'Draft title');
});

test('series cover application replaces TXT cover drafts while preserving each book identity and metadata', () => {
    const source = {
        id: 'first', group: 'Novel', filepath: '/books/Novel 1.txt',
        txtCoverChange: { type: 'file', filePath: '/covers/new.png', label: 'Search cover' },
        textCoverPath: '/covers/first-old.png',
        coverDataUrl: 'data:image/png;base64,new',
    };
    const target = {
        id: 'second', group: 'Novel', filepath: '/books/Novel 2.txt', checked: false,
        textContentHash: 'second-content', textCoverPath: '/covers/second-old.png',
        coverOverridePath: '/covers/second-old.png', coverDataUrl: 'old preview', textCoverRevision: 3,
        metadata: { Title: 'Custom second title', Volume: '2' },
        originalMetadata: { Title: 'Original second title' },
        txtCoverChange: { type: 'reset' },
    };
    const epub = { id: 'epub', group: 'Novel', filepath: '/books/Novel.epub' };
    const otherSeries = { id: 'other', group: 'Other', filepath: '/books/Other.txt' };
    const items = applyTxtSeriesCover([source, target, epub, otherSeries], source);
    assert.equal(items[0], source);
    assert.equal(items[2], epub);
    assert.equal(items[3], otherSeries);
    assert.deepEqual(items[1].txtCoverChange, source.txtCoverChange);
    assert.notEqual(items[1].txtCoverChange, source.txtCoverChange);
    assert.equal(items[1].coverDataUrl, source.coverDataUrl);
    assert.equal(items[1].textCoverRevision, 4);
    assert.equal(items[1].textContentHash, target.textContentHash);
    assert.equal(items[1].textCoverPath, target.textCoverPath);
    assert.equal(items[1].coverOverridePath, target.coverOverridePath);
    assert.equal(items[1].metadata, target.metadata);
    assert.equal(items[1].originalMetadata, target.originalMetadata);
    assert.equal(items[1].checked, false);
});

test('series cover application can reuse saved covers without a preview and does not copy cover removal', () => {
    const source = {
        id: 'first', group: 'Novel', filepath: '/books/Novel 1.txt',
        textCoverPath: '/covers/saved.png', coverOverridePath: '/covers/fallback.png',
    };
    const target = {
        id: 'second', group: 'Novel', filepath: '/books/Novel 2.txt',
        coverDataUrl: 'old preview', coverLoadedAt: 123,
    };
    const items = [source, target];
    const applied = applyTxtSeriesCover(items, source);
    assert.equal(applied[1].txtCoverChange.filePath, source.textCoverPath);
    assert.equal(applied[1].coverDataUrl, undefined);
    assert.equal(applied[1].coverLoadedAt, undefined);
    assert.equal(txtMetadataCoverForSeries({ ...source, textCoverPath: '' }).filePath, source.coverOverridePath);
    assert.equal(applyTxtSeriesCover(items, { ...source, txtCoverChange: { type: 'reset' } }), items);
    assert.equal(applyTxtSeriesCover(items, { filepath: '/books/Empty.txt' }), items);
    assert.equal(applyTxtSeriesCover(items, { filepath: '/books/Book.epub', coverOverridePath: '/covers/epub.png' }), items);
});

test('partial TXT save clears only successful paths and updates the reset baseline', () => {
    const items = [
        {
            filepath: '/first/Same.txt',
            metadata: { Title: 'First new title' },
            originalMetadata: { Title: 'First old title' },
            txtCoverChange: { type: 'file', filePath: '/new.png' },
            coverDataUrl: 'new preview',
        },
        {
            filepath: '/second/Same.txt',
            metadata: { Title: 'Second new title' },
            originalMetadata: { Title: 'Second old title' },
            txtCoverChange: { type: 'reset' },
        },
    ];
    const successfulTargets = successfulTxtMetadataTargets(items, ['/first/Same.txt']);
    assert.deepEqual(successfulTargets.map(item => item.filepath), ['/first/Same.txt']);
    assert.deepEqual(successfulTxtMetadataTargets(items), []);

    const reconciled = items.map(item => successfulTargets.includes(item)
        ? applySuccessfulTxtMetadataSave(item, item, {
            textContentHash: 'abc',
            textCoverPath: '/thumbs/txt/abc.png',
            coverOverridePath: '/thumbs/txt/abc.png',
        })
        : item);
    assert.equal(reconciled[0].txtCoverChange, undefined);
    assert.equal(reconciled[0].coverDataUrl, undefined);
    assert.equal(reconciled[0].textContentHash, 'abc');
    assert.equal(reconciled[0].textCoverPath, '/thumbs/txt/abc.png');
    assert.deepEqual(reconciled[0].originalMetadata, items[0].metadata);
    assert.equal(reconciled[1], items[1]);
    assert.deepEqual(reconciled[1].txtCoverChange, { type: 'reset' });
});

test('successful removal clears stored cover paths while preserving newer unsaved cover edits', () => {
    const savedTarget = {
        filepath: 'C:\\Books\\Novel.txt',
        metadata: { Title: 'Saved title' },
        txtCoverChange: { type: 'reset' },
    };
    assert.equal(successfulTxtMetadataTargets([savedTarget], ['c:/books/novel.txt']).length, 1);
    const newerDraft = {
        ...savedTarget,
        metadata: { Title: 'Newer title' },
        txtCoverChange: { type: 'file', filePath: '/newer.png' },
        coverDataUrl: 'newer preview',
        textCoverPath: '/old.png',
        coverOverridePath: '/old.png',
    };
    const reconciled = applySuccessfulTxtMetadataSave(newerDraft, savedTarget, { textCoverPath: '', coverOverridePath: '' });
    assert.equal(reconciled.textCoverPath, '');
    assert.equal(reconciled.coverOverridePath, '');
    assert.equal(reconciled.coverDataUrl, 'newer preview');
    assert.deepEqual(reconciled.txtCoverChange, newerDraft.txtCoverChange);
    assert.equal(reconciled.metadata.Title, 'Newer title');
    assert.equal(reconciled.originalMetadata.Title, 'Saved title');
});
