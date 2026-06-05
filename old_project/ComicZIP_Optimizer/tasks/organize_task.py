import os
import shutil
import uuid
import tempfile
import subprocess
import re
import sys
from pathlib import Path

from utils import natural_keys
from core.parser import extract_core_title, get_similarity, is_garbage_folder_name

CREATE_NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0

def _subprocess_kwargs():
    if sys.platform == 'win32':
        return {'creationflags': CREATE_NO_WINDOW}
    return {}


def _is_same_format(src_ext, target_ext):
    zip_family = {'.zip', '.cbz', '.cbr'}
    if src_ext in zip_family and target_ext in zip_family:
        return True
    return src_ext == target_ext


def _rename_only(seven_z_exe, filepath, rename_map, target_path):
    """케이스 A: 7za rn 으로 내부 경로만 변경."""
    sys_temp = tempfile.gettempdir()
    safe_id = uuid.uuid4().hex[:6]
    temp_archive = os.path.join(sys_temp, f"ComicZIP_RN_{safe_id}_{os.path.basename(filepath)}")

    try:
        shutil.copy2(filepath, temp_archive)

        flat_args = []
        for old, new in rename_map:
            flat_args.extend([old, new])

        for i in range(0, len(flat_args), 40):
            res = subprocess.run(
                [seven_z_exe, 'rn', temp_archive] + flat_args[i:i + 40],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                **_subprocess_kwargs()
            )
            if res.returncode not in (0, 1):
                return False

        shutil.move(temp_archive, target_path)
        return True

    except Exception as e:
        print(f"_rename_only error: {e}")
        if os.path.exists(temp_archive):
            os.remove(temp_archive)
        return False


class OrganizerProcessTask:
    def __init__(self, targets, config, org_data, seven_z_exe, signals):
        self.targets = targets
        self.backup_on = config.get("backup_on", False)
        self.target_format = config.get("target_format", "none")
        self.lang = config.get("lang", "ko")
        self.org_data = org_data
        self.seven_z_exe = seven_z_exe
        self.signals = signals
        self._is_cancelled = False

    def cancel(self):
        self._is_cancelled = True

    def _get_target_ext(self, src_ext):
        if self.target_format != "none":
            return f".{self.target_format}"
        return src_ext

    def _process_single(self, file_path, idx, total):
        filename = os.path.basename(file_path)
        src_ext = Path(file_path).suffix.lower()
        target_ext = self._get_target_ext(src_ext)
        data = self.org_data[file_path]

        msg = (
            f"[{idx+1}/{total}] 처리 중: {filename}"
            if self.lang == "ko"
            else f"[{idx+1}/{total}] Processing: {filename}"
        )
        self.signals.progress.emit(int((idx / total) * 100), msg)

        clean_title = re.sub(r'^[._\-\s]+', '', data['clean_title'])
        base_out_dir = data.get('out_path', os.path.dirname(file_path))
        volumes = data['volumes']

        original_tmp = file_path + ".tmp"
        created_zips = []

        try:
            if self.backup_on:
                bak_dir = os.path.join(os.path.dirname(file_path), 'bak')
                os.makedirs(bak_dir, exist_ok=True)
                shutil.copy2(file_path, os.path.join(bak_dir, filename))

            is_single_vol = len(volumes) == 1
            same_format = _is_same_format(src_ext, target_ext)
            vol = volumes[0] if volumes else None

            use_rename_only = (
                is_single_vol
                and same_format
                and vol is not None
                and vol.get('type') == 'folder'
            )

            if use_rename_only:
                # 케이스 A: 7za rn
                vol_base = re.sub(r'^[._\-\s]+', '', vol['new_name'])
                vol_name = f"{vol_base}{target_ext}"
                os.makedirs(base_out_dir, exist_ok=True)
                target_path = os.path.join(base_out_dir, vol_name)

                base_name_t, ext_t = os.path.splitext(vol_name)
                counter = 1
                while os.path.exists(target_path) and os.path.abspath(target_path) != os.path.abspath(file_path):
                    target_path = os.path.join(base_out_dir, f"{base_name_t}_{counter}{ext_t}")
                    counter += 1

                orig_inner = vol.get('original_path', '')
                if not orig_inner:
                    if os.path.abspath(file_path) != os.path.abspath(target_path):
                        if os.path.exists(original_tmp):
                            os.remove(original_tmp)
                        os.rename(file_path, target_path)
                    return True, filename, [target_path]

                from tasks.load_task import _list_entries_fast
                entries, _ = _list_entries_fast(file_path, src_ext, self.seven_z_exe)
                img_entries = [e for e in entries if e.get('is_img', False)]

                if not img_entries:
                    use_rename_only = False
                else:
                    rename_map = []
                    for e in img_entries:
                        old_path = e['path']
                        parts = Path(old_path).parts
                        if len(parts) > 1:
                            new_path = '/'.join(parts[1:])
                            if old_path != new_path:
                                rename_map.append((old_path, new_path))

                    if os.path.exists(original_tmp):
                        os.remove(original_tmp)
                    os.rename(file_path, original_tmp)

                    success = _rename_only(
                        self.seven_z_exe, original_tmp, rename_map, target_path
                    )

                    if success:
                        os.remove(original_tmp)
                        return True, filename, [target_path]
                    else:
                        os.rename(original_tmp, file_path)
                        use_rename_only = False

            if not use_rename_only:
                return self._process_extract_repack(
                    file_path, filename, src_ext, target_ext,
                    clean_title, base_out_dir, volumes, original_tmp
                )

        except Exception as e:
            if os.path.exists(original_tmp):
                if not os.path.exists(file_path):
                    os.rename(original_tmp, file_path)
            return False, f"{filename} - {str(e)}", []

    def _process_extract_repack(self, file_path, filename, src_ext, target_ext,
                                clean_title, base_out_dir, volumes, original_tmp):
        """케이스 B/C: 전체 해제 후 재압축."""
        safe_id = uuid.uuid4().hex[:6]
        sys_temp = tempfile.gettempdir()
        temp_base = os.path.join(sys_temp, f"ComicZIP_{safe_id}_{filename}")
        created_zips = []

        if os.path.exists(temp_base):
            shutil.rmtree(temp_base, ignore_errors=True)
        os.makedirs(temp_base, exist_ok=True)

        try:
            if os.path.exists(original_tmp):
                os.remove(original_tmp)
            os.rename(file_path, original_tmp)

            def extract_all(src_path, dest_dir):
                # 🌟 [복구] 압축을 '푸는(x)' 명령어로 원상 복구 및 에러 로그 차단 최적화
                subprocess.run(
                    [self.seven_z_exe, 'x', src_path, f'-o{dest_dir}', '-y'],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    **_subprocess_kwargs(),
                    check=True
                )
                
                while True:
                    found = []
                    for root, dirs, files in os.walk(dest_dir):
                        for f in files:
                            if f.lower().endswith(('.zip', '.cbz', '.rar', '.7z')):
                                found.append(os.path.join(root, f))
                    if not found:
                        break
                    for arch in found:
                        arch_dir = os.path.splitext(arch)[0]
                        os.makedirs(arch_dir, exist_ok=True)
                        subprocess.run(
                            [self.seven_z_exe, 'x', arch, f'-o{arch_dir}', '-y'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            **_subprocess_kwargs()
                        )
                        os.remove(arch)

            extract_all(original_tmp, temp_base)

            def get_actual_root(curr_dir):
                while True:
                    items = os.listdir(curr_dir)
                    subdirs = [i for i in items if os.path.isdir(os.path.join(curr_dir, i))]
                    images = [i for i in items if i.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'))]
                    if len(subdirs) == 1 and len(images) == 0:
                        curr_dir = os.path.join(curr_dir, subdirs[0])
                    else:
                        break
                return curr_dir

            actual_root = get_actual_root(temp_base)
            leaf_folders = set()
            root_images = []
            total_extracted_images = 0

            for root_dir, _, files in os.walk(actual_root):
                for f in files:
                    if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif')):
                        total_extracted_images += 1
                        rel_path = os.path.relpath(root_dir, actual_root)
                        if rel_path == '.':
                            root_images.append(os.path.join(root_dir, f))
                        else:
                            parts = Path(rel_path).parts
                            top_folder_name = parts[0]
                            p0 = top_folder_name.lower()
                            is_part_folder = bool(re.search(r'(\d+\s*부|제\s*\d+\s*부|시즌|season|part)', p0))
                            if is_part_folder and len(parts) > 1:
                                top_folder = os.path.join(top_folder_name, parts[1])
                            else:
                                top_folder = top_folder_name
                            leaf_folders.add(os.path.join(actual_root, top_folder))

            if total_extracted_images == 0:
                raise Exception("이미지 파일이 없거나 압축을 풀 수 없습니다.")

            deleted_root_images = []
            if root_images:
                if leaf_folders:
                    for img_path in root_images:
                        deleted_root_images.append(os.path.basename(img_path))
                        os.remove(img_path)
                        total_extracted_images -= 1
                else:
                    leaf_folders.add(actual_root)

            leaf_folders = sorted(list(leaf_folders), key=natural_keys)
            archive_type = '-t7z' if target_ext == '.7z' else '-tzip'
            total_packed_images = 0

            for v_idx, leaf in enumerate(leaf_folders):
                if self._is_cancelled:
                    break

                img_count = sum(
                    1 for r, _, fs in os.walk(leaf)
                    for f in fs
                    if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'))
                )
                total_packed_images += img_count

                if v_idx < len(volumes):
                    vol_base = volumes[v_idx]['new_name']
                else:
                    pad = max(2, len(str(len(leaf_folders))))
                    vol_base = f"{clean_title} v{v_idx+1:0{pad}d}" if self.lang == 'en' else f"{clean_title} {v_idx+1:0{pad}d}권"

                vol_base = re.sub(r'^[._\-\s]+', '', vol_base)
                vol_name = f"{vol_base}{target_ext}"

                rel_path = os.path.relpath(leaf, actual_root)
                if rel_path == '.' or rel_path == 'Root_Files':
                    out_dir = base_out_dir
                else:
                    parts = Path(rel_path).parts
                    valid_parts = []
                    for p in parts[:-1]:
                        cp = re.sub(r'\[.*?\]|\(.*?\)|<.*?>', '', p).strip()
                        cp = re.sub(r'[-_+]+', ' ', cp).strip()
                        is_garbage = (
                            len(p) > 15 and bool(re.match(r'^[a-fA-F0-9\-_]+$', p))
                        ) or bool(re.match(r'^\d+$', cp))
                        if not is_garbage and cp:
                            p_core = extract_core_title(p)
                            c_core = extract_core_title(clean_title)
                            if p_core and c_core and get_similarity(p_core, c_core) >= 0.5:
                                if not bool(re.search(r'(\d+\s*부|제\s*\d+\s*부|시즌|season|part)', p.lower())):
                                    continue
                            valid_parts.append(cp if cp else p)
                    rel_dir = os.path.join(*valid_parts) if valid_parts else ''
                    out_dir = os.path.join(base_out_dir, rel_dir) if rel_dir else base_out_dir

                os.makedirs(out_dir, exist_ok=True)

                base_target_path = os.path.join(out_dir, vol_name)
                target_path = base_target_path
                base_name_t, ext_t = os.path.splitext(vol_name)
                counter = 1
                while os.path.exists(target_path):
                    target_path = os.path.join(out_dir, f"{base_name_t}_{counter}{ext_t}")
                    counter += 1

                temp_archive = os.path.join(
                    sys_temp,
                    f"ComicZIP_Done_{safe_id}_{uuid.uuid4().hex[:4]}_{os.path.basename(target_path)}"
                )
                if os.path.exists(temp_archive):
                    os.remove(temp_archive)

                # 🌟 [핵심 개선] 실제 압축(a)하는 위치에 멀티쓰레드(-mmt=on) 및 에러 출력 차단 적용
                subprocess.run(
                    [self.seven_z_exe, 'a', archive_type, temp_archive, '*', '-mx=0', '-mmt=on'],
                    cwd=leaf, 
                    stdout=subprocess.DEVNULL, 
                    stderr=subprocess.DEVNULL,
                    **_subprocess_kwargs(),
                    check=True
                )

                shutil.move(temp_archive, target_path)
                created_zips.append(target_path)

            shutil.rmtree(temp_base, ignore_errors=True)

            if not self._is_cancelled:
                if total_extracted_images != total_packed_images:
                    raise Exception(
                        f"이미지 유실 징후 (원본: {total_extracted_images}장 / 압축됨: {total_packed_images}장)"
                    )
                os.remove(original_tmp)

                if deleted_root_images:
                    del_msg = (
                        f" 🗑️(불필요 커버 {len(deleted_root_images)}개 제거됨)"
                        if self.lang == "ko"
                        else f" 🗑️({len(deleted_root_images)} covers removed)"
                    )
                    return True, f"{filename}{del_msg}", created_zips
                return True, filename, created_zips
            else:
                for z in created_zips:
                    if os.path.exists(z):
                        os.remove(z)
                os.rename(original_tmp, file_path)
                return None, filename, []

        except Exception as e:
            shutil.rmtree(temp_base, ignore_errors=True)
            for z in created_zips:
                if os.path.exists(z):
                    os.remove(z)
            if os.path.exists(original_tmp):
                if not os.path.exists(file_path):
                    os.rename(original_tmp, file_path)
            return False, f"{filename} - {str(e)}", []

    def run(self):
        stats = {'success': [], 'skip': [], 'error': []}
        all_created_zips = []

        try:
            total = len(self.targets)

            for idx, file_path in enumerate(self.targets):
                if self._is_cancelled:
                    stats['skip'].append(f"{os.path.basename(file_path)} (Cancelled)")
                    break

                result, msg, created_zips = self._process_single(file_path, idx, total)

                if result is True:
                    stats['success'].append(msg)
                    all_created_zips.extend(created_zips)
                elif result is False:
                    stats['error'].append(msg)
                else:
                    break

            if self._is_cancelled:
                self.signals.progress.emit(0, "Cancelled" if self.lang == "en" else "작업 중단됨")
            else:
                self.signals.progress.emit(100, "Done!" if self.lang == "en" else "작업 완료!")

            self.signals.org_process_done.emit(stats, all_created_zips, self._is_cancelled)

        except Exception as e:
            self.signals.progress.emit(100, f"Critical Error: {e}")
            stats['error'].append(str(e))
            self.signals.org_process_done.emit(stats, all_created_zips, True)