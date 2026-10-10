import { decodeHTML } from 'entities';

function attributeValue(tag, name) {
    const match = String(tag).match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return decodeHTML(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function findDivByClasses(html, classes, start = 0) {
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = start;
    let tag;
    while ((tag = tags.exec(html))) {
        if (/^<\//.test(tag[0])) continue;
        const classNames = attributeValue(tag[0], 'class').split(/\s+/);
        if (!classes.every(name => classNames.includes(name))) continue;
        const contentStart = tags.lastIndex;
        let depth = 1;
        let nested;
        while ((nested = tags.exec(html))) {
            depth += /^<\//.test(nested[0]) ? -1 : 1;
            if (depth === 0) {
                return { html: html.slice(contentStart, nested.index), end: tags.lastIndex };
            }
        }
        return null;
    }
    return null;
}

function cleanText(value = '', multiline = false) {
    const html = String(value).replace(/\s+/g, ' ')
        .replace(/<br\b[^>]*>/gi, '\n')
        .replace(/<\/(?:p|div)>/gi, '\n')
        .replace(/<[^>]*>/g, '');
    const text = decodeHTML(html);
    return multiline
        ? text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim()
        : text.replace(/\s+/g, ' ').trim();
}

function coverUrl(basicHtml) {
    const imageBlock = findDivByClasses(basicHtml, ['vd-image']);
    const imageTag = imageBlock?.html.match(/<img\b[^>]*>/i)?.[0] || '';
    const source = attributeValue(imageTag, 'src').trim();
    if (!source || /\/noimages\./i.test(source)) return '';
    try {
        const url = new URL(source, 'https://www.kmas.or.kr/');
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function publicationDate(period = '') {
    const match = period.match(/^(\d{4})-(\d{2})-(\d{2})(?=\s|$)/);
    if (!match) return { PubDate: '', Year: '', Month: '', Day: '' };
    const [, year, month, day] = match;
    const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[0]) {
        return { PubDate: '', Year: '', Month: '', Day: '' };
    }
    return { PubDate: match[0], Year: year, Month: String(Number(month)), Day: String(Number(day)) };
}

export function parseKmasDetailHtml(html = '') {
    const source = String(html || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const basic = findDivByClasses(source, ['detail-basic', 'with-img']);
    if (!basic) return {};
    const title = cleanText(basic.html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    if (!title) return {};

    const fields = new Map();
    for (const row of basic.html.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)) {
        const label = cleanText(row[1].match(/<dt\b[^>]*>([\s\S]*?)<\/dt>/i)?.[1]);
        const value = cleanText(row[1].match(/<dd\b[^>]*>([\s\S]*?)<\/dd>/i)?.[1]);
        if (label && value) fields.set(label, value);
    }

    let summary = '';
    let position = basic.end;
    let section;
    while ((section = findDivByClasses(source, ['detail-basic', 'with-fold'], position))) {
        position = section.end;
        const heading = cleanText(section.html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
        if (!/^(?:작품\s*)?줄거리$/.test(heading)) continue;
        summary = cleanText(findDivByClasses(section.html, ['detail-con'])?.html, true);
        break;
    }
    const period = fields.get('연재기간') || '';
    return {
        Title: title,
        Series: title,
        LocalizedSeries: title,
        Writer: fields.get('글작가') || '',
        Penciller: fields.get('그림작가') || '',
        Publisher: fields.get('연재매체') || '',
        Summary: summary,
        Genre: fields.get('대표장르') || '',
        CoverUrl: coverUrl(basic.html),
        ...publicationDate(period),
        Notes: period ? `연재기간: ${period}` : '',
    };
}
