const RELEASE_IMAGE_CDN_HOSTS = new Set([
    'user-images.githubusercontent.com',
    'private-user-images.githubusercontent.com',
    'secured-user-images.githubusercontent.com',
]);
const MAX_RELEASE_IMAGE_DIMENSION = 4096;
const RELEASE_HTML_ENTITIES = Object.freeze({
    amp: '&',
    apos: "'",
    gt: '>',
    ldquo: '“',
    lsquo: '‘',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    rdquo: '”',
    rsquo: '’',
});

function decodeReleaseHtmlEntities(value = '') {
    return String(value).replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, (entityText, entity) => {
        if (!entity.startsWith('#')) {
            return RELEASE_HTML_ENTITIES[entity.toLowerCase()] ?? entityText;
        }
        const hexadecimal = entity[1]?.toLowerCase() === 'x';
        const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff) return entityText;
        try {
            return String.fromCodePoint(codePoint);
        } catch {
            return entityText;
        }
    });
}

function timestampOf(release = {}) {
    const value = release.publishedAt || release.published_at || release.date || '';
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function parseHtmlAttributes(source = '') {
    const attributes = {};
    const attributePattern = /([a-z][a-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    let match;
    while ((match = attributePattern.exec(source)) !== null) {
        const name = match[1].toLowerCase();
        if (Object.prototype.hasOwnProperty.call(attributes, name)) continue;
        attributes[name] = decodeReleaseHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return attributes;
}

function normalizeReleaseImageDimension(value = '') {
    const source = String(value || '').trim();
    if (!/^\d+$/.test(source)) return null;
    const dimension = Number(source);
    if (!Number.isSafeInteger(dimension) || dimension < 1) return null;
    return Math.min(dimension, MAX_RELEASE_IMAGE_DIMENSION);
}

export function normalizeReleaseImageUrl(value = '') {
    try {
        const url = new URL(decodeReleaseHtmlEntities(String(value || '').trim()));
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
        const hostname = url.hostname.toLowerCase();
        const isGithubAttachment = hostname === 'github.com'
            && /^\/user-attachments\/assets\/[a-z0-9-]+\/?$/i.test(url.pathname);
        const isGithubImageCdn = RELEASE_IMAGE_CDN_HOSTS.has(hostname) && url.pathname !== '/';
        return isGithubAttachment || isGithubImageCdn ? url.toString() : '';
    } catch {
        return '';
    }
}

export function parseReleaseImageLine(line = '') {
    const source = String(line || '').trim();
    const htmlImage = source.match(/^<img\b([^<>]*)\/?\s*>$/i);
    if (htmlImage) {
        const attributes = parseHtmlAttributes(htmlImage[1]);
        const src = normalizeReleaseImageUrl(attributes.src);
        if (!src) return null;
        const width = normalizeReleaseImageDimension(attributes.width);
        const height = normalizeReleaseImageDimension(attributes.height);
        return {
            type: 'image',
            src,
            alt: String(attributes.alt || '').slice(0, 500),
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
        };
    }

    const markdownImage = source.match(/^!\[([^\]]*)\]\(\s*(https:\/\/[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)$/i);
    if (!markdownImage) return null;
    const src = normalizeReleaseImageUrl(markdownImage[2]);
    if (!src) return null;
    return {
        type: 'image',
        src,
        alt: decodeReleaseHtmlEntities(markdownImage[1]).slice(0, 500),
    };
}

export function normalizeReleaseList(releases = []) {
    return [...(Array.isArray(releases) ? releases : [])]
        .map((release, index) => ({
            id: release.id || release.tag || release.name || `release-${index}`,
            name: release.name || release.tag || 'Release',
            tag: release.tag || '',
            date: String(release.date || release.publishedAt || release.published_at || '').slice(0, 10),
            publishedAt: release.publishedAt || release.published_at || release.date || '',
            body: String(release.body || ''),
            url: /^https:\/\/github\.com\//i.test(String(release.url || ''))
                ? String(release.url)
                : '',
            draft: Boolean(release.draft),
            prerelease: Boolean(release.prerelease),
        }))
        .sort((left, right) => timestampOf(right) - timestampOf(left));
}

export function parseInlineMarkdown(text = '') {
    const tokens = [];
    const source = String(text);
    const inlinePattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let cursor = 0;
    let match;

    while ((match = inlinePattern.exec(source)) !== null) {
        if (match.index > cursor) {
            tokens.push({ type: 'text', value: source.slice(cursor, match.index) });
        }
        if (match[1] && match[2]) {
            tokens.push({
                type: 'link',
                label: match[1],
                url: match[2],
            });
        } else if (match[3]) {
            tokens.push({ type: 'strong', value: match[3] });
        } else {
            tokens.push({ type: 'code', value: match[4] });
        }
        cursor = match.index + match[0].length;
    }

    if (cursor < source.length) {
        tokens.push({ type: 'text', value: source.slice(cursor) });
    }
    return tokens.length > 0 ? tokens : [{ type: 'text', value: source }];
}

function listIndentWidth(indent = '') {
    let width = 0;
    for (const character of indent) {
        if (character === '\t') {
            width += 4 - (width % 4);
        } else {
            width += 1;
        }
    }
    return width;
}

export function parseReleaseMarkdown(markdown = '') {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let listItems = [];
    let listStack = [];
    let codeLines = [];
    let inCode = false;

    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        blocks.push({
            type: 'paragraph',
            content: parseInlineMarkdown(paragraph.join('\n')),
        });
        paragraph = [];
    };
    const flushList = () => {
        if (listItems.length === 0) return;
        blocks.push({ type: 'list', items: listItems });
        listItems = [];
        listStack = [];
    };
    const flushCode = () => {
        blocks.push({ type: 'code', value: codeLines.join('\n') });
        codeLines = [];
    };

    for (const line of lines) {
        if (/^```/.test(line)) {
            flushParagraph();
            flushList();
            if (inCode) flushCode();
            inCode = !inCode;
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            continue;
        }

        const image = parseReleaseImageLine(line);
        if (image) {
            flushParagraph();
            flushList();
            blocks.push(image);
            continue;
        }

        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            flushList();
            blocks.push({
                type: 'heading',
                level: heading[1].length,
                content: parseInlineMarkdown(heading[2]),
            });
            continue;
        }

        const listItem = line.match(/^([ \t]*)([-*]|\d+\.)[ \t]+(.+)$/);
        if (listItem) {
            flushParagraph();
            const indent = listIndentWidth(listItem[1]);
            const item = {
                ordered: /\d+\./.test(listItem[2]),
                content: parseInlineMarkdown(listItem[3]),
                children: [],
            };

            if (listStack.length === 0) {
                listStack.push({ indent, items: listItems });
            } else {
                while (listStack.length > 1 && indent < listStack[listStack.length - 1].indent) {
                    listStack.pop();
                }

                const currentLevel = listStack[listStack.length - 1];
                if (indent > currentLevel.indent) {
                    const parentItem = currentLevel.items[currentLevel.items.length - 1];
                    if (parentItem) {
                        listStack.push({ indent, items: parentItem.children });
                    }
                } else if (indent < currentLevel.indent) {
                    flushList();
                    listStack.push({ indent, items: listItems });
                }
            }

            listStack[listStack.length - 1].items.push(item);
            continue;
        }

        if (!line.trim()) {
            flushParagraph();
            flushList();
            continue;
        }

        flushList();
        paragraph.push(line);
    }

    if (inCode || codeLines.length > 0) flushCode();
    flushParagraph();
    flushList();
    return blocks;
}
