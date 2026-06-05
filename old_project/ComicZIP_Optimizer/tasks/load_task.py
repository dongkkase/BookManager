import os
import zipfile
import subprocess
import sys
from pathlib import Path
import re
import tempfile
import uuid
import shutil

from utils import natural_keys
from core.parser import is_garbage_folder_name, resolve_titles, format_leaf_name

CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

def _subprocess_kwargs():
    if sys.platform == 'win32':
        return {'creationflags': CREATE_NO_WINDOW}
    return {}

# 🌟 [인코딩 복원 함수 추가]
def decode_zip_filename(filename):
    """Python zipfile 모듈이 CP949(한국어)를 CP437로 잘못 읽어 깨지는 현상 완벽 복원"""
    try:
        raw_bytes = filename.encode('cp437')
        try:
            return raw_bytes.decode('cp949')
        except UnicodeDecodeError:
            return raw_bytes.decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return filename

def _list_entries_fast(filepath, ext, seven_z_exe):
    entries = []
    has_nested = False
    img_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}
    nested_exts = {'.zip', '.cbz', '.cbr', '.7z', '.rar', '.alz', '.egg'}

    if ext in ['.zip', '.cbz']:
        try:
            with zipfile.ZipFile(filepath, 'r') as zf:
                for info in zf.infolist():
                    # 🌟 [적용] 파일명 깨짐 완벽 복원
                    correct_filename = decode_zip_filename(info.filename)
                    p_str = correct_filename.replace('\\', '/')
                    is_dir = info.is_dir()
                    _ext = os.path.splitext(p_str)[1].lower()
                    entry = {
                        'path': p_str,
                        'is_dir': is_dir,
                        'size': info.file_size,
                        'is_img': not is_dir and _ext in img_exts,
                        'is_nested': not is_dir and _ext in nested_exts
                    }
                    entries.append(entry)
                    if entry['is_nested']: has_nested = True
            return entries, has_nested
        except zipfile.BadZipFile:
            pass

    cmd = [seven_z_exe, 'l', '-ba', '-sccUTF-8', str(filepath)]
    try:
        result = subprocess.run(cmd, capture_output=True, **_subprocess_kwargs())
        stdout = result.stdout.decode('utf-8', errors='ignore')
        for line in stdout.splitlines():
            line = line.strip()
            if not line: continue
            parts = line.split(maxsplit=5)
            if len(parts) < 6: continue
            p_str = parts[5].replace('\\', '/')
            is_dir = 'D' in parts[2]
            _ext = os.path.splitext(p_str)[1].lower()
            entry = {
                'path': p_str,
                'is_dir': is_dir,
                'size': int(parts[3]) if parts[3].isdigit() else 0,
                'is_img': not is_dir and _ext in img_exts,
                'is_nested': not is_dir and _ext in nested_exts,
            }
            entries.append(entry)
            if entry['is_nested']: has_nested = True
    except Exception:
        return [], False

    return entries, has_nested


def _analyze_from_entries(entries, filepath, lang):
    if not any(e['is_img'] or e['is_nested'] for e in entries):
        return None, '', '', None

    swallowed_name = ''
    top_level_folders = set()
    
    target_entries = [e for e in entries if e['is_img'] or e['is_nested']]
    for e in target_entries:
        parts = Path(e['path']).parts
        if len(parts) > 1:
            top_level_folders.add(parts[0])

    all_under_one = len(top_level_folders) == 1
    if all_under_one:
        single_top = list(top_level_folders)[0]
        root_files = []
        for e in target_entries:
            parts = Path(e['path']).parts
            if len(parts) == 2:
                root_files.append(e)
        if not root_files and not is_garbage_folder_name(single_top):
            swallowed_name = single_top
            for e in entries:
                if len(Path(e['path']).parts) > 1:
                    e['path'] = '/'.join(Path(e['path']).parts[1:])

    volume_groups = {}
    root_images = []

    for e in entries:
        if not (e['is_img'] or e['is_nested']): continue
        
        parts = Path(e['path']).parts
        if len(parts) == 1:
            if e['is_nested']:
                vol_name = os.path.splitext(parts[0])[0]
                if vol_name not in volume_groups: volume_groups[vol_name] = []
                volume_groups[vol_name].append(e['path'])
            else:
                root_images.append(e['path'])
        else:
            top_folder_name = parts[0]
            p0 = top_folder_name.lower()
            is_part_folder = bool(re.search(r'(\d+\s*부|제\s*\d+\s*부|시즌|season|part)', p0))
            if is_part_folder and len(parts) > 2:
                top_folder = top_folder_name + '/' + parts[1]
            else:
                top_folder = top_folder_name
                
            if top_folder not in volume_groups:
                volume_groups[top_folder] = []
            volume_groups[top_folder].append(e['path'])

    if root_images:
        volume_groups['Root_Files'] = root_images

    force_unit = None
    ch_pattern = re.compile(r'\d+(?:\.\d+)?\s*화')
    all_leaf_names = [k for k in volume_groups.keys() if k != 'Root_Files']
    found_ch = any(ch_pattern.search(leaf) for leaf in all_leaf_names)
    if not found_ch:
        for e in target_entries:
            if ch_pattern.search(e['path']):
                found_ch = True
                break
    if found_ch:
        force_unit = '화'

    inner_meaningful_name = ''
    group_names = sorted(list(volume_groups.keys()), key=natural_keys)
    for leaf in group_names:
        if leaf and leaf != 'Root_Files':
            clean_p = re.sub(r'\.(zip|cbz|cbr|rar|7z)$', '', leaf, flags=re.IGNORECASE)
            if not is_garbage_folder_name(clean_p) and re.search(r'[가-힣a-zA-Z]', clean_p):
                inner_meaningful_name = clean_p
                break

    if not inner_meaningful_name and swallowed_name:
        inner_meaningful_name = re.sub(r'\.(zip|cbz|cbr|rar|7z)$', '', swallowed_name, flags=re.IGNORECASE)

    return volume_groups, inner_meaningful_name, swallowed_name, force_unit


class OrganizerLoadTask:
    def __init__(self, paths, seven_z_exe, lang, signals):
        self.paths = paths
        self.seven_z_exe = seven_z_exe
        self.lang = lang
        self.signals = signals

    def run(self):
        try:
            exts = {'.zip', '.cbz', '.cbr', '.7z', '.rar'}
            all_files = []
            new_data = {}
            skipped_files = []

            for p in self.paths:
                path_obj = Path(p)
                if path_obj.is_file() and path_obj.suffix.lower() in exts:
                    all_files.append(path_obj)
                elif path_obj.is_dir():
                    for sub in path_obj.rglob('*'):
                        if sub.is_file() and sub.suffix.lower() in exts and 'bak' not in sub.parts:
                            all_files.append(sub)

            total = len(all_files)
            if total == 0:
                self.signals.org_load_done.emit({}, [])
                return

            for idx, path_obj in enumerate(all_files):
                filepath = str(path_obj)
                filename = path_obj.name

                if idx % max(1, total // 50) == 0 or idx == total - 1:
                    msg = f"[{idx+1}/{total}] 구조 분석 중: {filename}" if self.lang == 'ko' else f"[{idx+1}/{total}] Analyzing: {filename}"
                    self.signals.progress.emit(int((idx / total) * 100), msg)

                size_mb = os.path.getsize(filepath) / (1024 * 1024)

                try:
                    entries, has_nested = _list_entries_fast(filepath, path_obj.suffix.lower(), self.seven_z_exe)
                    result = _analyze_from_entries(entries, filepath, self.lang)

                    if result is None or result[0] is None:
                        skipped_files.append(filename)
                        continue

                    volume_groups, inner_meaningful_name, swallowed_name, force_unit = result

                    display_title, core_title = resolve_titles(filepath, inner_meaningful_name)
                    group_names = sorted(list(volume_groups.keys()), key=natural_keys)
                    parsed_vols = []

                    # 🌟 [추가됨] 로드 시 언어별 권/화 포맷(정규식 변환)을 완벽하게 적용하는 내부 함수
                    def apply_lang_format(name, lang, force_unit_val):
                        is_chap = (force_unit_val == '화')
                        
                        # 문자열에서 마지막 숫자 블록을 찾아 (앞부분) (숫자) (뒷부분)으로 완벽히 분리합니다.
                        # 정규식 에러(look-behind)가 발생하지 않는 안전한 문법을 사용합니다.
                        pattern = r'^(.*?)\s*(?:v|c)?([\d\.\-\~]+)(?:권|화|巻|話|vol\.?|ch\.?|volume|chapter)?\s*([^0-9]*)$'
                        match = re.search(pattern, name, re.IGNORECASE)
                        
                        if match:
                            base = match.group(1).strip()
                            num = match.group(2).strip()
                            tail = match.group(3).strip()  # '외전', '특별편' 등이 여기에 담깁니다.
                            
                            # 꼬리말(외전 등)이 있다면 제목과 숫자 사이로 당겨와서 결합합니다.
                            if tail:
                                base = f"{base} {tail}".strip()
                                
                            if lang == "en":
                                unit = "c" if is_chap else "v"
                                return f"{base} {unit}{num}" if base else f"{unit}{num}"
                            elif lang == "ja":
                                unit = "話" if is_chap else "巻"
                                return f"{base} {num}{unit}" if base else f"{num}{unit}"
                            else:
                                unit = "화" if is_chap else "권"
                                return f"{base} {num}{unit}" if base else f"{num}{unit}"
                        else:
                            # 숫자가 전혀 없는 순수 텍스트(예: "외전" 단독)는 단위를 붙이지 않고 원래 이름 유지
                            return name.strip()

                    # 🌟 단일 파일 처리 시 언어별 포맷 덮어쓰기
                    if len(group_names) == 1 and group_names[0] == 'Root_Files':
                        vol_name = format_leaf_name(core_title, inner_meaningful_name or filename, 0, 1, self.lang)
                        vol_name = apply_lang_format(vol_name, self.lang, force_unit)
                        
                        parsed_vols.append({
                            'original_path': '', 
                            'original_basename': inner_meaningful_name or filename,
                            'new_name': vol_name,
                            'type': 'archive', 'force_unit': force_unit
                        })
                    else:
                    # 🌟 다중 파일(폴더) 처리 시 언어별 포맷 덮어쓰기
                        for v_idx, leaf in enumerate(group_names):
                            leaf_basename = os.path.basename(leaf.replace('\\', '/'))
                            parse_leaf = leaf_basename
                            if force_unit == '화' and not re.search(r'[가-힣a-zA-Z]', leaf_basename):
                                parse_leaf = leaf_basename + '화'
                            
                            vol_name = format_leaf_name(core_title, parse_leaf, v_idx, len(group_names), self.lang)
                            vol_name = apply_lang_format(vol_name, self.lang, force_unit)
                            
                            parsed_vols.append({
                                'original_path': leaf, 
                                'original_basename': leaf_basename,
                                'new_name': vol_name,
                                'type': 'folder', 'force_unit': force_unit
                            })

                    new_data[filepath] = {
                        'checked': True,
                        'name': filename,
                        'size_mb': size_mb,
                        'clean_title': display_title,
                        'volumes': parsed_vols
                    }

                except Exception as e:
                    skipped_files.append(f"{filename} (Error: {str(e)})")

            self.signals.progress.emit(100, "분석 완료" if self.lang == 'ko' else "Analysis Done")
            self.signals.org_load_done.emit(new_data, skipped_files)

        except Exception as e:
            self.signals.progress.emit(100, f"Error: {e}")
            self.signals.org_load_done.emit({}, [])


class FileLoadTask:
    def __init__(self, paths, seven_z_exe, lang, signals):
        self.paths = paths
        self.seven_z_exe = seven_z_exe
        self.lang = lang
        self.signals = signals

    def get_7z_entries(self, filepath):
        cmd = [self.seven_z_exe, 'l', '-ba', '-sccUTF-8', str(filepath)]
        result = subprocess.run(cmd, capture_output=True, **_subprocess_kwargs())
        stdout = result.stdout.decode('utf-8', errors='ignore')

        entries = []
        for line in stdout.splitlines():
            line = line.strip()
            if not line: continue
            parts = line.split(maxsplit=5)
            if len(parts) < 6: continue
            p_str = parts[5].replace('\\', '/')
            is_dir = 'D' in parts[2]
            if not is_dir:
                entries.append({
                    'original_name': p_str,
                    'filename': p_str,
                    'file_size': int(parts[3]) if parts[3].isdigit() else 0
                })
        return entries

    def run(self):
        try:
            exts = {'.zip', '.cbz', '.cbr', '.7z'}
            all_files = []
            new_data = {}
            nested_files = []
            unsupported_files = []

            for p in self.paths:
                path_obj = Path(p)
                if path_obj.is_file():
                    all_files.append(path_obj)
                elif path_obj.is_dir():
                    for sub in path_obj.rglob('*'):
                        if sub.is_file() and 'bak' not in sub.parts:
                            all_files.append(sub)

            total = len(all_files)
            if total == 0:
                self.signals.load_done.emit({}, [], [])
                return

            for idx, path_obj in enumerate(all_files):
                filepath = str(path_obj)
                filename = path_obj.name
                ext = path_obj.suffix.lower()

                if idx % max(1, total // 100) == 0 or idx == total - 1:
                    msg = f"[{idx+1}/{total}] 파일 분석 중: {filename}" if self.lang == 'ko' else f"[{idx+1}/{total}] Analyzing: {filename}"
                    self.signals.progress.emit(int((idx / total) * 100), msg)

                if ext not in exts:
                    unsupported_files.append(filename)
                    continue

                try:
                    size_mb = os.path.getsize(filepath) / (1024 * 1024)
                    if ext in ['.zip', '.cbz']:
                        with zipfile.ZipFile(filepath, 'r') as zf:
                            # 🌟 [적용] FileLoadTask에도 깨짐 복원 적용
                            entries = sorted([{
                                'original_name': decode_zip_filename(info.filename),
                                'filename': decode_zip_filename(info.filename).replace('\\', '/'),
                                'file_size': info.file_size
                            } for info in zf.infolist() if not info.is_dir()], key=lambda x: natural_keys(x['filename']))
                    else:
                        if not os.path.exists(self.seven_z_exe):
                            continue
                        entries = sorted(self.get_7z_entries(filepath), key=lambda x: natural_keys(x['filename']))

                    image_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}
                    img_entries = [e for e in entries if Path(e['filename']).suffix.lower() in image_exts]

                    if not img_entries:
                        continue

                    nested_exts = {'.zip', '.cbz', '.cbr', '.7z', '.rar', '.alz', '.egg'}
                    if any(Path(e['filename']).suffix.lower() in nested_exts for e in entries):
                        nested_files.append(filename)
                        continue

                    new_data[filepath] = {
                        'checked': True,
                        'entries': img_entries,
                        'size_mb': size_mb,
                        'name': filename,
                        'ext': ext
                    }
                except Exception:
                    pass

            self.signals.progress.emit(100, "분석 완료" if self.lang == 'ko' else "Analysis Done")
            self.signals.load_done.emit(new_data, nested_files, unsupported_files)

        except Exception as e:
            self.signals.progress.emit(100, f"Error: {e}")
            self.signals.load_done.emit({}, [], [])