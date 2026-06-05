import Database from 'better-sqlite3';
import { app } from 'electron';
import { existsSync } from 'fs';
import { mkdirSync } from 'fs';

export interface CacheEntry {
  key: string;
  value: string;
  created_at: string;
  ttl_days: number;
}

class ApiCache {
  private db: Database.Database;
  private initialized = false;

  constructor(dbPath?: string) {
    const basePath = dbPath || app.getPath('userData');
    this.db = new Database(`${basePath}/.api_cache.db`);
  }

  private ensureInitialized(): void {
    if (this.initialized) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ttl_days INTEGER DEFAULT 7
      );
      CREATE TABLE IF NOT EXISTS img_cache (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL,
        created_at TEXT NOT NULL,
        ttl_days INTEGER DEFAULT 30
      );
      CREATE TABLE IF NOT EXISTS trans_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ttl_days INTEGER DEFAULT 30
      );
      CREATE TABLE IF NOT EXISTS ridi_date_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ttl_days INTEGER DEFAULT 7
      );
    `);

    this.initialized = true;
  }

  public get(table: 'search_cache' | 'trans_cache' | 'ridi_date_cache', key: string): string | null {
    this.ensureInitialized();

    const row = this.db
      .prepare(`SELECT value, created_at, ttl_days FROM ${table} WHERE key = ?`)
      .get(key) as { value: string; created_at: string; ttl_days: number } | undefined;

    if (!row) return null;

    const created = new Date(row.created_at);
    const now = new Date();
    const diffDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays > row.ttl_days) {
      this.delete(table, key);
      return null;
    }

    return row.value;
  }

  public getBinary(table: 'img_cache', key: string): Buffer | null {
    this.ensureInitialized();

    const row = this.db
      .prepare(`SELECT value, created_at, ttl_days FROM ${table} WHERE key = ?`)
      .get(key) as { value: Buffer; created_at: string; ttl_days: number } | undefined;

    if (!row) return null;

    const created = new Date(row.created_at);
    const now = new Date();
    const diffDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays > row.ttl_days) {
      this.delete(table, key);
      return null;
    }

    return row.value;
  }

  public set(
    table: 'search_cache' | 'trans_cache' | 'ridi_date_cache',
    key: string,
    value: string,
    ttlDays: number = 7
  ): void {
    this.ensureInitialized();

    this.db.prepare(`
      INSERT OR REPLACE INTO ${table} (key, value, created_at, ttl_days)
      VALUES (?, ?, datetime('now'), ?)
    `).run(key, value, ttlDays);
  }

  public setBinary(table: 'img_cache', key: string, value: Buffer, ttlDays: number = 30): void {
    this.ensureInitialized();

    this.db.prepare(`
      INSERT OR REPLACE INTO ${table} (key, value, created_at, ttl_days)
      VALUES (?, ?, datetime('now'), ?)
    `).run(key, value, ttlDays);
  }

  public delete(table: string, key: string): void {
    this.ensureInitialized();
    this.db.prepare(`DELETE FROM ${table} WHERE key = ?`).run(key);
  }

  public clear(table?: string): void {
    this.ensureInitialized();

    if (table) {
      this.db.prepare(`DELETE FROM ${table}`).run();
    } else {
      this.db.exec(`
        DELETE FROM search_cache;
        DELETE FROM img_cache;
        DELETE FROM trans_cache;
        DELETE FROM ridi_date_cache;
      `);
    }
  }

  public close(): void {
    this.db.close();
  }
}

let instance: ApiCache | null = null;

export function getApiCache(): ApiCache {
  if (!instance) {
    instance = new ApiCache();
  }
  return instance;
}
