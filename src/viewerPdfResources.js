export function viewerPdfResourceOptions(workerUrl, { baseUrl, development = false }) {
    const resourceBase = development
        ? new URL('/assets/pdfjs/', baseUrl)
        : new URL('./pdfjs/', new URL(workerUrl, baseUrl));
    return {
        cMapUrl: new URL('cmaps/', resourceBase).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', resourceBase).href,
    };
}
