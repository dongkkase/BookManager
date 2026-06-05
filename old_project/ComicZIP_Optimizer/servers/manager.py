from .opds_server import OPDSServerThread
from .webdav_server import WebDAVServerThread
import socket

class ServerManager:
    """
    프로그램 내 구동되는 모든 프로토콜 서버의 인스턴스를 관리합니다.
    """
    def __init__(self):
        self.servers = {}

    def is_port_in_use(self, port: int) -> bool:
        """지정된 포트가 이미 사용 중인지 검사합니다."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', port)) == 0

    def start_server(self, protocol: str, port: int, root_path: str):
        """
        지정된 프로토콜의 서버를 시작합니다.
        """
        if protocol in self.servers and self.servers[protocol].is_running:
            return False, f"{protocol} server is already running."
            
        # 포트 충돌 선제 검사
        if self.is_port_in_use(port):
            from core.i18n import get_i18n
            from config import load_config
            lang = load_config().get("language", load_config().get("lang", "ko"))
            msg = get_i18n().get(lang, get_i18n()["ko"]).get("msg_port_in_use", "Port {} is already in use.").format(port)
            return False, msg

        server_thread = None
        if protocol == "OPDS":
            server_thread = OPDSServerThread(port=port, root_path=root_path)
        elif protocol == "WebDAV":
            server_thread = WebDAVServerThread(port=port, root_path=root_path)
        else:
            return False, f"Unsupported protocol: {protocol}"

        if server_thread:
            # 디버깅용 콘솔 출력 연결
            server_thread.log_signal.connect(lambda msg: print(f"[Server Log] {msg}"))
            server_thread.error_signal.connect(lambda msg: print(f"[Server Error] {msg}"))
            
            self.servers[protocol] = server_thread
            server_thread.start()
            return True, f"{protocol} server started successfully."
            
        return False, "Failed to initialize server."

    def stop_server(self, protocol: str):
        """
        지정된 프로토콜의 서버를 중지합니다.
        """
        if protocol in self.servers:
            self.servers[protocol].stop()
            del self.servers[protocol]
            return True
        return False

    def stop_all(self):
        for protocol in list(self.servers.keys()):
            self.stop_server(protocol)