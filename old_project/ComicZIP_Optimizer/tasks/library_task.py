import os
import subprocess
import hashlib
import tempfile
import xml.etree.ElementTree as ET
import shutil
from PyQt6.QtCore import QThread, pyqtSignal
from core.library_db import db

class LibraryExtractThread(QThread):
    data_extracted = pyqtSignal(str, dict)

    def __init__(self, filepaths, seven_zip_path, thumb_dir):
        super().__init__()
        self.filepaths = filepaths
        self.seven_zip_path = seven_zip_path
        self.thumb_dir = thumb_dir
        self.is_cancelled = False

    def cancel(self):
        self.is_cancelled = True

    def run(self):
        img_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp'}
        
        for fp in self.filepaths:
            if self.is_cancelled:
                break
            
            try:
                stat = os.stat(fp)
                current_mtime = stat.st_mtime
                current_size = stat.st_size
                
                cached = db.get_file_info(fp)
                if cached and cached[1] == current_mtime and cached[10] and os.path.exists(cached[10]):
                    meta_dict = {
                        "mtime": cached[1], "ctime": cached[2], "filesize": cached[3],
                        "resolution": cached[4], "title": cached[5], "series": cached[6],
                        "volume": cached[7], "number": cached[8], "writer": cached[9],
                        "thumb_path": cached[10]
                    }
                    self.data_extracted.emit(fp, meta_dict)
                    continue

                result = subprocess.run([self.seven_zip_path, 'l', fp], capture_output=True, text=True, errors='replace', creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                
                xml_path_in_archive = None
                img_paths_in_archive = []
                
                lines = result.stdout.splitlines()
                is_file_list = False
                for line in lines:
                    if set(line.strip()) == {'-'}:
                        is_file_list = not is_file_list
                        continue
                    if is_file_list:
                        parts = line.rsplit(' ', 1)
                        if len(parts) == 2:
                            filename = parts[1].strip()
                            filename_lower = filename.lower()
                            if filename_lower == 'comicinfo.xml':
                                xml_path_in_archive = filename
                            elif os.path.splitext(filename_lower)[1] in img_exts:
                                img_paths_in_archive.append(filename)

                if not img_paths_in_archive:
                    continue 
                
                img_paths_in_archive.sort()
                cover_path_in_archive = img_paths_in_archive[0] 
                
                extract_targets = [cover_path_in_archive]
                if xml_path_in_archive:
                    extract_targets.append(xml_path_in_archive)
                
                with tempfile.TemporaryDirectory() as temp_dir:
                    cmd_ext = [self.seven_zip_path, 'e', fp, f"-o{temp_dir}", "-y"] + extract_targets
                    subprocess.run(cmd_ext, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                    
                    extracted_cover = os.path.join(temp_dir, os.path.basename(cover_path_in_archive))
                    thumb_filename = hashlib.md5(fp.encode('utf-8')).hexdigest() + os.path.splitext(cover_path_in_archive)[1]
                    final_thumb_path = os.path.join(self.thumb_dir, thumb_filename)
                    
                    if os.path.exists(extracted_cover):
                        shutil.copy(extracted_cover, final_thumb_path)
                    else:
                        final_thumb_path = ""

                    meta_dict = {
                        "mtime": current_mtime, "ctime": stat.st_ctime, "filesize": current_size,
                        "resolution": "", "title": "", "series": "", "volume": "", "number": "", 
                        "writer": "", "thumb_path": final_thumb_path
                    }
                    
                    extracted_xml = os.path.join(temp_dir, 'comicinfo.xml')
                    if not os.path.exists(extracted_xml):
                        extracted_xml = os.path.join(temp_dir, 'ComicInfo.xml')
                        
                    if os.path.exists(extracted_xml):
                        try:
                            tree = ET.parse(extracted_xml)
                            root = tree.getroot()
                            def get_text(tag):
                                el = root.find(tag)
                                return el.text if el is not None else ""
                            meta_dict["title"] = get_text('Title')
                            meta_dict["series"] = get_text('Series')
                            meta_dict["volume"] = get_text('Volume')
                            meta_dict["number"] = get_text('Number')
                            meta_dict["writer"] = get_text('Writer')
                        except Exception:
                            pass
                            
                db.save_file_info(fp, meta_dict)
                self.data_extracted.emit(fp, meta_dict)
                
            except Exception as e:
                print(f"[Extract Error] {fp}: {e}")