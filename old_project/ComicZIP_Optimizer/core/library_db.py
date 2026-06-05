import sqlite3
import os
import threading
import json

def get_project_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def get_db_path():
    db_dir = os.path.join(get_project_root(), "data")
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    return os.path.join(db_dir, "library.db")

class LibraryDB:
    def __init__(self):
        self.db_path = get_db_path()
        self.lock = threading.Lock()
        self.init_db()

    def get_connection(self):
        is_new = not os.path.exists(self.db_path)
        conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=20.0)
        
        # --- [최적화] SQLite PRAGMA 튜닝 ---
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA cache_size = -64000") # 64MB 캐시
        conn.execute("PRAGMA temp_store = MEMORY")
        conn.execute("PRAGMA mmap_size = 30000000000")
        # ------------------------------------
        
        if is_new:
            self._create_tables(conn)
        return conn

    def _create_tables(self, conn):
        cursor = conn.cursor()
        
        # 기존 메타데이터 테이블
        cursor.execute('''
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
        ''')
        
        # [신규] 1. 최종 중복 매칭 결과 캐시 테이블
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS dup_cache (
                a_path TEXT PRIMARY KEY,
                match_data TEXT
            )
        ''')
        
        # [신규] 2. 대상 폴더(B) 고속 스캔 인덱싱 테이블
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS dup_target_index (
                full_path TEXT PRIMARY KEY,
                target_folder TEXT,
                name TEXT,
                size REAL
            )
        ''')
            
        # --- [최적화] 인덱스(Index) 생성 ---
        # 주로 검색(WHERE, LIKE)이나 정렬에 사용되는 컬럼들에 인덱스 추가
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_files_series ON files(series)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_files_title ON files(title)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_files_writer ON files(writer)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_dup_target_folder ON dup_target_index(target_folder)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_dup_target_name ON dup_target_index(name)')
        # -----------------------------------
            
        conn.commit()

    def init_db(self):
        with self.lock:
            conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=20.0)
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            self._create_tables(conn)
            conn.close()

    # --- 기존 메타데이터 메서드 ---
    def upsert_file_info(self, path, mtime, size, ext, resolution, title, series, series_group, volume, number, 
                         writer, creators, publisher, imprint, genre, volume_count, page_count, format_val, manga, 
                         language, rating, age_rating, publish_date, summary, characters, teams, locations, 
                         story_arc, tags, notes, web, thumb_path):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT OR REPLACE INTO files 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (path, mtime, size, ext, resolution, title, series, series_group, volume, number, writer, 
                      creators, publisher, imprint, genre, volume_count, page_count, format_val, manga, language, 
                      rating, age_rating, publish_date, summary, characters, teams, locations, story_arc, 
                      tags, notes, web, thumb_path))
                conn.commit()
            except Exception as e: print(e)
            finally: 
                if 'conn' in locals(): conn.close()

    def upsert_file_info_bulk(self, records):
        if not records: return
        with self.lock:
            try:
                conn = self.get_connection()
                conn.execute("PRAGMA synchronous = NORMAL") 
                cursor = conn.cursor()
                cursor.executemany('''
                    INSERT OR REPLACE INTO files 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', records)
                conn.commit()
            except Exception as e: 
                print(f"DB Bulk Upsert Error: {e}")
            finally: 
                if 'conn' in locals(): conn.close()

    def get_file_info(self, path):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('SELECT * FROM files WHERE path = ?', (path,))
                return cursor.fetchone()
            except Exception as e: return None
            finally: 
                if 'conn' in locals(): conn.close()

    # --- [신규] 중복 검사 인덱싱 (dup_target_index) 메서드 ---
    def save_target_index(self, records):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.executemany('''
                    INSERT OR REPLACE INTO dup_target_index (full_path, target_folder, name, size)
                    VALUES (?, ?, ?, ?)
                ''', records)
                conn.commit()
            except Exception as e: print(e)
            finally: 
                if 'conn' in locals(): conn.close()

    def get_target_index(self, target_folder):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('SELECT full_path, name, size FROM dup_target_index WHERE target_folder = ?', (target_folder,))
                rows = cursor.fetchall()
                if not rows: return None
                
                result = []
                for row in rows:
                    result.append({
                        "full_path": row[0],
                        "path": os.path.dirname(row[0]),
                        "name": row[1],
                        "size": row[2]
                    })
                return result
            except Exception as e: return None
            finally: 
                if 'conn' in locals(): conn.close()

    def remove_target_index_bulk(self, paths):
        if not paths: return
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.executemany("DELETE FROM dup_target_index WHERE full_path = ?", [(p,) for p in paths])
                conn.commit()
            except Exception as e:
                print(f"DB remove_target_index_bulk 오류: {e}")
            finally:
                if 'conn' in locals(): conn.close()

    # --- [신규] 중복 매칭 결과 캐시 (dup_cache) 메서드 ---
    def save_dup_match(self, a_path, match_data):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                json_data = json.dumps(match_data, ensure_ascii=False)
                cursor.execute('''
                    INSERT OR REPLACE INTO dup_cache (a_path, match_data)
                    VALUES (?, ?)
                ''', (a_path, json_data))
                conn.commit()
            except Exception as e: print(e)
            finally: 
                if 'conn' in locals(): conn.close()

    def get_dup_match(self, a_path):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('SELECT match_data FROM dup_cache WHERE a_path = ?', (a_path,))
                result = cursor.fetchone()
                return json.loads(result[0]) if result else None
            except Exception as e: return None
            finally: 
                if 'conn' in locals(): conn.close()

    # --- [추가/수정] 중복 매칭 일괄 처리 메서드 ---
    def get_all_dup_match(self):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('SELECT a_path, match_data FROM dup_cache')
                rows = cursor.fetchall()
                # 딕셔너리 형태로 한 번에 반환 { "파일경로": 매칭결과_딕셔너리 }
                import json
                return {row[0]: json.loads(row[1]) for row in rows}
            except Exception as e: 
                return {}
            finally: 
                if 'conn' in locals(): conn.close()

    def save_dup_matches_bulk(self, match_list):
        # match_list 포맷: [(a_path, match_data_dict), (a_path, match_data_dict), ...]
        if not match_list: return
        with self.lock:
            try:
                conn = self.get_connection()
                # WAL 모드 또는 동기화 옵션 조정으로 쓰기 속도 극대화
                conn.execute("PRAGMA synchronous = NORMAL") 
                cursor = conn.cursor()
                import json
                records = [(m[0], json.dumps(m[1], ensure_ascii=False)) for m in match_list]
                cursor.executemany('''
                    INSERT OR REPLACE INTO dup_cache (a_path, match_data)
                    VALUES (?, ?)
                ''', records)
                conn.commit()
            except Exception as e: 
                print(f"Bulk Save Error: {e}")
            finally: 
                if 'conn' in locals(): conn.close()

    def clear_dup_cache(self):
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                cursor.execute('DELETE FROM dup_cache')
                conn.commit()
                
                # SQLite 특성상 데이터를 삭제해도 파일 용량이 줄어들지 않으므로,
                # VACUUM 명령을 실행하여 실제 파일 크기를 강제로 축소시킵니다.
                conn.execute('VACUUM')
                return True
            except Exception as e:
                print(f"Clear Cache Error: {e}")
                return False
            finally:
                if 'conn' in locals(): conn.close()


    def get_all_files_in_path(self, folder_path, include_sub):
        """FolderScanThread용 일괄 캐시 조회"""
        with self.lock:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                
                # 경로 정규화 (슬래시 통일)
                norm_folder = os.path.normpath(folder_path)
                if not norm_folder.endswith(os.sep):
                    like_path = norm_folder + os.sep + '%'
                else:
                    like_path = norm_folder + '%'
                
                cursor.execute('SELECT * FROM files WHERE path LIKE ?', (like_path,))
                rows = cursor.fetchall()
                
                result = {}
                for row in rows:
                    filepath = row[0]
                    if not include_sub:
                        if os.path.normpath(os.path.dirname(filepath)) != norm_folder:
                            continue
                    result[filepath] = row
                return result
            except Exception as e:
                print(f"get_all_files_in_path error: {e}")
                return {}
            finally:
                if 'conn' in locals():
                    conn.close()
db = LibraryDB()