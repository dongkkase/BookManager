from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                             QPushButton, QSpinBox, QTextEdit, QGroupBox, QGridLayout, QLineEdit, QApplication)
from PyQt6.QtCore import pyqtSlot, Qt

# 프로젝트 최상위의 servers 패키지에서 ServerManager를 임포트
from servers.manager import ServerManager
from config import load_config, save_config

class TabSharing(QWidget):
    def __init__(self, main_app=None):
        super().__init__()
        self.main_app = main_app
        self.config = self.main_app.config if self.main_app else load_config()
        # 여러 프로토콜을 중앙에서 관리하는 매니저 인스턴스
        self.server_manager = ServerManager()
        self.init_ui()

    def init_ui(self):
        import qtawesome as qta

        main_layout = QHBoxLayout()
        main_layout.setContentsMargins(15, 15, 15, 15)
        main_layout.setSpacing(20)
        
        left_layout = QVBoxLayout()
        left_layout.setSpacing(15)

        group_style = """
            QGroupBox { 
                font-size: 13px;
                font-weight: bold; 
                border: 1px solid #3f3f46; 
                border-radius: 8px; 
                margin-top: 15px; 
                padding-top: 20px; 
                background-color: #18181b; 
            }
            QGroupBox::title { 
                subcontrol-origin: margin; 
                subcontrol-position: top left;
                left: 15px; 
                padding: 0 5px; 
                color: #60a5fa; 
            }
        """

        input_style = """
            QLineEdit, QSpinBox { 
                background-color: #09090b; 
                color: #f4f4f5; 
                border: 1px solid #27272a; 
                border-radius: 6px; 
                padding: 8px 12px; 
                font-size: 13px;
            }
            QLineEdit:focus, QSpinBox:focus { 
                border: 1px solid #3b82f6; 
                background-color: #18181b; 
            }
        """

        copy_btn_style = """
            QPushButton { 
                background-color: #27272a; 
                color: #f4f4f5; 
                border: 1px solid #3f3f46; 
                border-radius: 6px; 
                padding: 8px 15px; 
                font-weight: bold; 
            }
            QPushButton:hover { 
                background-color: #3f3f46; 
                border: 1px solid #52525b; 
            }
            QPushButton:pressed {
                background-color: #52525b;
            }
        """
        
        self.setStyleSheet(input_style)

        # --- OPDS 서버 설정 그룹 (Panels 지원) ---
        self.opds_group = QGroupBox("OPDS 공유 서버 (Panels 지원)")
        self.opds_group.setStyleSheet(group_style)
        opds_vlayout = QVBoxLayout()
        opds_vlayout.setContentsMargins(15, 10, 15, 15)
        opds_vlayout.setSpacing(12)
        
        opds_layout = QHBoxLayout()
        
        self.lbl_opds_port = QLabel("포트:")
        self.lbl_opds_port.setStyleSheet("color: #a1a1aa; font-weight: bold;")
        opds_layout.addWidget(self.lbl_opds_port)
        
        self.opds_port_spin = QSpinBox()
        self.opds_port_spin.setRange(1024, 65535)
        self.opds_port_spin.setValue(self.config.get("opds_port", 8080))
        self.opds_port_spin.valueChanged.connect(self.save_ports)
        self.opds_port_spin.setFixedWidth(100)
        opds_layout.addWidget(self.opds_port_spin)
        
        opds_layout.addSpacing(10)
        
        self.btn_opds_toggle = QPushButton("OPDS 서버 켜기")
        self.btn_opds_toggle.setObjectName("actionBtnGreen")
        self.btn_opds_toggle.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_opds_toggle.setIcon(qta.icon('fa5s.power-off', color='white'))
        self.btn_opds_toggle.clicked.connect(lambda: self.toggle_server("OPDS", self.opds_port_spin, self.btn_opds_toggle))
        opds_layout.addWidget(self.btn_opds_toggle)
        
        opds_layout.addStretch()
        opds_vlayout.addLayout(opds_layout)
        
        opds_url_layout = QHBoxLayout()
        self.opds_url_label = QLineEdit()
        self.opds_url_label.setReadOnly(True)
        opds_url_layout.addWidget(self.opds_url_label)
        
        self.btn_opds_copy = QPushButton("URL 복사")
        self.btn_opds_copy.setIcon(qta.icon('fa5s.copy', color='#f4f4f5'))
        self.btn_opds_copy.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_opds_copy.setStyleSheet(copy_btn_style)
        self.btn_opds_copy.clicked.connect(lambda: QApplication.clipboard().setText(self.opds_url_label.text()))
        opds_url_layout.addWidget(self.btn_opds_copy)
        opds_vlayout.addLayout(opds_url_layout)
        
        self.opds_group.setLayout(opds_vlayout)
        left_layout.addWidget(self.opds_group)

        # --- WebDAV 서버 설정 그룹 ---
        self.webdav_group = QGroupBox("WebDAV 공유 서버 (ComicGlass 지원)")
        self.webdav_group.setStyleSheet(group_style)
        webdav_vlayout = QVBoxLayout()
        webdav_vlayout.setContentsMargins(15, 10, 15, 15)
        webdav_vlayout.setSpacing(12)
        
        self.lbl_webdav_desc = QLabel("※ 앱에서 접속 시 사용할 계정을 설정하세요.")
        self.lbl_webdav_desc.setStyleSheet("color: #a1a1aa; font-size: 12px;")
        webdav_vlayout.addWidget(self.lbl_webdav_desc)
        
        webdav_auth_layout = QHBoxLayout()
        
        self.lbl_webdav_id = QLabel("아이디:")
        self.lbl_webdav_id.setStyleSheet("color: #a1a1aa; font-weight: bold;")
        self.webdav_id_input = QLineEdit(self.config.get("webdav_username", "user"))
        self.webdav_id_input.setFixedWidth(110)
        self.webdav_id_input.textChanged.connect(self.save_ports)
        
        self.lbl_webdav_pw = QLabel("비밀번호:")
        self.lbl_webdav_pw.setStyleSheet("color: #a1a1aa; font-weight: bold;")
        self.webdav_pw_input = QLineEdit(self.config.get("webdav_password", "1234"))
        self.webdav_pw_input.setFixedWidth(110)
        self.webdav_pw_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.webdav_pw_input.textChanged.connect(self.save_ports)
        
        self.webdav_pw_action = self.webdav_pw_input.addAction(
            qta.icon('fa5s.eye-slash', color='#a1a1aa'),
            QLineEdit.ActionPosition.TrailingPosition
        )
        self.webdav_pw_action.triggered.connect(self.toggle_webdav_pw_visibility)
        
        webdav_auth_layout.addWidget(self.lbl_webdav_id)
        webdav_auth_layout.addWidget(self.webdav_id_input)
        webdav_auth_layout.addSpacing(10)
        webdav_auth_layout.addWidget(self.lbl_webdav_pw)
        webdav_auth_layout.addWidget(self.webdav_pw_input)
        webdav_auth_layout.addStretch()
        webdav_vlayout.addLayout(webdav_auth_layout)

        webdav_layout = QHBoxLayout()
        
        self.lbl_webdav_port = QLabel("포트:")
        self.lbl_webdav_port.setStyleSheet("color: #a1a1aa; font-weight: bold;")
        webdav_layout.addWidget(self.lbl_webdav_port)
        
        self.webdav_port_spin = QSpinBox()
        self.webdav_port_spin.setRange(1024, 65535)
        self.webdav_port_spin.setValue(self.config.get("webdav_port", 8081))
        self.webdav_port_spin.valueChanged.connect(self.save_ports)
        self.webdav_port_spin.setFixedWidth(100)
        webdav_layout.addWidget(self.webdav_port_spin)
        
        webdav_layout.addSpacing(10)
        
        self.btn_webdav_toggle = QPushButton("WebDAV 서버 켜기")
        self.btn_webdav_toggle.setObjectName("actionBtnGreen")
        self.btn_webdav_toggle.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_webdav_toggle.setIcon(qta.icon('fa5s.power-off', color='white'))
        self.btn_webdav_toggle.clicked.connect(lambda: self.toggle_server("WebDAV", self.webdav_port_spin, self.btn_webdav_toggle))
        webdav_layout.addWidget(self.btn_webdav_toggle)
        
        webdav_layout.addStretch()
        webdav_vlayout.addLayout(webdav_layout)
        
        webdav_url_layout = QHBoxLayout()
        self.webdav_url_label = QLineEdit()
        self.webdav_url_label.setReadOnly(True)
        webdav_url_layout.addWidget(self.webdav_url_label)
        
        self.btn_webdav_copy = QPushButton("URL 복사")
        self.btn_webdav_copy.setIcon(qta.icon('fa5s.copy', color='#f4f4f5'))
        self.btn_webdav_copy.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_webdav_copy.setStyleSheet(copy_btn_style)
        self.btn_webdav_copy.clicked.connect(lambda: QApplication.clipboard().setText(self.webdav_url_label.text()))
        webdav_url_layout.addWidget(self.btn_webdav_copy)
        webdav_vlayout.addLayout(webdav_url_layout)
        
        self.webdav_group.setLayout(webdav_vlayout)
        left_layout.addWidget(self.webdav_group)

        left_layout.addStretch()
        
        main_layout.addLayout(left_layout, 1)

        # --- 서버 상태 로그 출력 ---
        self.log_group = QGroupBox("서버 상태 로그")
        self.log_group.setStyleSheet(group_style)
        log_layout = QVBoxLayout()
        log_layout.setContentsMargins(15, 15, 15, 15)
        self.log_console = QTextEdit()
        self.log_console.setReadOnly(True)
        self.log_console.setStyleSheet("""
            QTextEdit {
                font-family: Consolas, monospace;
                font-size: 12px;
                background-color: #09090b;
                color: #d4d4d8;
                border: 1px solid #27272a;
                border-radius: 6px;
                padding: 10px;
            }
        """)
        log_layout.addWidget(self.log_console)
        self.log_group.setLayout(log_layout)
        main_layout.addWidget(self.log_group, 1)

        self.setLayout(main_layout)
        self.update_urls()

    def toggle_webdav_pw_visibility(self):
        import qtawesome as qta
        if self.webdav_pw_input.echoMode() == QLineEdit.EchoMode.Password:
            self.webdav_pw_input.setEchoMode(QLineEdit.EchoMode.Normal)
            self.webdav_pw_action.setIcon(qta.icon('fa5s.eye', color='#a1a1aa'))
        else:
            self.webdav_pw_input.setEchoMode(QLineEdit.EchoMode.Password)
            self.webdav_pw_action.setIcon(qta.icon('fa5s.eye-slash', color='#a1a1aa'))

    def get_local_ip(self):
        try:
            import socket
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except Exception:
            return "127.0.0.1"

    def retranslate_ui(self, t, lang):
        self.i18n_t = t
        self.lang = lang
        self.opds_group.setTitle(t.get("tab_sharing_opds_title", "OPDS 공유 서버 (Panels 지원)"))
        self.webdav_group.setTitle(t.get("tab_sharing_webdav_title", "WebDAV 공유 서버 (ComicGlass 지원)"))
        self.log_group.setTitle(t.get("tab_sharing_log_title", "서버 상태 로그"))
        
        self.lbl_opds_port.setText(t.get("tab_sharing_port", "포트:"))
        self.lbl_webdav_port.setText(t.get("tab_sharing_port", "포트:"))
        self.btn_opds_copy.setText(t.get("tab_sharing_copy", "URL 복사"))
        self.btn_webdav_copy.setText(t.get("tab_sharing_copy", "URL 복사"))
        self.lbl_webdav_desc.setText(t.get("tab_sharing_webdav_desc", "※ 앱에서 접속 시 사용할 계정을 설정하세요."))
        self.lbl_webdav_id.setText(t.get("tab_sharing_webdav_id", "아이디:"))
        self.lbl_webdav_pw.setText(t.get("tab_sharing_webdav_pw", "비밀번호:"))
        
        self._update_btn_text(self.btn_opds_toggle, "OPDS")
        self._update_btn_text(self.btn_webdav_toggle, "WebDAV")

    def _update_btn_text(self, btn, protocol):
        import qtawesome as qta
        t = getattr(self, 'i18n_t', {})
        is_running = protocol in self.server_manager.servers and self.server_manager.servers[protocol].is_running
        
        if is_running:
            turn_off_text = t.get("tab_sharing_turn_off", f"{protocol} 서버 끄기")
            btn.setText(turn_off_text.replace("{protocol}", protocol))
            btn.setIcon(qta.icon('fa5s.stop-circle', color='white'))
        else:
            turn_on_text = t.get("tab_sharing_turn_on", f"{protocol} 서버 켜기")
            btn.setText(turn_on_text.replace("{protocol}", protocol))
            btn.setIcon(qta.icon('fa5s.power-off', color='white'))

    def update_urls(self):
        import os
        ip = self.get_local_ip()
        cert_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "cert.pem")
        scheme = "https" if os.path.exists(cert_path) else "http"
        self.opds_url_label.setText(f"{scheme}://{ip}:{self.opds_port_spin.value()}/opds")
        if hasattr(self, 'webdav_url_label'):
            self.webdav_url_label.setText(f"http://{ip}:{self.webdav_port_spin.value()}/")

    def save_ports(self):
        self.config["opds_port"] = self.opds_port_spin.value()
        if hasattr(self, 'webdav_port_spin'):
            self.config["webdav_port"] = self.webdav_port_spin.value()
            self.config["webdav_username"] = self.webdav_id_input.text().strip() or "user"
            self.config["webdav_password"] = self.webdav_pw_input.text().strip() or "1234"
        save_config(self.config)
        self.update_urls()

    def toggle_server(self, protocol, port_spin, btn_toggle):
        """버튼 하나로 특정 프로토콜 서버를 켜거나 끄는 로직"""
        import qtawesome as qta
        t = getattr(self, 'i18n_t', {})
        turn_on_template = t.get("tab_sharing_turn_on", "{protocol} 서버 켜기")
        turn_off_template = t.get("tab_sharing_turn_off", "{protocol} 서버 끄기")
        
        is_turning_on = not (protocol in self.server_manager.servers and self.server_manager.servers[protocol].is_running)

        if is_turning_on:
            port = port_spin.value()
            success, msg = self.server_manager.start_server(protocol, port, "")
            
            if success:
                # 매니저에 생성된 스레드의 시그널을 UI 로그창과 연결
                server_thread = self.server_manager.servers.get(protocol)
                if server_thread:
                    server_thread.log_signal.connect(self.append_log)
                    server_thread.error_signal.connect(self.append_error)
                    
                btn_toggle.setText(turn_off_template.replace("{protocol}", protocol))
                btn_toggle.setObjectName("actionBtnCancel")
                btn_toggle.setIcon(qta.icon('fa5s.stop-circle', color='white'))
                btn_toggle.style().unpolish(btn_toggle)
                btn_toggle.style().polish(btn_toggle)
                port_spin.setEnabled(False)
                if protocol == "WebDAV" and hasattr(self, 'webdav_id_input'):
                    self.webdav_id_input.setEnabled(False)
                    self.webdav_pw_input.setEnabled(False)
                self.append_log(msg)
                if self.main_app and hasattr(self.main_app, 'update_server_status_icon'):
                    self.main_app.update_server_status_icon()
            else:
                self.append_error(msg)
        else:
            success = self.server_manager.stop_server(protocol)
            if success:
                btn_toggle.setText(turn_on_template.replace("{protocol}", protocol))
                btn_toggle.setObjectName("actionBtnGreen")
                btn_toggle.setIcon(qta.icon('fa5s.power-off', color='white'))
                btn_toggle.style().unpolish(btn_toggle)
                btn_toggle.style().polish(btn_toggle)
                port_spin.setEnabled(True)
                if protocol == "WebDAV" and hasattr(self, 'webdav_id_input'):
                    self.webdav_id_input.setEnabled(True)
                    self.webdav_pw_input.setEnabled(True)
                msg_stopped = t.get("tab_sharing_msg_stopped", "{protocol} 서버가 성공적으로 중지되었습니다.")
                self.append_log(msg_stopped.replace("{protocol}", protocol))
                if self.main_app and hasattr(self.main_app, 'update_server_status_icon'):
                    self.main_app.update_server_status_icon()
            else:
                msg_fail = t.get("tab_sharing_msg_stop_fail", "{protocol} 서버 중지에 실패했습니다.")
                self.append_error(msg_fail.replace("{protocol}", protocol))

    @pyqtSlot(str)
    def append_log(self, msg):
        self.log_console.append(f"[INFO] {msg}")

    @pyqtSlot(str)
    def append_error(self, msg):
        self.log_console.append(f"<font color='red'>[ERROR] {msg}</font>")