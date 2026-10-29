export function pdfAutoSpreadStepSize(index, pageCount, ratios = {}) {
    return index >= pageCount - 1 || ratios[index] > 1 || ratios[index + 1] > 1 ? 1 : 2;
}

export async function scanViewerPdfPageRatios(pdfDocument, {
    getCurrentIndex = () => 0,
    initialRatios = {},
    onRatios = () => {},
    isCancelled = () => false,
    yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
} = {}) {
    const pageCount = Number.isSafeInteger(pdfDocument?.numPages) && pdfDocument.numPages > 0 ? pdfDocument.numPages : 0;
    const ratios = { ...initialRatios };
    let nextIndex = 0;
    let batchSize = 0;
    let measured = 0;
    let dirty = false;
    const publish = () => {
        onRatios({ ...ratios });
        dirty = false;
    };
    while (!isCancelled()) {
        const currentIndex = Math.max(0, Math.min(pageCount - 1, Math.floor(Number(getCurrentIndex()) || 0)));
        const priority = [currentIndex, currentIndex + 1, currentIndex - 1].find(index => (
            index >= 0 && index < pageCount && !Object.hasOwn(ratios, index)
        ));
        while (nextIndex < pageCount && Object.hasOwn(ratios, nextIndex)) nextIndex += 1;
        const index = priority ?? nextIndex;
        if (index >= pageCount) break;
        let ratio = 0;
        try {
            const page = await pdfDocument.getPage(index + 1);
            if (isCancelled()) return;
            const viewport = page.getViewport({ scale: 1 });
            if (Number.isFinite(viewport.width) && viewport.width > 0
                && Number.isFinite(viewport.height) && viewport.height > 0) {
                ratio = viewport.width / viewport.height;
            }
        } catch {
            if (isCancelled()) return;
        }
        ratios[index] = ratio;
        batchSize += 1;
        measured += 1;
        dirty = true;
        if (measured <= 3 || (priority !== undefined && ratio > 1) || batchSize >= 8) publish();
        if (batchSize >= 8) {
            batchSize = 0;
            await yieldControl();
        }
    }
    if (dirty && !isCancelled()) publish();
}
