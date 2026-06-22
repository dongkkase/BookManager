import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
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
const execFileAsync = promisify(execFile);

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

async function ensureSelfSignedCertificate(options = {}, config = {}) {
    const certDir = resolveHttpsCertDir(options, config);
    const localIp = getLocalIp();
    const certPath = path.join(certDir, 'bookmanager-sharing.crt');
    const keyPath = path.join(certDir, 'bookmanager-sharing.key');
    const opensslConfigPath = path.join(certDir, 'openssl.cnf');
    const manifestPath = path.join(certDir, 'manifest.json');
    const opensslConfig = buildOpensslConfig(localIp);
    let shouldGenerate = true;

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        shouldGenerate = !(
            fs.existsSync(certPath)
            && fs.existsSync(keyPath)
            && manifest.opensslConfig === opensslConfig
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
    fs.writeFileSync(opensslConfigPath, opensslConfig, 'utf-8');
    try {
        await execFileAsync('openssl', [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-sha256',
            '-days',
            '825',
            '-keyout',
            keyPath,
            '-out',
            certPath,
            '-config',
            opensslConfigPath,
        ]);
    } catch (error) {
        throw new Error(sharingText(
            config,
            'sharing_https_cert_failed',
            'HTTPS 인증서 생성에 실패했습니다. openssl을 사용할 수 있는지 확인하세요: {msg}',
            { msg: error.message },
        ));
    }

    fs.writeFileSync(manifestPath, JSON.stringify({ opensslConfig, createdAt: new Date().toISOString() }, null, 2));
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
