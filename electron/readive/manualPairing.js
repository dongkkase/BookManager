import crypto from 'node:crypto';
import { fail } from './policy.js';

const NONCE = /^[a-f0-9]{64}$/;
const DEVICE_ID = /^[a-zA-Z0-9_-]{8,100}$/;
const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));

function validateCredentials(body, includeName = false) {
    const keys = includeName ? ['requestId', 'nonce', 'deviceId', 'deviceName'] : ['nonce', 'deviceId'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))
        || typeof body.nonce !== 'string' || !NONCE.test(body.nonce)
        || typeof body.deviceId !== 'string' || !DEVICE_ID.test(body.deviceId)
        || (includeName && (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)))
        || (includeName && (typeof body.deviceName !== 'string' || !body.deviceName.trim() || body.deviceName.length > 100
            || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(body.deviceName)))) {
        throw fail('manual_pairing_invalid', 400);
    }
}

export function manualPairingCode(certificateSha256, nonce, deviceId) {
    if (!NONCE.test(certificateSha256)) throw fail('manual_pairing_invalid', 400);
    validateCredentials({ nonce, deviceId });
    return hash(`readive-manual-pair-v1\n${certificateSha256}\n${nonce}\n${deviceId}`).slice(0, 16).toUpperCase().match(/.{4}/g).join(' ');
}

export class ReadiveManualPairing {
    constructor({ now = Date.now, requestApproval, ttlMs = 120000 } = {}) {
        this.now = now;
        this.requestApproval = requestApproval;
        this.ttlMs = ttlMs;
        this.records = new Map();
        this.prompt = null;
        this.attempts = { count: 0, until: 0 };
    }

    invalidate(record, state = 'denied') {
        record.state = state;
        record.ticket = null;
        record.secretHash = null;
        record.controller.abort();
        clearTimeout(record.timer);
    }

    prune() {
        for (const [id, record] of this.records) {
            if (record.deadline <= this.now()) {
                this.invalidate(record);
                this.records.delete(id);
            }
        }
    }

    admit() {
        if (this.attempts.until <= this.now()) this.attempts = { count: 0, until: this.now() + 600000 };
        if (this.attempts.count >= 10 || this.records.size >= 16) throw fail('manual_pairing_busy', 429);
        this.attempts.count += 1;
    }

    begin(body, context) {
        validateCredentials(body, true);
        this.prune();
        if (typeof this.requestApproval !== 'function') throw fail('manual_pairing_unsupported', 409);
        const existing = this.records.get(body.requestId);
        if (existing) {
            if (existing.deviceId !== body.deviceId || !equal(existing.nonce, body.nonce)) throw fail('manual_pairing_invalid', 401);
            if (existing.state === 'cancelled') throw fail('manual_pairing_expired', 410);
            if (existing.deviceName !== body.deviceName.trim()) throw fail('manual_pairing_invalid', 401);
            return { ...existing.public };
        }
        if (this.prompt || [...this.records.values()].some(record => ['pending', 'approved'].includes(record.state))) throw fail('manual_pairing_busy', 429);
        this.admit();
        const requestId = body.requestId;
        const deadline = this.now() + this.ttlMs;
        const controller = new AbortController();
        const record = {
            deviceId: body.deviceId, deviceName: body.deviceName.trim(), nonce: body.nonce, deadline, controller,
            state: 'pending', ticket: null, secretHash: null,
            public: { version: 1, requestId, serverId: context.serverId, serverName: context.serverName, expiresAt: new Date(deadline).toISOString() },
        };
        const code = manualPairingCode(context.certificateSha256, body.nonce, body.deviceId);
        const frozenContext = { ...context };
        record.timer = setTimeout(() => {
            this.invalidate(record);
            if (this.records.get(requestId) === record) this.records.delete(requestId);
        }, this.ttlMs);
        record.timer.unref?.();
        this.records.set(requestId, record);
        this.prompt = record;
        Promise.resolve().then(() => {
            if (controller.signal.aborted) return false;
            return this.requestApproval({ code, deviceName: record.deviceName, signal: controller.signal });
        }).then(approved => {
            if (this.records.get(requestId) !== record || controller.signal.aborted || record.state !== 'pending' || this.now() >= deadline) return;
            if (approved !== true) { this.invalidate(record); return; }
            const secret = crypto.randomBytes(32).toString('base64url');
            record.ticket = { version: 1, ...frozenContext, secret, expiresAt: new Date(Math.min(deadline, this.now() + 60000)).toISOString() };
            record.secretHash = hash(secret);
            record.state = 'approved';
        }).catch(() => {
            if (this.records.get(requestId) === record && record.state === 'pending') this.invalidate(record);
        }).finally(() => {
            if (this.prompt === record) this.prompt = null;
        });
        return { ...record.public };
    }

    get(requestId, body) {
        validateCredentials(body);
        this.prune();
        if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw fail('manual_pairing_invalid', 400);
        const record = this.records.get(requestId);
        if (!record) throw fail('manual_pairing_expired', 410);
        if (record.deviceId !== body.deviceId || !equal(record.nonce, body.nonce)) throw fail('manual_pairing_invalid', 401);
        if (record.state === 'approved' && Date.parse(record.ticket.expiresAt) <= this.now()) {
            this.invalidate(record);
            throw fail('manual_pairing_expired', 410);
        }
        return record;
    }

    status(requestId, body) {
        const record = this.get(requestId, body);
        return record.state === 'approved' ? { status: 'approved', ticket: { ...record.ticket } }
            : { status: record.state === 'pending' ? 'pending' : 'denied' };
    }

    cancel(requestId, body) {
        validateCredentials(body);
        if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw fail('manual_pairing_invalid', 400);
        this.prune();
        let record = this.records.get(requestId);
        if (record) {
            if (record.deviceId !== body.deviceId || !equal(record.nonce, body.nonce)) throw fail('manual_pairing_invalid', 401);
        } else {
            this.admit();
            record = { ...body, controller: new AbortController(), deadline: this.now() + this.ttlMs };
            this.records.set(requestId, record);
        }
        this.invalidate(record, 'cancelled');
        record.timer = setTimeout(() => {
            if (this.records.get(requestId) === record) this.records.delete(requestId);
        }, Math.max(0, record.deadline - this.now()));
        record.timer.unref?.();
        return { status: 'cancelled' };
    }

    consume(secret, body) {
        this.prune();
        if (typeof secret !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(secret)) return false;
        const secretHash = hash(secret);
        for (const record of this.records.values()) {
            if (record.state !== 'approved' || Date.parse(record.ticket.expiresAt) <= this.now() || !equal(record.secretHash, secretHash)) continue;
            if (record.deviceId !== body.deviceId || record.deviceName !== body.deviceName?.trim()) return false;
            this.invalidate(record);
            return true;
        }
        return false;
    }

    clear() {
        for (const record of this.records.values()) this.invalidate(record);
        this.records.clear();
        // The native prompt still owns its slot until its aborted promise settles.
    }
}
