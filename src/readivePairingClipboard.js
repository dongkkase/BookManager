export function readivePairingDeviceRevision(devices = []) {
    return JSON.stringify(devices.map(device => [device.id, device.pairedAt || '']).sort((left, right) => left[0].localeCompare(right[0])));
}

export function getReadivePairingText(pairing, { running, statusError = false, now = Date.now(), deviceRevision } = {}) {
    const expiresAt = Date.parse(pairing?.expiresAt);
    if (!running || statusError || !Number.isFinite(expiresAt) || expiresAt <= now) return '';
    if (pairing.deviceRevision !== undefined && pairing.deviceRevision !== deviceRevision) return '';
    if (typeof pairing.qrPayload === 'string' && pairing.qrPayload.startsWith('readive://bookmanager?ticket=')) return pairing.qrPayload;
    return typeof pairing.ticket === 'string' ? pairing.ticket : '';
}

export async function copyReadivePairing({ getText, writeText }) {
    const text = getText();
    if (!text) return 'unavailable';
    try {
        await writeText(text);
    } catch {
        return getText() === text ? 'failed' : 'unavailable';
    }
    return getText() === text ? 'copied' : 'unavailable';
}
