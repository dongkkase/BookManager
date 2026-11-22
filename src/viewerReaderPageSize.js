export const DEFAULT_READER_PAPER_SIZE = 'shinguk';

export const READER_PAPER_SIZES = [
    { id: 'shinguk', width: 152, height: 225, label: '신국판 (152 × 225 mm)', labelKey: 'viewer.settings.paper_shinguk' },
    { id: 'a5', width: 148, height: 210, label: 'A5 (148 × 210 mm)', labelKey: 'viewer.settings.paper_a5' },
    { id: '46', width: 128, height: 188, label: '사륙판 (128 × 188 mm)', labelKey: 'viewer.settings.paper_46' },
    { id: 'a6', width: 105, height: 148, label: '문고판 A6 (105 × 148 mm)', labelKey: 'viewer.settings.paper_a6' },
    { id: 'poetry', width: 128, height: 210, label: '시집판 (128 × 210 mm)', labelKey: 'viewer.settings.paper_poetry' },
    { id: 'paperback', width: 127, height: 203.2, label: '페이퍼백 (127 × 203.2 mm)', labelKey: 'viewer.settings.paper_paperback' },
    { id: 'crown', width: 176, height: 248, label: '크라운판 (176 × 248 mm)', labelKey: 'viewer.settings.paper_crown' },
    { id: 'b5', width: 182, height: 257, label: 'B5 (182 × 257 mm)', labelKey: 'viewer.settings.paper_b5' },
    { id: '46-double', width: 188, height: 257, label: '사륙배판 (188 × 257 mm)', labelKey: 'viewer.settings.paper_46_double' },
    { id: 'a4', width: 210, height: 297, label: '국배판 A4 (210 × 297 mm)', labelKey: 'viewer.settings.paper_a4' },
    { id: 'square', width: 200, height: 200, label: '정사각판 (200 × 200 mm)', labelKey: 'viewer.settings.paper_square' },
    { id: 'screen', label: '화면에 맞춤', labelKey: 'viewer.settings.paper_screen' },
];

export function normalizeReaderPaperSize(value) {
    return READER_PAPER_SIZES.some(paper => paper.id === value) ? value : DEFAULT_READER_PAPER_SIZE;
}

export function readerPageFrameSize({ viewport, flowMode, paperSize, widthFit = false, stagePadding = 14 } = {}) {
    const viewportWidth = Number(viewport?.width);
    const viewportHeight = Number(viewport?.height);
    const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 900;
    const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 700;
    const columns = flowMode === 'spread' ? 2 : 1;
    const paper = READER_PAPER_SIZES.find(item => item.id === normalizeReaderPaperSize(paperSize));

    // Continuous reading and the legacy screen layout keep their viewport-based dimensions.
    if (flowMode === 'scroll' || paper.id === 'screen') {
        const stageWidth = Math.max(280, width - stagePadding * 2);
        const availableWidth = Math.max(220, (stageWidth - (columns === 2 ? 0 : 10)) / columns);
        return {
            width: Math.min(widthFit ? availableWidth : columns === 2 ? 680 : 900, availableWidth),
            height: Math.max(260, height - stagePadding * 2),
        };
    }

    const ratio = paper.width / paper.height;
    const availableWidth = Math.max(1, width - stagePadding * 2) / columns;
    const availableHeight = Math.max(1, height - stagePadding * 2);
    const pageHeight = Math.min(availableHeight, availableWidth / ratio);
    return { width: pageHeight * ratio, height: pageHeight };
}
