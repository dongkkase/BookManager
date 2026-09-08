import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import https from 'node:https';
import { createSelfSignedCertificate } from '../servers/sharingServers.js';
import { ReadiveStore } from './store.js';
import { fail, isOnLink, listReadiveInterfaces, transferSizePolicy } from './policy.js';
import { openFrozenAsset, publicSnapshot, scanReadivePaths, selectSnapshotEntries, summarizeEntries } from './manifest.js';
import { exchangeReading, getImportedReadingState, readingRowSignature } from './reading.js';
import { ReadiveCatalogCache, readReadiveLibraryEntries, registeredReadiveLibraries, resolveReadiveLibraryPath, validateReadiveLibrary } from './catalog.js';
import { pairingQrDataUrl } from './qr.js';
import { openReaderAsset, ReadiveReaders } from './readers.js';
import { ReadiveDestinations } from './destinations.js';
import { ReadiveManualPairing } from './manualPairing.js';

const PREFIX = '/readive/v1';
const SCAN_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const tokenValue = () => crypto.randomBytes(32).toString('base64url');
const equalDigest = (left, right) => typeof left === 'string' && typeof right === 'string' && left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));

function publicJob(job) {
    return {
        id: job.id, title: job.title, state: job.state, createdAt: job.createdAt,
        fileCount: job.manifest.files.length, directoryCount: job.manifest.directories.length,
        totalBytes: job.manifest.totalBytes, completedFileIds: [...job.completedFileIds],
        origin: job.libraryScope ? 'mobile-browse' : 'desktop-push',
        destination: job.destination || null,
    };
}

function normalizeFormat(extension) {
    if (['zip', 'cbz', 'rar', 'cbr', '7z', 'cb7', 'tar', 'cbt'].includes(extension)) return 'comic';
    if (['txt', 'text', 'log', 'md'].includes(extension)) return 'text';
    if (['epub', 'pdf', 'image'].includes(extension)) return extension;
    return 'audio';
}

async function readBody(request) {
    if (request.headers['content-encoding']) throw fail('unsupported_encoding', 415);
    if (Number(request.headers['content-length'] || 0) > 4 * 1024 ** 2) throw fail('body_too_large', 413);
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
        length += chunk.length;
        if (length > 4 * 1024 ** 2) throw fail('body_too_large', 413);
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw fail('invalid_json'); }
}

export class ReadiveService {
    constructor({ directory, getLibraryDb, getRegisteredLibraries = () => [], serverName = os.hostname(), interfaces = listReadiveInterfaces, now = Date.now, onReadingChanged = () => {}, onLog = () => {}, requestManualApproval }) {
        this.store = new ReadiveStore(directory);
        this.getLibraryDb = getLibraryDb;
        this.getRegisteredLibraries = getRegisteredLibraries;
        this.serverName = String(serverName).slice(0, 100);
        this.interfaces = interfaces;
        this.now = now;
        this.onReadingChanged = onReadingChanged;
        this.onLog = onLog;
        this.server = null;
        this.localInterface = null;
        this.port = null;
        this.certificateSha256 = '';
        this.ticket = null;
        this.manualPairing = new ReadiveManualPairing({ now: () => this.now(), requestApproval: requestManualApproval });
        this.pairAttempts = new Map();
        this.snapshots = new Map();
        this.scanning = false;
        this.connections = new Map();
        this.scanController = null;
        this.lifecyclePending = Promise.resolve();
        this.catalogSecret = crypto.randomBytes(32);
        this.catalogCache = new ReadiveCatalogCache({ now: () => this.now() });
        this.readers = new ReadiveReaders({ now: () => this.now(), onClose: session => this.abortDeviceTransfers(session.deviceId, `reader-${session.id}`) });
        this.destinations = new ReadiveDestinations({ now: () => this.now() });
        this.preparations = new Map();
        this.cancelledPreparations = new Map();
        this.preparationTimeoutMs = 10 * 60 * 1000;
    }

    log(key, values = {}, type = 'INFO') {
        const safeValues = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, String(value).replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()]));
        try {
            this.onLog({ type, key, values: safeValues });
        } catch { /* Closing the log window must not interrupt the service. */ }
    }

    logError(key, error, values = {}) {
        const code = typeof error?.code === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'internal_error';
        this.log(key, { ...values, code }, 'ERROR');
    }

    async status() {
        const state = await this.store.load();
        return {
            running: Boolean(this.server), address: this.localInterface?.address || '', port: this.port,
            url: this.server ? `https://${this.localInterface.address}:${this.port}` : '',
            interfaces: this.interfaces(),
            libraries: registeredReadiveLibraries(state, this.getRegisteredLibraries()).map(library => ({ ...library, shared: true })),
            devices: state.devices.map(({ tokenHash, ...device }) => ({ ...device, deviceId: device.id })),
            jobs: state.jobs.map(job => ({ ...publicJob(job), deviceId: job.deviceId, status: job.state === 'accepted' ? 'receiving' : job.state, summary: job.summary, receivedEntryIds: job.completedFileIds, failedEntryIds: [] })),
        };
    }

    async setLibraries() {
        // Older renderer calls no longer change registered library visibility.
        return this.status();
    }

    async validateJobLibrary(job, state = this.store.state) {
        if (job?.libraryScope) {
            await validateReadiveLibrary(state, this.getRegisteredLibraries(), job.libraryScope.libraryId, job.libraryScope);
            this.validateLibraryPermission(job.libraryScope, state);
        }
    }

    validateLibraryPermission(scope, state = this.store.state) {
        if (!scope || !registeredReadiveLibraries(state, this.getRegisteredLibraries()).some(item => item.id === scope.libraryId && item.path === scope.rootPath)) throw fail('library_unavailable', 409);
    }

    validateDevice(device) {
        if (!this.store.state.devices.some(item => item.id === device.id && equalDigest(item.tokenHash, device.tokenHash))) throw fail('unauthorized', 401);
    }

    preparationKey(device, libraryId, scanId) {
        return `${device.id}:${device.tokenHash}:${libraryId}:${scanId}`;
    }

    prunePreparations() {
        for (const [id, preparation] of this.preparations) {
            if (this.now() - preparation.createdAt > 30 * 60 * 1000 && preparation.state !== 'scanning') this.preparations.delete(id);
        }
        for (const [key, expiresAt] of this.cancelledPreparations) if (expiresAt <= this.now()) this.cancelledPreparations.delete(key);
    }

    async cancelPreparation(libraryId, scanId, device) {
        if (!SCAN_ID.test(scanId)) throw fail('invalid_scan_id');
        this.prunePreparations();
        const preparation = this.preparations.get(scanId);
        if (preparation && (preparation.deviceId !== device.id || preparation.tokenHash !== device.tokenHash || preparation.scope.libraryId !== libraryId)) throw fail('not_found', 404);
        if (!preparation && !registeredReadiveLibraries(this.store.state, this.getRegisteredLibraries()).some(library => library.id === libraryId)) throw fail('library_unavailable', 409);
        if (preparation) {
            preparation.controller.abort();
            preparation.state = 'failed';
            preparation.error = 'scan_cancelled';
        }
        const key = this.preparationKey(device, libraryId, scanId);
        if (!this.cancelledPreparations.has(key) && this.cancelledPreparations.size >= 256) throw fail('too_many_jobs', 429);
        this.cancelledPreparations.set(key, this.now() + 30 * 60 * 1000);
        if (preparation?.jobId) await this.cancel({ jobId: preparation.jobId });
        return { success: true };
    }

    async beginPreparation(libraryId, paths, device, requestedScanId) {
        if (requestedScanId !== undefined && (typeof requestedScanId !== 'string' || !SCAN_ID.test(requestedScanId))) throw fail('invalid_scan_id');
        if (!Array.isArray(paths) || !paths.length || paths.length > 1300 || paths.some(value => typeof value !== 'string' || value.length > 2048)) throw fail('invalid_library_path');
        this.prunePreparations();
        const scanId = requestedScanId || crypto.randomUUID();
        const requestHash = digest(JSON.stringify(paths));
        const existing = () => {
            if (this.cancelledPreparations.has(this.preparationKey(device, libraryId, scanId))) return true;
            const preparation = this.preparations.get(scanId);
            if (!preparation) return false;
            if (preparation.deviceId !== device.id || preparation.tokenHash !== device.tokenHash || preparation.scope.libraryId !== libraryId || preparation.requestHash !== requestHash) throw fail('preparation_mismatch', 409);
            return true;
        };
        if (existing()) return { scanId };
        if (this.scanning) throw fail('scan_in_progress', 409);
        const { scope } = await validateReadiveLibrary(this.store.state, this.getRegisteredLibraries(), libraryId);
        this.validateLibraryPermission(scope);
        this.validateDevice(device);
        if (existing()) return { scanId };
        if (this.scanning) throw fail('scan_in_progress', 409);
        while (this.preparations.size >= 20) {
            const expired = [...this.preparations].find(([, value]) => value.state !== 'scanning');
            if (!expired) throw fail('too_many_jobs', 409);
            this.preparations.delete(expired[0]);
        }
        const controller = new AbortController();
        const preparation = { id: scanId, deviceId: device.id, tokenHash: device.tokenHash, scope, controller, requestHash, createdAt: this.now(), state: 'scanning' };
        this.preparations.set(preparation.id, preparation);
        this.scanning = true;
        this.scanController = controller;
        const deadline = setTimeout(() => {
            preparation.state = 'failed';
            preparation.error = 'scan_timeout';
            controller.abort('scan_timeout');
        }, this.preparationTimeoutMs);
        deadline.unref?.();
        preparation.promise = (async () => {
            try {
                const sourcePaths = [];
                for (const value of paths) {
                    if (controller.signal.aborted) throw fail('scan_cancelled', 409);
                    sourcePaths.push((await resolveReadiveLibraryPath(scope, value)).sourcePath);
                }
                const snapshot = await scanReadivePaths(sourcePaths, { libraryDb: await this.getLibraryDb?.(), signal: controller.signal, rootPath: scope.rootPath, preserveAncestors: false });
                if (snapshot.blocked) throw fail('transfer_hard_limit', 413);
                if (controller.signal.aborted) throw fail('scan_cancelled', 409);
                await validateReadiveLibrary(this.store.state, this.getRegisteredLibraries(), libraryId, scope);
                if (!this.store.state.devices.some(item => item.id === device.id && equalDigest(item.tokenHash, device.tokenHash))) throw fail('unauthorized', 401);
                snapshot.libraryScope = scope;
                snapshot.signal = controller.signal;
                snapshot.tokenHash = device.tokenHash;
                while (this.snapshots.size >= 5) this.snapshots.delete(this.snapshots.keys().next().value);
                this.snapshots.set(snapshot.id, snapshot);
                const job = await this.enqueue({ snapshotId: snapshot.id, deviceId: device.id, confirmed: true, largeConfirmed: true });
                preparation.jobId = job.id;
                if (controller.signal.aborted) {
                    await this.cancel({ jobId: job.id });
                    throw fail('scan_cancelled', 409);
                }
                preparation.state = 'ready';
            } catch (error) {
                preparation.state = 'failed';
                preparation.error = controller.signal.aborted ? controller.signal.reason === 'scan_timeout' ? 'scan_timeout' : 'scan_cancelled' : error.code || 'internal_error';
            } finally {
                clearTimeout(deadline);
                if (this.scanController === controller) {
                    this.scanning = false;
                    this.scanController = null;
                }
            }
        })();
        return { scanId: preparation.id };
    }

    start(options = {}) {
        const operation = this.lifecyclePending.then(() => this.startServer(options));
        this.lifecyclePending = operation.catch(() => {});
        return operation;
    }

    async startServer({ address, port = 19421 } = {}) {
        if (this.server) throw fail('already_running', 409);
        const local = this.interfaces().find(item => item.address === address);
        if (!local) throw fail('invalid_lan_interface');
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw fail('invalid_port');
        await this.store.load();
        const certPath = path.join(this.store.directory, 'certificate.pem');
        const keyPath = path.join(this.store.directory, 'private-key.pem');
        let cert;
        let key;
        try {
            [cert, key] = await Promise.all([fs.readFile(certPath), fs.readFile(keyPath)]);
            if (Date.parse(new crypto.X509Certificate(cert).validTo) <= this.now()) throw fail('certificate_expired');
        } catch (error) {
            if (!['ENOENT', 'certificate_expired'].includes(error.code)) throw error;
            const generated = createSelfSignedCertificate({ localIp: local.address });
            cert = Buffer.from(generated.certPem);
            key = Buffer.from(generated.keyPem);
            await fs.writeFile(keyPath, key, { mode: 0o600 });
            await fs.writeFile(certPath, cert, { mode: 0o600 });
            await this.store.transact(state => { state.devices = []; });
        }
        await fs.chmod(keyPath, 0o600);
        this.certificateSha256 = digest(new crypto.X509Certificate(cert).raw);
        const server = https.createServer({ cert, key, minVersion: 'TLSv1.2', maxHeaderSize: 16384 }, (request, response) => {
            this.handleRequest(request, response).catch(() => response.destroy());
        });
        server.maxConnections = 32;
        server.maxRequestsPerSocket = 1;
        server.setTimeout(60000, socket => socket.destroy());
        server.requestTimeout = 30000;
        server.headersTimeout = 10000;
        server.keepAliveTimeout = 1000;
        this.localInterface = local;
        this.port = port;
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, local.address, resolve);
            });
            this.server = server;
        } catch (error) {
            this.localInterface = null;
            this.port = null;
            throw error;
        }
        this.log('readive.log_started', { url: `https://${local.address}:${port}` });
        return this.status();
    }

    stop() {
        this.scanController?.abort();
        const operation = this.lifecyclePending.then(() => this.stopServer());
        this.lifecyclePending = operation.catch(() => {});
        return operation;
    }

    async stopServer() {
        this.ticket = null;
        this.manualPairing.clear();
        this.catalogCache.clear();
        this.readers.clear();
        this.destinations.clear();
        this.scanController?.abort();
        for (const responses of this.connections.values()) for (const response of responses) response.destroy();
        this.connections.clear();
        const server = this.server;
        this.server = null;
        this.localInterface = null;
        this.port = null;
        if (server) {
            server.closeAllConnections?.();
            await new Promise(resolve => server.close(resolve));
            this.log('readive.log_stopped');
        }
        return { running: false };
    }

    async pairing() {
        if (!this.server) throw fail('server_not_running', 409);
        const state = await this.store.load();
        const secret = tokenValue();
        const ticket = { version: 1, serverId: state.serverId, serverName: this.serverName, host: this.localInterface.address, port: this.port, certificateSha256: this.certificateSha256, secret, expiresAt: new Date(this.now() + 5 * 60 * 1000).toISOString() };
        this.ticket = { hash: digest(secret), expiresAt: ticket.expiresAt };
        const qrPayload = `readive://bookmanager?ticket=${Buffer.from(JSON.stringify(ticket)).toString('base64url')}`;
        const qrDataUrl = pairingQrDataUrl(qrPayload);
        this.log('readive.log_pairing_created');
        return { ticket: JSON.stringify(ticket), qrPayload, qrDataUrl, expiresAt: ticket.expiresAt };
    }

    async revoke({ deviceId }) {
        const revokedDevice = await this.store.transact(state => {
            const device = state.devices.find(item => item.id === deviceId);
            state.devices = state.devices.filter(device => device.id !== deviceId);
            for (const job of state.jobs) if (job.deviceId === deviceId && job.state !== 'completed') job.state = 'cancelled';
            for (const item of Object.values(state.items)) item.deviceIds = item.deviceIds.filter(id => id !== deviceId);
            return device;
        });
        this.abortDeviceTransfers(deviceId);
        this.readers.closeDevice(deviceId);
        this.destinations.clearDevice(deviceId);
        for (const preparation of this.preparations.values()) if (preparation.deviceId === deviceId) preparation.controller.abort();
        if (revokedDevice) this.log('readive.log_device_revoked', { device: revokedDevice.name });
        return { success: true };
    }

    abortDeviceTransfers(deviceId, jobId) {
        for (const [key, responses] of this.connections) {
            if (key.startsWith(`${deviceId}:`) && (!jobId || key === `${deviceId}:${jobId}`)) {
                for (const response of responses) response.destroy();
                this.connections.delete(key);
            }
        }
    }

    async scan({ paths }) {
        if (this.scanning) throw fail('scan_in_progress', 409);
        this.scanning = true;
        this.scanController = new AbortController();
        try {
            const libraryDb = await this.getLibraryDb?.();
            const snapshot = await scanReadivePaths(paths, { libraryDb, signal: this.scanController.signal });
            while (this.snapshots.size >= 5) this.snapshots.delete(this.snapshots.keys().next().value);
            this.snapshots.set(snapshot.id, snapshot);
            return publicSnapshot(snapshot);
        } finally {
            this.scanning = false;
            this.scanController = null;
        }
    }

    async requestDestinationPage({ deviceId, parentId = null, cursor = null } = {}) {
        if (!this.server) throw fail('server_not_running', 409);
        const state = await this.store.load();
        if (!this.server) throw fail('server_not_running', 409);
        const device = state.devices.find(item => item.id === deviceId);
        if (!device) throw fail('unknown_device', 404);
        return this.destinations.request(device, parentId, cursor);
    }

    async enqueue({ snapshotId, deviceId, excludedIds = [], confirmed, largeConfirmed, destination } = {}) {
        const snapshot = this.snapshots.get(snapshotId);
        if (!snapshot || this.now() - Date.parse(snapshot.createdAt) > 30 * 60 * 1000) throw fail('snapshot_expired', 409);
        if (snapshot.blocked || confirmed !== true) throw fail('confirmation_required', 409);
        const entries = selectSnapshotEntries(snapshot, excludedIds);
        const summary = summarizeEntries(entries);
        const policy = transferSizePolicy(summary);
        if (policy.blocked || (policy.large && largeConfirmed !== true)) throw fail('large_confirmation_required', 409);
        if (!entries.length) throw fail('empty_transfer');
        const libraryDb = await this.getLibraryDb?.();
        return this.store.transact(async state => {
            if (snapshot.signal?.aborted) throw fail('scan_cancelled', 409);
            if (snapshot.libraryScope) {
                await validateReadiveLibrary(state, this.getRegisteredLibraries(), snapshot.libraryScope.libraryId, snapshot.libraryScope);
                if (!state.devices.some(device => device.id === deviceId && equalDigest(device.tokenHash, snapshot.tokenHash))) throw fail('unauthorized', 401);
            }
            if (!state.devices.some(device => device.id === deviceId)) throw fail('unknown_device', 404);
            const target = this.destinations.validate(state.devices.find(device => device.id === deviceId), destination);
            if (state.jobs.filter(job => ['queued', 'accepted'].includes(job.state)).length >= 20) throw fail('too_many_jobs', 409);
            const assets = {};
            state.entryIds ||= {};
            state.pathContentHashes ||= {};
            const stableIds = new Map(entries.map(entry => {
                const sourceKey = process.platform === 'win32' ? entry.sourcePath.toLowerCase() : entry.sourcePath;
                state.entryIds[sourceKey] ||= crypto.randomUUID();
                return [entry.id, state.entryIds[sourceKey]];
            }));
            const directories = entries.filter(entry => entry.kind === 'directory').map(({ id, parentId, name, relativePath }) => ({
                id: stableIds.get(id), parentId: parentId ? stableIds.get(parentId) : null, name, relativePath,
            }));
            const files = [];
            for (const entry of entries.filter(item => item.kind === 'file')) {
                for (const id of [entry.assetId, entry.coverAssetId].filter(Boolean)) {
                    const handle = await openFrozenAsset(snapshot.assets[id]);
                    await handle.close();
                    assets[id] = snapshot.assets[id];
                }
                const sourceKey = process.platform === 'win32' ? entry.sourcePath.toLowerCase() : entry.sourcePath;
                const previousHash = state.pathContentHashes[sourceKey] || Object.values(state.items).find(existing => (
                    (process.platform === 'win32' ? existing.sourcePath.toLowerCase() : existing.sourcePath) === sourceKey
                ))?.contentHash;
                const item = state.items[entry.contentHash] || { itemId: crypto.randomUUID(), contentHash: entry.contentHash, deviceIds: [] };
                if (previousHash && previousHash !== entry.contentHash && libraryDb) {
                    const row = libraryDb.getConnection().prepare('SELECT * FROM reading_states WHERE file_path = ?')
                        .get(libraryDb.normalizeFilePath(entry.sourcePath));
                    if (row) item.localReadingBaseline = { revision: row.revision, signature: readingRowSignature(row) };
                    else delete item.localReadingBaseline;
                }
                state.pathContentHashes[sourceKey] = entry.contentHash;
                item.sourcePath = entry.sourcePath;
                item.identity = snapshot.assets[entry.assetId].identity;
                item.format = normalizeFormat(entry.format);
                if (!item.deviceIds.includes(deviceId)) item.deviceIds.push(deviceId);
                state.items[entry.contentHash] = item;
                const metadata = entry.metadataAssetId ? snapshot.assets[entry.metadataAssetId] : null;
                const cover = entry.coverAssetId ? snapshot.assets[entry.coverAssetId] : null;
                files.push({
                    id: stableIds.get(entry.id), itemId: item.itemId, parentId: entry.parentId ? stableIds.get(entry.parentId) : null, name: entry.name, relativePath: entry.relativePath,
                    size: entry.size, sha256: entry.contentHash, format: entry.format,
                    metadata: metadata ? JSON.parse(Buffer.from(metadata.base64, 'base64').toString('utf8')) : null,
                    metadataHash: metadata?.sha256 || null,
                    cover: cover ? { size: cover.size, sha256: cover.sha256, mimeType: cover.mimeType } : null,
                });
            }
            const manifest = { version: 1, id: snapshot.id, directories, files, totalBytes: summary.bytes };
            if (Buffer.byteLength(JSON.stringify(manifest)) > 8 * 1024 ** 2) throw fail('manifest_too_large');
            const fingerprint = digest(JSON.stringify({ deviceId, destination: target, libraryApproval: snapshot.libraryScope?.approvalId, manifest: { ...manifest, id: undefined } }));
            const previous = state.jobs.find(job => job.fingerprint === fingerprint && ['queued', 'accepted'].includes(job.state));
            if (previous) return { ...publicJob(previous), duplicate: true };
            while (state.jobs.length >= 100) {
                const index = state.jobs.findIndex(job => ['completed', 'cancelled'].includes(job.state));
                if (index < 0) throw fail('too_many_jobs', 409);
                state.jobs.splice(index, 1);
            }
            const job = {
                id: crypto.randomUUID(), deviceId, title: snapshot.roots.map(root => root.name).join(', ').slice(0, 200),
                state: 'queued', createdAt: new Date(this.now()).toISOString(), manifest, assets, summary,
                fileAssets: Object.fromEntries(entries.filter(entry => entry.kind === 'file').map(entry => [stableIds.get(entry.id), { file: entry.assetId, cover: entry.coverAssetId || null }])),
                completedFileIds: [], fingerprint, destination: target,
                ...(snapshot.libraryScope ? { libraryScope: snapshot.libraryScope } : {}),
            };
            if (snapshot.signal?.aborted) throw fail('scan_cancelled', 409);
            state.jobs.push(job);
            return publicJob(job);
        });
    }

    async cancel({ jobId, scan } = {}) {
        if (scan === true) {
            this.scanController?.abort();
            return { success: true };
        }
        const deviceId = await this.store.transact(state => {
            const job = state.jobs.find(item => item.id === jobId);
            if (!job) throw fail('job_not_found', 404);
            if (job.state !== 'completed') job.state = 'cancelled';
            return job.deviceId;
        });
        this.abortDeviceTransfers(deviceId, jobId);
        return { success: true };
    }

    validateSource(remoteAddress, localAddress) {
        const current = this.interfaces().find(item => item.address === this.localInterface?.address && item.netmask === this.localInterface?.netmask);
        if (!current || localAddress !== current.address || !isOnLink(remoteAddress, current)) throw fail('lan_only', 403);
    }

    async dispatch({ method, pathname, query = new URLSearchParams(), body = {}, token = '', remoteAddress, localAddress, signal }) {
        this.validateSource(remoteAddress, localAddress);
        await this.store.load();
        if (method === 'POST' && pathname === `${PREFIX}/manual-pair`) {
            if (!this.server) throw fail('server_not_running', 409);
            return { json: this.manualPairing.begin(body, {
                serverId: this.store.state.serverId, serverName: this.serverName,
                host: this.localInterface.address, port: this.port, certificateSha256: this.certificateSha256,
            }) };
        }
        const manualMatch = pathname.match(/^\/readive\/v1\/manual-pair\/([a-f0-9-]+)\/(status|cancel)$/);
        if (method === 'POST' && manualMatch) return { json: this.manualPairing[manualMatch[2]](manualMatch[1], body) };
        if (method === 'POST' && pathname === `${PREFIX}/pair`) {
            const source = String(remoteAddress);
            let attempt = this.pairAttempts.get(source);
            if (!attempt || attempt.until < this.now()) attempt = { count: 0, until: this.now() + 10 * 60 * 1000 };
            attempt.count += 1;
            if (this.pairAttempts.size >= 256 && !this.pairAttempts.has(source)) this.pairAttempts.delete(this.pairAttempts.keys().next().value);
            this.pairAttempts.set(source, attempt);
            if (attempt.count > 10) throw fail('pair_rate_limited', 429);
            const qrTicket = this.ticket && Date.parse(this.ticket.expiresAt) > this.now() && typeof body.secret === 'string'
                && equalDigest(this.ticket.hash, digest(body.secret));
            if (typeof body.deviceId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.deviceId)
                || typeof body.deviceName !== 'string' || !body.deviceName.trim() || body.deviceName.length > 100) throw fail('invalid_device');
            if (qrTicket) this.ticket = null;
            else if (!this.manualPairing.consume(body.secret, body)) throw fail('invalid_pairing_ticket', 401);
            const paired = await this.store.transact(state => {
                if (state.devices.length >= 32 && !state.devices.some(device => device.id === body.deviceId)) throw fail('too_many_devices', 409);
                const token = tokenValue();
                state.devices = state.devices.filter(device => device.id !== body.deviceId);
                state.devices.push({ id: body.deviceId, name: body.deviceName.trim(), tokenHash: digest(token), pairedAt: new Date(this.now()).toISOString(), lastSeenAt: new Date(this.now()).toISOString() });
                return { serverId: state.serverId, serverName: this.serverName, deviceId: body.deviceId, token };
            });
            this.abortDeviceTransfers(body.deviceId);
            this.readers.closeDevice(body.deviceId);
            this.destinations.clearDevice(body.deviceId);
            for (const preparation of this.preparations.values()) if (preparation.deviceId === body.deviceId) preparation.controller.abort();
            this.log('readive.log_device_paired', { device: body.deviceName });
            return { json: paired };
        }
        const state = this.store.state;
        const device = /^[a-zA-Z0-9_-]{43}$/.test(token) ? state.devices.find(item => equalDigest(item.tokenHash, digest(token))) : null;
        if (!device) throw fail('unauthorized', 401);
        if (method === 'GET' && pathname === `${PREFIX}/destination-requests`) return { json: { requests: this.destinations.list(device) } };
        const destinationMatch = pathname.match(/^\/readive\/v1\/destinations\/([a-f0-9-]+)$/);
        if (method === 'POST' && destinationMatch) return { json: this.destinations.respond(device, destinationMatch[1], body) };
        if (method === 'GET' && pathname === `${PREFIX}/libraries`) {
            const libraries = [];
            for (const registered of registeredReadiveLibraries(state, this.getRegisteredLibraries())) {
                try {
                    libraries.push(await validateReadiveLibrary(state, this.getRegisteredLibraries(), registered.id));
                } catch { /* Unavailable roots are omitted from the catalog. */ }
            }
            this.validateDevice(device);
            const allowed = libraries.filter(({ scope }) => {
                try { this.validateLibraryPermission(scope); return true; } catch { return false; }
            }).map(({ library }) => ({ id: library.id, name: library.name }));
            return { json: { libraries: allowed } };
        }
        const readerMatch = pathname.match(/^\/readive\/v1\/readers\/([a-f0-9-]+)\/(content|close)$/);
        if (readerMatch) {
            const [, readerId, action] = readerMatch;
            if (method === 'POST' && action === 'close') {
                const session = this.readers.get(readerId, device, { touch: false, missingAllowed: true });
                if (session) this.readers.remove(readerId);
                return { json: { success: true } };
            }
            if (method !== 'GET' || action !== 'content') throw fail('not_found', 404);
            const session = await this.validateReader(readerId, device);
            const handle = await openReaderAsset(session.asset);
            await handle.close();
            await this.validateReader(readerId, device);
            return { asset: session.asset, deviceId: device.id, readerId, tokenHash: device.tokenHash };
        }
        const libraryMatch = pathname.match(/^\/readive\/v1\/libraries\/([a-f0-9]{32})\/(entries|prepare|preparations|read)(?:\/([a-f0-9-]+)(?:\/(cancel))?)?$/);
        if (libraryMatch) {
            const [, libraryId, action, scanId, cancel] = libraryMatch;
            if (action === 'preparations' && scanId) {
                if (method === 'POST' && cancel) return { json: await this.cancelPreparation(libraryId, scanId, device) };
                this.prunePreparations();
                if (method === 'GET' && !cancel && this.cancelledPreparations.has(this.preparationKey(device, libraryId, scanId))) return { json: { state: 'failed', error: 'scan_cancelled' } };
                const preparation = this.preparations.get(scanId);
                if (!preparation || preparation.deviceId !== device.id || preparation.tokenHash !== device.tokenHash || preparation.scope.libraryId !== libraryId) throw fail('not_found', 404);
                if (method !== 'GET' || cancel) throw fail('not_found', 404);
                await validateReadiveLibrary(state, this.getRegisteredLibraries(), libraryId, preparation.scope);
                this.validateLibraryPermission(preparation.scope);
                this.validateDevice(device);
                if (preparation.state === 'ready') {
                    const current = this.store.state.jobs.find(job => job.id === preparation.jobId);
                    if (!current) throw fail('not_found', 404);
                    return { json: { state: 'ready', job: publicJob(current), manifest: current.manifest } };
                }
                return { json: { state: preparation.state, ...(preparation.error ? { error: preparation.error } : {}) } };
            }
            if (scanId) throw fail('not_found', 404);
            if (method === 'POST' && action === 'read') {
                if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'path')) throw fail('invalid_library_path');
                return { json: await this.readers.open(device, body.path,
                    async () => (await validateReadiveLibrary(this.store.state, this.getRegisteredLibraries(), libraryId)).scope,
                    async scope => {
                        await validateReadiveLibrary(this.store.state, this.getRegisteredLibraries(), libraryId, scope);
                        this.validateLibraryPermission(scope);
                        this.validateDevice(device);
                        this.validateSource(remoteAddress, localAddress);
                    }, signal) };
            }
            if (method === 'POST' && action === 'prepare') return { json: await this.beginPreparation(libraryId, body.paths, device, body.scanId) };
            if (method === 'GET' && action === 'entries') {
                if ([...query.keys()].some(key => !['path', 'cursor'].includes(key)) || query.getAll('path').length > 1 || query.getAll('cursor').length > 1) throw fail('query_not_allowed');
                const { scope } = await validateReadiveLibrary(state, this.getRegisteredLibraries(), libraryId);
                const result = await readReadiveLibraryEntries(scope, query.get('path') || '', query.get('cursor') || '', { secret: this.catalogSecret, cache: this.catalogCache, signal });
                await validateReadiveLibrary(this.store.state, this.getRegisteredLibraries(), libraryId, scope);
                this.validateLibraryPermission(scope);
                if (!this.store.state.devices.some(item => item.id === device.id && equalDigest(item.tokenHash, device.tokenHash))) throw fail('unauthorized', 401);
                return { json: result };
            }
            throw fail('not_found', 404);
        }
        if (method === 'GET' && pathname === `${PREFIX}/jobs`) {
            return { json: await this.store.transact(next => {
                const active = next.devices.find(item => item.id === device.id);
                if (!active) throw fail('unauthorized', 401);
                active.lastSeenAt = new Date(this.now()).toISOString();
                return { jobs: next.jobs.filter(job => job.deviceId === device.id).map(publicJob) };
            }) };
        }
        if (method === 'POST' && pathname === `${PREFIX}/reading`) {
            const records = await this.store.transact(async next => {
                if (!next.devices.some(item => item.id === device.id && equalDigest(item.tokenHash, digest(token)))) throw fail('unauthorized', 401);
                return exchangeReading(next, device, body.records, await this.getLibraryDb?.(), body.itemIds);
            });
            this.onReadingChanged();
            return { json: { records } };
        }
        const match = pathname.match(/^\/readive\/v1\/jobs\/([a-f0-9-]+)(?:\/(accept|ack|cancel|files|covers)(?:\/([a-f0-9-]+))?)?$/);
        const job = match && state.jobs.find(item => item.id === match[1] && item.deviceId === device.id);
        if (!job) throw fail('not_found', 404);
        const action = match[2];
        if (method === 'GET' && !action) {
            await this.validateJobLibrary(job);
            this.validateDevice(device);
            return { json: { job: publicJob(job), manifest: job.manifest } };
        }
        if (method === 'POST' && action === 'cancel') return { json: await this.cancel({ jobId: job.id }) };
        if (job.state === 'cancelled') throw fail('job_cancelled', 409);
        await this.validateJobLibrary(job);
        if (method === 'POST' && action === 'accept') {
            if (body.manifestId !== job.manifest.id) throw fail('manifest_mismatch', 409);
            if (transferSizePolicy(job.summary).large && body.largeConfirmed !== true) throw fail('large_confirmation_required', 409);
            return { json: await this.store.transact(async next => {
                if (!next.devices.some(item => item.id === device.id && equalDigest(item.tokenHash, digest(token)))) throw fail('unauthorized', 401);
                const current = next.jobs.find(item => item.id === job.id);
                if (current.state === 'cancelled') throw fail('job_cancelled', 409);
                await this.validateJobLibrary(current, next);
                for (const asset of Object.values(current.assets)) {
                    const handle = await openFrozenAsset(asset);
                    await handle.close();
                }
                if (current.state !== 'completed') current.state = 'accepted';
                return { success: true };
            }) };
        }
        if (job.state !== 'accepted' && job.state !== 'completed') throw fail('accept_required', 409);
        if (method === 'GET' && (action === 'files' || action === 'covers')) {
            const assetId = job.fileAssets[match[3]]?.[action === 'files' ? 'file' : 'cover'];
            if (!assetId || !job.assets[assetId]) throw fail('asset_not_found', 404);
            return { asset: job.assets[assetId], deviceId: device.id, jobId: job.id, tokenHash: device.tokenHash };
        }
        if (method === 'POST' && action === 'ack') {
            return { json: await this.store.transact(next => {
                if (!next.devices.some(item => item.id === device.id && equalDigest(item.tokenHash, digest(token)))) throw fail('unauthorized', 401);
                const current = next.jobs.find(item => item.id === job.id);
                if (current.state === 'cancelled') throw fail('job_cancelled', 409);
                if (body.complete === true) {
                    if (current.completedFileIds.length !== current.manifest.files.length) throw fail('incomplete_transfer', 409);
                    current.state = 'completed';
                } else {
                    if (!current.manifest.files.some(file => file.id === body.fileId)) throw fail('unknown_file', 404);
                    if (!current.completedFileIds.includes(body.fileId)) current.completedFileIds.push(body.fileId);
                }
                return { success: true };
            }) };
        }
        throw fail('not_found', 404);
    }

    async handleRequest(request, response) {
        const controller = new AbortController();
        const disconnected = () => { if (!response.writableEnded) controller.abort(); };
        response.once('close', disconnected);
        try {
            if (request.headers.origin || !['GET', 'POST'].includes(request.method)) throw fail('request_not_allowed', 403);
            this.validateSource(request.socket.remoteAddress, request.socket.localAddress);
            const url = new URL(request.url, 'https://readive.invalid');
            if (url.search && !(request.method === 'GET' && /^\/readive\/v1\/libraries\/[a-f0-9]{32}\/entries$/.test(url.pathname))) throw fail('query_not_allowed');
            const result = await this.dispatch({
                method: request.method, pathname: url.pathname, query: url.searchParams,
                body: request.method === 'POST' ? await readBody(request) : {},
                token: /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(String(request.headers.authorization || ''))?.[1] || '',
                remoteAddress: request.socket.remoteAddress, localAddress: request.socket.localAddress, signal: controller.signal,
            });
            if (result.asset) {
                if (result.readerId) await this.sendReaderAsset(request, response, result);
                else await this.sendAsset(request, response, result);
                return;
            }
            this.sendJson(response, 200, result.json);
        } catch (error) {
            const catalogRequest = request.method === 'GET' && /^\/readive\/v1\/libraries(?:\/[a-f0-9]{32}\/entries)?$/.test(String(request.url || '').split('?')[0]);
            if (catalogRequest) this.logError('readive.log_catalog_failed', error);
            else if (request.method === 'POST' || (error.status || 500) >= 500) this.logError('readive.log_request_failed', error);
            if (!response.headersSent) this.sendJson(response, error.status || 500, { error: error.code || 'internal_error' });
            else response.destroy();
        } finally {
            response.removeListener('close', disconnected);
        }
    }

    sendJson(response, status, value) {
        const bytes = Buffer.from(JSON.stringify(value));
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'Connection': 'close', 'X-Content-Type-Options': 'nosniff' });
        response.end(bytes);
    }

    async validateReader(readerId, device) {
        const session = this.readers.get(readerId, device);
        await validateReadiveLibrary(this.store.state, this.getRegisteredLibraries(), session.scope.libraryId, session.scope);
        this.validateLibraryPermission(session.scope);
        this.validateDevice(device);
        if (this.readers.get(readerId, device) !== session) throw fail('reader_expired', 409);
        return session;
    }

    async sendReaderAsset(request, response, { asset, deviceId, readerId, tokenHash }) {
        const device = { id: deviceId, tokenHash };
        const handle = await openReaderAsset(asset);
        const controller = new AbortController();
        const key = `${deviceId}:reader-${readerId}`;
        let responses;
        const disconnected = () => controller.abort();
        try {
            const session = await this.validateReader(readerId, device);
            this.validateSource(request.socket.remoteAddress, request.socket.localAddress);
            if (response.destroyed) throw fail('reader_expired', 409);
            let start = 0;
            let end = asset.size - 1;
            const range = request.headers.range;
            if (range) {
                const match = /^bytes=(\d+)-(\d*)$/.exec(range);
                if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) >= asset.size
                    || (match[2] && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) < Number(match[1]) || Number(match[2]) >= asset.size))) throw fail('invalid_range', 416);
                start = Number(match[1]);
                end = match[2] ? Number(match[2]) : end;
            }
            responses = this.connections.get(key) || new Set();
            if (responses.size >= 4) throw fail('too_many_transfers', 429);
            responses.add(response);
            this.connections.set(key, responses);
            response.once('close', disconnected);
            response.writeHead(range ? 206 : 200, {
                'Content-Type': asset.mimeType, 'Content-Length': Math.max(0, end - start + 1),
                'Accept-Ranges': 'bytes', ETag: `"${session.sourceVersion}"`, 'Cache-Control': 'no-store', Connection: 'close',
                ...(range ? { 'Content-Range': `bytes ${start}-${end}/${asset.size}` } : {}),
            });
            let sent = 0;
            let checkedAt = 0;
            if (asset.size) {
                const stream = handle.createReadStream({ start, end, autoClose: false, signal: controller.signal });
                for await (const chunk of stream) {
                    if (controller.signal.aborted) throw fail('reader_expired', 409);
                    const finalChunk = sent + chunk.length === end - start + 1;
                    if (finalChunk || this.now() - checkedAt >= 1000) {
                        await this.validateReader(readerId, device);
                        this.validateSource(request.socket.remoteAddress, request.socket.localAddress);
                        const current = await openReaderAsset(asset);
                        await current.close();
                        const stat = await handle.stat();
                        if (Object.entries(asset.identity).some(([name, value]) => stat[name] !== value)) throw fail('source_changed', 409);
                        if (controller.signal.aborted || response.destroyed) throw fail('reader_expired', 409);
                        checkedAt = this.now();
                    }
                    sent += chunk.length;
                    if (!response.write(chunk)) {
                        await new Promise((resolve, reject) => {
                            const cleanup = () => { response.removeListener('drain', drained); response.removeListener('close', closed); };
                            const drained = () => { cleanup(); resolve(); };
                            const closed = () => { cleanup(); reject(fail('reader_expired', 409)); };
                            response.once('drain', drained);
                            response.once('close', closed);
                            if (response.destroyed) closed();
                        });
                    }
                }
            }
            response.end();
        } finally {
            response.removeListener('close', disconnected);
            responses?.delete(response);
            if (responses && !responses.size && this.connections.get(key) === responses) this.connections.delete(key);
            await handle.close();
        }
    }

    async sendAsset(request, response, { asset, deviceId, jobId, tokenHash }) {
        const handle = await openFrozenAsset(asset);
        try {
            let start = 0;
            let end = asset.size - 1;
            const range = request.headers.range;
            if (range) {
                const match = /^bytes=(\d+)-(\d*)$/.exec(range);
                if (!match || Number(match[1]) >= asset.size || (match[2] && (Number(match[2]) < Number(match[1]) || Number(match[2]) >= asset.size))) throw fail('invalid_range', 416);
                start = Number(match[1]);
                end = match[2] ? Number(match[2]) : end;
            }
            await this.validateJobLibrary(this.store.state.jobs.find(job => job.id === jobId));
            const state = this.store.state;
            if (!state.devices.some(device => device.id === deviceId && equalDigest(device.tokenHash, tokenHash)) || state.jobs.find(job => job.id === jobId)?.state === 'cancelled') throw fail('job_cancelled', 409);
            const key = `${deviceId}:${jobId}`;
            const responses = this.connections.get(key) || new Set();
            if (responses.size >= 4) throw fail('too_many_transfers', 429);
            responses.add(response);
            this.connections.set(key, responses);
            const cleanup = () => { responses.delete(response); if (!responses.size) this.connections.delete(key); };
            response.once('close', cleanup);
            response.writeHead(range ? 206 : 200, {
                'Content-Type': asset.mimeType, 'Content-Length': Math.max(0, end - start + 1),
                'Accept-Ranges': 'bytes', ETag: `"${asset.sha256}"`, 'Cache-Control': 'no-store', Connection: 'close',
                ...(range ? { 'Content-Range': `bytes ${start}-${end}/${asset.size}` } : {}),
            });
            if (!asset.size) { response.end(); cleanup(); return; }
            await new Promise((resolve, reject) => {
                const stream = handle.createReadStream({ start, end, autoClose: false });
                let lastNetworkCheck = 0;
                let checkingLibrary = false;
                stream.on('data', () => {
                    if (Date.now() - lastNetworkCheck < 1000) return;
                    lastNetworkCheck = Date.now();
                    try {
                        this.validateSource(request.socket.remoteAddress, request.socket.localAddress);
                        if (!this.store.state.devices.some(device => device.id === deviceId && equalDigest(device.tokenHash, tokenHash))) throw fail('unauthorized', 401);
                        if (!checkingLibrary) {
                            checkingLibrary = true;
                            this.validateJobLibrary(this.store.state.jobs.find(job => job.id === jobId)).catch(error => {
                                stream.destroy(error);
                                response.destroy();
                            }).finally(() => { checkingLibrary = false; });
                        }
                    } catch (error) {
                        stream.destroy(error);
                        response.destroy();
                    }
                });
                const done = () => { stream.destroy(); resolve(); };
                response.once('close', done);
                stream.once('error', reject);
                stream.once('end', resolve);
                stream.pipe(response);
            });
        } finally {
            await handle.close();
        }
    }

    async readingState(filePath) {
        const state = await this.store.load();
        const libraryDb = await this.getLibraryDb?.();
        return libraryDb ? getImportedReadingState(state, filePath, libraryDb) : null;
    }
}
