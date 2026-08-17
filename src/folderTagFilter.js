const VALUE_SEPARATOR = /[,;|\n\r]+/u;
const VALUE_COLLATOR = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

function normalizedValue(value = '') {
    return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

export function sortFolderTagValues(values = [], sortMode = 'frequency') {
    return [...values].sort((left, right) => {
        if (sortMode === 'frequency') {
            const countDifference = (Number(right.count) || 0) - (Number(left.count) || 0);
            if (countDifference !== 0) return countDifference;
        }
        return VALUE_COLLATOR.compare(left.value, right.value);
    });
}

function splitValues(...values) {
    const unique = new Map();
    values
        .flatMap(value => Array.isArray(value) ? value : [value])
        .flatMap(value => String(value || '').split(VALUE_SEPARATOR))
        .map(value => value.trim())
        .filter(Boolean)
        .forEach(value => {
            const normalized = normalizedValue(value);
            if (normalized && !unique.has(normalized)) unique.set(normalized, value);
        });
    return [...unique.values()];
}

function fieldValue(file = {}, field = '') {
    if (file[field] !== undefined && file[field] !== null) return file[field];
    const metadata = file.metadata || {};
    if (metadata[field] !== undefined && metadata[field] !== null) return metadata[field];
    const pascalField = field.replace(/(^|_)([a-z])/g, (_match, _prefix, letter) => letter.toUpperCase());
    return metadata[pascalField] ?? '';
}

function valuesFromFields(file, fields) {
    return splitValues(fields.map(field => fieldValue(file, field)));
}

function isPdfFile(file = {}) {
    const type = String(file.book_type || file.bookType || '').toLowerCase();
    const extension = String(file.ext || file.extension || '').replace(/^\./, '').toLowerCase();
    return type === 'pdf' || extension === 'pdf';
}

function yearValues(file = {}) {
    const rawValues = [
        fieldValue(file, 'year'),
        fieldValue(file, 'date'),
        fieldValue(file, 'publish_date'),
    ];
    const years = rawValues.flatMap(value => String(value || '').match(/\b(?:1\d{3}|2\d{3})\b/g) || []);
    return splitValues(years);
}

function extensionValues(file = {}) {
    const source = fieldValue(file, 'ext')
        || fieldValue(file, 'extension')
        || String(file.name || file.path || '').match(/\.[^.\\/]+$/u)?.[0]
        || '';
    const extension = String(source).trim().replace(/^\./, '').toLocaleLowerCase();
    return extension ? [extension] : [];
}

export const FOLDER_TAG_CATEGORIES = Object.freeze([
    { id: 'genre', labelKey: 'folder_tag_category_genre', values: file => valuesFromFields(file, ['genre', 'genres']) },
    {
        id: 'tags',
        labelKey: 'folder_tag_category_tags',
        values: file => isPdfFile(file) ? [] : valuesFromFields(file, ['tags', 'keywords', 'categories', 'category']),
    },
    {
        id: 'pdf_keywords',
        labelKey: 'folder_tag_category_pdf_keywords',
        values: file => isPdfFile(file) ? valuesFromFields(file, ['tags', 'keywords']) : [],
    },
    { id: 'publisher', labelKey: 'folder_tag_category_publisher', values: file => valuesFromFields(file, ['publisher']) },
    { id: 'writer', labelKey: 'folder_tag_category_writer', values: file => valuesFromFields(file, ['writer']) },
    { id: 'penciller', labelKey: 'folder_tag_category_penciller', values: file => valuesFromFields(file, ['penciller']) },
    { id: 'inker', labelKey: 'folder_tag_category_inker', values: file => valuesFromFields(file, ['inker']) },
    { id: 'colorist', labelKey: 'folder_tag_category_colorist', values: file => valuesFromFields(file, ['colorist']) },
    { id: 'letterer', labelKey: 'folder_tag_category_letterer', values: file => valuesFromFields(file, ['letterer']) },
    { id: 'cover_artist', labelKey: 'folder_tag_category_cover_artist', values: file => valuesFromFields(file, ['cover_artist']) },
    { id: 'editor', labelKey: 'folder_tag_category_editor', values: file => valuesFromFields(file, ['editor']) },
    { id: 'age_rating', labelKey: 'folder_tag_category_age_rating', values: file => valuesFromFields(file, ['age_rating']) },
    { id: 'format', labelKey: 'folder_tag_category_format', values: file => valuesFromFields(file, ['format']) },
    { id: 'characters', labelKey: 'folder_tag_category_characters', values: file => valuesFromFields(file, ['characters']) },
    { id: 'year', labelKey: 'folder_tag_category_year', values: yearValues },
    { id: 'extension', labelKey: 'folder_tag_category_extension', values: extensionValues },
]);

const CATEGORY_BY_ID = new Map(FOLDER_TAG_CATEGORIES.map(category => [category.id, category]));

export function folderTagSelectionKey(selection = {}) {
    return `${selection.categoryId || ''}:${normalizedValue(selection.value)}`;
}

export function collectFolderTagCategories(files = []) {
    const sourceFiles = Array.isArray(files) ? files.filter(file => file && file.is_folder !== true) : [];
    return FOLDER_TAG_CATEGORIES.map(category => {
        const values = new Map();
        sourceFiles.forEach(file => {
            category.values(file).forEach(value => {
                const normalized = normalizedValue(value);
                if (!normalized) return;
                const current = values.get(normalized);
                values.set(normalized, current
                    ? { ...current, count: current.count + 1 }
                    : { value, normalized, count: 1 });
            });
        });
        return {
            id: category.id,
            labelKey: category.labelKey,
            values: [...values.values()].sort((left, right) => VALUE_COLLATOR.compare(left.value, right.value)),
        };
    }).filter(category => category.values.length > 0);
}

export function filterFilesByFolderTags(files = [], selections = [], matchMode = 'all') {
    if (!Array.isArray(files) || !Array.isArray(selections) || selections.length === 0) return files;
    const conditions = selections
        .map(selection => ({
            category: CATEGORY_BY_ID.get(selection?.categoryId),
            value: normalizedValue(selection?.value),
        }))
        .filter(condition => condition.category && condition.value);
    if (conditions.length === 0) return files;

    return files.filter(file => {
        const matches = conditions.map(condition => condition.category.values(file)
            .some(value => normalizedValue(value) === condition.value));
        return matchMode === 'any' ? matches.some(Boolean) : matches.every(Boolean);
    });
}
