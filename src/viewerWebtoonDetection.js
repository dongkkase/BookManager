// Check archive size first, then image proportions and continuity.
export function isWebtoonByArchiveSize(pageCount, totalEncodedBytes) {
    return Number.isSafeInteger(pageCount) && pageCount > 0
        && Number.isSafeInteger(totalEncodedBytes) && totalEncodedBytes >= pageCount
        && totalEncodedBytes / pageCount <= 128 * 1024;
}

export function getWebtoonSampleIndices(pageCount) {
    if (!Number.isSafeInteger(pageCount) || pageCount <= 0) return [];
    if (pageCount === 1) return [0];
    if (pageCount <= 13) return Array.from({ length: pageCount - 1 }, (_, index) => index + 1);
    const indices = new Set();
    for (const fraction of [0, 1 / 3, 2 / 3, 1]) {
        const start = 1 + Math.round((pageCount - 4) * fraction);
        for (let offset = 0; offset < 3; offset += 1) indices.add(start + offset);
    }
    return [...indices].sort((left, right) => left - right);
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function validSamples(pageCount, samples) {
    const expected = getWebtoonSampleIndices(pageCount);
    return expected.length > 0 && expected.length === samples.length && samples.every((sample, index) => (
        sample.index === expected[index]
        && Number.isFinite(sample.width) && sample.width >= 160
        && Number.isFinite(sample.height) && sample.height > 0
        && Number.isFinite(sample.encodedBytes) && sample.encodedBytes > 0
    ));
}

function contentSamples(pageCount, samples) {
    const last = samples[samples.length - 1];
    const width = median(samples.map(sample => sample.width));
    const closingCard = last.height / last.width <= 1.5 && Math.abs(last.width / width - 1) > 0.05;
    const shortFinalSlice = last.height / last.width < 0.2 && Math.abs(last.width / width - 1) <= 0.02;
    // Closing cards and short remainders do not describe the body or add seam evidence.
    // Interior layout changes still count.
    return samples.length >= 8 && last.index === pageCount - 1
        && (closingCard || shortFinalSlice)
        ? samples.slice(0, -1) : samples;
}

export function hasLongWebtoonPages(pageCount, samples) {
    if (!validSamples(pageCount, samples)) return false;
    samples = contentSamples(pageCount, samples);
    const ratios = samples.map(sample => sample.height / sample.width);
    const width = median(samples.map(sample => sample.width));
    const consistent = samples.filter(sample => Math.abs(sample.width / width - 1) <= 0.05).length;
    if (consistent / samples.length < 0.9) return false;
    // A single very tall episode needs no filename or file-count assumption.
    if (samples.length <= 2) return ratios.every(ratio => ratio >= 4);
    return median(ratios) >= 3.2 && ratios.filter(ratio => ratio >= 2.8).length / ratios.length >= 0.9;
}

export function isWebtoonByArchiveRatios(pageCount, totalEncodedBytes, samples = []) {
    if (!Number.isSafeInteger(pageCount) || pageCount <= 0
        || !Number.isSafeInteger(totalEncodedBytes) || totalEncodedBytes < pageCount
        || totalEncodedBytes / pageCount <= 128 * 1024 || totalEncodedBytes / pageCount > 200 * 1024
        || !Array.isArray(samples) || !validSamples(pageCount, samples)) return false;
    const content = contentSamples(pageCount, samples);
    const ratios = content.map(sample => sample.height / sample.width);
    if (content.length >= 8 && median(ratios) >= 2
        && ratios.filter(ratio => ratio >= 1.8).length / ratios.length >= 0.9) return true;
    // Landscape spreads are common in paged comics and do not demonstrate variable webtoon cuts.
    const body = content.filter(sample => sample.height >= sample.width);
    if (body.length < 8) return false;
    const typicalRatio = median(body.map(sample => sample.height / sample.width));
    const varying = body.filter(sample => {
        const ratio = sample.height / sample.width;
        return ratio <= typicalRatio * 0.85 || ratio >= typicalRatio * 1.15;
    });
    // Ratio changes remain evidence within one sampled group; region separation is only needed for seams.
    return varying.length >= 2;
}

function edgeDistance(left, right) {
    return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0) / left.length / 255;
}

function informativeEdge(edge) {
    if (!edge || edge.length !== 192 || edge.some(value => !Number.isFinite(value) || value < 0 || value > 255)) return false;
    const luminance = Array.from({ length: 64 }, (_, index) => (
        (edge[index * 3] + edge[index * 3 + 1] + edge[index * 3 + 2]) / 3
    ));
    const mean = luminance.reduce((sum, value) => sum + value, 0) / 64;
    const deviation = Math.sqrt(luminance.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 64);
    const changes = luminance.slice(1).filter((value, index) => Math.abs(value - luminance[index]) >= 10).length;
    return deviation >= 18 && changes >= 8;
}

function sampleRegion(pageCount, pageIndex) {
    if (pageCount <= 13) return Math.min(2, Math.floor(pageIndex * 3 / pageCount));
    // Large books are sampled in four separate triplets. Dividing the book into
    // thirds can put both middle triplets in one region and discard valid seams.
    const sampleIndex = getWebtoonSampleIndices(pageCount).indexOf(pageIndex);
    return Math.floor(Math.max(0, sampleIndex) / 3);
}

function hasDistributedMatches(
    pageCount,
    matches,
    informativePairs,
    minimumMatches,
    minimumAgreement,
) {
    if (matches.length < minimumMatches || matches.length / Math.max(1, informativePairs) < minimumAgreement) return false;
    const regions = new Set();
    const distinct = [];
    for (const match of matches) {
        regions.add(sampleRegion(pageCount, match.index));
        if (distinct.every(edge => edgeDistance(edge, match.edge) > 0.08)) distinct.push(match.edge);
    }
    return regions.size >= 2 && distinct.length >= 3;
}

export function classifyWebtoon(
    pageCount,
    samples,
    bookName,
) {
    if (!validSamples(pageCount, samples)) return 'paged';
    if (hasLongWebtoonPages(pageCount, samples)) return 'scroll';
    samples = contentSamples(pageCount, samples);
    if (samples.length < 8) return 'paged';
    const width = median(samples.map(sample => sample.width));
    if (samples.some(sample => Math.abs(sample.width / width - 1) > 0.02
        || sample.height / sample.width < 0.2 || sample.height / sample.width > 2.5)) return 'paged';

    let informativePairs = 0;
    const strongMatches = [];
    const closeMatches = [];
    for (let index = 0; index + 1 < samples.length; index += 1) {
        const previous = samples[index];
        const next = samples[index + 1];
        if (previous.index + 1 !== next.index || !informativeEdge(previous.bottom) || !informativeEdge(next.top)) continue;
        informativePairs += 1;
        if (!previous.top || !next.bottom) continue;
        const seam = edgeDistance(previous.bottom, next.top);
        // Matching blank gutters and recurring page decorations are not a continuous drawing.
        if (seam <= 0.09
            && seam + 0.025 < edgeDistance(previous.top, previous.bottom) * 0.5
            && seam + 0.025 < edgeDistance(next.top, next.bottom) * 0.5) {
            const match = { index: previous.index, edge: previous.bottom };
            closeMatches.push(match);
            if (seam <= 0.045) strongMatches.push(match);
        }
    }
    const names = [bookName, ...samples.map(sample => sample.name)].join(' ').normalize('NFC');
    const chapterHint = /(?:\d+\s*화(?:\D|$)|(?:^|[\s_.(/-])(?:ch(?:apter)?|c)[\s_.-]*\d+)/i.test(names);
    const volumeHint = /(?:\d+\s*권(?:\D|$)|(?:^|[\s_.(/-])(?:vol(?:ume)?|v)[\s_.-]*\d+)/i.test(names);
    const smallPages = median(samples.map(sample => sample.encodedBytes)) <= 384 * 1024;
    const minimumMatches = !volumeHint && (chapterHint || smallPages) ? 4 : 6;
    if (hasDistributedMatches(pageCount, strongMatches, informativePairs, minimumMatches, 0.8)) return 'scroll';

    const height = median(samples.map(sample => sample.height));
    const ratios = samples.map(sample => sample.height / sample.width);
    const regularTallSlices = median(ratios) >= 2
        && ratios.filter(ratio => ratio >= 1.8).length / ratios.length >= 0.9
        && samples.filter(sample => Math.abs(sample.height / height - 1) <= 0.02).length / samples.length >= 0.8;
    // Regular tall cuts can change at text/line edges. Still require distinct drawings across regions,
    // a close-to-exact seam and small images; blank gutters and chapter names alone never qualify.
    if (regularTallSlices && smallPages && !volumeHint && strongMatches.length >= 1
        && hasDistributedMatches(pageCount, closeMatches, informativePairs, chapterHint ? 3 : 4, 0.75)) return 'scroll';

    const regularPortraitSlices = ratios.filter(ratio => ratio >= 1).length / ratios.length >= 0.9
        && samples.filter(sample => Math.abs(sample.height / height - 1) <= 0.02).length / samples.length >= 0.9;
    const strongRegions = new Set(strongMatches.map(match => sampleRegion(pageCount, match.index)));
    // Page-shaped cuts need stronger continuity evidence: every informative cut agrees,
    // with close-to-exact drawings in separate regions. Blank cuts add no evidence.
    return regularPortraitSlices && smallPages && !volumeHint && strongRegions.size >= 2
        && hasDistributedMatches(pageCount, closeMatches, informativePairs, chapterHint ? 3 : 4, 1)
        ? 'scroll' : 'paged';
}

export function createWebtoonDetectionSession(timeoutMs = 5000) {
    let promise = null;
    let settled = false;
    let stopped = false;
    let cancel;
    return {
        detect(probe) {
            if (promise) return promise;
            promise = new Promise(resolve => {
                const finish = (decision) => {
                    if (settled) return;
                    settled = true;
                    stopped = true;
                    clearTimeout(timer);
                    resolve(decision);
                };
                const timer = setTimeout(() => finish('paged'), timeoutMs);
                cancel = () => finish('paged');
                if (stopped) { finish('paged'); return; }
                void Promise.resolve().then(() => stopped ? 'paged' : probe(() => stopped))
                    .then(finish, () => finish('paged'));
            });
            return promise;
        },
        dispose() { stopped = true; cancel?.(); },
    };
}
