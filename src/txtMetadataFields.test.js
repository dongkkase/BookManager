import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as bookFields from './metadata/bookMetadataFields.js';
import { resolveBookType } from './metadata/metadataTypes.js';
import { metadataFromApiResult, metadataSearchQueryForItem } from './metadataApiPolicy.js';
import { applyBatchMetadataFields, applySeriesAutoMetadata, inferMetadataFromArchiveName, normalizeMetadataAutoNumber } from './metadataPolicy.js';
import { isTxtMetadataItem, shouldAutoUseTxtSearchCover, txtMetadataCoverForSeries } from './txtMetadataPolicy.js';

const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');

function fragment(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

test('switching between EPUB and TXT adds one combined field directly below series number', () => {
    let previousDependencies;
    let previousValue;
    const context = vm.createContext({
        ...bookFields,
        useMemo: (factory, dependencies) => {
            if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies[index])) {
                previousValue = factory();
                previousDependencies = dependencies;
            }
            return previousValue;
        },
    });
    const config = fragment('const currentMetadataConfig = useMemo(', 'const currentSectionTabs =');
    vm.runInContext(`globalThis.configFor = (activeIsTxt) => {
        const activeBookType = 'book';
        ${config}
        return currentMetadataConfig;
    };`, context);
    assert.equal(context.configFor(false).fields.basic.some(field => field.id === 'Number'), false);
    const txtConfig = context.configFor(true);
    const volumeIndex = txtConfig.fields.basic.findIndex(field => field.id === 'Volume');
    assert.deepEqual(txtConfig.fields.basic[volumeIndex + 1], {
        id: 'Number', labelKey: 'txt_f_volume_chapter', type: 'text',
    });
    assert.equal(txtConfig.metaFieldIds.filter(fieldId => fieldId === 'Number').length, 1);
    assert.equal(txtConfig.metaFields.some(field => field.id === 'Number'), true);
    assert.equal(context.configFor(false).metaFieldIds.includes('Number'), false);
});

test('save payload keeps the independent TXT volume/chapter field when files of different formats are selected', () => {
    const context = vm.createContext({ ...bookFields, resolveBookType, isTxtMetadataItem });
    const pickFields = fragment('function pickMetadataFields(', 'function trimMetadataCoverCache(');
    const isEpub = fragment('function isEpubFilePath(', 'const LANGUAGE_LABELS =');
    const sanitize = fragment('const sanitizeItemForSave = (item) => {', 'const handleSave =');
    vm.runInContext(`${pickFields}\n${isEpub}\n${sanitize}\nglobalThis.sanitize = sanitizeItemForSave;`, context);
    for (const value of ['551', '12.5', '1-551', '0', '']) {
        const metadata = { Title: '작품명', Volume: '2', Number: value };
        const item = { filepath: '/books/작품명.TXT', metadata };
        const saved = context.sanitize(item);
        assert.equal(saved.metadata.Volume, '2');
        assert.equal(saved.metadata.Number, value);
        assert.equal(item.metadata, metadata);
        const epub = context.sanitize({ filepath: '/books/작품명.epub', metadata });
        assert.equal(epub.metadata.Volume, '2');
        assert.equal(Object.hasOwn(epub.metadata, 'Number'), false);
    }
});

function searchApplyContext(items, result) {
    const activeIsTxt = isTxtMetadataItem(items[0]);
    const context = vm.createContext({
        ...bookFields,
        resolveBookType,
        isTxtMetadataItem,
        shouldAutoUseTxtSearchCover,
        txtMetadataCoverForSeries,
        metadataFromApiResult,
        metadataSearchQueryForItem,
        applyBatchMetadataFields,
        applySeriesAutoMetadata,
        inferMetadataFromArchiveName,
        normalizeMetadataAutoNumber,
        activeBookType: 'book',
        activeIsTxt,
        activeItem: items[0],
        fileList: items,
        batchMetadata: {},
        currentMetaFields: activeIsTxt ? bookFields.TXT_META_FIELDS : bookFields.BOOK_META_FIELDS,
        currentMetaFieldIds: activeIsTxt ? bookFields.TXT_META_FIELD_IDS : bookFields.BOOK_META_FIELD_IDS,
        currentMetadataExtraFieldIds: [],
        applyEmpty: false,
        isWorking: false,
        saveLockRef: { current: false },
        config: { language: 'ko' },
        apiSource: '통합검색',
        apiSearch: { query: '전지적 독자 시점' },
        searchQuery: '전지적 독자 시점',
        normalizeMetadata: metadata => metadata,
        searchMetadata: async () => ({ success: true, results: [result] }),
        window: { electronAPI: {} },
        closeApiSearch: () => {},
        setSearchQuery: () => {},
        setStatusMessage: () => {},
        showToast: () => {},
        t: key => key,
        text: (_key, fallback) => fallback,
    });
    context.setIsWorking = value => { context.isWorking = value; };
    context.setBatchMetadata = value => {
        context.batchMetadata = typeof value === 'function' ? value(context.batchMetadata) : value;
    };
    context.setFileList = updater => {
        context.fileList = updater(context.fileList);
        context.activeItem = context.fileList.find(item => item.id === context.activeItem.id);
    };
    context.isSameActiveBookType = item => resolveBookType(item) === context.activeBookType;
    const callbacks = [
        fragment('function pickMetadataFields(', 'function trimMetadataCoverCache('),
        fragment('function apiResultCoverUrl(', 'function ridiOriginalCoverUrl('),
        fragment('function isEpubFilePath(', 'const LANGUAGE_LABELS ='),
        fragment('const updateItem = (id, updater) => {', 'const updateBatchMetadata ='),
        fragment('const handleCopyField = (fieldId) => {', 'const getCommaValues ='),
        fragment('const handleApplyBatchToSeries = () => {', 'const handleCopyMyToBatch ='),
        fragment('const applyMetadataToBatch = (metadata = {}) => {', 'const normalizeTagText ='),
        fragment('const handleSelectApiResult = async (result) => {', 'const updateActiveEpubCoverChange ='),
        fragment('const inferTitleParts = (item) => {', 'const applyAutoFieldToSeries ='),
        fragment('const handleAutoMatchSeries = async () => {', 'const resolveRidiPublishDate ='),
        fragment('const sanitizeItemForSave = (item) => {', 'const handleSave ='),
    ];
    vm.runInContext(`${callbacks.join('\n')}
        globalThis.handlers = {
            select: handleSelectApiResult,
            copyNumber: () => handleCopyField('Number'),
            applyToActive: handleApplyBatchToActive,
            applyToSeries: handleApplyBatchToSeries,
            autoMatch: handleAutoMatchSeries,
            sanitize: sanitizeItemForSave,
        };`, context);
    return context;
}

const searchResult = {
    apiSource: '문피아',
    metadata: { Title: '전지적 독자 시점', Series: '전지적 독자 시점', Count: '1064' },
};

function seriesItems(extension = 'txt') {
    return [551, 552, 553].map((number, index) => ({
        id: `book-${index}`,
        group: index < 2 ? 'series' : 'other-series',
        name: `전지적 독자 시점 ${number}화.${extension}`,
        filepath: `/books/전지적 독자 시점 ${number}화.${extension}`,
        metadata: { Title: '전지적 독자 시점', Volume: String(index + 2), Number: '' },
    }));
}

test('selecting a search count fills TXT batch editing and survives field copy, active apply and series apply', async () => {
    const context = searchApplyContext(seriesItems(), searchResult);
    await context.handlers.select(searchResult);
    assert.equal(context.batchMetadata.Number, '1064');
    assert.equal(context.batchMetadata.Volume, undefined);
    assert.equal(context.activeItem.metadata.Number, '');

    context.handlers.copyNumber();
    assert.equal(context.activeItem.metadata.Number, '1064');
    assert.equal(context.activeItem.metadata.Volume, '2');
    context.activeItem.metadata.Number = '';
    context.handlers.applyToActive();
    assert.equal(context.activeItem.metadata.Number, '1064');

    context.handlers.applyToSeries();
    for (const [index, item] of context.fileList.slice(0, 2).entries()) {
        const saved = context.handlers.sanitize(item);
        assert.equal(saved.metadata.Number, '1064');
        assert.equal(saved.metadata.Volume, String(index + 2));
    }
    assert.equal(context.fileList[2].metadata.Number, '');
});

test('TXT automatic series matching keeps the search count over chapter numbers inferred from filenames', async () => {
    const context = searchApplyContext(seriesItems(), searchResult);
    await context.handlers.autoMatch();
    assert.equal(context.batchMetadata.Number, '1064');
    for (const [index, item] of context.fileList.slice(0, 2).entries()) {
        assert.equal(item.metadata.Number, '1064');
        const saved = context.handlers.sanitize(item);
        assert.equal(saved.metadata.Number, '1064');
        assert.equal(saved.metadata.Volume, String(index + 2));
    }
    assert.equal(context.fileList[2].metadata.Number, '');
});

test('EPUB search selection and automatic matching keep counts out of editable and saved book fields', async () => {
    for (const action of ['select', 'autoMatch']) {
        const context = searchApplyContext(seriesItems('epub'), searchResult);
        await context.handlers[action](searchResult);
        assert.equal(Object.hasOwn(context.batchMetadata, 'Number'), false);
        assert.equal(Object.hasOwn(context.batchMetadata, 'Count'), false);
        if (action === 'select') context.handlers.applyToActive();
        const saved = context.handlers.sanitize(context.activeItem);
        assert.equal(Object.hasOwn(saved.metadata, 'Number'), false);
        assert.equal(Object.hasOwn(saved.metadata, 'Count'), false);
        assert.equal(saved.metadata.Volume, '2');
    }
});
