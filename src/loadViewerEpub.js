export async function loadViewerEpub(api, sessionId, isCurrent) {
    const result = await api.getEpubText(sessionId, true);
    if (!result.chapterPackets) return result;
    const { chapterPackets, resourceUrls, ...book } = result;
    const chapters = [];
    for (const bytes of chapterPackets) {
        if (!isCurrent()) return null;
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        const text = await new Response(stream).text();
        if (!isCurrent()) return null;
        const records = JSON.parse(text);
        for (const [heading, blocks] of records) {
            if (heading) {
                heading.original.resourceUrls = resourceUrls;
                heading.blocks = blocks;
                chapters.push(heading);
            } else {
                chapters.at(-1).blocks.push(...blocks);
            }
        }
    }
    return { ...book, chapters };
}
