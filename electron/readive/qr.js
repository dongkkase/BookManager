import QRCode from './vendor/qrcode/index.cjs';
import QRErrorCorrectLevel from './vendor/qrcode/QRErrorCorrectLevel.cjs';

export function pairingQrSvg(payload) {
    if (typeof payload !== 'string' || !payload.length || payload.length > 2048 || /[^\x20-\x7e]/.test(payload)) throw new Error('invalid_qr_payload');
    let code = new QRCode(-1, QRErrorCorrectLevel.H);
    code.addData(payload);
    try {
        code.make();
    } catch (error) {
        if (!error.message.startsWith('code length overflow.')) throw error;
        code = new QRCode(-1, QRErrorCorrectLevel.M);
        code.addData(payload);
        code.make();
    }
    const modules = code.getModuleCount();
    const quietZone = 4;
    const paths = [];
    for (let y = 0; y < modules; y += 1) {
        for (let x = 0; x < modules; x += 1) {
            if (!code.isDark(y, x)) continue;
            const start = x;
            while (x + 1 < modules && code.isDark(y, x + 1)) x += 1;
            paths.push(`M${start + quietZone} ${y + quietZone}h${x - start + 1}v1H${start + quietZone}z`);
        }
    }
    const size = modules + quietZone * 2;
    const logoSize = Math.floor(modules * 0.24);
    const logoStart = (size - logoSize) / 2;
    const logo = code.errorCorrectLevel === QRErrorCorrectLevel.H ? `
        <svg x="${logoStart}" y="${logoStart}" width="${logoSize}" height="${logoSize}" viewBox="0 0 100 100" shape-rendering="geometricPrecision">
            <rect width="100" height="100" rx="5" fill="white"/>
            <g fill="none" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M50 25C40 17 28 13 17 14V60C29 59 40 63 50 70C60 63 71 59 83 60V14C72 13 60 17 50 25Z"/>
                <path d="M50 25V70M17 19L11 21V66C26 63 39 66 50 73C61 66 74 63 89 66V21L83 19"/>
            </g>
            <text x="50" y="91" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="black">Readive</text>
        </svg>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 2}" height="${size * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path fill="black" d="${paths.join('')}"/>${logo}</svg>`;
}

export function pairingQrDataUrl(payload) {
    return `data:image/svg+xml;base64,${Buffer.from(pairingQrSvg(payload)).toString('base64')}`;
}
