export const AUDIOBOOK_SECTION_TABS = [
    { id: 'basic', labelKey: 't3_nav_basic' },
    { id: 'creators', labelKey: 'audio_nav_creators' },
    { id: 'tags', labelKey: 't3_nav_book_tags' },
    { id: 'track', labelKey: 'audio_nav_track' },
];

export const AUDIOBOOK_BASIC_FIELDS = [
    { id: 'Title', labelKey: 't3_f_title', type: 'text' },
    { id: 'Series', labelKey: 't3_f_series', type: 'text' },
    { id: 'Album', labelKey: 'audio_f_album', type: 'text' },
    { id: 'Summary', labelKey: 't3_f_book_description', type: 'textarea' },
];

export const AUDIOBOOK_CREATOR_FIELDS = [
    { id: 'Writer', labelKey: 'audio_f_artist', type: 'text' },
    { id: 'AlbumArtist', labelKey: 'audio_f_album_artist', type: 'text' },
    { id: 'Composer', labelKey: 'audio_f_composer', type: 'text' },
    { id: 'Publisher', labelKey: 't3_f_pub', type: 'select', options: [] },
];

export const AUDIOBOOK_TRACK_FIELDS = [
    { id: 'Year', labelKey: 't3_f_year', type: 'number' },
    { id: 'TrackNumber', labelKey: 'audio_f_track_number', type: 'number' },
    { id: 'TrackTotal', labelKey: 'audio_f_track_total', type: 'number' },
    { id: 'DiscNumber', labelKey: 'audio_f_disc_number', type: 'number' },
    { id: 'DiscTotal', labelKey: 'audio_f_disc_total', type: 'number' },
];

export const AUDIOBOOK_TECHNICAL_FIELDS = [
    { id: 'DurationSeconds', labelKey: 'audio_f_duration_seconds', type: 'decimal' },
    { id: 'Bitrate', labelKey: 'audio_f_bitrate_bps', type: 'number' },
    { id: 'SampleRate', labelKey: 'audio_f_sample_rate_hz', type: 'number' },
    { id: 'Codec', labelKey: 'audio_f_codec', type: 'text' },
    { id: 'Container', labelKey: 'audio_f_container', type: 'text' },
    { id: 'Channels', labelKey: 'audio_f_channels', type: 'number' },
    { id: 'MimeType', labelKey: 'audio_f_mime_type', type: 'text' },
    { id: 'Format', labelKey: 't3_f_format', type: 'text' },
];

export const AUDIOBOOK_META_FIELDS = [
    ...AUDIOBOOK_BASIC_FIELDS,
    ...AUDIOBOOK_CREATOR_FIELDS,
    { id: 'Genre', labelKey: 't3_f_genre', type: 'text' },
    { id: 'Tags', labelKey: 't3_f_tags_lbl', type: 'text' },
    ...AUDIOBOOK_TRACK_FIELDS,
];

export const AUDIOBOOK_META_FIELD_IDS = AUDIOBOOK_META_FIELDS.map(field => field.id);

export const AUDIOBOOK_SAVE_FIELD_IDS = [
    ...AUDIOBOOK_META_FIELD_IDS,
    ...AUDIOBOOK_TECHNICAL_FIELDS.map(field => field.id),
];

export const AUDIOBOOK_SEARCHABLE_SELECT_FIELDS = new Set(['Publisher']);
