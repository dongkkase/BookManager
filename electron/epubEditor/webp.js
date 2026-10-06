export function webpDimensions(data) {
    if (data.length < 20 || data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WEBP') return null;
    const end = data.readUInt32LE(4) + 8;
    if (end > data.length || end < 20) return null;
    for (let offset = 12; offset + 8 <= end;) {
        const type = data.toString('latin1', offset, offset + 4);
        const length = data.readUInt32LE(offset + 4);
        const start = offset + 8;
        const next = start + length + length % 2;
        if (next > end) return null;
        if (type === 'VP8X' && length >= 10) {
            return { width: data.readUIntLE(start + 4, 3) + 1, height: data.readUIntLE(start + 7, 3) + 1 };
        }
        if (type === 'VP8L' && length >= 5 && data[start] === 0x2f) {
            const bits = data.readUInt32LE(start + 1);
            if (bits >>> 29) return null;
            return { width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1 };
        }
        if (type === 'VP8 ' && length >= 10 && !(data[start] & 1) && data.toString('hex', start + 3, start + 6) === '9d012a') {
            const width = data.readUInt16LE(start + 6) & 0x3fff;
            const height = data.readUInt16LE(start + 8) & 0x3fff;
            return width && height ? { width, height } : null;
        }
        offset = next;
    }
    return null;
}
