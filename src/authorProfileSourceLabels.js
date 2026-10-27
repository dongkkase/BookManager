const COMMON_SOURCE_LABELS = {
    wikidata: 'Wikidata',
    wikipedia: 'Wikipedia',
    openlibrary: 'Open Library',
};

const SOURCE_LABELS = {
    ko: { ...COMMON_SOURCE_LABELS, aladin: '알라딘', kyobo: '교보문고', cartoon: '한국만화가협회', kmas: '한국웹툰', naver: '네이버' },
    en: { ...COMMON_SOURCE_LABELS, aladin: 'Aladin', kyobo: 'Kyobo Book Centre', cartoon: 'Korea Cartoonists Association', kmas: 'Korean Webtoons', naver: 'Naver' },
    ja: { ...COMMON_SOURCE_LABELS, aladin: 'アラジン', kyobo: '教保文庫', cartoon: '韓国漫画家協会', kmas: '韓国ウェブトゥーン', naver: 'Naver' },
};

export function authorProfileSourceLabels(language = 'ko') {
    return SOURCE_LABELS[language] || SOURCE_LABELS.ko;
}

export function authorProfileSourceName(provider, language = 'ko') {
    return authorProfileSourceLabels(language)[provider] || '';
}
