// Decoding a tall PNG can allocate hundreds of MiB even for a tiny thumbnail.
// Keep the slot until decoding finishes, including after a consumer unmounts.
const pendingThumbnails = [];
let thumbnailRunning = false;

function drainThumbnails() {
    if (thumbnailRunning) return;
    const nextIndex = pendingThumbnails.reduce((best, entry, index) => (
        best < 0 || entry.priority < pendingThumbnails[best].priority ? index : best
    ), -1);
    const entry = nextIndex >= 0 ? pendingThumbnails.splice(nextIndex, 1)[0] : null;
    if (!entry) return;
    thumbnailRunning = true;
    Promise.resolve().then(() => entry.cancelled ? undefined : entry.run(() => entry.cancelled))
        .catch(() => {})
        .finally(() => {
            thumbnailRunning = false;
            drainThumbnails();
        });
}

export function scheduleComicThumbnail(run, { priority = 1 } = {}) {
    const entry = { run, cancelled: false, priority: Number.isFinite(priority) ? priority : 1 };
    pendingThumbnails.push(entry);
    drainThumbnails();
    return () => {
        entry.cancelled = true;
        const index = pendingThumbnails.indexOf(entry);
        if (index >= 0) pendingThumbnails.splice(index, 1);
    };
}

export async function readStaticComicPngSize(blob, isCancelled = () => false) {
    const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (signature.length !== 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => signature[index] === value)) return null;
    let size = null;
    for (let offset = 8, count = 0; offset + 12 <= blob.size && count < 4096; count += 1) {
        if (isCancelled()) return null;
        // Skip compressed pixels and metadata bodies without copying the full PNG.
        const bytes = new Uint8Array(await blob.slice(offset, offset + 25).arrayBuffer());
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const length = view.getUint32(0);
        const name = String.fromCharCode(...bytes.subarray(4, 8));
        if (length > blob.size - offset - 12 || name === 'acTL') return null;
        if (offset === 8 && (name !== 'IHDR' || length !== 13)) return null;
        if (name === 'IHDR') {
            if (size || length !== 13 || bytes[18] !== 0 || bytes[19] !== 0 || bytes[20] > 1) return null;
            const width = view.getUint32(8);
            const height = view.getUint32(12);
            if (!width || !height) return null;
            size = { width, height };
        }
        // APNG requires acTL before the first IDAT (https://www.w3.org/TR/png/).
        // Pixel validity is checked by the decoder; thousands of IDAT chunks
        // must not make a static PNG retain its full decoded image as a thumbnail.
        if (name === 'IDAT') return size;
        if (name === 'IEND') return null;
        offset += length + 12;
    }
    return null;
}
