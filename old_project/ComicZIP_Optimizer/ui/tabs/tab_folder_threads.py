import os
import hashlib
import zipfile
import time
import traceback
import subprocess
import xml.etree.ElementTree as ET
from collections import defaultdict
from PyQt6.QtCore import QThread, pyqtSignal, QDir, Qt
import io
from PIL import Image
import re
from datetime import datetime
from core.library_db import db

# [속도/정밀도 개선 핵심 정규식]
RE_TRASH_1 = re.compile(r'(?i)\b(1080p|720p|480p|1440p|4k|2k|x264|x265|\d{3,4}x\d{3,4})\b')
RE_TRASH_2 = re.compile(r'\[19\d{2}\]|\[20\d{2}\]|\(19\d{2}\)|\(20\d{2}\)')
RE_TRASH_3 = re.compile(r'(?i)\bv\d+\b')

# 범위 매칭 (물결표는 키보드~, 전각～, 일본식〜 모두 커버하여 무조건 범위로 인정)
RE_RANGE_TILDE = re.compile(r'(\d+)\s*(?:권|화|장|편|부|vol|ch|ep)?\s*[~～〜]\s*(\d+)\s*(?:권|화|장|편|부|vol|ch|ep)?', re.IGNORECASE)

# 대시(-)는 13권-56(에피소드)과 13-56화(범위)를 엄격히 구분하기 위해 우측이나 양쪽에 명시적 단위가 있을 때만 범위로 인정
RE_RANGE_DASH_1 = re.compile(r'(\d+)\s*-\s*(\d+)\s*(권|화|장|편|부|vol|ch|ep)', re.IGNORECASE)
RE_RANGE_DASH_2 = re.compile(r'(\d+)\s*(권|화|장|편|부|vol|ch|ep)\s*-\s*(\d+)\s*\2', re.IGNORECASE)

# 단일 명시 매칭 (13권 - 56 처럼 우측 단위가 없으면 메인 번호 13만 잡고 즉시 종료)
RE_KO_SINGLE = re.compile(r'(\d+)(?:[-_.]\d+)?\s*(권|화|장|편|부)', re.IGNORECASE)
RE_EN_SINGLE = re.compile(r'(?i)(?:vol|chapter|ch|제|#)\s*\.?\s*0*(\d+)(?:[-_.]\d+)?')

# 최후의 숫자 추출 (단어와 바로 붙어있는 숫자 제외, 예: 8미터, 100일, 10년 등)
RE_DIGITS = re.compile(r'(\d+)(?:[-_.]\d+)?(?![가-힣a-zA-Z])')


class DupScanThread(QThread):
    scan_finished = pyqtSignal(list)
    progress_updated = pyqtSignal(int, int) # 매칭된 압축파일 수, 전체 스캔한 파일 수

    def __init__(self, dup_folders, target_exts):
        super().__init__()
        self.dup_folders = dup_folders
        self.target_exts = tuple(target_exts)
        self.is_cancelled = False

    def cancel(self):
        self.is_cancelled = True

    def run(self):
        from core.library_db import db
        b_cache = []
        match_count = 0
        total_scanned = 0

        for folder in self.dup_folders:
            if self.is_cancelled: return
            if not os.path.exists(folder): continue
            
            target_records = db.get_target_index(folder)
            db_paths = {record["full_path"]: record for record in target_records} if target_records else {}
            new_records = []
            current_physical_paths = set()

            def fast_scan(scan_path):
                nonlocal match_count, total_scanned
                if self.is_cancelled: return
                try:
                    with os.scandir(scan_path) as it:
                        for entry in it:
                            if self.is_cancelled: return
                            
                            if entry.is_dir(follow_symlinks=False):
                                fast_scan(entry.path)
                            elif entry.is_file(follow_symlinks=False):
                                total_scanned += 1
                                name = entry.name
                                
                                if name.lower().endswith(self.target_exts):
                                    fp = entry.path
                                    current_physical_paths.add(fp)
                                    size = entry.stat().st_size
                                    
                                    b_cache.append({
                                        "name": name,
                                        "path": scan_path,
                                        "full_path": fp,
                                        "size": size,
                                        "name_no_ext": os.path.splitext(name)[0].lower()
                                    })
                                    
                                    if fp not in db_paths:
                                        new_records.append((fp, folder, name, size))
                                        
                                    match_count += 1
                                
                                if total_scanned % 500 == 0:
                                    self.progress_updated.emit(match_count, total_scanned)
                except Exception: pass

            fast_scan(folder)
            
            if new_records:
                db.save_target_index(new_records)
                
            if len(db_paths) > len(current_physical_paths) or any(p not in current_physical_paths for p in db_paths):
                try: db.clear_dup_cache()
                except Exception: pass
                    
        self.progress_updated.emit(match_count, total_scanned)
        self.scan_finished.emit(b_cache)


class IndexSyncThread(QThread):
    def __init__(self, dup_folders, target_exts):
        super().__init__()
        self.dup_folders = dup_folders
        self.target_exts = tuple(target_exts)

    def run(self):
        from core.library_db import db
        b_folder_changed = False

        for folder in self.dup_folders:
            if not os.path.exists(folder): continue
            
            target_records = db.get_target_index(folder)
            db_paths = {record["full_path"] for record in target_records} if target_records else set()

            new_records = []
            current_physical_paths = set()

            def fast_sync_scan(scan_path):
                try:
                    with os.scandir(scan_path) as it:
                        for entry in it:
                            if entry.is_dir(follow_symlinks=False):
                                fast_sync_scan(entry.path)
                            elif entry.is_file(follow_symlinks=False):
                                name = entry.name
                                if name.lower().endswith(self.target_exts):
                                    fp = entry.path
                                    current_physical_paths.add(fp)
                                    
                                    if fp not in db_paths:
                                        size = entry.stat().st_size
                                        new_records.append((fp, folder, name, size))
                except Exception: pass

            fast_sync_scan(folder)
            
            # [수정] DB에만 있고 실제로는 삭제된 '유령' 파일 인덱스를 DB에서 제거
            deleted_paths = db_paths - current_physical_paths
            if deleted_paths:
                b_folder_changed = True
                db.remove_target_index_bulk(list(deleted_paths))

            if new_records:
                b_folder_changed = True
                db.save_target_index(new_records)
                
            if len(db_paths) > len(current_physical_paths) or any(p not in current_physical_paths for p in db_paths):
                b_folder_changed = True

        if b_folder_changed:
            try:
                db.clear_dup_cache()
                print("[LOG] 백그라운드 인덱스 동기화: 대상 폴더 변경 감지로 매칭 캐시 초기화됨.")
            except Exception: pass


class DupMatchThread(QThread):
    match_finished = pyqtSignal(dict)
    match_progress = pyqtSignal(int, int)

    def __init__(self, a_files, b_cache):
        super().__init__()
        self.a_files = a_files
        self.b_cache = b_cache
        self.is_cancelled = False

    def cancel(self):
        self.is_cancelled = True

    def extract_series_and_nums(self, name):
        from core.parser import extract_core_title
        
        core_title = extract_core_title(name).lower()
        
        bundle_pattern = r'(?:v|vol|c|ch|chapter|제)?\.?\s*(\d+(?:\.\d+)?)\s*[~-]\s*(\d+(?:\.\d+)?)\s*(?:권|화|장|편|부)?'
        bundle_match = re.search(bundle_pattern, name, re.IGNORECASE)
        if bundle_match:
            return core_title, [float(bundle_match.group(1)), float(bundle_match.group(2))], True

        if re.search(r'완결|합본|전권|시리즈|\(완\)', name):
            return core_title, [], True
            
        ko_single = re.search(r'(\d+(?:\.\d+)?)\s*(?:권|화|장|편|부)', name, re.IGNORECASE)
        if ko_single:
            return core_title, [float(ko_single.group(1))], False

        en_single = re.search(r'(?:v|vol|c|ch|chapter|제)\.?\s*(\d+(?:\.\d+)?)', name, re.IGNORECASE)
        if en_single:
            return core_title, [float(en_single.group(1))], False
            
        clean_name = re.sub(r'\[.*?\]|\(.*?\)', '', name)
        nums = re.findall(r'\d+(?:\.\d+)?', clean_name)
        if nums:
            return core_title, [float(nums[-1])], False
            
        return core_title, [], False

    # 동의어 사전: 번역어/표기 변형 정규화
    SYNONYMS = {
        '블랙': '검은', 'black': '검은',
        '화이트': '흰', 'white': '흰',
        '레드': '빨간', 'red': '빨간',
        '블루': '파란', 'blue': '파란',
        '그린': '녹색', 'green': '녹색',
        'love': '사랑',
        'hell': '지옥',
        'hero': '영웅', 'heroes': '영웅',
        'king': '왕',
        'god': '신',
        'dark': '어둠', '다크': '어둠',
        'new': '새로운',
        'super': '슈퍼',
        'dragon': '드래곤',
        'hunter': '헌터',
        'master': '마스터',
        'legend': '전설',
        'world': '세계',
        'sword': '검',
    }


    def normalize(self, text):
        text = text.lower()
        for k, v in self.SYNONYMS.items():
            text = re.sub(r'\b' + re.escape(k) + r'\b', v, text)
        return text


    # 요청하신 불용어 리스트 추가   
    STOPWORDS = [
        '만화책', '만화', '코믹스', 'e북', 'ebook', '완결', '합본', 
        '웹툰', '단행본', '시리즈', '총집편', '풀컬러', 'in', 'the', 'of', 'a', 'an', '미완'
    ]

    def get_char_and_bigrams(self, text):
        text = text.lower()
        
        # 1. 불용어 완벽 제거 (일반 단어 훼손을 막기 위해 단어 앞뒤 맥락 고려)
        for word in self.STOPWORDS:
            if re.match(r'^[a-z]+$', word):
                text = re.sub(r'\b' + re.escape(word) + r'\b', '', text)
            else:
                text = re.sub(r'(?<![가-힣a-z])' + re.escape(word) + r'(?![가-힣a-z])', '', text)

        # 2. 동의어 치환
        for k, v in self.SYNONYMS.items():
            text = re.sub(r'\b' + re.escape(k) + r'\b', v, text)
            
        # 3. [핵심] 숫자 및 기호 완벽 제거 
        # (화수/권수는 이미 number_match로 별도 검증하므로, 순수 제목 비교 시 숫자가 남으면 오탐률만 높아집니다)
        char_only = re.sub(r'[^가-힣a-z]', '', text)
        
        # 예외 처리: '1984' 처럼 숫자로만 이루어진 제목인 경우만 숫자를 살림
        if not char_only:
            char_only = re.sub(r'[^a-z0-9가-힣]', '', text)
            
        # 2글자 묶음 생성
        bigrams = set(char_only[i:i+2] for i in range(len(char_only)-1))
        return char_only, bigrams

    def check_similarity_fast(self, a_char, b_char, a_bigrams, b_bigrams):
        if not a_char or not b_char: return False, 0.0

        # 1. 고속 필터링: 2글자 묶음 교집합이 하나도 없으면 완전 다른 제목이므로 즉시 스킵
        if a_bigrams and b_bigrams and len(a_bigrams & b_bigrams) == 0:
            return False, 0.0

        # 2. 문자열 비교 연산
        import difflib
        sm = difflib.SequenceMatcher(None, a_char, b_char)
        
        # 전체 길이 대비 일치율 (예: A와 B의 전체 길이가 비슷할수록 높음)
        standard_ratio = sm.ratio() 
        
        # 짧은 제목이 긴 제목에 얼마나 포함되는지 비율 (예: '원피스'가 '원피스 풀컬러판'에 100% 포함됨)
        match_len = sum(triple.size for triple in sm.get_matching_blocks())
        min_len = min(len(a_char), len(b_char))
        contained_ratio = match_len / min_len if min_len > 0 else 0.0

        # 3. 최종 점수 계산 (두 비율의 평균)
        score = (standard_ratio + contained_ratio) / 2.0
        
        # 짧은 제목이 긴 제목에 거의 그대로 포함된다면 합격선으로 보정
        if contained_ratio >= 0.9: 
            score = max(score, 0.75) 

            # 단, 단어 자체가 너무 짧으면서 전체 일치율이 처참하다면 우연의 일치로 간주하여 페널티
            # (예: '마도' 2글자가 포함되었다고 무조건 75%를 주지 않음)
            if min_len <= 3 and standard_ratio < 0.4:
                score = score * 0.8 

        return score >= 0.70, round(score * 100, 1)

    # [수정됨] run 메서드
    def run(self):
        import time 
        from core.library_db import db
        
        from core.i18n import get_i18n
        from config import load_config
        lang = load_config().get("language", load_config().get("lang", "ko"))
        msg_match_all = get_i18n().get(lang, get_i18n()["ko"]).get("msg_folder_match_all", "(Folder Full Match)")
        
        matches = {}
        total_a = len(self.a_files)
        
        all_cached_matches = db.get_all_dup_match()
        new_matches_to_save = [] 
        
        a_data = []
        for idx, a_file in enumerate(self.a_files):
            if self.is_cancelled: return
            if idx % 50 == 0: time.sleep(0.001) 
            
            if "name" in a_file:
                raw_name = os.path.splitext(a_file["name"])[0]
                core_title, nums, is_bundle = self.extract_series_and_nums(raw_name)
                if not core_title: core_title = raw_name.lower()
                
                # --- 전처리 단순화 ---
                a_char, a_bigrams = self.get_char_and_bigrams(core_title)
                a_data.append((a_file, core_title, nums, is_bundle, a_char, a_bigrams))

        b_folders = {}
        for idx, b_file in enumerate(self.b_cache):
            if self.is_cancelled: return
            if idx % 50 == 0: time.sleep(0.001) 
            
            bp = b_file["path"]
            if bp not in b_folders:
                folder_name = os.path.basename(bp)
                f_core, _, _ = self.extract_series_and_nums(folder_name) if folder_name else ("", [], False)
                f_core_str = f_core if f_core else folder_name.lower()
                
                f_char, f_bigrams = self.get_char_and_bigrams(f_core_str)

                b_folders[bp] = {
                    "name": folder_name,
                    "core_title": f_core_str,
                    "f_char": f_char, "f_bigrams": f_bigrams,
                    "size": 0, "files": []
                }
            
            if "core_title" not in b_file:
                raw_name = os.path.splitext(b_file["name"])[0]
                core_title, nums, is_bundle = self.extract_series_and_nums(raw_name)
                core_str = core_title if core_title else raw_name.lower()
                
                b_char, b_bigrams = self.get_char_and_bigrams(core_str)

                b_file["core_title"] = core_str
                b_file["nums"] = nums
                b_file["is_bundle"] = is_bundle
                b_file["b_char"] = b_char
                b_file["b_bigrams"] = b_bigrams
                
            b_folders[bp]["files"].append(b_file)
            b_folders[bp]["size"] += b_file.get("size", 0)

        for i, (a_file, a_core, a_nums, a_is_bundle, a_char, a_bigrams) in enumerate(a_data):
            if self.is_cancelled: return
            
            a_full_path = a_file.get("full_path", "")
            
            if a_full_path in all_cached_matches:
                cached_data = all_cached_matches[a_full_path]
                
                # 🌟 [버그 수정] 캐시에 있는 매칭 결과 중, 원본 B 파일이 이미 삭제된 '유령 캐시'인지 검증
                is_stale_cache = False
                if cached_data:
                    for bp, matches_list in cached_data.items():
                        for m in matches_list:
                            b_fp = m.get("b_file", {}).get("full_path", "")
                            if b_fp and not os.path.exists(b_fp):
                                is_stale_cache = True
                                break
                        if is_stale_cache: break
                
                if not is_stale_cache:
                    if cached_data: 
                        matches[a_full_path] = cached_data
                    if total_a > 0 and i % max(1, total_a // 20) == 0:
                        self.match_progress.emit(i + 1, total_a)
                    continue

            if i % 10 == 0: time.sleep(0.001)
            
            file_matches = []
            a_path = os.path.normcase(os.path.normpath(a_full_path))
            a_dir_norm = os.path.dirname(a_path)
            
            for bp, b_folder in b_folders.items():
                if self.is_cancelled: return
                bp_norm = os.path.normcase(os.path.normpath(bp))
                
                if a_dir_norm != bp_norm:
                    # [비교 호출부 수정] 파라미터 간소화
                    is_folder_match, ratio = self.check_similarity_fast(
                        a_char, b_folder["f_char"], a_bigrams, b_folder["f_bigrams"]
                    )
                    if is_folder_match:
                        dummy_b_file = {
                            "name": msg_match_all,
                            "size": b_folder["size"],
                            "full_path": bp,
                            "path": bp
                        }
                        file_matches.append({"b_file": dummy_b_file, "ratio": ratio})
                        continue
                        
                for b_file in b_folder["files"]:
                    if self.is_cancelled: return
                    b_full_path = os.path.normcase(os.path.normpath(b_file.get("full_path", "")))
                    if a_path == b_full_path: continue
                    
                    number_match = False
                    if a_is_bundle or b_file["is_bundle"]:
                        number_match = True
                    else:
                        if a_nums == b_file["nums"]:
                            number_match = True
                            
                    if not number_match: continue
                    
                    # [비교 호출부 수정] 파라미터 간소화
                    is_file_match, f_ratio = self.check_similarity_fast(
                        a_char, b_file["b_char"], a_bigrams, b_file["b_bigrams"]
                    )
                    if is_file_match:
                        file_matches.append({"b_file": b_file, "ratio": f_ratio})
                        
            if file_matches:
                grouped = {}
                for m in file_matches:
                    bp = m["b_file"]["path"]
                    if bp not in grouped: grouped[bp] = []
                    grouped[bp].append(m)
                matches[a_full_path] = grouped
                new_matches_to_save.append((a_full_path, grouped))
            else:
                new_matches_to_save.append((a_full_path, {}))
                
            if total_a > 0 and i % max(1, total_a // 20) == 0:
                self.match_progress.emit(i + 1, total_a)
                
        if new_matches_to_save and not self.is_cancelled:
            db.save_dup_matches_bulk(new_matches_to_save)
                
        self.match_finished.emit(matches)


class MemoryExtractThread(QThread):
    data_extracted = pyqtSignal(str, dict, bool) 
    progress_updated = pyqtSignal(int)
    
    def __init__(self, tasks, seven_zip_path):
        super().__init__()
        self.current_tasks = tasks
        self.seven_zip_path = seven_zip_path
        self.is_cancelled = False
        self.show_progress = False

    def cancel(self):
        self.is_cancelled = True

    def _process_task(self, task):
        if self.is_cancelled: return None
        
        filepath, needs_img, needs_meta, thumb_path = task
        meta_dict = {}
        img_bytes = b""
        has_img_out = False

        if thumb_path and os.path.exists(thumb_path):
            if os.path.getsize(thumb_path) > 0:
                has_img_out = True
            else:
                has_img_out = False

        if needs_meta or needs_img:
            ext = os.path.splitext(filepath)[1].lower()
            try:
                if ext in ['.zip', '.cbz']:
                    with zipfile.ZipFile(filepath, 'r') as zf:
                        namelist = zf.namelist()
                        if needs_meta:
                            xml_name = next((f for f in namelist if f.lower() == 'comicinfo.xml'), None)
                            if xml_name:
                                xml_data = zf.read(xml_name).decode('utf-8', errors='ignore')
                                meta_dict = self._parse_xml(xml_data)
                        if needs_img:
                            img_files = [f for f in namelist if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp'))]
                            if img_files:
                                img_files.sort()
                                img_bytes = zf.read(img_files[0]) 
                else:
                    cmd_l = [self.seven_zip_path, 'l', '-slt', filepath]
                    res_l = subprocess.run(cmd_l, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
                    lines = res_l.stdout.splitlines()
                    
                    has_xml = False
                    img_candidates = []
                    for line in lines:
                        if line.startswith("Path = "):
                            fname = line.replace("Path = ", "").strip()
                            if fname.lower() == 'comicinfo.xml':
                                has_xml = True
                            elif needs_img and fname.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp')):
                                img_candidates.append(fname)
                                
                    if needs_meta and has_xml:
                        cmd_x = [self.seven_zip_path, 'e', filepath, 'ComicInfo.xml', '-so']
                        res_x = subprocess.run(cmd_x, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
                        if res_x.returncode == 0:
                            meta_dict = self._parse_xml(res_x.stdout.decode('utf-8', errors='ignore'))
                            
                    if needs_img and img_candidates:
                        img_candidates.sort()
                        cmd_e = [self.seven_zip_path, 'e', filepath, img_candidates[0], '-so']
                        res_e = subprocess.run(cmd_e, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
                        if res_e.returncode == 0:
                            img_bytes = res_e.stdout 
            except Exception:
                pass

        if img_bytes:
            try:
                with Image.open(io.BytesIO(img_bytes)) as img:
                    meta_dict["resolution"] = f"{img.width} x {img.height}"
                    if not has_img_out:
                        img.thumbnail((400, 400), Image.Resampling.LANCZOS)
                        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                            alpha = img.convert('RGBA')
                            bg = Image.new('RGBA', alpha.size, (255, 255, 255, 255))
                            out_img = Image.alpha_composite(bg, alpha).convert('RGB')
                        else:
                            out_img = img.convert('RGB') if img.mode not in ('RGB', 'L') else img
                            
                        if thumb_path:
                            out_img.save(thumb_path, "WEBP", quality=85)
                        has_img_out = True
            except Exception as e:
                print(f"Thumbnail extraction error: {e}")
                    
        return filepath, meta_dict, has_img_out

    def run(self):
        import concurrent.futures
        max_workers = max(1, os.cpu_count() // 2)
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(self._process_task, task) for task in self.current_tasks]
            
            for future in concurrent.futures.as_completed(futures):
                if self.is_cancelled:
                    break
                try:
                    res = future.result()
                    if res:
                        filepath, meta_dict, has_img_out = res
                        self.data_extracted.emit(filepath, meta_dict, has_img_out)
                        if self.show_progress:
                            self.progress_updated.emit(1)
                except Exception as e:
                    print(f"MemoryExtractThread error: {e}")
            
    def _parse_xml(self, xml_data):
        meta = {}
        try:
            root = ET.fromstring(xml_data)
            meta["title"] = root.findtext("Title", "")
            meta["series"] = root.findtext("Series", "")
            meta["series_group"] = root.findtext("SeriesGroup", "")
            meta["volume"] = root.findtext("Volume", "")
            meta["number"] = root.findtext("Number", "")
            meta["writer"] = root.findtext("Writer", "")
            meta["penciller"] = root.findtext("Penciller", "")
            meta["inker"] = root.findtext("Inker", "")
            meta["colorist"] = root.findtext("Colorist", "")
            meta["letterer"] = root.findtext("Letterer", "")
            meta["cover_artist"] = root.findtext("CoverArtist", "")
            meta["editor"] = root.findtext("Editor", "")
            meta["publisher"] = root.findtext("Publisher", "")
            meta["imprint"] = root.findtext("Imprint", "")
            meta["genre"] = root.findtext("Genre", "")
            meta["volume_count"] = root.findtext("VolumeCount", "")
            meta["page_count"] = root.findtext("PageCount", "")
            meta["format"] = root.findtext("Format", "")
            meta["manga"] = root.findtext("Manga", "")
            meta["language"] = root.findtext("LanguageISO", "")
            meta["rating"] = root.findtext("CommunityRating") or root.findtext("Rating", "")
            meta["age_rating"] = root.findtext("AgeRating", "")
            meta["year"] = root.findtext("Year", "")
            meta["month"] = root.findtext("Month", "")
            meta["day"] = root.findtext("Day", "")
            meta["summary"] = root.findtext("Summary", "")
            meta["characters"] = root.findtext("Characters", "")
            meta["teams"] = root.findtext("Teams", "")
            meta["locations"] = root.findtext("Locations", "")
            meta["story_arc"] = root.findtext("StoryArc", "")
            meta["tags"] = root.findtext("Tags", "")
            meta["notes"] = root.findtext("Notes", "")
            meta["web"] = root.findtext("Web", "")
        except: pass
        return meta


class FolderScanThread(QThread):
    progress_updated = pyqtSignal(int)
    scan_finished = pyqtSignal(list, float)
    
    def __init__(self, folder_path, include_sub, target_exts, thumb_dir, force_update=False):
        super().__init__()
        self.folder_path = folder_path
        self.include_sub = include_sub
        self.target_exts = tuple(target_exts)
        self.thumb_dir = thumb_dir
        self.force_update = force_update
        self.is_cancelled = False

    def run(self):
        folder_path_norm = os.path.normpath(self.folder_path)
        if not os.path.exists(folder_path_norm):
            self.scan_finished.emit([], 0)
            return

        from core.library_db import db
        # 1. DB에서 캐시를 가져올 때, 모든 키를 정규화 및 소문자로 변환하여 Dictionary에 저장합니다. (대소문자 차이 무시)
        raw_cache_dict = db.get_all_files_in_path(folder_path_norm, self.include_sub)
        
        cache_dict = {}
        for k, v in raw_cache_dict.items():
            norm_k = os.path.normpath(k).lower()
            cache_dict[norm_k] = v

        # [최적화] 썸네일 폴더 내 파일 목록을 미리 메모리(Set)에 로드하여 수만 번의 Disk I/O 병목 방지
        try:
            existing_thumbs = set(os.listdir(self.thumb_dir))
        except Exception:
            existing_thumbs = set()

        file_data_cache = []
        total_size = 0
        count = 0

        def scan_dir(path):
            nonlocal total_size, count
            if self.is_cancelled:
                return
            try:
                with os.scandir(path) as it:
                    for entry in it:
                        if self.is_cancelled:
                            break

                        if entry.is_dir(follow_symlinks=False):
                            if self.include_sub:
                                scan_dir(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            name = entry.name
                            if name.lower().endswith(self.target_exts):
                                # 2. 파일 경로를 정규화(\와 / 혼용 방지)
                                full_path = os.path.normpath(entry.path)
                                stat = entry.stat()
                                mtime = stat.st_mtime
                                ctime = stat.st_ctime
                                size = stat.st_size

                                # 3. 소문자로 변환하여 캐시에서 찾기 (Windows 드라이브 대소문자 혼용 방어)
                                cached = cache_dict.get(full_path.lower())
                                meta_processed = False
                                full_meta = {}
                                res, title, series, vol, num, writer = "", "", "", "", "", ""

                                if cached and not self.force_update:
                                    cached_mtime = cached[1]
                                    if abs(float(cached_mtime) - float(mtime)) < 2.0:
                                        meta_processed = True
                                        res    = cached[4]  if len(cached) > 4  else ""
                                        title  = cached[5]  if len(cached) > 5  else ""
                                        series = cached[6]  if len(cached) > 6  else ""
                                        series_group = cached[7] if len(cached) > 7 else ""
                                        vol    = cached[8]  if len(cached) > 8  else ""
                                        num    = cached[9]  if len(cached) > 9  else ""
                                        writer = cached[10] if len(cached) > 10 else ""
                                        full_meta = {
                                            "resolution":   cached[4]  if len(cached) > 4  else "",
                                            "title":        cached[5]  if len(cached) > 5  else "",
                                            "series":       cached[6]  if len(cached) > 6  else "",
                                            "series_group": series_group,
                                            "volume":       cached[8]  if len(cached) > 8  else "",
                                            "number":       cached[9]  if len(cached) > 9  else "",
                                            "writer":       cached[10] if len(cached) > 10 else "",
                                            "creators":     cached[11] if len(cached) > 11 else "",
                                            "publisher":    cached[12] if len(cached) > 12 else "",
                                            "imprint":      cached[13] if len(cached) > 13 else "",
                                            "genre":        cached[14] if len(cached) > 14 else "",
                                            "volume_count": cached[15] if len(cached) > 15 else "",
                                            "page_count":   cached[16] if len(cached) > 16 else "",
                                            "format":       cached[17] if len(cached) > 17 else "",
                                            "manga":        cached[18] if len(cached) > 18 else "",
                                            "language":     cached[19] if len(cached) > 19 else "",
                                            "rating":       cached[20] if len(cached) > 20 else "",
                                            "age_rating":   cached[21] if len(cached) > 21 else "",
                                            "publish_date": cached[22] if len(cached) > 22 else "",
                                            "summary":      cached[23] if len(cached) > 23 else "",
                                            "characters":   cached[24] if len(cached) > 24 else "",
                                            "teams":        cached[25] if len(cached) > 25 else "",
                                            "locations":    cached[26] if len(cached) > 26 else "",
                                            "story_arc":    cached[27] if len(cached) > 27 else "",
                                            "tags":         cached[28] if len(cached) > 28 else "",
                                            "notes":        cached[29] if len(cached) > 29 else "",
                                            "web":          cached[30] if len(cached) > 30 else "",
                                        }

                                # 4. 기존 혼용 경로 해시값과 새로운 정규화 해시값을 모두 확인하여 기존 썸네일 재사용
                                new_hash = hashlib.md5(f"{full_path}_{mtime}".encode()).hexdigest()
                                old_hash = hashlib.md5(f"{entry.path}_{mtime}".encode()).hexdigest()
                                
                                if f"{new_hash}.webp" in existing_thumbs:
                                    file_hash = new_hash
                                elif f"{old_hash}.webp" in existing_thumbs:
                                    file_hash = old_hash
                                else:
                                    file_hash = new_hash

                                thumb_filename = f"{file_hash}.webp"
                                thumb_path = os.path.join(self.thumb_dir, thumb_filename)
                                has_thumb = thumb_filename in existing_thumbs
                                
                                if res == "0x0":
                                    has_thumb = True

                                row_dict = {
                                    "full_path":       full_path,
                                    "hash":            file_hash,
                                    "name":            name,
                                    "path":            path,
                                    "ext":             os.path.splitext(name)[1].lower(),
                                    "raw_size":        size,
                                    "raw_mtime":       mtime,
                                    "raw_ctime":       ctime,
                                    "ctime":           datetime.fromtimestamp(ctime).strftime('%Y-%m-%d %H:%M'),
                                    "mtime":           datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M'),
                                    "thumb_processed": has_thumb,
                                    "meta_processed":  meta_processed,
                                    "full_meta":       full_meta,
                                    "res":    res,
                                    "series": series,
                                    "title":  title,
                                    "vol":    vol,
                                    "num":    num,
                                    "writer": writer,
                                    "display_index": -1
                                }
                                file_data_cache.append(row_dict)
                                total_size += size
                                count += 1

                                if count % 1000 == 0:
                                    self.progress_updated.emit(count)
            except Exception as e:
                print(f"scan_dir error: {e}")

        scan_dir(self.folder_path)
        self.scan_finished.emit(file_data_cache, total_size)

    def cancel(self):
        self.is_cancelled = True


class MissingCheckThread(QThread):
    finished_signal = pyqtSignal(list, bool)

    def __init__(self, dup_folders, file_data_cache, is_toast=False):
        super().__init__()
        self.dup_folders = dup_folders
        self.file_data_cache = file_data_cache
        self.is_toast = is_toast
        self.series_regex_cache = {}

    def extract_vol_numbers(self, name, series_name=""):
        vols = set()
        
        clean_name = RE_TRASH_1.sub('', name)
        clean_name = RE_TRASH_2.sub('', clean_name)
        clean_name = RE_TRASH_3.sub('', clean_name)
        
        # 1. 범위 형태 최우선 처리 (찾으면 얼리 리턴)
        for rm in RE_RANGE_TILDE.finditer(clean_name):
            start, end = int(rm.group(1)), int(rm.group(2))
            if start <= end and end - start < 250: 
                vols.update(range(start, end + 1))
                return vols
                
        for rm in RE_RANGE_DASH_1.finditer(clean_name):
            start, end = int(rm.group(1)), int(rm.group(2))
            if start <= end and end - start < 250: 
                vols.update(range(start, end + 1))
                return vols
                
        for rm in RE_RANGE_DASH_2.finditer(clean_name):
            start, end = int(rm.group(1)), int(rm.group(3))
            if start <= end and end - start < 250: 
                vols.update(range(start, end + 1))
                return vols

        # 2. 명시적 단위가 있는 단일 번호 처리 (찾으면 메인 번호 1개만 넣고 얼리 리턴)
        km = RE_KO_SINGLE.search(clean_name)
        if km:
            vols.add(int(km.group(1)))
            return vols
            
        em = RE_EN_SINGLE.search(clean_name)
        if em:
            vols.add(int(em.group(1)))
            return vols
            
        # 3. 최후의 수단: 시리즈명을 제거하고 남은 맨 마지막 숫자 하나만 수집
        if series_name:
            if series_name not in self.series_regex_cache:
                safe_series = r'\s*'.join(re.escape(word) for word in series_name.split())
                self.series_regex_cache[series_name] = re.compile(f'(?i){safe_series}')
                
            name_no_series = self.series_regex_cache[series_name].sub('', clean_name)
        else:
            name_no_series = clean_name
            
        digits = RE_DIGITS.findall(name_no_series)
        if digits:
            vols.add(int(digits[-1]))
            
        return vols

    def run(self):
        from core.library_db import db
        from core.parser import extract_core_title
        
        series_map = defaultdict(list)
        
        def process_record(fp, name, db_series):
            if not fp or not name: return
            
            # [핵심 수정] 기존에 잘못 분류된 '회장님은 메이드 사마 56' 같은 파편화 시리즈를 
            # 메인 엔진(extract_core_title)을 통해 강제로 깎아내어 원래 시리즈로 뭉치게 만듭니다.
            if db_series:
                series_name = extract_core_title(db_series).strip()
                if not series_name: series_name = db_series
            else:
                series_name = extract_core_title(os.path.splitext(name)[0]).strip()
                if not series_name:
                    series_name = os.path.basename(os.path.dirname(fp))
            
            series_map[series_name].append({
                "name": name,
                "folder_path": os.path.dirname(fp),
                "series_name": series_name
            })

        if self.dup_folders:
            for folder in self.dup_folders:
                if not os.path.exists(folder): continue
                records = db.get_target_index(folder)
                if not records: continue
                
                for record in records:
                    if isinstance(record, dict):
                        fp = record.get("full_path", "")
                        name = record.get("name", "")
                        db_series = record.get("series", "")
                        if not db_series:
                            db_series = record.get("full_meta", {}).get("series", "")
                    else:
                        fp = record[0]
                        name = record[2]
                        db_series = record[6] if len(record) > 6 else ""
                        
                    process_record(fp, name, db_series)
                    
            # [수정] 라이브러리가 설정되어 있어도 현재 탐색기 패널에서 보고 있는 폴더를 누락 검사에 포함
            for row in self.file_data_cache:
                if row.get("is_folder") or row.get("is_dup_folder") or row.get("is_dup_child"): continue
                fp = row.get("full_path", "")
                name = row.get("name", "")
                db_series = row.get("series", "") or row.get("full_meta", {}).get("series", "")
                
                # 이미 라이브러리에 포함된 경로면 중복 처리 방지
                if not any(fp.startswith(os.path.normpath(d)) for d in self.dup_folders):
                    process_record(fp, name, db_series)
                    
        else:
            for row in self.file_data_cache:
                if row.get("is_folder") or row.get("is_dup_folder") or row.get("is_dup_child"): continue
                
                fp = row.get("full_path", "")
                name = row.get("name", "")
                db_series = row.get("series", "") or row.get("full_meta", {}).get("series", "")
                
                process_record(fp, name, db_series)

        missing_data = []
        for s_name, items in series_map.items():
            vols = set()
            folder_paths = set()
            for item in items:
                v_nums = self.extract_vol_numbers(item["name"], item["series_name"])
                vols.update(v_nums)
                folder_paths.add(item["folder_path"])
                    
            if vols:
                min_v, max_v = min(vols), max(vols)
                if max_v - min_v < 250:
                    missing = [str(i) for i in range(min_v, max_v) if i not in vols]
                    
                    if missing:
                        missing_data.append({
                            "series": s_name,
                            "missing": missing,
                            "folder_path": next(iter(folder_paths)) 
                        })
                        
        missing_data.sort(key=lambda x: x["series"])
        self.finished_signal.emit(missing_data, self.is_toast)
