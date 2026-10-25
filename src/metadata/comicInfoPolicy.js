export const COMICINFO_FIELDS = [
    'Title', 'Series', 'Number', 'Count', 'Volume',
    'AlternateSeries', 'AlternateNumber', 'AlternateCount', 'Summary', 'Notes',
    'Year', 'Month', 'Day', 'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer',
    'CoverArtist', 'Editor', 'Translator', 'Publisher', 'Imprint', 'Genre', 'Tags',
    'Web', 'PageCount', 'LanguageISO', 'Format', 'BlackAndWhite', 'Manga',
    'Characters', 'Teams', 'Locations', 'ScanInformation', 'StoryArc',
    'StoryArcNumber', 'SeriesGroup', 'AgeRating', 'Pages', 'CommunityRating',
    'MainCharacterOrTeam', 'Review', 'GTIN',
];

export const COMICINFO_AGE_RATINGS = [
    'Unknown', 'Adults Only 18+', 'Early Childhood', 'Everyone', 'Everyone 10+',
    'G', 'Kids to Adults', 'M', 'MA15+', 'Mature 17+', 'PG', 'R18+',
    'Rating Pending', 'Teen', 'X18+',
];

const ageAliases = new Map(Object.entries({
    'all ages': 'Everyone',
    'kids / children': 'Kids to Adults',
    'young adult / teen': 'Teen',
    'older teen / mature': 'Mature 17+',
    'adult / mature audiences': 'Adults Only 18+',
    '전체 이용가': 'Everyone',
    '전체이용가': 'Everyone',
    '전체 연령가': 'Everyone',
    '전체연령가': 'Everyone',
    '전체': 'Everyone',
    '12세 이상': 'Teen',
    '12세 이용가': 'Teen',
    '15세 이상': 'MA15+',
    '15세 이용가': 'MA15+',
    '18세 이상': 'Adults Only 18+',
    '19세 이상': 'Adults Only 18+',
    '19세 이용가': 'Adults Only 18+',
    '청소년 이용불가': 'Adults Only 18+',
}).map(([alias, rating]) => [alias.replace(/\s+/g, ''), rating]));

const ageLimitRatings = new Map([
    ['0', 'Everyone'],
    ['10', 'Everyone 10+'],
    ['12', 'Teen'],
    ['15', 'MA15+'],
    ['17', 'Mature 17+'],
    ['18', 'Adults Only 18+'],
    ['19', 'Adults Only 18+'],
]);

export function normalizeComicInfoAgeRating(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const canonical = COMICINFO_AGE_RATINGS.find(rating => rating.toLowerCase() === text.toLowerCase());
    if (canonical) return canonical;
    const compact = text.toLowerCase().replace(/\s+/g, '');
    const alias = ageAliases.get(compact);
    if (alias) return alias;
    // Only explicit age aliases are converted; unfamiliar regional ratings remain unresolved.
    const age = compact.match(/^(\d+)(?:\+|(?:세)?(?:이상)?(?:이용가)?)$/)?.[1];
    return ageLimitRatings.get(age) || null;
}

function ratingNumber(value) {
    const text = String(value ?? '').trim();
    return text && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number(text) >= 0 ? Number(text) : NaN;
}

export function comicInfoRatingToApp(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const rating = ratingNumber(text);
    if (!Number.isFinite(rating) || rating > 10) return text;
    // Values above five are unambiguous legacy BookManager ten-point ratings.
    return String(Math.round((rating <= 5 ? rating * 2 : rating) * 100) / 100);
}

export function appRatingToComicInfo(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const rating = ratingNumber(text);
    if (!Number.isFinite(rating) || rating > 10) {
        throw new Error('ComicInfo CommunityRating requires an app rating from 0 to 10.');
    }
    return String(Math.round((rating / 2 + Number.EPSILON) * 10) / 10);
}
