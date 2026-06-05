import urllib.request
import ssl
import json
import os
import sys
import stat
import zipfile
import platform
from config import CURRENT_VERSION

class VersionCheckTask:
    def __init__(self, signals): self.signals = signals
    def run(self):
        try:
            url = "https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/version.json"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=3, context=context) as response:
                data = json.loads(response.read().decode('utf-8'))
                latest_ver = data.get("latest_version", "")
                curr_parts = [int(x) for x in CURRENT_VERSION.split('.')]
                latest_parts = [int(x) for x in latest_ver.split('.')]
                if latest_parts > curr_parts:
                    self.signals.version_checked.emit(latest_ver)
        except: pass

class ReleaseNotesTask:
    def __init__(self, signals): self.signals = signals

    def run(self):
        import urllib.request
        import ssl
        import json
        import markdown
        try:
            url = "https://api.github.com/repos/dongkkase/ComicZIP_Optimizer/releases?per_page=10"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=5, context=context) as response:
                data = json.loads(response.read().decode('utf-8'))
                
                parsed_releases = []
                if isinstance(data, list):
                    for release in data:
                        name = release.get("name", release.get("tag_name", "업데이트"))
                        date_str = release.get("published_at", "")
                        if date_str: date_str = date_str.split("T")[0]
                        body = release.get("body", "릴리즈 내용이 없습니다.")
                        
                        # 🌟 마크다운을 HTML(Rich Text)로 변환하여 메인 UI로 전달
                        body_html = markdown.markdown(body, extensions=['nl2br', 'extra', 'fenced_code'])
                        
                        parsed_releases.append({
                            "name": name,
                            "date": date_str,
                            "body": body_html
                        })
                
                self.signals.release_notes_loaded.emit(parsed_releases)
        except Exception as e:
            print(f"Release Notes Error: {e}")
            self.signals.release_notes_loaded.emit([])


class AutoUpdateTask:
    def __init__(self, download_url, signals): 
        self.download_url = download_url
        self.signals = signals

    def run(self):
        try:
            self.signals.progress.emit(10, "업데이트 파일을 다운로드 중입니다...")
            
            temp_zip_path = "update_temp.zip"
            req = urllib.request.Request(self.download_url, headers={'User-Agent': 'Mozilla/5.0'})
            context = ssl._create_unverified_context()
            
            with urllib.request.urlopen(req, context=context) as response, open(temp_zip_path, 'wb') as out_file:
                out_file.write(response.read())

            self.signals.progress.emit(60, "업데이트 파일 압축 해제 중...")
            extract_dir = "_update_temp"
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)

            self.signals.progress.emit(90, "업데이트 스크립트 생성 중...")
            
            is_windows = platform.system() == "Windows"
            is_frozen = getattr(sys, 'frozen', False)
            
            if is_windows:
                script_path = "updater.bat"
                if is_frozen:
                    exe_name = os.path.basename(sys.executable)
                    start_cmd = f'start "" "{exe_name}"'
                else:
                    exe_name = sys.executable
                    start_cmd = f'start "" "{exe_name}" main.py'

                script_content = f"""@echo off
echo 업데이트 적용 중... 프로그램 종료 대기(3초)
timeout /t 3 /nobreak > NUL
xcopy /s /y "{extract_dir}\\*" .\\
rmdir /s /q "{extract_dir}"
del "{temp_zip_path}"
{start_cmd}
del "%~f0"
"""
                encoding = "euc-kr"
            else:
                script_path = "updater.sh"
                if is_frozen:
                    exe_name = sys.executable
                    start_cmd = f'open "{exe_name}"'
                else:
                    exe_name = sys.executable
                    start_cmd = f'"{exe_name}" main.py &'
                    
                script_content = f"""#!/bin/bash
echo "업데이트 적용 중... 프로그램 종료 대기(3초)"
sleep 3
cp -Rf {extract_dir}/* ./
rm -rf {extract_dir}
rm -f {temp_zip_path}
{start_cmd}
rm -f "$0"
"""
                encoding = "utf-8"

            with open(script_path, "w", encoding=encoding) as f:
                f.write(script_content)

            if not is_windows:
                os.chmod(script_path, os.stat(script_path).st_mode | stat.S_IEXEC)

            self.signals.progress.emit(100, "업데이트 준비 완료!")
            self.signals.update_ready.emit(script_path)

        except Exception as e:
            print(f"AutoUpdate Error: {e}")
            self.signals.progress.emit(0, f"업데이트 실패: {e}")