import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fail } from './policy.js';

export class ReadiveStore {
    constructor(directory) {
        this.directory = directory;
        this.filePath = path.join(directory, 'state.json');
        this.state = null;
        this.pending = Promise.resolve();
        this.loading = null;
    }

    async load() {
        if (this.loading) return this.loading;
        if (this.state) return this.state;
        this.loading = this.initialize();
        try {
            return await this.loading;
        } finally {
            this.loading = null;
        }
    }

    async initialize() {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            const bytes = await fs.readFile(this.filePath);
            if (bytes.length > 128 * 1024 ** 2) throw fail('readive_store_too_large');
            const state = JSON.parse(bytes.toString('utf8'));
            if (state.version !== 1 || !state.serverId || !Array.isArray(state.devices) || !Array.isArray(state.jobs)) throw fail('readive_store_invalid');
            this.state = state;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            this.state = { version: 1, serverId: crypto.randomUUID(), devices: [], jobs: [], items: {}, reading: {}, appliedReadings: {} };
            await this.save();
        }
        return this.state;
    }

    async save() {
        const bytes = Buffer.from(JSON.stringify(this.state));
        if (bytes.length > 128 * 1024 ** 2) throw fail('readive_store_too_large');
        const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
        try {
            await fs.rename(temporary, this.filePath);
        } finally {
            await fs.rm(temporary, { force: true });
        }
    }

    transact(callback) {
        const operation = this.pending.then(async () => {
            await this.load();
            const previous = structuredClone(this.state);
            try {
                const result = await callback(this.state);
                await this.save();
                return result;
            } catch (error) {
                this.state = previous;
                throw error;
            }
        });
        this.pending = operation.catch(() => {});
        return operation;
    }
}
