import Database from 'better-sqlite3';
import { app } from 'electron';
import { join, sep, normalize } from 'path';
import fs from 'fs-extra';

export interface FileInfo {
  path: string;
  mtime: number;
  size: number;
  ext: string;
  resolution: string;
  title: string;
  series: string;
  series_group: string;
  volume: string;
  number: string;
  writer: string;
  creators: string;
  publisher: string;
  imprint: string;
  genre: string;
  volume_count: string;
  page_count: string;
  format: string;
  manga: string;
  language: string;
  rating: string;
  age_rating: string;
  publish_date: string;
  summary: string;
  characters: string;
  teams: string;
  locations: string;
  story_arc: string;
  tags: string;
  notes: string;
  web: string;
  thumb_path: string;
}

export interface DupTargetIndex {
  full_path: string;
  target_folder: string;
  name: string;
  size: number;
}

export interface DuplicateTarget {
  full_path: string;
  target_folder: string;
  name: string;
  size: number;
}

export interface DupCache {
  a_path: string;
  match_data: string; // JSON string
}

class LibraryDB {
  private db: Database.Database;

  constructor() {
    const userDataPath = app.getPath('userData');
    const dbDir = join(userDataPath, 'data');
    fs.ensureDirSync(dbDir);
    
    const dbPath = join(dbDir, 'library.db');
    this.db = new Database(dbPath);

    // Pragma optimizations
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 30000000000');

    this.initDb();
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        mtime REAL,
        size REAL,
        ext TEXT,
        resolution TEXT,
        title TEXT,
        series TEXT,
        series_group TEXT,
        volume TEXT,
        number TEXT,
        writer TEXT,
        creators TEXT,
        publisher TEXT,
        imprint TEXT,
        genre TEXT,
        volume_count TEXT,
        page_count TEXT,
        format TEXT,
        manga TEXT,
        language TEXT,
        rating TEXT,
        age_rating TEXT,
        publish_date TEXT,
        summary TEXT,
        characters TEXT,
        teams TEXT,
        locations TEXT,
        story_arc TEXT,
        tags TEXT,
        notes TEXT,
        web TEXT,
        thumb_path TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dup_cache (
        a_path TEXT PRIMARY KEY,
        match_data TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dup_target_index (
        full_path TEXT PRIMARY KEY,
        target_folder TEXT,
        name TEXT,
        size REAL
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_files_series ON files(series)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_files_title ON files(title)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_files_writer ON files(writer)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_dup_target_folder ON dup_target_index(target_folder)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_dup_target_name ON dup_target_index(name)');
  }

  // --- Metadata Methods ---
  upsertFileInfo(fileInfo: FileInfo): void {
    const keys = Object.keys(fileInfo);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map(k => fileInfo[k as keyof FileInfo]);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (${keys.join(', ')})
      VALUES (${placeholders})
    `);
    stmt.run(...values);
  }

  upsertFileInfoBulk(records: FileInfo[]): void {
    if (!records || records.length === 0) return;
    
    const keys = Object.keys(records[0]);
    const placeholders = keys.map(() => '?').join(', ');
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (${keys.join(', ')})
      VALUES (${placeholders})
    `);

    const insertMany = this.db.transaction((items: FileInfo[]) => {
      for (const item of items) {
        stmt.run(...keys.map(k => item[k as keyof FileInfo]));
      }
    });

    insertMany(records);
  }

  getFileInfo(path: string): FileInfo | undefined {
    const stmt = this.db.prepare('SELECT * FROM files WHERE path = ?');
    return stmt.get(path) as FileInfo | undefined;
  }

  // --- Target Index Methods ---
  saveTargetIndex(records: DuplicateTarget[]): void {
    if (!records || records.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dup_target_index (full_path, target_folder, name, size)
      VALUES (?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: DuplicateTarget[]) => {
      for (const item of items) {
        stmt.run(item.full_path, item.target_folder, item.name, item.size);
      }
    });

    insertMany(records);
  }

  getTargetIndex(targetFolder: string): Array<{ full_path: string; path: string; name: string; size: number }> {
    const stmt = this.db.prepare('SELECT full_path, name, size FROM dup_target_index WHERE target_folder = ?');
    const rows = stmt.all(targetFolder) as DupTargetIndex[];
    
    return rows.map(row => ({
      full_path: row.full_path,
      path: row.full_path.substring(0, row.full_path.lastIndexOf('/') || row.full_path.lastIndexOf('\\')),
      name: row.name,
      size: row.size
    }));
  }

  removeTargetIndexBulk(paths: string[]): void {
    if (!paths || paths.length === 0) return;

    const stmt = this.db.prepare('DELETE FROM dup_target_index WHERE full_path = ?');
    const deleteMany = this.db.transaction((items: string[]) => {
      for (const item of items) {
        stmt.run(item);
      }
    });

    deleteMany(paths);
  }

  // --- Duplicate Cache Methods ---
  saveDupMatch(aPath: string, matchData: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dup_cache (a_path, match_data)
      VALUES (?, ?)
    `);
    stmt.run(aPath, JSON.stringify(matchData));
  }

  getDupMatch(aPath: string): Record<string, unknown> | null {
    const stmt = this.db.prepare('SELECT match_data FROM dup_cache WHERE a_path = ?');
    const row = stmt.get(aPath) as { match_data: string } | undefined;
    if (row) {
      try {
        return JSON.parse(row.match_data);
      } catch {
        return null;
      }
    }
    return null;
  }

  getAllDupMatch(): Record<string, Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT a_path, match_data FROM dup_cache');
    const rows = stmt.all() as { a_path: string; match_data: string }[];
    
    const result: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      try {
        result[row.a_path] = JSON.parse(row.match_data);
      } catch { /* skip invalid entries */ }
    }
    return result;
  }

  saveDupMatchesBulk(matchList: { aPath: string; matchData: Record<string, unknown> }[]): void {
    if (!matchList || matchList.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dup_cache (a_path, match_data)
      VALUES (?, ?)
    `);

    const insertMany = this.db.transaction((items: { aPath: string; matchData: Record<string, unknown> }[]) => {
      for (const item of items) {
        stmt.run(item.aPath, JSON.stringify(item.matchData));
      }
    });

    insertMany(matchList);
  }

  clearDupCache(): void {
    this.db.exec('DELETE FROM dup_cache');
    this.db.exec('VACUUM');
  }

  getAllFilesInPath(folderPath: string, includeSub: boolean): Record<string, FileInfo> {
    const stmt = this.db.prepare('SELECT * FROM files WHERE path LIKE ?');
    // For backslash systems (Windows), the path might be stored with backslashes. 
    // We should probably allow searching by the exact format it was saved.
    // In Python it used os.path.normpath. Here we can check both or rely on the stored format.
    // Let's use the provided folderPath with a wildcard.
    const osSep = sep;
    const normFolder = normalize(folderPath);
    const likeParam = normFolder.endsWith(osSep) ? `${normFolder}%` : `${normFolder}${osSep}%`;
    
    const rows = stmt.all(likeParam) as FileInfo[];
    
    const result: Record<string, FileInfo> = {};
    for (const row of rows) {
      const filepath = row.path;
      if (!includeSub) {
        const dir = filepath.substring(0, filepath.lastIndexOf(osSep));
        if (dir !== normFolder) {
          continue;
        }
      }
      result[filepath] = row;
    }
    
    return result;
  }
}

// Lazy initialization
let _db: LibraryDB | null = null;

export function getDb(): LibraryDB {
  if (!_db) {
    _db = new LibraryDB();
  }
  return _db;
}

// Proxy object for backward compatibility
export const db = new Proxy<LibraryDB>({
  upsertFileInfo: () => {},
  upsertFileInfoBulk: () => {},
  getFileInfo: () => undefined,
  saveTargetIndex: () => {},
  getTargetIndex: () => [],
  removeTargetIndexBulk: () => {},
  saveDupMatch: () => {},
  getDupMatch: () => null,
  getAllDupMatch: () => ({}),
  saveDupMatchesBulk: () => {},
  clearDupCache: () => {},
  getAllFilesInPath: () => ({}),
} as unknown as LibraryDB, {
  get(_target, prop: string) {
    return Reflect.get(getDb(), prop);
  }
});
