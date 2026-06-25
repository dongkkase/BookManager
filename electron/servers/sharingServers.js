import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
    getLocalIp,
    normalizeSharingRoots,
    sharingText,
} from './shared/sharingCommon.js';
import { buildOpdsApp } from './opdsServer.js';
import { buildWebApp } from './webServer.js';
import {
    buildWebdavApp,
    resolveWebdavPath,
} from './webdavServer.js';

const servers = new Map();
const SHARING_SERVER_TYPES = ['OPDS', 'Web', 'WebDAV'];

export {
    buildOpdsApp,
    buildWebApp,
    buildWebdavApp,
    normalizeSharingRoots,
    resolveWebdavPath,
};

export function normalizeSharingServerType(type) {
    const normalized = String(type || '').trim().toUpperCase();
    if (normalized === 'OPDS') return 'OPDS';
    if (normalized === 'WEBDAV') return 'WebDAV';
    if (normalized === 'WEB') return 'Web';
    return null;
}

function sharingServerUrl(type, localIp, port, secure = false) {
    const scheme = secure ? 'https' : 'http';
    return type === 'OPDS'
        ? `${scheme}://${localIp}:${port}/opds`
        : `${scheme}://${localIp}:${port}/`;
}

function isValidIpv4(value) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(value || ''))
        && String(value).split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
}

function resolveHttpsCertDir(options = {}, config = {}) {
    return options.httpsCertDir
        || config.sharing_https_cert_dir
        || path.join(os.tmpdir(), 'bookmanager-sharing-cert');
}

function buildOpensslConfig(localIp) {
    const sanLines = [
        'DNS.1 = localhost',
        'IP.1 = 127.0.0.1',
        'IP.2 = ::1',
    ];
    if (isValidIpv4(localIp) && localIp !== '127.0.0.1') {
        sanLines.push(`IP.3 = ${localIp}`);
    }
    return [
        '[req]',
        'prompt = no',
        'distinguished_name = dn',
        'x509_extensions = v3_req',
        '',
        '[dn]',
        'CN = BookManager Local Sharing',
        '',
        '[v3_req]',
        'subjectAltName = @alt_names',
        'basicConstraints = CA:FALSE',
        'keyUsage = digitalSignature, keyEncipherment',
        'extendedKeyUsage = serverAuth',
        '',
        '[alt_names]',
        ...sanLines,
        '',
    ].join('\n');
}

function derLength(length) {
    if (length < 0x80) return Buffer.from([length]);
    const bytes = [];
    let value = length;
    while (value > 0) {
        bytes.unshift(value & 0xff);
        value >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, content) {
    return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...items) {
    return der(0x30, Buffer.concat(items));
}

function derSet(...items) {
    return der(0x31, Buffer.concat(items));
}

function derExplicit(tagNumber, content) {
    return der(0xa0 + tagNumber, content);
}

function derInteger(value) {
    const bytes = Buffer.isBuffer(value)
        ? Buffer.from(value)
        : Buffer.from([value]);
    const normalized = bytes.length > 0 ? bytes : Buffer.from([0]);
    return der(0x02, normalized[0] & 0x80 ? Buffer.concat([Buffer.from([0]), normalized]) : normalized);
}

function derBoolean(value) {
    return der(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function derNull() {
    return der(0x05, Buffer.alloc(0));
}

function derBitString(bytes, unusedBits = 0) {
    return der(0x03, Buffer.concat([Buffer.from([unusedBits]), Buffer.from(bytes)]));
}

function derOctetString(content) {
    return der(0x04, Buffer.from(content));
}

function derUtf8String(value) {
    return der(0x0c, Buffer.from(String(value), 'utf8'));
}

function derUtcTime(date) {
    const year = String(date.getUTCFullYear()).slice(-2);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    const second = String(date.getUTCSeconds()).padStart(2, '0');
    return der(0x17, Buffer.from(`${year}${month}${day}${hour}${minute}${second}Z`, 'ascii'));
}

function derOid(oid) {
    const parts = String(oid).split('.').map(Number);
    const first = 40 * parts[0] + parts[1];
    const bytes = [first];
    for (const part of parts.slice(2)) {
        const encoded = [part & 0x7f];
        let value = part >> 7;
        while (value > 0) {
            encoded.unshift((value & 0x7f) | 0x80);
            value >>= 7;
        }
        bytes.push(...encoded);
    }
    return der(0x06, Buffer.from(bytes));
}

function derAlgorithmIdentifier() {
    return derSequence(derOid('1.2.840.113549.1.1.11'), derNull());
}

function derName(commonName) {
    return derSequence(
        derSet(
            derSequence(
                derOid('2.5.4.3'),
                derUtf8String(commonName),
            ),
        ),
    );
}

function ipv4ToBytes(value) {
    if (!isValidIpv4(value)) return null;
    return Buffer.from(String(value).split('.').map(part => Number(part)));
}

function ipv6ToBytes(value) {
    if (value !== '::1') return null;
    return Buffer.from('00000000000000000000000000000001', 'hex');
}

function derDnsName(value) {
    return der(0x82, Buffer.from(String(value), 'ascii'));
}

function derIpAddress(value) {
    const bytes = ipv4ToBytes(value) || ipv6ToBytes(value);
    if (!bytes) return null;
    return der(0x87, bytes);
}

function derExtension(oid, value, { critical = false } = {}) {
    return derSequence(
        derOid(oid),
        ...(critical ? [derBoolean(true)] : []),
        derOctetString(value),
    );
}

function derSubjectAltName(localIp) {
    const names = [
        derDnsName('localhost'),
        derIpAddress('127.0.0.1'),
        derIpAddress('::1'),
    ];
    if (isValidIpv4(localIp) && localIp !== '127.0.0.1') {
        names.push(derIpAddress(localIp));
    }
    return derSequence(...names.filter(Boolean));
}

function pemBlock(label, derBuffer) {
    const body = derBuffer.toString('base64').match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function createSelfSignedCertificate({ localIp, days = 825 }) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicExponent: 0x10001,
    });
    const notBefore = new Date(Date.now() - 5 * 60 * 1000);
    const notAfter = new Date(notBefore.getTime() + days * 24 * 60 * 60 * 1000);
    const name = derName('BookManager Local Sharing');
    const extensions = derSequence(
        derExtension('2.5.29.19', derSequence(), { critical: true }),
        derExtension('2.5.29.15', derBitString(Buffer.from([0xa0]), 5), { critical: true }),
        derExtension('2.5.29.37', derSequence(derOid('1.3.6.1.5.5.7.3.1'))),
        derExtension('2.5.29.17', derSubjectAltName(localIp)),
    );
    const tbsCertificate = derSequence(
        derExplicit(0, derInteger(2)),
        derInteger(crypto.randomBytes(16)),
        derAlgorithmIdentifier(),
        name,
        derSequence(derUtcTime(notBefore), derUtcTime(notAfter)),
        name,
        publicKey.export({ type: 'spki', format: 'der' }),
        derExplicit(3, extensions),
    );
    const signature = crypto.sign('RSA-SHA256', tbsCertificate, privateKey);
    const certificate = derSequence(
        tbsCertificate,
        derAlgorithmIdentifier(),
        derBitString(signature),
    );
    return {
        certPem: pemBlock('CERTIFICATE', certificate),
        keyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }),
    };
}

async function ensureSelfSignedCertificate(options = {}, config = {}) {
    const certDir = resolveHttpsCertDir(options, config);
    const localIp = getLocalIp();
    const certPath = path.join(certDir, 'bookmanager-sharing.crt');
    const keyPath = path.join(certDir, 'bookmanager-sharing.key');
    const manifestPath = path.join(certDir, 'manifest.json');
    const certificateProfile = buildOpensslConfig(localIp);
    let shouldGenerate = true;

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        shouldGenerate = !(
            fs.existsSync(certPath)
            && fs.existsSync(keyPath)
            && manifest.certificateProfile === certificateProfile
        );
    } catch {
        shouldGenerate = true;
    }

    if (!shouldGenerate) {
        return {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
            certPath,
            keyPath,
        };
    }

    fs.mkdirSync(certDir, { recursive: true });
    try {
        const { certPem, keyPem } = createSelfSignedCertificate({ localIp });
        fs.writeFileSync(certPath, certPem, 'utf-8');
        fs.writeFileSync(keyPath, keyPem, 'utf-8');
    } catch (error) {
        throw new Error(sharingText(
            config,
            'sharing_https_cert_failed',
            'HTTPS 인증서 생성에 실패했습니다: {msg}',
            { msg: error.message },
        ));
    }

    fs.writeFileSync(manifestPath, JSON.stringify({ certificateProfile, createdAt: new Date().toISOString() }, null, 2));
    return {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
        certPath,
        keyPath,
    };
}

export function getSharingServerStatus() {
    const localIp = getLocalIp();
    const status = {
        localIp,
    };
    for (const type of SHARING_SERVER_TYPES) {
        const entry = servers.get(type);
        status[type] = {
            running: Boolean(entry),
            port: entry?.port || null,
            secure: Boolean(entry?.secure),
            url: entry ? sharingServerUrl(type, localIp, entry.port, entry.secure) : null,
        };
    }
    return status;
}

export async function startSharingServer(type, options = {}, config = {}, onLog = () => {}) {
    const serverType = normalizeSharingServerType(type);
    if (!serverType) {
        throw new Error(sharingText(config, 'sharing_invalid_server_type', '지원하지 않는 서버 타입입니다: {server}', { server: String(type || '') }));
    }
    if (servers.has(serverType)) {
        throw new Error(sharingText(config, 'sharing_server_already_running', '{server} 서버가 이미 실행 중입니다.', { server: serverType }));
    }

    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error(sharingText(config, 'sharing_invalid_port', '포트 번호는 1024부터 65535 사이여야 합니다.'));
    }

    const log = (message, logType = 'INFO') => onLog({
        type: logType === 'ERROR' ? 'ERROR' : 'INFO',
        protocol: serverType,
        message,
    });
    const app = serverType === 'WebDAV'
        ? buildWebdavApp(config, options, log)
        : serverType === 'Web'
            ? buildWebApp(config, options, log)
            : buildOpdsApp(config, log, options);
    const secure = Boolean(options.https ?? config.sharing_https_enabled);
    let certInfo = null;
    if (secure) {
        certInfo = await ensureSelfSignedCertificate(options, config);
    }
    const server = secure
        ? https.createServer({ cert: certInfo.cert, key: certInfo.key }, app)
        : http.createServer(app);

    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '0.0.0.0', resolve);
        });
    } catch (error) {
        server.close();
        onLog({
            type: 'ERROR',
            protocol: serverType,
            message: sharingText(config, 'sharing_start_failed', '포트 {port}에서 서버를 시작하지 못했습니다: {msg}', { port, msg: error.message }),
        });
        throw error;
    }

    servers.set(serverType, { server, port, secure });
    const localIp = getLocalIp();
    const url = sharingServerUrl(serverType, localIp, port, secure);
    log(sharingText(config, 'sharing_started', '{server} 서버가 시작되었습니다: {url}', { server: serverType, url }));
    if (secure) {
        log(sharingText(
            config,
            'sharing_https_self_signed_notice',
            'HTTPS가 자체 서명 인증서로 시작되었습니다. 브라우저나 앱에서 인증서 신뢰 예외가 필요할 수 있습니다.',
        ));
    }
    return { success: true, running: true, port, localIp, url };
}

export async function stopSharingServer(type, onLog = () => {}, config = {}) {
    const serverType = normalizeSharingServerType(type);
    if (!serverType) return { success: true, running: false };
    const entry = servers.get(serverType);
    if (!entry) return { success: true, running: false };

    await new Promise(resolve => entry.server.close(resolve));
    servers.delete(serverType);
    onLog({
        type: 'INFO',
        protocol: serverType,
        message: sharingText(config, 'sharing_stopped', '{server} 서버가 중지되었습니다.', { server: serverType }),
    });
    return { success: true, running: false };
}

export async function stopAllSharingServers(onLog = () => {}, config = {}) {
    await Promise.all([...servers.keys()].map(type => stopSharingServer(type, onLog, config)));
}
