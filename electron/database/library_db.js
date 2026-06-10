/**
 * Library Database Manager
 * Migratd from: old_project/ComicZIP_Optimizer/core/library_db.py
 * 
 * SQLite-based library management with thread-safe operations
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

class LibraryDB {
  constructor() {
    this.dbPath = this.getDBPath();
    this.db = null;
    this.lock = Promise.resolve();
  }

  /**
   * Get database file path
   * Returns path in userData directory for cross-platform compatibility
   */
  getDBPath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'library.db');
  }

  /**
   * Get database connection
   */
  getConnection() {
    if (!this.db) {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      this.db = new sqlite3.Database(this.dbPath);
      this.db.serialize(() => {
        this.createTables(this.db);
      });
    }
    return this.db;
  }

  /**
   * Create database tables if they don't exist
   */
  createTables(db) {
    db.run(`
      CREATE TABLE IF NOT EXISTS file_info (
        path TEXT PRIMARY KEY,
        filename TEXT,
        size INTEGER,
        ext TEXT,
        mod_date TEXT,
        meta_title TEXT,
        meta_volume TEXT,
        meta_chapter TEXT,
        meta_pages INTEGER,
        meta_date TEXT,
        meta_description TEXT,
        meta_creator TEXT,
        meta_genre TEXT,
        meta_tags TEXT,
        meta_cover TEXT,
        meta_processed INTEGER DEFAULT 0,
        thumb_path TEXT,
        series_name TEXT,
        sorted_volume REAL,
        scan_time TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS target_index (
        target_folder TEXT,
        file_path TEXT,
        UNIQUE(target_folder, file_path)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS dup_match (
        a_path TEXT PRIMARY KEY,
        match_path TEXT,
        match_score REAL,
        match_time TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS series_groups (
        series_name TEXT PRIMARY KEY,
        files TEXT,
        updated_at TEXT
      )
    `);

    // Create indexes for better query performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_file_info_series ON file_info(series_name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_file_info_mod_date ON file_info(mod_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_target_index_folder ON target_index(target_folder)`);
  }

  /**
   * Initialize database - create tables if needed
   */
  async initDB() {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        return true;
      } catch (error) {
        console.error('Failed to initialize database:', error);
        throw error;
      }
    });
  }

  /**
   * Execute operation with lock for thread safety
   */
  async withLock(fn) {
    // Chain operations to ensure serial execution
    this.lock = this.lock.then(() => fn()).catch(err => {
      console.error('Database lock error:', err);
      throw err;
    });
    return this.lock;
  }

  /**
   * Upsert file info record
   */
  async upsertFileInfo(record) {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        const {
          path: filePath,
          filename,
          size,
          ext,
          mod_date,
          meta_title,
          meta_volume,
          meta_chapter,
          meta_pages,
          meta_date,
          meta_description,
          meta_creator,
          meta_genre,
          meta_tags,
          meta_cover,
          meta_processed,
          thumb_path,
          series_name,
          sorted_volume,
          scan_time
        } = record;

        const sql = `
          INSERT INTO file_info (
            path, filename, size, ext, mod_date,
            meta_title, meta_volume, meta_chapter, meta_pages, meta_date,
            meta_description, meta_creator, meta_genre, meta_tags, meta_cover,
            meta_processed, thumb_path, series_name, sorted_volume, scan_time
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(path) DO UPDATE SET
            filename = excluded.filename,
            size = excluded.size,
            ext = excluded.ext,
            mod_date = excluded.mod_date,
            meta_title = excluded.meta_title,
            meta_volume = excluded.meta_volume,
            meta_chapter = excluded.meta_chapter,
            meta_pages = excluded.meta_pages,
            meta_date = excluded.meta_date,
            meta_description = excluded.meta_description,
            meta_creator = excluded.meta_creator,
            meta_genre = excluded.meta_genre,
            meta_tags = excluded.meta_tags,
            meta_cover = excluded.meta_cover,
            meta_processed = excluded.meta_processed,
            thumb_path = excluded.thumb_path,
            series_name = excluded.series_name,
            sorted_volume = excluded.sorted_volume,
            scan_time = excluded.scan_time
        `;

        const params = [
          filePath, filename, size, ext, mod_date,
          meta_title, meta_volume, meta_chapter, meta_pages, meta_date,
          meta_description, meta_creator, meta_genre, meta_tags, meta_cover,
          meta_processed || 0, thumb_path, series_name, sorted_volume, scan_time
        ];

        return new Promise((resolve, reject) => {
          db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
          });
        });
      } catch (error) {
        console.error('Error in upsertFileInfo:', error);
        throw error;
      }
    });
  }

  /**
   * Bulk upsert file info records
   */
  async upsertFileInfoBulk(records) {
    if (!records || records.length === 0) return;

    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.serialize(() => {
            const stmt = db.prepare(`
              INSERT INTO file_info (
                path, filename, size, ext, mod_date,
                meta_title, meta_volume, meta_chapter, meta_pages, meta_date,
                meta_description, meta_creator, meta_genre, meta_tags, meta_cover,
                meta_processed, thumb_path, series_name, sorted_volume, scan_time
              ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              )
              ON CONFLICT(path) DO UPDATE SET
                filename = excluded.filename,
                size = excluded.size,
                ext = excluded.ext,
                mod_date = excluded.mod_date,
                meta_title = excluded.meta_title,
                meta_volume = excluded.meta_volume,
                meta_chapter = excluded.meta_chapter,
                meta_pages = excluded.meta_pages,
                meta_date = excluded.meta_date,
                meta_description = excluded.meta_description,
                meta_creator = excluded.meta_creator,
                meta_genre = excluded.meta_genre,
                meta_tags = excluded.meta_tags,
                meta_cover = excluded.meta_cover,
                meta_processed = excluded.meta_processed,
                thumb_path = excluded.thumb_path,
                series_name = excluded.series_name,
                sorted_volume = excluded.sorted_volume,
                scan_time = excluded.scan_time
            `);

            let successCount = 0;
            let errorCount = 0;

            records.forEach(record => {
              const params = [
                record.path, record.filename, record.size, record.ext, record.mod_date,
                record.meta_title, record.meta_volume, record.meta_chapter, record.meta_pages, record.meta_date,
                record.meta_description, record.meta_creator, record.meta_genre, record.meta_tags, record.meta_cover,
                record.meta_processed || 0, record.thumb_path, record.series_name, record.sorted_volume, record.scan_time
              ];

              stmt.run(params, function(err) {
                if (err) {
                  errorCount++;
                  console.error('Error inserting record:', err);
                } else {
                  successCount++;
                }
              });
            });

            stmt.finalize(() => {
              resolve({ successCount, errorCount });
            });
          });
        });
      } catch (error) {
        console.error('Error in upsertFileInfoBulk:', error);
        throw error;
      }
    });
  }

  /**
   * Get file info by path
   */
  async getFileInfo(filePath) {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.get(
            'SELECT * FROM file_info WHERE path = ?',
            [filePath],
            (err, row) => {
              if (err) reject(err);
              else resolve(row || null);
            }
          );
        });
      } catch (error) {
        console.error('Error in getFileInfo:', error);
        throw error;
      }
    });
  }

  /**
   * Save target index entries
   */
  async saveTargetIndex(records) {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.serialize(() => {
            const stmt = db.prepare(
              'INSERT OR REPLACE INTO target_index (target_folder, file_path) VALUES (?, ?)'
            );

            let successCount = 0;

            records.forEach(record => {
              stmt.run([record.target_folder, record.file_path], function(err) {
                if (err) {
                  console.error('Error inserting target index:', err);
                } else {
                  successCount++;
                }
              });
            });

            stmt.finalize(() => {
              resolve({ successCount });
            });
          });
        });
      } catch (error) {
        console.error('Error in saveTargetIndex:', error);
        throw error;
      }
    });
  }

  /**
   * Get target index for a folder
   */
  async getTargetIndex(targetFolder) {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.all(
            'SELECT file_path FROM target_index WHERE target_folder = ?',
            [targetFolder],
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows.map(r => r.file_path));
            }
          );
        });
      } catch (error) {
        console.error('Error in getTargetIndex:', error);
        throw error;
      }
    });
  }

  /**
   * Remove bulk paths from target index
   */
  async removeTargetIndexBulk(paths) {
    if (!paths || paths.length === 0) return;

    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.serialize(() => {
            const placeholders = paths.map(() => '?').join(',');
            const sql = `DELETE FROM target_index WHERE file_path IN (${placeholders})`;
            
            db.run(sql, paths, function(err) {
              if (err) reject(err);
              else resolve({ changes: this.changes });
            });
          });
        });
      } catch (error) {
        console.error('Error in removeTargetIndexBulk:', error);
        throw error;
      }
    });
  }

  /**
   * Save duplicate match
   */
  async saveDupMatch(aPath, matchData) {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        const sql = `
          INSERT OR REPLACE INTO dup_match (a_path, match_path, match_score, match_time)
          VALUES (?, ?, ?, ?)
        `;

        return new Promise((resolve, reject) => {
          db.run(
            sql,
            [aPath, matchData.match_path, matchData.match_score, matchData.match_time || new Date().toISOString()],
            function(err) {
              if (err) reject(err);
              else resolve({ changes: this.changes });
            }
          );
        });
      } catch (error) {
        console.error('Error in saveDupMatch:', error);
        throw error;
      }
    });
  }

  /**
   * Get duplicate match for a path
   */
  async getDupMatch(aPath) {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.get(
            'SELECT * FROM dup_match WHERE a_path = ?',
            [aPath],
            (err, row) => {
              if (err) reject(err);
              else resolve(row || null);
            }
          );
        });
      } catch (error) {
        console.error('Error in getDupMatch:', error);
        throw error;
      }
    });
  }

  /**
   * Get all duplicate matches
   */
  async getAllDupMatch() {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.all(
            'SELECT * FROM dup_match',
            (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            }
          );
        });
      } catch (error) {
        console.error('Error in getAllDupMatch:', error);
        throw error;
      }
    });
  }

  /**
   * Bulk save duplicate matches
   */
  async saveDupMatchesBulk(matchList) {
    if (!matchList || matchList.length === 0) return;

    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.serialize(() => {
            const stmt = db.prepare(
              'INSERT OR REPLACE INTO dup_match (a_path, match_path, match_score, match_time) VALUES (?, ?, ?, ?)'
            );

            let successCount = 0;

            matchList.forEach(match => {
              stmt.run(
                [match.a_path, match.match_path, match.match_score, match.match_time || new Date().toISOString()],
                function(err) {
                  if (err) {
                    console.error('Error inserting dup match:', err);
                  } else {
                    successCount++;
                  }
                }
              );
            });

            stmt.finalize(() => {
              resolve({ successCount });
            });
          });
        });
      } catch (error) {
        console.error('Error in saveDupMatchesBulk:', error);
        throw error;
      }
    });
  }

  /**
   * Clear duplicate cache
   */
  async clearDupCache() {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        return new Promise((resolve, reject) => {
          db.run('DELETE FROM dup_match', function(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
          });
        });
      } catch (error) {
        console.error('Error in clearDupCache:', error);
        throw error;
      }
    });
  }

  /**
   * Get all files in path from cache
   * FolderScanThread용 일괄 캐시 조회
   */
  async getAllFilesInPath(folderPath, includeSub) {
    return this.withLock(async () => {
      try {
        const db = this.getConnection();
        
        let sql;
        let params;

        if (includeSub) {
          // Include subdirectories
          const likePattern = `${folderPath}%`;
          sql = 'SELECT * FROM file_info WHERE path LIKE ?';
          params = [likePattern];
        } else {
          // Only direct children
          sql = `
            SELECT * FROM file_info 
            WHERE path LIKE ? AND path NOT LIKE ?
          `;
          const likePattern = `${folderPath}%`;
          const excludePattern = `${folderPath}%%`;
          params = [likePattern, excludePattern];
        }

        return new Promise((resolve, reject) => {
          db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });
      } catch (error) {
        console.error('Error in getAllFilesInPath:', error);
        throw error;
      }
    });
  }

  /**
   * Close database connection
   */
  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else {
            this.db = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

// Singleton instance
let instance = null;

export function getLibraryDB() {
  if (!instance) {
    instance = new LibraryDB();
  }
  return instance;
}

export { LibraryDB };
