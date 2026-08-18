import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AUDIOBOOK_META_FIELD_IDS,
    AUDIOBOOK_SAVE_FIELD_IDS,
    AUDIOBOOK_SECTION_TABS,
    AUDIOBOOK_TECHNICAL_FIELDS,
} from './metadata/audiobookMetadataFields.js';

const EDITABLE_FIELD_IDS = [
    'Title',
    'Series',
    'Album',
    'Summary',
    'Writer',
    'AlbumArtist',
    'Composer',
    'Publisher',
    'Genre',
    'Tags',
    'Year',
    'TrackNumber',
    'TrackTotal',
    'DiscNumber',
    'DiscTotal',
];

const TECHNICAL_FIELD_IDS = [
    'DurationSeconds',
    'Bitrate',
    'SampleRate',
    'Codec',
    'Container',
    'Channels',
    'MimeType',
    'Format',
];

test('오디오 기술 정보는 편집 및 일괄 적용 대상에서 제외한다', () => {
    assert.deepEqual(AUDIOBOOK_SECTION_TABS.map(section => section.id), [
        'basic',
        'creators',
        'tags',
        'track',
    ]);
    assert.deepEqual(AUDIOBOOK_META_FIELD_IDS, EDITABLE_FIELD_IDS);
    assert.deepEqual(AUDIOBOOK_TECHNICAL_FIELDS.map(field => field.id), TECHNICAL_FIELD_IDS);
    for (const fieldId of TECHNICAL_FIELD_IDS) {
        assert.equal(AUDIOBOOK_META_FIELD_IDS.includes(fieldId), false);
    }
});

test('오디오 기술 정보는 저장 왕복 대상에는 유지한다', () => {
    assert.deepEqual(AUDIOBOOK_SAVE_FIELD_IDS, [
        ...EDITABLE_FIELD_IDS,
        ...TECHNICAL_FIELD_IDS,
    ]);
    assert.equal(new Set(AUDIOBOOK_SAVE_FIELD_IDS).size, AUDIOBOOK_SAVE_FIELD_IDS.length);
});
