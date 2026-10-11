import { metadataSearchSourcesForBookType, UNIFIED_METADATA_API_SOURCE } from './metadataApiPolicy.js';
import { metadataSearchResultKey, searchMetadata } from './metadataSearch.js';

function firstCoverUrl(...values) {
    return values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

export function coverEditorMetadataCoverUrl(result = {}) {
    const coverUrl = firstCoverUrl(
        result.coverUrl, result.CoverUrl, result.coverCacheUrl, result.coverDataUrl,
        result.metadata?.coverUrl, result.metadata?.CoverUrl,
        result.metadata?.coverCacheUrl, result.metadata?.coverDataUrl,
    );
    if (result.apiSource !== '리디북스') return coverUrl;
    const directId = String(result.b_id || result.id || result.metadata?.b_id || result.metadata?.id || '').match(/\d+/)?.[0];
    const linkId = String(result.Web || result.link || result.metadata?.Web || result.metadata?.link || '').match(/\/books\/(\d+)/)?.[1];
    const coverId = coverUrl.match(/\/cover\/(\d+)/)?.[1];
    const id = directId || linkId || coverId;
    return id ? `https://img.ridicdn.net/cover/${id}/xxlarge?dpi=xxhdpi#1` : coverUrl;
}

export function coverEditorMetadataThumbnail(result = {}) {
    return firstCoverUrl(
        result.highQualityCoverCacheUrl,
        result.coverCacheUrl, result.metadata?.coverCacheUrl,
        result.coverDataUrl, result.metadata?.coverDataUrl,
        result.coverUrl, result.CoverUrl, result.metadata?.coverUrl, result.metadata?.CoverUrl,
    );
}

function readCoverImageSize(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const finish = (error) => {
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            const size = { width: image.naturalWidth, height: image.naturalHeight };
            image.removeAttribute('src');
            if (error) reject(error);
            else resolve(size);
        };
        const timer = setTimeout(() => finish(new Error('Cover image loading timed out')), 12000);
        image.onload = () => finish();
        image.onerror = () => finish(new Error('Cover image could not be loaded'));
        try {
            image.src = src;
        } catch (error) {
            finish(error);
        }
    });
}

export async function upgradeCoverEditorMetadataThumbnails(results, cacheCover, {
    isCancelled = () => false,
    onThumbnail = () => {},
    readImageSize = readCoverImageSize,
} = {}) {
    if (!Array.isArray(results) || typeof cacheCover !== 'function' || isCancelled()) return;
    const cachedImages = new Map();
    const imageSizes = new Map();
    const measure = src => {
        if (!imageSizes.has(src)) imageSizes.set(src, Promise.resolve().then(() => isCancelled() ? null : readImageSize(src))
            .then(size => Number.isFinite(size?.width) && size.width > 0
                && Number.isFinite(size?.height) && size.height > 0 ? size : null)
            .catch(() => null));
        return imageSizes.get(src);
    };
    let cursor = 0;
    const worker = async () => {
        while (!isCancelled() && cursor < results.length) {
            const result = results[cursor++];
            const imageUrl = coverEditorMetadataCoverUrl(result);
            const sourceUrl = firstCoverUrl(result.coverUrl, result.CoverUrl, result.metadata?.coverUrl, result.metadata?.CoverUrl);
            if (result.highQualityCoverCacheUrl || !/^https?:\/\//i.test(imageUrl) || imageUrl === sourceUrl) continue;
            const fallback = coverEditorMetadataThumbnail(result);
            try {
                if (!cachedImages.has(imageUrl)) cachedImages.set(imageUrl, Promise.resolve().then(() => {
                    if (!isCancelled()) return cacheCover(imageUrl);
                    return null;
                }));
                const cached = await cachedImages.get(imageUrl);
                if (isCancelled()) return;
                const thumbnail = firstCoverUrl(cached?.coverCacheUrl);
                if (!thumbnail || thumbnail === fallback) continue;
                const size = await measure(thumbnail);
                if (isCancelled()) return;
                if (!size) continue;
                const fallbackSize = fallback ? await measure(fallback) : null;
                if (isCancelled()) return;
                if (fallbackSize && (size.width < fallbackSize.width || size.height < fallbackSize.height
                    || (size.width === fallbackSize.width && size.height === fallbackSize.height))) continue;
                onThumbnail({ resultKey: metadataSearchResultKey(result), thumbnail, imageUrl,
                    width: size.width, height: size.height, fallback });
            } catch {
                // 고화질 이미지를 읽지 못하면 기존 검색 썸네일을 유지합니다.
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, results.length) }, worker));
}

export async function searchCoverEditorMetadata(options = {}, fetchMetadata, runtime = {}) {
    const apiSource = metadataSearchSourcesForBookType(options.bookType).some(source => source.value === options.apiSource)
        ? options.apiSource : UNIFIED_METADATA_API_SOURCE;
    const response = await searchMetadata({ ...options, apiSource }, fetchMetadata, runtime);
    const seen = new Set();
    const results = response.results.filter(result => {
        if (!coverEditorMetadataThumbnail(result)) return false;
        const key = metadataSearchResultKey(result);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return { ...response, results };
}
