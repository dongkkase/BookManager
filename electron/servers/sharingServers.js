import http from 'http';
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

function sharingServerUrl(type, localIp, port) {
    return type === 'OPDS'
        ? `http://${localIp}:${port}/opds`
        : `http://${localIp}:${port}/`;
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
            url: entry ? sharingServerUrl(type, localIp, entry.port) : null,
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
    const server = http.createServer(app);

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

    servers.set(serverType, { server, port });
    const localIp = getLocalIp();
    const url = sharingServerUrl(serverType, localIp, port);
    log(sharingText(config, 'sharing_started', '{server} 서버가 시작되었습니다: {url}', { server: serverType, url }));
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
