function timestampOf(release = {}) {
    const value = release.publishedAt || release.published_at || release.date || '';
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
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

export function parseReleaseMarkdown(markdown = '') {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let listItems = [];
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

        const listItem = line.match(/^\s*([-*]|\d+\.)\s+(.+)$/);
        if (listItem) {
            flushParagraph();
            listItems.push({
                ordered: /\d+\./.test(listItem[1]),
                content: parseInlineMarkdown(listItem[2]),
            });
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
