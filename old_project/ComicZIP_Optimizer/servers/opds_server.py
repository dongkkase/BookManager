import http.server
import socketserver
import urllib.parse
import html
import os
import datetime
import uuid
import socket
from .base import BaseServerThread
from core.library_db import db

class OPDSServerThread(BaseServerThread):
    """
    Panels, ComicGlass, KyBook 등을 지원하기 위한 OPDS(XML) 제공 서버입니다.
    """
    def __init__(self, port=8080, root_path=""):
        super().__init__(port, root_path)
        self.httpd = None

    def _start_server(self):
        server_thread = self
        
        # 내부 요청 처리 핸들러 정의
        class OPDSHandler(http.server.SimpleHTTPRequestHandler):
            # 접속 시 지연을 유발하는 역방향 DNS 조회 무시
            def address_string(self):
                return self.client_address[0]
                
            # 멀티스레딩 병목을 유발하는 파이썬 기본 콘솔 로깅 비활성화
            def log_message(self, format, *args):
                pass
                
            def do_GET(self):
                parsed_url = urllib.parse.urlparse(self.path)
                
                # 1. OPDS XML 피드 요청 처리 (트리 네비게이션)
                if parsed_url.path == "/opds" or parsed_url.path == "/opds/":
                    params = urllib.parse.parse_qs(parsed_url.query)
                    current_dir = params.get('dir', [''])[0]
                    
                    log_dir = os.path.basename(current_dir.rstrip(os.sep)) if current_dir else "최상위 라이브러리"
                    server_thread.log_signal.emit(f"[OPDS] 탐색 중: {log_dir} ({self.client_address[0]})")
                    
                    self.send_response(200)
                    self.send_header("Content-type", "application/xml; charset=utf-8")
                    self.end_headers()
                    
                    conn = db.get_connection()
                    cursor = conn.cursor()
                    
                    folders = set()
                    files = []
                    
                    # 등록된 라이브러리 폴더 목록 추출
                    registered_folders = set()
                    try:
                        from config import load_config
                        cfg = load_config()
                        for f in cfg.get("dup_check_folders", []):
                            if f:
                                registered_folders.add(os.path.normpath(f))
                    except Exception:
                        pass

                    if not current_dir:
                        # 등록된 라이브러리 폴더만 루트에 표시
                        if registered_folders:
                            for f in registered_folders:
                                if os.path.exists(f):
                                    folders.add(f)
                        else:
                            # 등록된 폴더가 없을 경우의 폴백 (전체 파일의 최상위 드라이브/경로)
                            cursor.execute('SELECT path FROM files')
                            for row in cursor.fetchall():
                                p = row[0]
                                drive, _ = os.path.splitdrive(p)
                                if drive:
                                    folders.add(drive + os.sep)
                                else:
                                    parts = p.split(os.sep)
                                    if p.startswith(os.sep) and len(parts) > 1:
                                        folders.add(os.sep + parts[1])
                                    else:
                                        folders.add(parts[0])
                    else:
                        # 특정 폴더 하위 탐색
                        prefix = current_dir if current_dir.endswith(os.sep) else current_dir + os.sep
                        cursor.execute('SELECT path, title, summary, writer, mtime, thumb_path, size, ext, page_count FROM files WHERE path LIKE ?', (prefix + '%',))
                        
                        folder_thumbnails = {} # [최적화] N+1 쿼리 방지용 썸네일 캐시
                        
                        for row in cursor.fetchall():
                            p = row[0]
                            rel_path = p[len(prefix):]
                            parts = rel_path.split(os.sep)
                            if len(parts) > 1:
                                folder_name = parts[0]
                                folders.add(folder_name)
                                # 해당 폴더의 '바로 아래'에 있는 파일(len(parts)==2)만 썸네일로 캐싱
                                if len(parts) == 2 and folder_name not in folder_thumbnails:
                                    folder_thumbnails[folder_name] = (p, row[5])
                            else:
                                files.append(row)
                                
                    # [정렬] 제목(가나다) 순으로 정렬 (제목이 없으면 파일명 기준)
                    files.sort(key=lambda x: (x[1] or os.path.basename(x[0])).lower())

                    now_iso = datetime.datetime.utcnow().isoformat() + "Z"
                    
                    xml = ['<?xml version="1.0" encoding="UTF-8"?>']
                    xml.append('<feed xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.w3.org/2005/Atom">')
                    xml.append(f'<updated>{now_iso}</updated>')
                    xml.append('<id>urn:uuid:comiczip-opds-catalog</id>')                    
                    feed_title = f"Folder: {os.path.basename(current_dir.rstrip(os.sep))}" if current_dir else "ComicZIP Library"
                    xml.append(f'<title>{html.escape(feed_title)}</title>')
                    xml.append('<author><name>ComicZIP Optimizer</name></author>')
                    
                    # 네비게이션 링크
                    current_url = f"/opds?dir={urllib.parse.quote(current_dir)}" if current_dir else "/opds"
                    xml.append(f'<link rel="self" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="{current_url}"/>')
                    xml.append('<link rel="start" href="/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>')
                    
                    # 상위 폴더로 가기 (Up)
                    if current_dir:
                        # 현재 폴더가 라이브러리 루트 폴더 중 하나라면, 상위 이동 시 최상위 목록으로 직행
                        if current_dir in registered_folders:
                            parent_url = "/opds"
                        else:
                            parent_dir = os.path.dirname(current_dir.rstrip(os.sep))
                            if parent_dir == current_dir.rstrip(os.sep) or parent_dir == current_dir:
                                parent_url = "/opds"
                            else:
                                if not parent_dir.endswith(os.sep) and len(parent_dir) == 2 and parent_dir.endswith(':'): 
                                    parent_dir += os.sep
                                parent_url = f"/opds?dir={urllib.parse.quote(parent_dir)}"
                        xml.append(f'<link rel="up" href="{parent_url}" type="application/atom+xml;profile=opds-catalog;kind=navigation" title="Up"/>')

                    # 1. 폴더 목록 렌더링
                    for folder in sorted(folders):
                        folder_path = os.path.join(current_dir, folder) if current_dir else folder
                        encoded_folder_path = urllib.parse.quote(folder_path)
                        folder_url = f"/opds?dir={encoded_folder_path}"
                        entry_id = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, folder_url)}"
                        
                        xml.append('<entry>')
                        xml.append(f'<title>{html.escape(folder)}</title>')
                        xml.append(f'<id>{entry_id}</id>')
                        xml.append(f'<updated>{now_iso}</updated>')
                        xml.append(f'<link rel="subsection" type="application/atom+xml;profile=opds-catalog;kind=navigation" href="{folder_url}"/>')
                        
                        # 폴더 썸네일 N+1 쿼리 병목 제거 (캐시 활용)
                        f_path, f_thumb = None, None
                        if current_dir and folder in folder_thumbnails:
                            f_path, f_thumb = folder_thumbnails[folder]
                        elif not current_dir:
                            folder_prefix = folder_path + os.sep if not folder_path.endswith(os.sep) else folder_path
                            # 루트 폴더인 경우 하위 폴더의 파일을 제외하기 위해 NOT LIKE 적용
                            cursor.execute('SELECT path, thumb_path FROM files WHERE path LIKE ? AND path NOT LIKE ? LIMIT 1', (folder_prefix + '%', folder_prefix + '%' + os.sep + '%'))
                            first_file = cursor.fetchone()
                            if first_file: f_path, f_thumb = first_file
                            
                        if f_path:
                            if f_thumb and os.path.exists(f_thumb):
                                folder_thumb_url = f"/download?file={urllib.parse.quote(f_thumb)}"
                            else:
                                folder_thumb_url = f"/thumbnail?file={urllib.parse.quote(f_path)}"
                            xml.append(f'<link rel="http://opds-spec.org/image/thumbnail" href="{folder_thumb_url}" type="image/jpeg" />')
                            xml.append(f'<link rel="http://opds-spec.org/image" href="{folder_thumb_url}" type="image/jpeg" />')
                            
                        xml.append('</entry>')
                    
                    # 2. 파일 목록 렌더링
                    for row in files:
                        path, title, summary, writer, mtime, thumb_path, size, ext, page_count = row
                        title_safe = html.escape(title or os.path.basename(path))
                        summary_safe = html.escape(summary or "")
                        writer_safe = html.escape(writer or "Unknown")
                        
                        # 확장자에 따른 Mime Type 결정 (Kavita 스타일 호환)
                        file_ext = ext.lower().strip('.') if ext else path.split('.')[-1].lower()
                        mime_type = "application/zip"
                        if file_ext == "cbz": mime_type = "application/x-cbz"
                        elif file_ext == "epub": mime_type = "application/epub+zip"
                        elif file_ext == "cbr": mime_type = "application/x-cbr"
                        
                        # 용량 및 페이지 변환
                        size_val = size if size else 0
                        extent_str = f"{size_val / (1024*1024):.2f} MB"
                        p_count = page_count if page_count and str(page_count).isdigit() else "0"
                        
                        encoded_path = urllib.parse.quote(path)
                        download_url = f"/download?file={encoded_path}"
                        stream_url_template = f"/page?file={encoded_path}&amp;page_num={{pageNumber}}"
                        
                        entry_id = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, path)}"
                        
                        xml.append('<entry>')
                        xml.append(f'<updated>{now_iso}</updated>')
                        xml.append(f'<id>{entry_id}</id>')
                        xml.append(f'<title>⭘ {title_safe}</title>')
                        
                        comb_summary = f"File Type: {mime_type} - {extent_str} Summary: {summary_safe}"
                        xml.append(f'<summary>{html.escape(comb_summary)}</summary>')
                        xml.append(f'<extent xmlns="http://purl.org/dc/terms/">{extent_str}</extent>')
                        xml.append('<format xmlns="http://purl.org/dc/terms/format">Archive</format>')
                        xml.append(f'<content type="text">{mime_type}</content>')
                        
                        # 표지 이미지(Thumbnail) 연결 (DB 캐시가 없으면 실시간 추출 라우터로 연결)
                        if thumb_path and os.path.exists(thumb_path):
                            encoded_thumb = urllib.parse.quote(thumb_path)
                            thumb_url = f"/download?file={encoded_thumb}"
                        else:
                            thumb_url = f"/thumbnail?file={encoded_path}"
                            
                        xml.append(f'<link rel="http://opds-spec.org/image/thumbnail" href="{thumb_url}" type="image/jpeg" />')
                        xml.append(f'<link rel="http://opds-spec.org/image" href="{thumb_url}" type="image/jpeg" />')
                        
                        # PSE(스트리밍) 및 다운로드 링크 주입
                        if p_count != "0":
                            xml.append(f'<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://opds-spec.org/acquisition/open-access" type="{mime_type}" href="{download_url}" p5:count="{p_count}"/>')
                            xml.append(f'<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" href="{stream_url_template}" p5:count="{p_count}"/>')
                        else:
                            xml.append(f'<link rel="http://opds-spec.org/acquisition/open-access" type="{mime_type}" href="{download_url}"/>')
                            xml.append(f'<link xmlns:p5="http://vaemendis.net/opds-pse/ns" rel="http://vaemendis.net/opds-pse/stream" type="image/jpeg" href="{stream_url_template}"/>')
                            
                        xml.append(f'<author><name>{writer_safe}</name></author>')
                        xml.append('</entry>')
                        
                    xml.append('</feed>')
                    self.wfile.write("\n".join(xml).encode('utf-8'))
                    conn.close()
                    
                # 2. 실제 파일 다운로드(스트리밍) 요청 처리
                elif parsed_url.path == "/download":
                    query = parsed_url.query
                    params = urllib.parse.parse_qs(query)
                    if 'file' in params:
                        file_name = os.path.basename(params['file'][0])
                        server_thread.log_signal.emit(f"[OPDS] 📥 다운로드 시작: {file_name} ({self.client_address[0]})")
                        self._serve_file(params['file'][0])
                    else:
                        self.send_error(400, "Missing file parameter")
                        
                # 3. 썸네일(표지) 실시간 추출 요청 처리
                elif parsed_url.path == "/thumbnail":
                    query = parsed_url.query
                    params = urllib.parse.parse_qs(query)
                    if 'file' in params:
                        self._serve_thumbnail(params['file'][0])
                    else:
                        self.send_error(400, "Missing file parameter")
                        
                # 4. 페이지 스트리밍 피드 요청 처리 (PSE)
                elif parsed_url.path == "/stream":
                    query = parsed_url.query
                    params = urllib.parse.parse_qs(query)
                    if 'file' in params:
                        file_name = os.path.basename(params['file'][0])
                        server_thread.log_signal.emit(f"[OPDS] 📱 스트리밍 시작: {file_name} ({self.client_address[0]})")
                        self._serve_stream_feed(params['file'][0])
                    else:
                        self.send_error(400, "Missing file parameter")
                        
                # 5. 스트리밍용 개별 페이지 이미지 요청 처리
                elif parsed_url.path == "/page":
                    query = parsed_url.query
                    params = urllib.parse.parse_qs(query)
                    if 'file' in params:
                        file_path = params['file'][0]
                        page_name = params.get('page', [None])[0]
                        page_num = params.get('page_num', [None])[0]
                        
                        if page_name or page_num is not None:
                            self._serve_page(file_path, page_name, page_num)
                        else:
                            self.send_error(400, "Missing parameters")
                    else:
                        self.send_error(400, "Missing file parameter")
                        
                # 6. 기타 경로 (정적 파일 제공 등)
                else:
                    super().do_GET()

            def _serve_file(self, file_path):
                if os.path.exists(file_path):
                    self.send_response(200)
                    filename = os.path.basename(file_path)
                    safe_filename = urllib.parse.quote(filename)
                    self.send_header("Content-type", "application/octet-stream")
                    self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{safe_filename}")
                    self.send_header("Content-Length", str(os.path.getsize(file_path)))
                    self.end_headers()
                    
                    with open(file_path, 'rb') as f:
                        # 4MB 청크 단위 전송 (메모리 절약 및 스트리밍 안정성 확보)
                        chunk_size = 1024 * 1024 * 4
                        while True:
                            chunk = f.read(chunk_size)
                            if not chunk:
                                break
                            try:
                                self.wfile.write(chunk)
                            except Exception:
                                # 클라이언트가 다운로드를 취소하거나 앱을 닫은 경우
                                break
                else:
                    self.send_error(404, "File not found")

            def _serve_thumbnail(self, file_path):
                if not os.path.exists(file_path):
                    self.send_error(404, "File not found")
                    return
                
                ext = file_path.lower().split('.')[-1]
                img_exts = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
                cover_data = None
                cover_ext = ".jpg"
                
                try:
                    import zipfile
                    if ext in ['zip', 'cbz']:
                        with zipfile.ZipFile(file_path, 'r') as zf:
                            images = [f for f in zf.namelist() if f.lower().endswith(img_exts) and '__MACOSX' not in f]
                            images.sort()
                            if images:
                                cover = images[0]
                                cover_data = zf.read(cover)
                                cover_ext = cover.lower()
                    else:
                        from config import TOOL_7Z
                        import subprocess
                        cmd = [TOOL_7Z, 'l', '-ba', '-slt', file_path]
                        startupinfo = None
                        if os.name == 'nt':
                            startupinfo = subprocess.STARTUPINFO()
                            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                        
                        output = subprocess.check_output(cmd, startupinfo=startupinfo, text=True, errors='ignore')
                        images = [line[7:].strip() for line in output.splitlines() if line.startswith('Path = ') and line.lower().endswith(img_exts) and '__MACOSX' not in line]
                        images.sort()
                        if images:
                            cover = images[0]
                            cmd_ext = [TOOL_7Z, 'e', '-so', file_path, cover]
                            cover_data = subprocess.check_output(cmd_ext, startupinfo=startupinfo)
                            cover_ext = cover.lower()
                except Exception as e:
                    print(f"Thumbnail extract error: {e}")
                    
                if cover_data:
                    self.send_response(200)
                    if cover_ext.endswith('.png'): mime = 'image/png'
                    elif cover_ext.endswith('.webp'): mime = 'image/webp'
                    elif cover_ext.endswith('.gif'): mime = 'image/gif'
                    else: mime = 'image/jpeg'
                    self.send_header("Content-type", mime)
                    self.send_header("Content-Length", str(len(cover_data)))
                    self.send_header("Cache-Control", "public, max-age=86400") # 앱에 캐시 처리 지시
                    self.end_headers()
                    self.wfile.write(cover_data)
                else:
                    self.send_error(404, "Thumbnail not found")

            def _serve_stream_feed(self, file_path):
                if not os.path.exists(file_path):
                    self.send_error(404, "File not found")
                    return
                
                ext = file_path.lower().split('.')[-1]
                img_exts = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
                images = []
                
                try:
                    import zipfile
                    if ext in ['zip', 'cbz']:
                        with zipfile.ZipFile(file_path, 'r') as zf:
                            images = [f for f in zf.namelist() if f.lower().endswith(img_exts) and '__MACOSX' not in f]
                    else:
                        from config import TOOL_7Z
                        import subprocess
                        cmd = [TOOL_7Z, 'l', '-ba', '-slt', file_path]
                        startupinfo = None
                        if os.name == 'nt':
                            startupinfo = subprocess.STARTUPINFO()
                            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                        
                        output = subprocess.check_output(cmd, startupinfo=startupinfo, text=True, errors='ignore')
                        images = [line[7:].strip() for line in output.splitlines() if line.startswith('Path = ') and line.lower().endswith(img_exts) and '__MACOSX' not in line]
                except Exception as e:
                    print(f"Stream extract error: {e}")
                    self.send_error(500, "Archive read error")
                    return
                    
                images.sort()
                
                now_iso = datetime.datetime.utcnow().isoformat() + "Z"
                xml = ['<?xml version="1.0" encoding="UTF-8"?>']
                xml.append('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">')
                xml.append(f'<id>urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, file_path + "_stream")}</id>')
                xml.append(f'<title>{html.escape(os.path.basename(file_path))} - Pages</title>')
                xml.append(f'<updated>{now_iso}</updated>')
                
                encoded_file = urllib.parse.quote(file_path)
                for i, img in enumerate(images):
                    encoded_img = urllib.parse.quote(img)
                    page_url = f"/page?file={encoded_file}&amp;page={encoded_img}"
                    
                    xml.append('<entry>')
                    xml.append(f'<title>Page {i+1}</title>')
                    xml.append(f'<id>urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, file_path + img)}</id>')
                    xml.append(f'<updated>{now_iso}</updated>')
                    
                    img_ext = img.lower().split('.')[-1]
                    mime = 'image/jpeg'
                    if img_ext == 'png': mime = 'image/png'
                    elif img_ext == 'webp': mime = 'image/webp'
                    elif img_ext == 'gif': mime = 'image/gif'
                    
                    xml.append(f'<link rel="http://opds-spec.org/acquisition" href="{page_url}" type="{mime}" />')
                    xml.append('</entry>')
                    
                xml.append('</feed>')
                self.send_response(200)
                self.send_header("Content-type", "application/atom+xml; charset=utf-8")
                self.end_headers()
                self.wfile.write("\n".join(xml).encode('utf-8'))

            def _serve_page(self, file_path, page_name=None, page_num=None):
                if not os.path.exists(file_path):
                    self.send_error(404, "File not found")
                    return
                
                ext = file_path.lower().split('.')[-1]
                img_data = None
                img_exts = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
                
                try:
                    images = []
                    import zipfile
                    if ext in ['zip', 'cbz']:
                        with zipfile.ZipFile(file_path, 'r') as zf:
                            images = [f for f in zf.namelist() if f.lower().endswith(img_exts) and '__MACOSX' not in f]
                            images.sort()
                            
                            target_name = page_name
                            if page_num is not None:
                                idx = int(page_num)
                                if 0 <= idx < len(images):
                                    target_name = images[idx]
                                    
                            if target_name:
                                img_data = zf.read(target_name)
                                img_ext = target_name.lower().split('.')[-1]
                    else:
                        from config import TOOL_7Z
                        import subprocess
                        cmd = [TOOL_7Z, 'l', '-ba', '-slt', file_path]
                        startupinfo = None
                        if os.name == 'nt':
                            startupinfo = subprocess.STARTUPINFO()
                            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                        output = subprocess.check_output(cmd, startupinfo=startupinfo, text=True, errors='ignore')
                        images = [line[7:].strip() for line in output.splitlines() if line.startswith('Path = ') and line.lower().endswith(img_exts) and '__MACOSX' not in line]
                        images.sort()
                        
                        target_name = page_name
                        if page_num is not None:
                            idx = int(page_num)
                            if 0 <= idx < len(images):
                                target_name = images[idx]
                                
                        if target_name:
                            cmd_e = [TOOL_7Z, 'e', '-so', file_path, target_name]
                            img_data = subprocess.check_output(cmd_e, startupinfo=startupinfo)
                            img_ext = target_name.lower().split('.')[-1]
                except Exception as e:
                    print(f"Page extract error: {e}")
                    
                if img_data:
                    self.send_response(200)
                    mime = 'image/jpeg'
                    if 'img_ext' in locals():
                        if img_ext == 'png': mime = 'image/png'
                        elif img_ext == 'webp': mime = 'image/webp'
                        elif img_ext == 'gif': mime = 'image/gif'
                    self.send_header("Content-type", mime)
                    self.send_header("Content-Length", str(len(img_data)))
                    self.send_header("Cache-Control", "public, max-age=86400") 
                    self.end_headers()
                    self.wfile.write(img_data)
                else:
                    self.send_error(404, "Page not found")

        # 포트 변경 및 재시작 시 발생하는 Address already in use 에러 방지
        class ReusableTCPServer(socketserver.ThreadingTCPServer):
            allow_reuse_address = True

        try:
            # 멀티 스레드 및 포트 재사용 서버 적용
            self.httpd = ReusableTCPServer(("", self.port), OPDSHandler)
            self.httpd.daemon_threads = True
            
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
                s.close()
            except Exception:
                local_ip = "127.0.0.1"
                
            self.log_signal.emit(f"[OPDS] Server listening at http://{local_ip}:{self.port}/opds")
            self.httpd.serve_forever()
        except Exception as e:
            self.error_signal.emit(f"[OPDS] Error: {str(e)}")

    def _stop_server(self):
        if self.httpd:
            # serve_forever()를 중단
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None