import crypto from 'node:crypto';
import { fail } from './policy.js';

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,180}$/.test(value);
const validParent = value => value === null || validId(value);
const validString = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const validCursor = value => value === null || validString(value, 2048);
const choiceKey = (device, parentId) => `${device.id}:${device.tokenHash}:${parentId || ''}`;

export class ReadiveDestinations {
    constructor({ now = Date.now } = {}) {
        this.now = now;
        this.requests = new Map();
        this.choices = new Map();
        this.timeoutMs = 30000;
    }

    prune() {
        for (const request of this.requests.values()) if (request.expiresAt <= this.now()) this.settle(request, fail('destination_unavailable', 409));
        for (const [key, choice] of this.choices) if (choice.expiresAt <= this.now()) this.choices.delete(key);
    }

    settle(request, error, page) {
        clearTimeout(request.timer);
        this.requests.delete(request.id);
        if (error) request.reject(error);
        else request.resolve(page);
    }

    clearDevice(deviceId) {
        for (const request of this.requests.values()) if (request.deviceId === deviceId) this.settle(request, fail('destination_unavailable', 409));
        for (const [key, choice] of this.choices) if (choice.deviceId === deviceId) this.choices.delete(key);
    }

    clear() {
        for (const request of this.requests.values()) this.settle(request, fail('destination_unavailable', 409));
        this.choices.clear();
    }

    request(device, parentId = null, cursor = null) {
        this.prune();
        if (!validParent(parentId) || !validCursor(cursor)) throw fail('invalid_destination_page');
        if (this.requests.size >= 4) throw fail('destination_busy', 429);
        return new Promise((resolve, reject) => {
            const request = { id: crypto.randomUUID(), deviceId: device.id, tokenHash: device.tokenHash, parentId, cursor, expiresAt: this.now() + this.timeoutMs, resolve, reject };
            request.timer = setTimeout(() => this.settle(request, fail('destination_unavailable', 409)), this.timeoutMs);
            request.timer.unref?.();
            this.requests.set(request.id, request);
        });
    }

    list(device) {
        this.prune();
        return [...this.requests.values()].filter(request => request.deviceId === device.id && request.tokenHash === device.tokenHash)
            .map(({ id, parentId, cursor }) => ({ id, parentId, cursor }));
    }

    respond(device, id, input) {
        this.prune();
        const request = this.requests.get(id);
        if (!request || request.deviceId !== device.id || request.tokenHash !== device.tokenHash) throw fail('destination_unavailable', 409);
        if (!input || typeof input !== 'object' || Buffer.byteLength(JSON.stringify(input)) > 256 * 1024) throw fail('invalid_destination_page');
        if (input.error !== undefined) {
            if (Object.keys(input).length !== 1 || !['destination_missing', 'destination_changed', 'destination_unavailable'].includes(input.error)) throw fail('invalid_destination_page');
            this.settle(request, fail(input.error, 409));
            return { success: true };
        }
        if (Object.keys(input).some(key => !['parentId', 'name', 'entries', 'nextCursor', 'revision'].includes(key))
            || input.parentId !== request.parentId || !validString(input.name, 255) || !validString(input.revision, 128)
            || !validCursor(input.nextCursor) || input.nextCursor === request.cursor && input.nextCursor !== null
            || !Array.isArray(input.entries) || input.entries.length > 100) throw fail('invalid_destination_page');
        const seen = new Set();
        const entries = input.entries.map(entry => {
            if (!entry || Object.keys(entry).some(key => !['id', 'name', 'kind', 'size'].includes(key))
                || !validId(entry.id) || entry.id === request.parentId || seen.has(entry.id) || !validString(entry.name, 255)
                || !['directory', 'file'].includes(entry.kind)
                || (entry.kind === 'directory' ? entry.size !== null : entry.size !== null && (!Number.isSafeInteger(entry.size) || entry.size < 0))) throw fail('invalid_destination_page');
            seen.add(entry.id);
            return { id: entry.id, name: entry.name, kind: entry.kind, size: entry.size };
        });
        const page = { name: input.name, parentId: input.parentId, entries, nextCursor: input.nextCursor, revision: input.revision };
        const key = choiceKey(device, page.parentId);
        this.choices.delete(key);
        while (this.choices.size >= 64) this.choices.delete(this.choices.keys().next().value);
        this.choices.set(key, { deviceId: device.id, revision: page.revision, expiresAt: this.now() + 10 * 60 * 1000 });
        this.settle(request, null, page);
        return { success: true };
    }

    validate(device, destination) {
        if (destination === undefined || destination === null) return null;
        this.prune();
        if (typeof destination !== 'object' || Object.keys(destination).some(key => !['collectionId', 'name', 'revision'].includes(key))
            || !validParent(destination.collectionId) || !validString(destination.name, 512) || !validString(destination.revision, 128)) throw fail('destination_changed', 409);
        const choice = this.choices.get(choiceKey(device, destination.collectionId));
        if (!choice || choice.revision !== destination.revision) throw fail('destination_changed', 409);
        return { collectionId: destination.collectionId, name: destination.name, revision: destination.revision };
    }
}
