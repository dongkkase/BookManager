import os
import threading
import webbrowser
from pathlib import Path

from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLabel, 
    QProgressBar, QFileDialog, QMessageBox, QTextBrowser, QTabWidget,
    QScrollArea, QFrame
)
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QIcon

import qtawesome as qta 

from config import load_config, save_config, get_resource_path, CURRENT_VERSION, TOOL_7Z
from utils import play_complete_sound
from ui.signals import WorkerSignals
from ui.dialogs import LogDialog, SettingsDialog
from ui.widgets import Toast 
from tasks.update_task import VersionCheckTask, ReleaseNotesTask
from tasks.load_task import OrganizerLoadTask, FileLoadTask
from tasks.organize_task import OrganizerProcessTask
from tasks.rename_task import RenameTask

from ui.tabs.tab1_organizer import Tab1Organizer
from ui.tabs.tab2_renamer import Tab2Renamer
from ui.tabs.tab3_metadata import Tab3Metadata
from ui.tabs.tab_folder import TabFolder
from ui.tabs.tab_sharing import TabSharing

from core.i18n import get_i18n

class RenamerApp(QMainWindow):
    def __init__(self):
        super().__init__()
        
        self.config = load_config()
        self.lang = self.config.get("lang", "ko")
        
        self.signals = WorkerSignals()
        self.signals.progress.connect(self.update_progress)
        self.signals.load_done.connect(self.on_renamer_loaded)
        self.signals.rename_done.connect(self.finish_process_rename)
        self.signals.org_load_done.connect(self.on_organizer_loaded)
        self.signals.org_process_done.connect(self.finish_process_org)
        self.signals.version_checked.connect(self.on_version_checked)
        self.signals.release_notes_loaded.connect(self.on_release_notes_loaded)
        
        self.signals.update_ready.connect(self.on_update_ready)

        self.signals.image_loaded.connect(self.route_image_loaded)
        
        self.is_processing = False
        self.active_task = None
        self.latest_version_found = None 
        self.latest_version_url = "https://github.com/dongkkase/ComicZIP_Optimizer/releases"
        
        self.seven_zip_path = TOOL_7Z
        self.format_keys = ["none", "zip", "cbz", "cbr", "7z"]
        
        self.is_all_checked = True 
        
        window_width = self.config.get("width", 1150)
        window_height = self.config.get("height", 800)
        self.setWindowTitle(f"ComicZIP Optimizer v{CURRENT_VERSION}")
        self.setMinimumSize(1200, 750) 
        self.resize(window_width, window_height)
        if self.config.get("is_maximized", False): self.showMaximized()
        
        icon_path = get_resource_path('app.ico')
        if os.path.exists(icon_path): self.setWindowIcon(QIcon(icon_path))
        
        self.i18n = get_i18n()

        self.setup_ui()
        self.apply_language()
        self.apply_dark_theme()
        
        self.setAcceptDrops(True)
        self.check_for_updates()
        threading.Thread(target=ReleaseNotesTask(self.signals).run, daemon=True).start()

        last_tab_index = self.config.get("last_tab_index", 0)
        self.tabs.setCurrentIndex(last_tab_index)

    def route_image_loaded(self, target_id, arc_path, img_data):
        current_tab = self.tabs.currentWidget()
        if hasattr(current_tab, 'render_image'):
            current_tab.render_image(target_id, arc_path, img_data)

    def check_for_updates(self):
        threading.Thread(target=VersionCheckTask(self.signals).run, daemon=True).start()

    def update_progress(self, percent, msg):
        self.progress_bar.setValue(percent)
        self.lbl_status.setText(msg)

    def on_version_checked(self, latest_version):
        self.latest_version_found = latest_version
        self.update_version_button_ui()
    
    def on_release_notes_loaded(self, release_list):
        from PyQt6.QtWidgets import QFrame, QLabel, QVBoxLayout
        from PyQt6.QtCore import Qt

        if not release_list:
            error_lbl = QLabel(self.i18n[self.lang].get("msg_release_load_fail", "Failed to load release notes."))
            error_lbl.setStyleSheet(f"color: #aaaaaa; font-family: {self.config.get('font_family_str', 'Jua')};")
            self.release_layout.addWidget(error_lbl)
            self.release_layout.addStretch()
            return

        for item in release_list:
            card = QFrame()
            card.setStyleSheet("""
                QFrame {
                    background-color: #2b2b2b;
                    border: 1px solid #444444;
                    border-radius: 15px;
                }
            """)
            card_layout = QVBoxLayout(card)
            card_layout.setContentsMargins(20, 20, 20, 20)

            title_lbl = QLabel(f"📦 {item.get('name', '')} <span style='color:#aaaaaa; font-size:13px;'>({item.get('date', '')})</span>")
            title_lbl.setTextFormat(Qt.TextFormat.RichText)
            title_lbl.setStyleSheet(f"color: #3498DB; font-size: 20px; font-weight: bold; border: none; font-family: {self.config.get('font_family_str', 'Jua')};")
            
            body_lbl = QLabel(item.get('body', ''))
            body_lbl.setTextFormat(Qt.TextFormat.RichText)
            body_lbl.setWordWrap(True) 
            body_lbl.setOpenExternalLinks(True)
            body_lbl.setStyleSheet(f"color: #e0e0e0; font-size: 14px; border: none; font-family: {self.config.get('font_family_str', 'Jua')}; line-height: 1.5;")

            card_layout.addWidget(title_lbl)
            card_layout.addWidget(body_lbl)
            self.release_layout.addWidget(card)

        self.release_layout.addStretch()

    def update_version_button_ui(self):
        if self.latest_version_found:
            update_msg = self.i18n[self.lang].get("msg_update_available", "").format(CURRENT_VERSION, self.latest_version_found)
            self.btn_version.setText(update_msg)
            self.btn_version.setIcon(qta.icon('fa5s.gift', color='white'))
            self.btn_version.setObjectName("versionBtnUpdate")
            self.btn_version.style().unpolish(self.btn_version)
            self.btn_version.style().polish(self.btn_version)
            self.latest_version_url = f"https://github.com/dongkkase/ComicZIP_Optimizer/releases/download/v{self.latest_version_found}/ComicZIP_Optimizer.zip"
        else:
            latest_msg = self.i18n[self.lang].get("msg_latest_version", "").format(CURRENT_VERSION)
            self.btn_version.setText(latest_msg)
            self.btn_version.setIcon(qta.icon('fa5s.check-circle', color='white'))
            self.btn_version.setObjectName("versionBtn")
            self.btn_version.style().unpolish(self.btn_version)
            self.btn_version.style().polish(self.btn_version)
            self.latest_version_url = "https://github.com/dongkkase/ComicZIP_Optimizer/releases"

    def open_update_link(self):
        if getattr(self, 'latest_version_url', None):
            if "download" in self.latest_version_url:
                reply = QMessageBox.question(
                    self, 
                    self.i18n[self.lang].get("msg_update_prompt_title"), 
                    self.i18n[self.lang].get("msg_update_prompt"), 
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
                )
                if reply == QMessageBox.StandardButton.Yes:
                    self.start_auto_update()
            else:
                webbrowser.open(self.latest_version_url)

    def start_auto_update(self):
        from tasks.update_task import AutoUpdateTask
        
        self.btn_version.setEnabled(False)
        self.progress_bar.show()
        self.progress_bar.setValue(0)
        self.lbl_status.setText(self.i18n[self.lang].get("msg_prep_update", "Preparing update..."))
        
        task = AutoUpdateTask(self.latest_version_url, self.signals)
        threading.Thread(target=task.run, daemon=True).start()

    def on_update_ready(self, script_path):
        import subprocess
        import platform
        
        if platform.system() == "Windows":
            subprocess.Popen([script_path], shell=True)
        else:
            subprocess.Popen(["bash", script_path])
            
        self.close()
        
    def open_issue_link(self):
        webbrowser.open("https://github.com/dongkkase/ComicZIP_Optimizer/issues")

    def setup_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(15, 15, 15, 15)

        toolbar_layout = QHBoxLayout()
        
        self.btn_add_folder = QPushButton()
        self.btn_add_folder.setIcon(qta.icon('fa5s.folder-open', color='white'))
        self.btn_add_folder.setCursor(Qt.CursorShape.PointingHandCursor) 
        self.btn_add_folder.clicked.connect(self.add_folder)
        
        self.btn_add_file = QPushButton()
        self.btn_add_file.setIcon(qta.icon('fa5s.file-signature', color='white'))
        self.btn_add_file.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_add_file.clicked.connect(self.add_file)
        
        self.btn_remove_sel = QPushButton()
        self.btn_remove_sel.setIcon(qta.icon('fa5s.minus-circle', color='white'))
        self.btn_remove_sel.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_remove_sel.setObjectName("dangerBtn")
        self.btn_remove_sel.clicked.connect(self.remove_selected)
        
        self.btn_clear_all = QPushButton()
        self.btn_clear_all.setIcon(qta.icon('fa5s.folder-minus', color='white'))
        self.btn_clear_all.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_clear_all.setObjectName("dangerBtn")
        self.btn_clear_all.clicked.connect(self.clear_list)

        self.btn_toggle_all = QPushButton()
        self.btn_toggle_all.setIcon(qta.icon('fa5s.check-square', color='white'))
        self.btn_toggle_all.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_toggle_all.clicked.connect(self.toggle_all_checkboxes)

        toolbar_layout.addWidget(self.btn_add_folder)
        toolbar_layout.addWidget(self.btn_add_file)
        toolbar_layout.addWidget(self.btn_remove_sel)
        toolbar_layout.addWidget(self.btn_clear_all)
        toolbar_layout.addWidget(self.btn_toggle_all)
        toolbar_layout.addStretch()

        self.btn_issue = QPushButton()
        self.btn_issue.setIcon(qta.icon('fa5s.bug', color='white'))
        self.btn_issue.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_issue.setObjectName("settingsBtn")
        self.btn_issue.clicked.connect(self.open_issue_link)
        toolbar_layout.addWidget(self.btn_issue)

        self.btn_version = QPushButton()
        self.btn_version.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_version.setObjectName("versionBtn")
        self.btn_version.clicked.connect(self.open_update_link)
        toolbar_layout.addWidget(self.btn_version)

        self.btn_settings = QPushButton()
        self.btn_settings.setIcon(qta.icon('fa5s.cog', color='white'))
        self.btn_settings.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_settings.setObjectName("settingsBtn")
        self.btn_settings.clicked.connect(self.open_settings)
        toolbar_layout.addWidget(self.btn_settings)

        main_layout.addLayout(toolbar_layout)

        self.tabs = QTabWidget()

        self.tab_folder = TabFolder(self)
        self.tab1 = Tab1Organizer(self)
        self.tab2 = Tab2Renamer(self)
        self.tab3 = Tab3Metadata(self)
        self.tab_sharing = TabSharing(self)
        self.tab_releases = QWidget()
        
        self.tabs.addTab(self.tab_folder, "폴더")
        self.tabs.addTab(self.tab1, "")
        self.tabs.addTab(self.tab2, "")
        self.tabs.addTab(self.tab3, "")
        self.tabs.addTab(self.tab_sharing, "공유 서버")
        self.tabs.addTab(self.tab_releases, "")
        self.tabs.currentChanged.connect(self.on_tab_changed)
        main_layout.addWidget(self.tabs, 1)

        # 🌟 에러가 났던 부분: t4_layout 선언 복구 완료
        t4_layout = QVBoxLayout(self.tab_releases)

        self.scroll_release = QScrollArea()
        self.scroll_release.setWidgetResizable(True)
        self.scroll_release.setStyleSheet("QScrollArea { border: none; background-color: transparent; }")
        
        self.release_content_widget = QWidget()
        self.release_content_widget.setStyleSheet("background-color: transparent;")
        self.release_layout = QVBoxLayout(self.release_content_widget)
        self.release_layout.setContentsMargins(15, 15, 15, 15)
        self.release_layout.setSpacing(20)
        
        self.scroll_release.setWidget(self.release_content_widget)
        t4_layout.addWidget(self.scroll_release)

        bottom_layout = QHBoxLayout()
        self.lbl_status = QLabel()
        self.lbl_status.setObjectName("statusLabel")
        
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(10)
        self.progress_bar.setFixedWidth(150)
        self.progress_bar.hide() 

        status_layout = QHBoxLayout()
        status_layout.setContentsMargins(0, 0, 0, 0)
        status_layout.setSpacing(10)  # 텍스트와 프로그레스 바 사이의 간격 지정
        
        self.lbl_server_status = QLabel()
        self.lbl_server_status.hide()
        status_layout.addWidget(self.lbl_server_status, alignment=Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        
        status_layout.addWidget(self.lbl_status, alignment=Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        status_layout.addWidget(self.progress_bar, alignment=Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        status_layout.addStretch()  # 남는 공간을 채워 요소들을 왼쪽으로 밀착시킴

        self.btn_run = QPushButton()
        self.btn_run.setIcon(qta.icon('fa5s.rocket', color='white'))
        self.btn_run.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_run.setObjectName("actionBtn")
        self.btn_run.setFixedHeight(45)
        self.btn_run.clicked.connect(self.start_process)

        bottom_layout.addLayout(status_layout)
        # bottom_layout.addStretch()  <- 기존에 있던 이 줄은 삭제합니다.
        bottom_layout.addWidget(self.btn_run)
        main_layout.addLayout(bottom_layout)

        from ui.widgets import DimOverlay
        self.lock_overlay = DimOverlay(self.tabs, show_spinner=True, text="작업을 진행 중입니다...")
        self.tabs.installEventFilter(self)

    def eventFilter(self, obj, event):
        from PyQt6.QtCore import QEvent
        if obj is getattr(self, 'tabs', None) and event.type() == QEvent.Type.Resize:
            if hasattr(self, 'lock_overlay') and self.lock_overlay.isVisible():
                self.lock_overlay.resize(self.tabs.size())
        return super().eventFilter(obj, event)

    def apply_dark_theme(self):
        self.is_dark_mode = True 
        
        style = f"""
        QMainWindow, QDialog {{ background-color: #1e1e1e; font-size: {self.config['s12']}px; }}
        QFrame#panelFrame {{ background-color: #2b2b2b; border-radius: 10px; }}
        QFrame#optionsFrame {{ background-color: #2b2b2b; border-radius: 8px; }}
        QFrame#divider {{ background-color: #444444; }}
        
        QLabel {{ color: #ffffff; font-family: {self.config['font_family_str']}; font-size: {self.config['s12']}px; }}
        QLabel#titleLabel {{ font-size: {self.config['s15']}px; font-weight: bold; margin-bottom: 5px; }}
        QLabel#boldLabel {{ font-size: {self.config['s12']}px; font-weight: bold; margin-top: 5px; }}
        QLabel#langLabel {{ font-size: {self.config['s12']}px; font-weight: bold; }}
        QLabel#statusLabel {{ color: #3498DB; font-weight: bold; font-size: {self.config['s12']}px; }}
        QLabel#infoLabel {{ color: #aaaaaa; font-size: {self.config['s11']}px; }}
        QLabel#imageLabel {{ background-color: #1a1a1a; border-radius: 8px; }}
        
        QCheckBox, QRadioButton {{ color: #ffffff; font-family: {self.config['font_family_str']}; font-size: {self.config['s12']}px; }}
        QCheckBox:disabled, QRadioButton:disabled {{ color: #777777; }}
        
        QGroupBox {{ color: #ffffff; font-family: {self.config['font_family_str']}; font-size: {self.config['s12']}px; font-weight: bold; border: 1px solid #555555; border-radius: 6px; margin-top: 12px; padding-top: 10px; }}
        QGroupBox::title {{ subcontrol-origin: margin; subcontrol-position: top left; left: 10px; padding: 0 5px; color: #ffffff; }}

        QTabWidget::pane {{ border: 1px solid #444; border-radius: 5px; top: -1px; background: #1e1e1e; }}
        QTabBar::tab {{ background: #2b2b2b; color: #888; border: 1px solid #444; padding: 10px 20px; margin-right: 2px; border-top-left-radius: 5px; border-top-right-radius: 5px; font-weight: bold; font-size: {self.config['s12']}px; }}
        QTabBar::tab:selected {{ background: #3a7ebf; color: #fff; }}
        QTabBar::tab:hover:!selected {{ background: #3a3a3a; color: #fff; }}

        QProgressBar {{ background-color: #3a3a3a; border: none; border-radius: 5px; }}
        QProgressBar::chunk {{ background-color: #3498DB; border-radius: 5px; }}
        
        QPushButton {{ background-color: #3a3a3a; color: white; border-radius: 6px; padding: 8px 12px; font-family: {self.config['font_family_str']}; font-weight: bold; font-size: {self.config['s12']}px; }}
        QPushButton:hover {{ background-color: #4a4a4a; }}
        
        QPushButton#versionBtn {{ background-color: #2b2b2b; color: #cccccc; border: 1px solid #555; }}
        QPushButton#versionBtn:hover {{ background-color: #3a3a3a; color: #ffffff; border: 1px solid #777; }}
        QPushButton#versionBtnUpdate {{ background-color: #27AE60; color: #ffffff; font-weight: bold; border: 1px solid #2ECC71; }}
        QPushButton#versionBtnUpdate:hover {{ background-color: #2ECC71; border: 1px solid #27AE60; }}
        
        QPushButton#settingsBtn {{ background-color: #2b2b2b; border: 1px solid #555; }}
        QPushButton#settingsBtn:hover {{ background-color: #3a3a3a; }}
        
        QPushButton#dangerBtn:enabled {{ background-color: #D32F2F; color: #FFFFFF; border: none; }}
        QPushButton#dangerBtn:hover:enabled {{ background-color: #B71C1C; }}
        
        QPushButton#actionBtn {{ background-color: {self.config['btn_primary']}; font-size: {self.config['s14']}px; padding: 10px 20px; border: none; }}
        QPushButton#actionBtn:hover {{ background-color: #005A9E; }}
        
        QPushButton#actionBtnGreen {{ background-color: #27AE60; font-size: {self.config['s14']}px; padding: 10px 20px; border: none; color: white; border-radius: 6px; font-weight: bold; }}
        QPushButton#actionBtnGreen:hover {{ background-color: #2ECC71; }}
        
        QPushButton#actionBtnOrange {{ background-color: #E67E22; font-size: {self.config['s14']}px; padding: 10px 20px; border: none; color: white; border-radius: 6px; font-weight: bold; }}
        QPushButton#actionBtnOrange:hover {{ background-color: #F39C12; }}
        
        QPushButton#actionBtnCancel {{ background-color: #E74C3C; font-size: {self.config['s14']}px; padding: 10px 20px; border: none; }}
        QPushButton#actionBtnCancel:hover {{ background-color: #C0392B; }}
        
        QPushButton:disabled {{ background-color: #555555; color: #888888; border: 1px solid #444; }}
        
        QTableWidget, QTreeWidget, QTextBrowser {{ background-color: #2b2b2b; color: white; border: 1px solid #444; border-radius: 8px; gridline-color: #3a3a3a; outline: none; font-family: {self.config['font_family_str']}; font-size: {self.config['s11']}px; }}
        QHeaderView::section {{ background-color: #1f1f1f; color: white; padding: 5px; border: none; font-weight: bold; font-family: {self.config['font_family_str']}; font-size: {self.config['s11']}px; }}
        QHeaderView::section:hover {{ background-color: #3a3a3a; cursor: pointer; }}
        QTableWidget::item:selected, QTreeWidget::item:selected {{ background-color: #3a7ebf; }}
        QTableWidget::item, QTreeWidget::item {{ padding: 4px; font-size: {self.config['s11']}px; }}
        QTableWidget::indicator, QTreeWidget::indicator {{ width: 18px; height: 18px; }}
        
        QScrollArea {{ background-color: transparent; border: none; }}

        QSlider::groove:horizontal {{ border-radius: 4px; height: 8px; background: #3a3a3a; }}
        QSlider::handle:horizontal {{ background: #3498DB; width: 16px; height: 16px; margin: -4px 0; border-radius: 8px; }}
        QSlider::handle:horizontal:hover {{ background: #5DADE2; }}
        
        QComboBox, QLineEdit, QTextEdit {{ background-color: #3a3a3a; color: white; border: 1px solid #555; border-radius: 4px; padding: 4px; font-family: {self.config['font_family_str']}; font-size: {self.config['s12']}px; }}
        """
        self.setStyleSheet(style)
        
        if hasattr(self.tab1, 'update_icons'): self.tab1.update_icons(True)
        if hasattr(self.tab2, 'update_icons'): self.tab2.update_icons(True)
        if hasattr(self.tab3, 'update_icons'): self.tab3.update_icons(True)

    def update_server_status_icon(self):
        if not hasattr(self, 'tab_sharing') or not hasattr(self, 'lbl_server_status'): return
        
        active_servers = list(self.tab_sharing.server_manager.servers.keys())
        
        if active_servers:
            self.lbl_server_status.setPixmap(qta.icon('fa5s.broadcast-tower', color='#2ECC71').pixmap(14, 14))
            tooltips = ", ".join(active_servers)
            tooltip_txt = f"{tooltips} 서버 구동 중" if self.lang == "ko" else (f"{tooltips} サーバー稼働中" if self.lang == "ja" else f"{tooltips} Server Running")
            self.lbl_server_status.setToolTip(tooltip_txt)
            self.lbl_server_status.show()
        else:
            self.lbl_server_status.hide()

    def apply_language(self):
        t = self.i18n[self.lang]
        self.setWindowTitle(t["title"])
        self.tabs.setTabText(0, t["tab_folders"])
        self.tabs.setTabText(1, t["tab1"])
        self.tabs.setTabText(2, t["tab2"])
        self.tabs.setTabText(3, t["tab3"])
        self.tabs.setTabText(4, t.get("tab_sharing", "공유 서버" if self.lang == "ko" else ("Sharing" if self.lang == "en" else "共有サーバー")))
        self.tabs.setTabText(5, t["tab_releases"])
        
        self.btn_add_folder.setText(f" {t['add_folder']}")
        self.btn_add_file.setText(f" {t['add_file']}")
        self.btn_remove_sel.setText(f" {t['remove_sel']}")
        self.btn_clear_all.setText(f" {t['clear_all']}")
        self.btn_toggle_all.setText(f" {t['toggle_all']}")
        self.btn_settings.setText(f" {t['settings_btn']}") 
        self.btn_issue.setText(f" {t['btn_issue']}")

        self.tabs.tabBar().setCursor(Qt.CursorShape.PointingHandCursor)
        
        if hasattr(self.tab1, 'retranslate_ui'): self.tab1.retranslate_ui(t, self.lang)
        if hasattr(self.tab2, 'retranslate_ui'): self.tab2.retranslate_ui(t, self.lang)
        if hasattr(self.tab3, 'retranslate_ui'): self.tab3.retranslate_ui(t, self.lang)
        if hasattr(self.tab_sharing, 'retranslate_ui'): self.tab_sharing.retranslate_ui(t, self.lang)
        
        if self.btn_run.objectName() == "actionBtn": self.btn_run.setText(f" {t['run_btn']}")
        else: self.btn_run.setText(f" {t['cancel_btn']}")
        
        if not self.lbl_status.text() or self.lbl_status.text() in [self.i18n["ko"]["status_wait"], self.i18n["en"]["status_wait"], self.i18n["ja"]["status_wait"]]:
            self.lbl_status.setText(t["status_wait"])
            
        self.update_server_status_icon()
        self.update_version_button_ui()

    def on_tab_changed(self, index):
        enabled = (index in [1, 2, 3]) and not self.is_processing
        self.btn_add_folder.setEnabled(enabled)
        self.btn_add_file.setEnabled(enabled)
        self.btn_remove_sel.setEnabled(enabled)
        self.btn_clear_all.setEnabled(enabled)
        self.btn_toggle_all.setEnabled(enabled)
        self.btn_run.setVisible(index in [1, 2])

    def toggle_ui_elements(self, is_processing):
        enabled = not is_processing
        current_tab = self.tabs.currentIndex()
        top_btn_enabled = enabled if current_tab in [1, 2, 3] else False
        
        self.btn_add_folder.setEnabled(top_btn_enabled)
        self.btn_add_file.setEnabled(top_btn_enabled)
        self.btn_remove_sel.setEnabled(top_btn_enabled)
        self.btn_clear_all.setEnabled(top_btn_enabled)
        self.btn_toggle_all.setEnabled(top_btn_enabled)
        self.btn_settings.setEnabled(enabled)
        self.btn_version.setEnabled(enabled) 
        self.setAcceptDrops(enabled) 
        
        if hasattr(self.tab1, 'btn_toggle_expand'):
            self.tab1.btn_toggle_expand.setEnabled(enabled)
            self.tab1.btn_batch_default.setEnabled(enabled)
            self.tab1.btn_batch_title.setEnabled(enabled)
            
        if hasattr(self.tab2, 'cb_pattern'):
            self.tab2.cb_pattern.setEnabled(enabled)
            if is_processing:
                self.tab2.entry_custom.setEnabled(False)
            else:
                self.tab2.on_pattern_change(self.tab2.cb_pattern.currentText())

        if is_processing:
            if hasattr(self, 'lock_overlay'):
                self.lock_overlay.text = self.i18n[self.lang].get("msg_processing_overlay", "Processing...")
                self.lock_overlay.show()
        else:
            if hasattr(self, 'lock_overlay'):
                self.lock_overlay.hide()

    def open_settings(self):
        old_lang = self.config.get("lang", "ko")
        old_font = self.config.get("font_family", "Default")
        old_scale = self.config.get("font_scale", 100)
        
        dlg = SettingsDialog(self, self.config, self.format_keys, self.i18n)
        dlg.setStyleSheet(self.styleSheet()) 
        from PyQt6.QtWidgets import QDialog, QMessageBox
        
        if dlg.exec() == int(QDialog.DialogCode.Accepted):
            new_data = dlg.get_data()
            new_lang = new_data.get("lang", "ko")
            new_font = new_data.get("font_family", "Default")
            new_scale = new_data.get("font_scale", 100)
            
            old_dup_folders = set(self.config.get("dup_check_folders", []))
            new_dup_folders = set(new_data.get("dup_check_folders", []))
            added_dup_folders = list(new_dup_folders - old_dup_folders)
            dup_folders_changed = new_dup_folders != old_dup_folders
            
            format_changed = new_data.get("target_format") != self.config.get("target_format")
            webp_conv_changed = new_data.get("webp_conversion") != self.config.get("webp_conversion")
            webp_qual_changed = new_data.get("img_quality") != self.config.get("img_quality")
            
            if format_changed or webp_conv_changed or webp_qual_changed:
                self.tab1.clear_list()
                self.tab2.clear_list()
                self.tab3.clear_list()
                
                lang = new_data.get("lang", "ko")
                msg = self.i18n[lang].get("msg_format_cleared", "All task lists have been cleared.")
                Toast.show(self, msg)

            self.config.update(new_data)
            self.lang = self.config["lang"]
            save_config(self.config)
            
            # 설정값이 변경되었을 경우 수동 안내 대신 재시작 팝업 띄우기
            if old_lang != new_lang or old_font != new_font or old_scale != new_scale:
                msg = self.i18n[new_lang].get("msg_restart_desc", "Settings changed. Restart?")
                title = self.i18n[new_lang].get("msg_restart_title", "Restart Required")
                
                reply = QMessageBox.question(
                    self, 
                    title, 
                    msg, 
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
                )
                
                if reply == QMessageBox.StandardButton.Yes:
                    self.restart_app()
                    return
            
            self.apply_language()

            # 폴더가 변경되었으면 재인덱싱 트리거
            if dup_folders_changed:
                self.tabs.setCurrentIndex(0)
                if hasattr(self.tab_folder, 'handle_new_library_folders'):
                    self.tab_folder.handle_new_library_folders(added_dup_folders)
                else:
                    self.tab_folder.start_dup_scan()

            if hasattr(self.tab2, 'update_inner_preview_list'):
                self.tab2.update_inner_preview_list()

    def restart_app(self):
        # 재시작 전 현재 창의 상태를 안전하게 저장
        self.config["width"] = self.normalGeometry().width()
        self.config["height"] = self.normalGeometry().height()
        self.config["is_maximized"] = self.isMaximized()
        self.config["last_tab_index"] = self.tabs.currentIndex()
        save_config(self.config)
        
        import sys
        from PyQt6.QtCore import QProcess
        from PyQt6.QtWidgets import QApplication
        
        # 메인 프로세스를 종료하고 새로운 프로세스 실행
        QApplication.quit()
        QProcess.startDetached(sys.executable, sys.argv)

    def dragEnterEvent(self, event):
        # 변수명 변경 및 인덱스 4(릴리즈 노트)에서 드롭 무시
        if self.tabs.currentIndex() == 4:
            event.ignore()
            return
            
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event):
        event.acceptProposedAction()
        if self.is_processing: return
        files = [u.toLocalFile() for u in event.mimeData().urls() if u.isLocalFile()]
        if files:
            QTimer.singleShot(10, lambda: self.process_paths(files))

    def add_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Directory", options=QFileDialog.Option.DontUseNativeDialog)
        if folder: self.process_paths([folder])

    def add_file(self):
        files, _ = QFileDialog.getOpenFileNames(self, "Select Archives", "", "Archive files (*.zip *.cbz *.cbr *.7z *.rar)", options=QFileDialog.Option.DontUseNativeDialog)
        if files: self.process_paths(files)

    def toggle_all_checkboxes(self):
        self.is_all_checked = not self.is_all_checked
        if self.is_all_checked:
            self.btn_toggle_all.setIcon(qta.icon('fa5s.check-square', color='white'))
        else:
            self.btn_toggle_all.setIcon(qta.icon('fa5s.square', color='white'))
            
        current = self.tabs.currentWidget()
        if hasattr(current, 'toggle_all_checkboxes'): current.toggle_all_checkboxes()

    def remove_selected(self):
        current = self.tabs.currentWidget()
        if hasattr(current, 'remove_selected'): current.remove_selected()

    def clear_list(self):
        current = self.tabs.currentWidget()
        if hasattr(current, 'clear_list'): current.clear_list()

    def process_paths(self, paths, is_auto_transfer=False):
        if self.is_processing: return
        
        if self.tabs.currentIndex() == 3:
            files_dropped = [p for p in paths if os.path.isfile(p)]
            folders_dropped = [p for p in paths if os.path.isdir(p)]
            final_paths = []

            if files_dropped and not is_auto_transfer:
                msg = self.i18n[self.lang].get("msg_drop_folders_desc", "Add entire folder?")
                title = self.i18n[self.lang].get("msg_drop_folders_title", "Select Add Method")
                
                reply = QMessageBox.question(
                    self, title, msg, 
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No | QMessageBox.StandardButton.Cancel
                )

                if reply == QMessageBox.StandardButton.Cancel: return
                elif reply == QMessageBox.StandardButton.Yes:
                    parent_dirs = set(os.path.dirname(f) for f in files_dropped)
                    for d in parent_dirs: folders_dropped.append(d)
                else: final_paths.extend(files_dropped)
            elif files_dropped and is_auto_transfer:
                final_paths.extend(files_dropped)

            for d in folders_dropped:
                if d not in final_paths: final_paths.append(d)

            if final_paths: self.tab3.load_paths(final_paths)
            return
            
        self.is_processing = True
        self.toggle_ui_elements(is_processing=True)
        self.progress_bar.show()
        self.progress_bar.setValue(0)
        self.lbl_status.setText(self.i18n[self.lang].get("msg_loading_list", "Loading files..."))
        
        if self.tabs.currentIndex() == 1:
            task = OrganizerLoadTask(paths, self.seven_zip_path, self.lang, self.signals)
        else:
            task = FileLoadTask(paths, self.seven_zip_path, self.lang, self.signals)
            
        self.active_task = task
        threading.Thread(target=task.run, daemon=True).start()

    def on_organizer_loaded(self, new_data, skipped_files):
        for fp, data in new_data.items():
            if fp not in self.tab1.org_data:
                self.tab1.org_data[fp] = data
                
        self.tab1.is_expanded = True
        self.tab1.refresh_list()
        self.safe_finish_ui_reset()
        
        if skipped_files:
            msg = self.i18n[self.lang].get("msg_org_skip_no_folder", "Skipped files:\n") + "\n".join(skipped_files[:5])
            if len(skipped_files) > 5: msg += self.i18n[self.lang].get("msg_more_files", "\n...more").format(len(skipped_files)-5)
            QMessageBox.information(self, self.i18n[self.lang].get("msg_notice", "Notice"), msg)

    def on_renamer_loaded(self, new_data, nested_files, unsupported_files):
        added = False
        for fp, data in new_data.items():
            if fp not in self.tab2.archive_data:
                self.tab2.archive_data[fp] = data
                added = True

        self.tab2.refresh_list()
        if added and self.tab2.table_archives.rowCount() > 0:
            self.tab2.table_archives.selectRow(self.tab2.table_archives.rowCount()-1)

        self.safe_finish_ui_reset()
        
        if unsupported_files:
            msg = self.i18n[self.lang].get("msg_unsupported_format", "Unsupported:\n") + "\n".join(unsupported_files[:5])
            if len(unsupported_files) > 5: msg += self.i18n[self.lang].get("msg_more_files", "\n...more").format(len(unsupported_files)-5)
            QMessageBox.warning(self, self.i18n[self.lang].get("dlg_warn", "Warning"), msg)
        if nested_files:
            msg = self.i18n[self.lang].get("msg_nested_archive", "Nested archives:\n") + "\n".join(nested_files[:5])
            if len(nested_files) > 5: msg += self.i18n[self.lang].get("msg_more_files", "\n...more").format(len(nested_files)-5)
            QMessageBox.warning(self, self.i18n[self.lang].get("dlg_warn", "Warning"), msg)

    def start_process(self):
        if self.is_processing: return
        
        if self.tabs.currentIndex() == 1:
            targets = self.tab1.get_targets()
            if not targets:
                QMessageBox.warning(self, self.i18n[self.lang].get("dlg_warn", "Warning"), self.i18n[self.lang].get("msg_no_targets"))
                return
            
            self.tab2.clear_list()
            self.tab3.clear_list()
            
            self.is_processing = True
            self.toggle_ui_elements(is_processing=True)
            
            try: self.btn_run.clicked.disconnect()
            except TypeError: pass
            
            self.btn_run.clicked.connect(self.cancel_process)
            self.btn_run.setObjectName("actionBtnCancel")
            self.btn_run.setText(f" {self.i18n[self.lang]['cancel_btn']}")
            self.btn_run.setIcon(qta.icon('fa5s.stop-circle', color='white')) 
            self.btn_run.style().unpolish(self.btn_run)
            self.btn_run.style().polish(self.btn_run)
            self.progress_bar.show(); self.progress_bar.setValue(0)
            
            task = OrganizerProcessTask(targets, self.config, self.tab1.org_data, self.seven_zip_path, self.signals)
            self.active_task = task
            threading.Thread(target=task.run, daemon=True).start()
            
        elif self.tabs.currentIndex() == 2:
            targets = self.tab2.get_targets()
            if not targets:
                QMessageBox.warning(self, self.i18n[self.lang].get("dlg_warn", "Warning"), self.i18n[self.lang].get("msg_no_targets"))
                return
                
            self.tab1.clear_list()
            self.tab3.clear_list()
            
            self.is_processing = True
            self.toggle_ui_elements(is_processing=True)
            
            try: self.btn_run.clicked.disconnect()
            except TypeError: pass
            
            self.btn_run.clicked.connect(self.cancel_process)
            self.btn_run.setObjectName("actionBtnCancel")
            self.btn_run.setText(f" {self.i18n[self.lang]['cancel_btn']}")
            self.btn_run.setIcon(qta.icon('fa5s.stop-circle', color='white')) 
            self.btn_run.style().unpolish(self.btn_run)
            self.btn_run.style().polish(self.btn_run)
            self.progress_bar.show(); self.progress_bar.setValue(0)
            
            task = RenameTask(
                targets, 
                self.config, 
                self.tab2.archive_data, 
                self.i18n, 
                self.tab2.get_pattern(), 
                self.tab2.get_custom_text(), 
                self.tab2.get_start_num(),
                self.seven_zip_path, 
                self.signals
            )
            self.active_task = task
            threading.Thread(target=task.run, daemon=True).start()

    def cancel_process(self):
        self.btn_run.setText(f" {self.i18n[self.lang]['cancel_wait']}")
        self.btn_run.setEnabled(False)
        if hasattr(self, 'active_task') and self.active_task and hasattr(self.active_task, 'cancel'):
            self.active_task.cancel()

    def finish_process_org(self, stats, new_fps, was_cancelled):
        self.is_processing = False
        self.toggle_ui_elements(is_processing=False)

        try: self.btn_run.clicked.disconnect()
        except TypeError: pass
        
        self.btn_run.clicked.connect(self.start_process)
        self.btn_run.setObjectName("actionBtn") 
        self.btn_run.setText(f" {self.i18n[self.lang]['run_btn']}")
        self.btn_run.setIcon(qta.icon('fa5s.rocket', color='white'))
        self.btn_run.setEnabled(True)
        self.btn_run.style().unpolish(self.btn_run)
        self.btn_run.style().polish(self.btn_run)
        
        self.tab1.clear_list()
        self.progress_bar.hide()
        self.progress_bar.setValue(0)

        if was_cancelled:
            self.lbl_status.setText(self.i18n[self.lang]["status_wait"])
            QMessageBox.warning(self, "Cancelled", self.i18n[self.lang].get("msg_cancelled", "Process cancelled by user."))
            log_dlg = LogDialog(self, stats, self.i18n[self.lang], show_continue_btn=False)
            log_dlg.setStyleSheet(self.styleSheet())
            log_dlg.exec()
        else:
            if self.config.get("play_sound", True): play_complete_sound()
            msg_str = self.i18n[self.lang].get("msg_job_done", "Done!").format(len(stats['success']), len(stats['skip']), len(stats['error']))
            self.lbl_status.setText(msg_str)
            
            valid_fps = [fp for fp in new_fps if os.path.exists(fp)]
            show_cont = len(valid_fps) > 0
            
            log_dlg = LogDialog(self, stats, self.i18n[self.lang], show_continue_btn=show_cont, continue_key="btn_continue_tab2")
            log_dlg.setStyleSheet(self.styleSheet())
            
            from PyQt6.QtWidgets import QDialog
            if log_dlg.exec() == int(QDialog.DialogCode.Accepted):
                self.tabs.setCurrentIndex(2)
                self.process_paths(valid_fps, is_auto_transfer=True)

    def finish_process_rename(self, stats, new_archive_data, was_cancelled):
        self.is_processing = False
        self.toggle_ui_elements(is_processing=False)

        try: self.btn_run.clicked.disconnect()
        except TypeError: pass
        
        self.btn_run.clicked.connect(self.start_process)
        self.btn_run.setObjectName("actionBtn") 
        self.btn_run.setText(f" {self.i18n[self.lang]['run_btn']}")
        self.btn_run.setIcon(qta.icon('fa5s.rocket', color='white')) 
        self.btn_run.setEnabled(True)
        self.btn_run.style().unpolish(self.btn_run)
        self.btn_run.style().polish(self.btn_run)
        
        valid_fps = []
        
        # --- [수정된 부분] 딕셔너리와 문자열 모두 안전하게 처리 ---
        for old_fp, val in new_archive_data.items():
            # 스킵된 파일처럼 단순 문자열인 경우
            if isinstance(val, str):
                new_fp = val
            # 만약 딕셔너리 구조가 넘어왔다면 안전하게 경로 추출
            elif isinstance(val, dict):
                new_fp = val.get('new_path', old_fp)
            else:
                continue

            if os.path.exists(new_fp):
                valid_fps.append(new_fp)
            
            # 리스트 UI 업데이트 로직
            if old_fp != new_fp:
                if old_fp in self.tab2.archive_data: del self.tab2.archive_data[old_fp]
                self.tab2.load_archive_info(new_fp)
                self.tab2.current_archive_path = new_fp 
            else:
                self.tab2.load_archive_info(new_fp)
        # ----------------------------------------------------
        
        self.tab2.refresh_list()
        
        if getattr(self.tab2, 'current_archive_path', None) and self.tab2.current_archive_path in self.tab2.archive_data:
            for row in range(self.tab2.table_archives.rowCount()):
                if self.tab2.table_archives.item(row, 0).data(Qt.ItemDataRole.UserRole) == self.tab2.current_archive_path:
                    self.tab2.table_archives.selectRow(row)
                    break

        if was_cancelled:
            self.safe_finish_ui_reset()
            QMessageBox.warning(self, "Cancelled", self.i18n[self.lang].get("msg_cancelled", "Process cancelled by user."))
            log_dlg = LogDialog(self, stats, self.i18n[self.lang], show_continue_btn=False)
            log_dlg.setStyleSheet(self.styleSheet())
            log_dlg.exec()
        else:
            if self.config.get("play_sound", True): play_complete_sound()
            self.progress_bar.hide()
            self.progress_bar.setValue(0)
            msg_str = self.i18n[self.lang].get("msg_job_done", "Done!").format(len(stats['success']), len(stats['skip']), len(stats['error']))
            self.lbl_status.setText(msg_str)
            
            show_cont = len(valid_fps) > 0
            log_dlg = LogDialog(self, stats, self.i18n[self.lang], show_continue_btn=show_cont, continue_key="btn_continue_tab3")
            log_dlg.setStyleSheet(self.styleSheet())
            
            from PyQt6.QtWidgets import QDialog
            if log_dlg.exec() == int(QDialog.DialogCode.Accepted):
                self.tabs.setCurrentIndex(3) 
                self.process_paths(valid_fps, is_auto_transfer=True)

    def safe_finish_ui_reset(self):
        self.is_processing = False
        self.toggle_ui_elements(is_processing=False)
        self.lbl_status.setText(self.i18n[self.lang]["status_wait"])
        QTimer.singleShot(300, self._actual_hide)

    def _actual_hide(self):
        self.progress_bar.hide()
        self.progress_bar.setValue(0)

    def closeEvent(self, event):
        is_tab3_running = hasattr(self, 'tab3') and hasattr(self.tab3, 'save_worker') and self.tab3.save_worker and self.tab3.save_worker.isRunning()
        
        if self.is_processing or is_tab3_running:
            # 🌟 [개선] 다국어 i18n 환경 파일에서 종료 메시지 가져오기
            title = self.i18n[self.lang].get("msg_exit_title", "종료 확인")
            msg = self.i18n[self.lang].get("msg_exit_body", "현재 작업이 진행 중입니다. 정말로 프로그램을 종료하시겠습니까?\n(진행 중인 작업은 강제 중단되며 파일이 손상될 수 있습니다.)")
            
            reply = QMessageBox.question(
                self, title, msg,
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            
            if reply == QMessageBox.StandardButton.No:
                event.ignore()
                return
            else:
                # 사용자가 강제 종료를 선택했을 때 실행 중인 스레드에 중단(Cancel) 신호를 보내 안전하게 닫기
                if hasattr(self, 'active_task') and self.active_task and hasattr(self.active_task, 'cancel'):
                    self.active_task.cancel()
                if is_tab3_running and hasattr(self.tab3.save_worker, 'cancel'):
                    self.tab3.save_worker.cancel()

        # 정상 종료 시 현재 창 상태와 탭 인덱스 저장
        self.config["width"] = self.normalGeometry().width()
        self.config["height"] = self.normalGeometry().height()
        self.config["is_maximized"] = self.isMaximized()
        if hasattr(self, 'tabs'):
            self.config["last_tab_index"] = self.tabs.currentIndex()
            
        save_config(self.config)
        event.accept()