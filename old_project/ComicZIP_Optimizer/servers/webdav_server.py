import os
import re
import tempfile
import sys
import subprocess
import shutil
from .base import BaseServerThread
from config import load_config

class WebDAVServerThread(BaseServerThread):
    def __init__(self, port: int, root_path: str):
        super().__init__(port, root_path)
        self.server = None
        self.vroot_dir = None

    def stop(self):
        self.is_running = False
        if self.server:
            try:
                self.server.stop()
            except:
                pass
        self.terminate()
        self.wait()
        
        # 가상 루트 폴더 정리 (Junction 링크 안전 삭제)
        if self.vroot_dir and os.path.exists(self.vroot_dir):
            try:
                for item in os.listdir(self.vroot_dir):
                    item_path = os.path.join(self.vroot_dir, item)
                    if os.path.isdir(item_path):
                        os.rmdir(item_path) # 원본 파일은 삭제되지 않음
                shutil.rmtree(self.vroot_dir)
            except Exception:
                pass
                
        self.log_signal.emit(f"WebDAV 서버가 성공적으로 중지되었습니다. (포트 {self.port})")

    def _start_server(self):
        try:
            from wsgidav.wsgidav_app import WsgiDAVApp
            from cheroot import wsgi
        except ImportError as e:
            self.error_signal.emit(f"WebDAV 라이브러리 로드 실패: {e}\n터미널에서 'pip install wsgidav cheroot' 명령어를 실행해주세요.")
            return

        # 이중 안전장치: 스레드 내부에서도 sys.stdout/stderr 검증
        # WSGI 프레임워크가 클라이언트 요청 처리 중 로그를 쓰려다 발생하는 NoneType 에러 방어
        if sys.stdout is None: sys.stdout = open(os.devnull, "w")
        if sys.stderr is None: sys.stderr = open(os.devnull, "w")

        config = load_config()
        lib_folders = config.get("dup_check_folders", [])
        
        if not lib_folders:
            self.error_signal.emit("공유할 라이브러리 폴더가 없습니다. [폴더] 탭의 ⚙️ 설정에서 라이브러리를 먼저 추가해주세요.")
            return
            
        # WebDAV는 루트('/') 접근 시 404가 발생하지 않도록 루트 매핑이 필수입니다.
        # 여러 개의 라이브러리 폴더를 지원하기 위해 임시 가상 루트 디렉토리를 만들고 Junction 링크를 연결합니다.
        try:
            self.vroot_dir = tempfile.mkdtemp(prefix="comiczip_webdav_")
            
            for idx, lib_path in enumerate(lib_folders):
                if os.path.exists(lib_path):
                    share_name = os.path.basename(lib_path)
                    if not share_name:
                        share_name = f"Library_{idx+1}"
                    share_name = re.sub(r'[\\/:*?"<>|]', '_', share_name)
                    
                    base_share = share_name
                    counter = 1
                    link_path = os.path.join(self.vroot_dir, share_name)
                    while os.path.exists(link_path):
                        share_name = f"{base_share}_{counter}"
                        link_path = os.path.join(self.vroot_dir, share_name)
                        counter += 1
                        
                    # Windows Junction(디렉토리 교차점) 생성 (관리자 권한 불필요)
                    creationflags = 0x08000000 if os.name == 'nt' else 0
                    subprocess.run(f'mklink /J "{link_path}" "{lib_path}"', shell=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creationflags)
        except Exception as e:
            self.error_signal.emit(f"가상 루트 폴더 생성 실패: {e}")
            return

        provider_mapping = {
            "/": self.vroot_dir
        }

        username = config.get("webdav_username", "user")
        password = config.get("webdav_password", "1234")
        
        webdav_config = {
            "host": "0.0.0.0",
            "port": self.port,
            "provider_mapping": provider_mapping,
            "simple_dc": {
                "user_mapping": {
                    "*": { username: {"password": password} }
                }
            },
            "dir_browser": {
                "enable": False
            },
            "logging": { "enable": False }
        }

        try:
            app = WsgiDAVApp(webdav_config)
            self.server = wsgi.Server(
                bind_addr=("0.0.0.0", self.port),
                wsgi_app=app,
            )
            self.log_signal.emit(f"WebDAV 서버가 시작되었습니다. (포트: {self.port}, 계정: {username})")
            self.server.start()
        except Exception as e:
            self.error_signal.emit(f"WebDAV 서버 오류: {str(e)}")