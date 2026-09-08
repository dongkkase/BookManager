import os from 'node:os';

export const READIVE_LIMITS = Object.freeze({
    softFiles: 100,
    softFolders: 30,
    softBytes: 2 * 1024 ** 3,
    hardFiles: 1000,
    hardFolders: 300,
    hardBytes: 10 * 1024 ** 3,
    depth: 20,
    scanEntries: 10000,
    browseEntries: 100000,
    metadataBytes: 256 * 1024,
    coverBytes: 16 * 1024 ** 2,
});

export function fail(code, status = 400) {
    const error = new Error(code);
    error.code = code;
    error.status = status;
    return error;
}

export function ipv4Number(value) {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
    const parts = value.split('.').map(Number);
    if (parts.some(part => part > 255)) return null;
    return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

export function isPrivateAddress(address) {
    const number = ipv4Number(address);
    return number !== null && ((number >>> 24) === 10
        || (number >>> 20) === 0xac1
        || (number >>> 16) === 0xc0a8);
}

export function validNetmask(value) {
    const mask = ipv4Number(value);
    if (!mask || mask === 0xffffffff) return false;
    const inverted = (~mask) >>> 0;
    return (inverted & (inverted + 1)) === 0;
}

export function listReadiveInterfaces(interfaces = os.networkInterfaces()) {
    return Object.entries(interfaces).flatMap(([name, addresses]) => {
        if (/^(?:utun|tun|tap|wg|ppp|tailscale|zerotier|docker|veth|virbr)/i.test(name)) return [];
        return (addresses || []).filter(item => !item.internal && item.family === 'IPv4'
            && isPrivateAddress(item.address) && validNetmask(item.netmask))
            .map(item => ({ name, address: item.address, netmask: item.netmask }));
    });
}

export function isOnLink(remoteAddress, localInterface) {
    const address = String(remoteAddress || '').replace(/^::ffff:/i, '');
    if (!localInterface || !isPrivateAddress(address) || !validNetmask(localInterface.netmask)) return false;
    const source = ipv4Number(address);
    const local = ipv4Number(localInterface.address);
    const mask = ipv4Number(localInterface.netmask);
    if (local === null || !isPrivateAddress(localInterface.address)) return false;
    const network = (local & mask) >>> 0;
    const broadcast = (network | ~mask) >>> 0;
    return source !== network && source !== broadcast && ((source & mask) >>> 0) === network;
}

export function transferSizePolicy(summary, limits = READIVE_LIMITS) {
    const blocked = summary.files > limits.hardFiles || summary.folders > limits.hardFolders || summary.bytes > limits.hardBytes;
    const large = summary.files > limits.softFiles || summary.folders > limits.softFolders || summary.bytes > limits.softBytes;
    return { blocked, large };
}

export function cleanRelativePath(value) {
    if (typeof value !== 'string' || !value || value.length > 2048 || /[\\\0]/.test(value)
        || value.startsWith('/') || /^[a-z]:/i.test(value)) throw fail('invalid_relative_path');
    const parts = value.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f\x7f]/.test(part))) throw fail('invalid_relative_path');
    return parts.join('/');
}
