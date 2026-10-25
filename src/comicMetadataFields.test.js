import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { AGE_RATING_OPTIONS, META_FIELDS, META_FIELD_IDS } from './metadata/comicMetadataFields.js';
import { COMICINFO_AGE_RATINGS, COMICINFO_FIELDS } from './metadata/comicInfoPolicy.js';
import { resolveBookType } from './metadata/metadataTypes.js';
import { clampMetadataNumber, isDecimalMetadataField, normalizeMetadataDecimal } from './metadataPolicy.js';
import { translate } from './utils/i18n.js';

const metadataTabSource = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');

function fragment(startMarker, endMarker) {
    const start = metadataTabSource.indexOf(startMarker);
    const end = metadataTabSource.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start);
    return metadataTabSource.slice(start, end);
}

test('comic save payload keeps every editable ComicInfo 2.1 scalar field', () => {
    assert.deepEqual([...META_FIELD_IDS].sort(), COMICINFO_FIELDS.filter(field => field !== 'Pages').sort());
    const context = vm.createContext({ META_FIELD_IDS, resolveBookType, isTxtMetadataItem: () => false });
    vm.runInContext([
        fragment('function pickMetadataFields(', 'function trimMetadataCoverCache('),
        fragment('const sanitizeItemForSave = (item) => {', 'const handleSave ='),
        'globalThis.sanitize = sanitizeItemForSave;',
    ].join('\n'), context);
    const metadata = Object.fromEntries(META_FIELD_IDS.map(field => [field, `value:${field}`]));
    metadata.Number = '001AU';
    metadata.AlternateNumber = '0.5';
    metadata.StoryArcNumber = '1,3';
    const saved = context.sanitize({ filepath: '/comics/example.cbz', metadata });
    for (const field of META_FIELD_IDS) assert.equal(saved.metadata[field], metadata[field], field);
});

test('comic integer and string fields retain their schema-specific edit types and localized labels', () => {
    assert.equal(META_FIELDS.find(field => field.id === 'Volume').type, 'number');
    assert.equal(META_FIELDS.find(field => field.id === 'Number').type, 'text');
    assert.deepEqual(AGE_RATING_OPTIONS, ['', ...COMICINFO_AGE_RATINGS]);
    for (const language of ['ko', 'en', 'ja']) {
        for (const field of META_FIELDS) assert.notEqual(translate(field.labelKey, language), field.labelKey);
        const ages = translate('meta_age', language);
        for (const code of COMICINFO_AGE_RATINGS) assert.ok(ages[code], `${language}:${code}`);
        assert.match(translate('t3_f_rate', language), /0–10/);
    }
});

test('comic Volume blur preserves invalid integers for save validation without changing other numeric fields', () => {
    const handler = fragment('        onBlur={event => {', '        }}').slice('        onBlur={'.length) + '}';
    const changes = [];
    const context = vm.createContext({
        activeBookType: 'comic',
        field: { id: 'Volume', type: 'number' },
        onChange: value => changes.push(value),
        clampMetadataNumber,
        isDecimalMetadataField,
        normalizeMetadataDecimal,
    });
    vm.runInContext(`globalThis.blur = ${handler};`, context);
    const blur = value => {
        changes.length = 0;
        context.blur({ target: { value } });
        return changes;
    };

    for (const [input, expected] of [
        [' 1.5 ', '1.5'], ['1e2', '1e2'], [' 2AU ', '2AU'],
        ['02147483648', '02147483648'], ['-2147483649', '-2147483649'],
        [' 001 ', '1'], ['+002', '2'], ['-001', '-1'], ['   ', ''],
    ]) {
        assert.deepEqual(blur(input), [expected], input);
    }
    context.field = { id: 'Count', type: 'number' };
    assert.deepEqual(blur(' 1.5 '), ['1']);
    context.field = { id: 'Month', type: 'number' };
    assert.deepEqual(blur('15'), ['12']);
    context.field = { id: 'Number', type: 'text' };
    assert.deepEqual(blur('001AU'), []);
    context.activeBookType = 'book';
    context.field = { id: 'Volume', type: 'decimal' };
    assert.deepEqual(blur('001.5'), ['1.5']);
});
