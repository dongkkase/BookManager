import { BOOK_LANGUAGE_OPTIONS } from './bookMetadataFields';

export const PDF_SECTION_TABS = [
    { id: 'basic', labelKey: 't3_nav_basic' },
    { id: 'tags', labelKey: 't3_nav_book_tags' },
    { id: 'publisher', labelKey: 't3_nav_publish' },
    { id: 'document', labelKey: 'pdf_nav_document' },
    { id: 'rights', labelKey: 'pdf_nav_rights' },
];

export const PDF_BASIC_FIELDS = [
    { id: 'Title', labelKey: 't3_f_title', type: 'text' },
    { id: 'Writer', labelKey: 't3_f_writer', type: 'text' },
    { id: 'Summary', labelKey: 'pdf_f_subject_description', type: 'textarea' },
];

export const PDF_PUBLISHER_FIELDS = [
    { id: 'Publisher', labelKey: 't3_f_pub', type: 'select', options: [] },
    { id: 'Year', labelKey: 't3_f_year', type: 'number' },
    { id: 'Month', labelKey: 't3_f_month', type: 'number' },
    { id: 'Day', labelKey: 't3_f_day', type: 'number' },
    { id: 'ISBN', labelKey: 't3_f_isbn', label: 'ISBN', type: 'text' },
    { id: 'LanguageISO', labelKey: 't3_f_iso', type: 'select', options: BOOK_LANGUAGE_OPTIONS },
    { id: 'CommunityRating', labelKey: 't3_f_rating', type: 'text' },
];

export const PDF_TRAPPED_OPTIONS = [
    '',
    'True',
    'False',
    'Unknown',
];

export const PDF_DOCUMENT_FIELDS = [
    { id: 'Creator', labelKey: 'pdf_f_creator_tool', type: 'text' },
    { id: 'Producer', labelKey: 'pdf_f_producer', type: 'text' },
    { id: 'Trapped', labelKey: 'pdf_f_trapped', type: 'select', options: PDF_TRAPPED_OPTIONS },
    { id: 'PdfCreateDate', labelKey: 'pdf_f_create_date', type: 'text' },
    { id: 'PdfModifyDate', labelKey: 'pdf_f_modify_date', type: 'text' },
];

export const PDF_RIGHTS_FIELDS = [
    { id: 'Rights', labelKey: 'pdf_f_rights', type: 'textarea' },
    { id: 'Web', labelKey: 't3_f_web', type: 'textarea' },
];

export const PDF_META_FIELDS = [
    ...PDF_BASIC_FIELDS,
    { id: 'Genre', labelKey: 't3_f_genre', type: 'text' },
    { id: 'Tags', labelKey: 't3_f_tags_lbl', type: 'text' },
    ...PDF_PUBLISHER_FIELDS,
    ...PDF_DOCUMENT_FIELDS,
    ...PDF_RIGHTS_FIELDS,
];

export const PDF_META_FIELD_IDS = PDF_META_FIELDS.map(field => field.id);

export const PDF_SEARCHABLE_SELECT_FIELDS = new Set(['Publisher']);
