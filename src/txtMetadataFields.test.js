import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as bookFields from './metadata/bookMetadataFields.js';
import { resolveBookType } from './metadata/metadataTypes.js';
import { isTxtMetadataItem } from './txtMetadataPolicy.js';

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
