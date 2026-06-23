export const BOOK_SECTION_TABS = [
    { id: 'basic', labelKey: 't3_nav_basic' },
    { id: 'creators', labelKey: 't3_nav_crew' },
    { id: 'tags', labelKey: 't3_nav_book_tags' },
    { id: 'publisher', labelKey: 't3_nav_publish' },
    { id: 'other', labelKey: 't3_nav_etc' },
];

export const BOOK_BASIC_FIELDS = [
    { id: 'Title', labelKey: 't3_f_title', type: 'text' },
    { id: 'Series', labelKey: 't3_f_series', type: 'text' },
    { id: 'Volume', labelKey: 't3_f_series_number', type: 'decimal' },
    { id: 'Summary', labelKey: 't3_f_book_description', type: 'textarea' },
];

export const BOOK_CREATOR_FIELDS = [
    { id: 'Writer', labelKey: 't3_f_writer', type: 'text' },
];

export const BOOK_PUBLISHER_FIELDS = [
    { id: 'Publisher', labelKey: 't3_f_pub', type: 'select', options: [] },
    { id: 'Year', labelKey: 't3_f_year', type: 'number' },
    { id: 'Month', labelKey: 't3_f_month', type: 'number' },
    { id: 'Day', labelKey: 't3_f_day', type: 'number' },
    { id: 'ISBN', labelKey: 't3_f_isbn', label: 'ISBN', type: 'text' },
];

export const BOOK_LANGUAGE_OPTIONS = [
    '',
    'ko',
    'en',
    'ja',
    'zh',
    'zh-CN',
    'zh-TW',
    'fr',
    'de',
    'es',
];

export const BOOK_OTHER_FIELDS = [
    { id: 'LanguageISO', labelKey: 't3_f_iso', type: 'select', options: BOOK_LANGUAGE_OPTIONS },
    { id: 'CommunityRating', labelKey: 't3_f_rating', type: 'text' },
];

export const BOOK_META_FIELDS = [
    ...BOOK_BASIC_FIELDS,
    ...BOOK_CREATOR_FIELDS,
    { id: 'Genre', labelKey: 't3_f_genre', type: 'text' },
    { id: 'Tags', labelKey: 't3_f_tags_lbl', type: 'text' },
    ...BOOK_PUBLISHER_FIELDS,
    ...BOOK_OTHER_FIELDS,
];

export const BOOK_META_FIELD_IDS = BOOK_META_FIELDS.map(field => field.id);

export const BOOK_SEARCHABLE_SELECT_FIELDS = new Set(['Publisher']);
