function nodeText(node) {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    if (typeof node.text === 'string') return node.text;
    return Array.isArray(node.children) ? node.children.map(nodeText).join('') : '';
}

function readerText(item) {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    if (typeof item.text === 'string' && item.text) return item.text;
    if (!Array.isArray(item.blocks)) return '';
    return item.blocks.map(block => {
        if (typeof block?.text === 'string') return block.text;
        return Array.isArray(block?.nodes) ? block.nodes.map(nodeText).join('') : '';
    }).filter(Boolean).join('\n\n');
}

function normalizedText(item) {
    return readerText(item).replace(/\s+/gu, '');
}

function chapterAnchors(chapter) {
    const anchors = Array.isArray(chapter.anchors) ? chapter.anchors : [];
    return [...new Set([
        ...anchors,
        ...(Array.isArray(chapter.blocks) ? chapter.blocks : []).flatMap(block => (
            Array.isArray(block?.anchors) ? block.anchors : []
        )),
    ].filter(anchor => typeof anchor === 'string' && anchor))];
}

function chapterLayout(layouts, name) {
    if (layouts instanceof Map) return layouts.get(name);
    return layouts && Object.hasOwn(layouts, name) ? layouts[name] : null;
}

export function buildOriginalEpubPages(chapters, layouts, { scroll = false } = {}) {
    if (!Array.isArray(chapters)) return [];
    return chapters.flatMap((chapter, chapterIndex) => {
        if (!chapter || typeof chapter !== 'object') return [];
        const layout = chapterLayout(layouts, chapter.name);
        const requestedCount = Number(layout?.pageCount);
        const pageCount = !scroll && Number.isSafeInteger(requestedCount) && requestedCount > 0
            ? requestedCount
            : 1;
        const measured = Boolean(layout) && Number.isSafeInteger(requestedCount) && requestedCount > 0;
        const anchorEntries = layout?.anchors && typeof layout.anchors === 'object'
            ? Object.entries(layout.anchors).filter(([anchor, offset]) => anchor && Number.isFinite(Number(offset)))
            : [];
        const anchorsByPage = Array.from({ length: pageCount }, () => []);
        if (scroll || !measured) {
            anchorsByPage[0] = [...new Set([...chapterAnchors(chapter), ...anchorEntries.map(([anchor]) => anchor)])];
        } else {
            anchorEntries.forEach(([anchor, offset]) => {
                const pageOffset = Math.max(0, Math.min(pageCount - 1, Math.floor(Number(offset))));
                anchorsByPage[pageOffset].push(anchor);
            });
        }
        return Array.from({ length: pageCount }, (_, originalPageOffset) => ({
            name: chapter.name || '',
            title: chapter.title || '',
            chapterIndex,
            originalChapter: chapter,
            originalPageOffset,
            text: scroll || !measured
                ? readerText(chapter)
                : typeof layout.textByPage?.[originalPageOffset] === 'string'
                    ? layout.textByPage[originalPageOffset]
                    : '',
            anchors: anchorsByPage[originalPageOffset],
        }));
    });
}

function matchingChapterPages(pages, position) {
    if (!Array.isArray(pages) || !position) return [];
    const entries = pages.map((page, index) => ({ page, index, text: normalizedText(page) }));
    if (position.entryName) {
        const matches = entries.filter(({ page }) => page?.name === position.entryName);
        if (matches.length) return matches;
    }
    if (Number.isInteger(position.chapterIndex)) {
        return entries.filter(({ page }) => page?.chapterIndex === position.chapterIndex);
    }
    return [];
}

export function captureEpubReadingPosition(pages, pageIndex) {
    if (!Array.isArray(pages) || !pages.length) return null;
    const numericIndex = Number(pageIndex);
    const index = Math.max(0, Math.min(pages.length - 1, Number.isFinite(numericIndex) ? Math.floor(numericIndex) : 0));
    const page = pages[index];
    if (!page || typeof page !== 'object') return null;
    const position = {
        entryName: typeof page.name === 'string' ? page.name : '',
        ...(Number.isInteger(page.chapterIndex) ? { chapterIndex: page.chapterIndex } : {}),
    };
    const chapterPages = matchingChapterPages(pages, position);
    const chapterPageIndex = chapterPages.findIndex(entry => entry.index === index);
    if (chapterPageIndex < 0) return null;
    const totalLength = chapterPages.reduce((total, entry) => total + entry.text.length, 0);
    const precedingLength = chapterPages.slice(0, chapterPageIndex).reduce((total, entry) => total + entry.text.length, 0);
    const textQuote = chapterPages[chapterPageIndex].text.slice(0, 100);
    return {
        ...position,
        chapterProgress: totalLength > 0
            ? precedingLength / totalLength
            : chapterPageIndex / Math.max(1, chapterPages.length - 1),
        ...(textQuote ? { textQuote } : {}),
    };
}

export function resolveEpubReadingPosition(pages, position) {
    const chapterPages = matchingChapterPages(pages, position);
    if (!chapterPages.length) return 0;
    const numericProgress = Number(position.chapterProgress);
    const progress = Math.max(0, Math.min(1, Number.isFinite(numericProgress) ? numericProgress : 0));
    const chapterText = chapterPages.map(entry => entry.text).join('');
    if (!chapterText.length) {
        return chapterPages[Math.round(progress * (chapterPages.length - 1))].index;
    }
    let targetOffset = progress * chapterText.length;
    const quote = typeof position.textQuote === 'string' ? normalizedText(position.textQuote).slice(0, 100) : '';
    if (quote) {
        let match = chapterText.indexOf(quote);
        let closestMatch = -1;
        let closestDistance = Infinity;
        while (match >= 0) {
            const distance = Math.abs(match - targetOffset);
            if (distance < closestDistance) {
                closestMatch = match;
                closestDistance = distance;
            }
            match = chapterText.indexOf(quote, match + 1);
        }
        if (closestMatch >= 0) targetOffset = closestMatch;
    }
    let accumulatedLength = 0;
    for (const entry of chapterPages) {
        accumulatedLength += entry.text.length;
        if (targetOffset < accumulatedLength - 1e-7) return entry.index;
    }
    return chapterPages.at(-1).index;
}
