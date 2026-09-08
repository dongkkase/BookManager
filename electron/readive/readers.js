import crypto from 'node:crypto';
import path from 'node:path';
import { resolveReadiveLibraryPath } from './catalog.js';
import { openFrozenAsset, readiveFileFormat } from './manifest.js';
import { fail, READIVE_LIMITS } from './policy.js';

const identity = stat => ({ size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, dev: stat.dev });

export async function openReaderAsset(asset) {
    try { return await openFrozenAsset(asset); }
    catch (error) {
        if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM'].includes(error.code)) throw fail('source_changed', 409);
        throw error;
    }
}

export class ReadiveReaders {
    constructor({ now = Date.now, onClose = () => {} } = {}) {
        this.now = now;
        this.onClose = onClose;
        this.sessions = new Map();
        this.pending = new Set();
        this.secret = crypto.randomBytes(32);
        this.generation = 0;
        this.timer = null;
        this.idleMs = 10 * 60 * 1000;
    }

    prune() {
        for (const session of this.sessions.values()) if (session.expiresAt <= this.now()) this.remove(session.id);
    }

    schedule() {
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.sessions.size) return;
        const expiry = Math.min(...[...this.sessions.values()].map(session => session.expiresAt));
        this.timer = setTimeout(() => { this.prune(); this.schedule(); }, Math.max(1, expiry - this.now()));
        this.timer.unref?.();
    }

    remove(id) {
        const session = this.sessions.get(id);
        if (!session) return;
        this.sessions.delete(id);
        this.onClose(session);
    }

    closeDevice(deviceId) {
        for (const session of this.sessions.values()) if (session.deviceId === deviceId) this.remove(session.id);
        for (const reservation of this.pending) if (reservation.deviceId === deviceId) reservation.cancelled = true;
        this.schedule();
    }

    clear() {
        this.generation += 1;
        for (const session of this.sessions.values()) this.remove(session.id);
        clearTimeout(this.timer);
        this.timer = null;
    }

    get(id, device, { touch = true, missingAllowed = false } = {}) {
        this.prune();
        const session = this.sessions.get(id);
        if (!session && missingAllowed) return null;
        if (!session || session.deviceId !== device.id || session.tokenHash !== device.tokenHash) throw fail('reader_expired', 409);
        if (touch) {
            session.expiresAt = this.now() + this.idleMs;
            this.schedule();
        }
        return session;
    }

    async open(device, relativePath, resolveScope, validate, signal) {
        this.prune();
        const owned = [...this.sessions.values(), ...this.pending].filter(session => session.deviceId === device.id).length;
        if (owned >= 4 || this.sessions.size + this.pending.size >= 32) throw fail('too_many_readers', 429);
        const reservation = { deviceId: device.id, cancelled: false };
        const generation = this.generation;
        this.pending.add(reservation);
        const check = () => {
            if (signal?.aborted || reservation.cancelled || generation !== this.generation) throw fail('reader_expired', 409);
        };
        try {
            check();
            const scope = await resolveScope();
            check();
            const { sourcePath, stat } = await resolveReadiveLibraryPath(scope, relativePath);
            if (!stat.isFile()) throw fail('invalid_library_path');
            if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > READIVE_LIMITS.hardBytes) throw fail('transfer_hard_limit', 413);
            const asset = { sourcePath, identity: identity(stat), size: stat.size, mimeType: 'application/octet-stream' };
            const handle = await openReaderAsset(asset);
            await handle.close();
            await validate(scope);
            check();
            const sourceVersion = crypto.createHmac('sha256', this.secret).update(JSON.stringify({ approvalId: scope.approvalId, path: relativePath, identity: asset.identity })).digest('hex');
            const session = {
                id: crypto.randomUUID(), deviceId: device.id, tokenHash: device.tokenHash, scope, asset,
                name: path.basename(sourcePath), format: readiveFileFormat(sourcePath), sourceVersion, expiresAt: this.now() + this.idleMs,
            };
            this.sessions.set(session.id, session);
            this.schedule();
            return { id: session.id, name: session.name, size: asset.size, format: session.format, sourceVersion };
        } finally { this.pending.delete(reservation); }
    }
}
