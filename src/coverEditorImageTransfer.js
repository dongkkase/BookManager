const IMAGE_MIME = /^image\//i;
const DIRECT_URL = /^[a-z][a-z0-9+.-]*:/i;

export const isCoverImagePath = path => /\.(?:jpe?g|png|webp|gif|bmp)$/i.test(String(path || ''));

const isImageFile = file => Boolean(file && (IMAGE_MIME.test(file.type || '') || isCoverImagePath(file.name)));
const readData = (dataTransfer, type) => {
    try {
        return String(dataTransfer?.getData?.(type) || '');
    } catch {
        return '';
    }
};

function imageFiles(dataTransfer) {
    const files = Array.from(dataTransfer?.files || []).filter(isImageFile);
    if (files.length) return files;
    return Array.from(dataTransfer?.items || [])
        .filter(item => item.kind === 'file' && IMAGE_MIME.test(item.type || ''))
        .map(item => item.getAsFile?.())
        .filter(Boolean);
}

export function isCoverImageTransfer(dataTransfer) {
    const files = Array.from(dataTransfer?.files || []);
    if (files.length) return files.every(isImageFile);
    const items = Array.from(dataTransfer?.items || []).filter(item => item.kind === 'file');
    if (items.length) return items.every(item => IMAGE_MIME.test(item.type || ''));
    const types = Array.from(dataTransfer?.types || []);
    return types.includes('text/html') || types.includes('text/uri-list')
        || DIRECT_URL.test(readData(dataTransfer, 'text/plain').trim());
}

function validatedUrl(value) {
    const url = String(value || '').trim();
    if (/^data:image\/(?:jpeg|png|webp|gif|bmp|x-ms-bmp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
    if (/[\u0000-\u001f\u007f]/.test(url)) return null;
    try {
        const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
        return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
    } catch {
        return null;
    }
}

const singleUrl = values => {
    if (values.length > 1) return { errorKey: 'cover_editor_drop_one' };
    const url = validatedUrl(values[0]);
    return url ? { url } : { errorKey: 'cover_editor_image_import_failed' };
};

const parseInertHtml = html => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
};

export function extractCoverImageTransfer(dataTransfer, { allowUrls = true, parseHtml = parseInertHtml } = {}) {
    const files = imageFiles(dataTransfer);
    if (files.length > 1) return { errorKey: 'cover_editor_drop_one' };
    const fileTransfer = files.length === 1 ? { file: files[0] } : null;
    if (fileTransfer && files[0].size !== 0) return fileTransfer;
    if (!allowUrls) return fileTransfer;

    const html = readData(dataTransfer, 'text/html');
    if (html) {
        try {
            const fragment = parseHtml(html);
            const images = Array.from(fragment.querySelectorAll ? fragment.querySelectorAll('img') : fragment.getElementsByTagName('img'));
            if (images.length) return singleUrl(images.map(image => image.getAttribute('src')));
        } catch {
            return { errorKey: 'cover_editor_image_import_failed' };
        }
    }

    const uriList = readData(dataTransfer, 'text/uri-list').split(/\r?\n/)
        .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    if (uriList.length) return singleUrl(uriList);

    const plain = readData(dataTransfer, 'text/plain').trim();
    if (!DIRECT_URL.test(plain)) return fileTransfer;
    return singleUrl(plain.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
}
