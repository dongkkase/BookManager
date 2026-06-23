export const SECTION_TABS = [
    { id: 'basic', labelKey: 't3_nav_basic' },
    { id: 'creators', labelKey: 't3_nav_crew' },
    { id: 'publisher', labelKey: 't3_nav_publish' },
    { id: 'tags', labelKey: 't3_nav_genre' },
    { id: 'other', labelKey: 't3_nav_etc' },
];

export const BASIC_FIELDS = [
    { id: 'Title', labelKey: 't3_f_title', type: 'text' },
    { id: 'Series', labelKey: 't3_f_series', type: 'text' },
    { id: 'SeriesGroup', labelKey: 't3_f_sgroup', type: 'select', options: [''] },
    { id: 'Count', labelKey: 't3_f_count', type: 'number' },
    { id: 'Volume', labelKey: 't3_f_vol', type: 'decimal' },
    { id: 'Number', labelKey: 't3_f_num', type: 'decimal' },
    { id: 'PageCount', labelKey: 't3_f_page', type: 'number' },
    { id: 'Summary', labelKey: 't3_f_sum', type: 'textarea' },
];

export const CREATOR_FIELDS = [
    { id: 'Writer', labelKey: 't3_f_writer', type: 'text' },
    { id: 'Penciller', labelKey: 't3_f_pen', type: 'text' },
    { id: 'Inker', labelKey: 't3_f_inker', type: 'text' },
    { id: 'Colorist', labelKey: 't3_f_color', type: 'text' },
    { id: 'Letterer', labelKey: 't3_f_letter', type: 'text' },
    { id: 'CoverArtist', labelKey: 't3_f_cover', type: 'text' },
    { id: 'Editor', labelKey: 't3_f_editor', type: 'text' },
];

export const FORMAT_OPTIONS = [
    '',
    'Tankobon',
    'Bunkoban',
    'Kanzenban',
    'Aizoban',
    'Shinsoban',
    'Omnibus',
    'Deluxe',
    'SpecialEdition',
    'LimitedEdition',
    'CollectorEdition',
    'Hardcover',
    'TradePaperback',
    'GraphicNovel',
    'Webtoon',
    'WebComic',
    'Digital',
];

export const AGE_RATING_OPTIONS = [
    '',
    'All Ages',
    'Kids / Children',
    'Young Adult / Teen',
    'Older Teen / Mature',
    'Adult / Mature Audiences',
];

export const MANGA_READING_OPTIONS = [
    '',
    'No',
    'Yes',
    'YesAndRightToLeft',
];

export const PUBLISHER_FIELDS = [
    { id: 'Publisher', labelKey: 't3_f_pub', type: 'text' },
    { id: 'Imprint', labelKey: 't3_f_imp', type: 'text' },
    { id: 'Web', labelKey: 't3_f_web', type: 'textarea' },
    { id: 'Format', labelKey: 't3_f_format', type: 'select', options: FORMAT_OPTIONS },
    { id: 'Year', labelKey: 't3_f_year', type: 'number' },
    { id: 'Month', labelKey: 't3_f_month', type: 'number' },
    { id: 'Day', labelKey: 't3_f_day', type: 'number' },
];

export const OTHER_FIELDS = [
    { id: 'AgeRating', labelKey: 't3_f_age', type: 'select', options: AGE_RATING_OPTIONS },
    { id: 'CommunityRating', labelKey: 't3_f_rate', type: 'text' },
    { id: 'LanguageISO', labelKey: 't3_f_iso', type: 'text' },
    { id: 'Manga', labelKey: 't3_f_dir', type: 'select', options: MANGA_READING_OPTIONS },
    { id: 'BlackAndWhite', labelKey: 't3_f_bw', type: 'select', options: ['', 'Yes', 'No'] },
    { id: 'Notes', labelKey: 't3_f_notes', type: 'textarea' },
];

export const META_FIELDS = [
    ...BASIC_FIELDS,
    ...CREATOR_FIELDS,
    ...PUBLISHER_FIELDS,
    { id: 'Genre', labelKey: 't3_f_genre', type: 'text' },
    { id: 'Tags', labelKey: 't3_f_tags_lbl', type: 'text' },
    { id: 'Characters', labelKey: 't3_f_char', type: 'text' },
    ...OTHER_FIELDS,
];

export const META_FIELD_IDS = META_FIELDS.map(field => field.id);

export const SEARCHABLE_SELECT_FIELDS = new Set(['SeriesGroup', 'Format']);
