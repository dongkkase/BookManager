from PyQt6.QtCore import QThread, pyqtSignal

class BaseServerThread(QThread):
    """
    모든 공유 서버(OPDS, WebDAV, API 등)의 기본이 되는 추상화 스레드 클래스입니다.
    """
    # 서버의 상태(로그 메시지 등)를 UI로 전달하는 시그널
    log_signal = pyqtSignal(str)
    error_signal = pyqtSignal(str)

    def __init__(self, port: int, root_path: str):
        super().__init__()
        self.port = port
        self.root_path = root_path
        self.is_running = False

    def run(self):
        """
        스레드가 시작되면 실행될 메인 로직입니다.
        하위 클래스에서 이 메서드를 오버라이드하여 실제 서버 구동(예: uvicorn, http.server 등)을 구현합니다.
        """
        self.is_running = True
        self.log_signal.emit(f"Server started on port {self.port}")
        self._start_server()

    def _start_server(self):
        """하위 클래스에서 구현해야 할 실제 서버 시작 로직"""
        raise NotImplementedError("Subclasses must implement _start_server()")

    def stop(self):
        """
        서버를 안전하게 종료합니다.
        """
        self.is_running = False
        self._stop_server()
        self.log_signal.emit(f"Server stopped on port {self.port}")
        self.quit()
        self.wait()

    def _stop_server(self):
        """하위 클래스에서 구현해야 할 실제 서버 종료 로직"""
        raise NotImplementedError("Subclasses must implement _stop_server()")