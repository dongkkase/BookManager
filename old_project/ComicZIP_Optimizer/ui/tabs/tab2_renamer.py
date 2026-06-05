import os
import threading
import zipfile
import platform
import subprocess
import sys
from pathlib import Path
import qtawesome as qta
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                             QLabel, QComboBox, QLineEdit, QFrame, QTableWidgetItem, QAbstractItemView, QHeaderView, QSizePolicy, QTableWidget, QMessageBox, QStackedWidget, QCheckBox, QMenu, QInputDialog, QSpinBox)
from PyQt6.QtCore import Qt, QTimer, QSize
from PyQt6.QtGui import QImage, QPixmap, QPainter, QPainterPath, QColor, QIntValidator, QAction

from ui.widgets import ArchiveTableWidget, Toast
from utils import natural_keys
from config import get_resource_path, save_config
from core.archive_utils import bg_load_image
from tasks.load_task import FileLoadTask

class ReorderableTableWidget(QTableWidget):
    def __init__(self, rows, cols, parent=None):
        super().__init__(rows, cols, parent)
        self.parent_tab = None
        self.setDragEnabled(True)
        self.setAcceptDrops(True)
        self.viewport().setAcceptDrops(True)
        self.viewport().setCursor(Qt.CursorShape.SizeAllCursor)
        self.setDragDropOverwriteMode(False)
        self.setDropIndicatorShown(True)
        self.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.setDragDropMode(QAbstractItemView.DragDropMode.InternalMove)

    def dropEvent(self, event):
        if event.source() == self:
            source_row = self.currentRow()
            drop_row = self.rowAt(event.pos().y())
            
            # 목록의 가장 아래 빈 공간으로 드래그한 경우
            if drop_row == -1:
                drop_row = self.rowCount() - 1

            if source_row != drop_row and source_row >= 0 and drop_row >= 0:
                if self.parent_tab:
                    event.ignore() # 기본 UI 꼬임 방지
                    self.parent_tab.move_inner_item(source_row, drop_row)
                    return
        super().dropEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Home:
            if self.rowCount() > 0:
                self.selectRow(0)
                self.scrollToTop()
            event.accept()
        elif event.key() == Qt.Key.Key_End:
            if self.rowCount() > 0:
                self.selectRow(self.rowCount() - 1)
                self.scrollToBottom()
            event.accept()
        else:
            super().keyPressEvent(event)

class Tab2Renamer(QWidget):
    def __init__(self, main_app):
        super().__init__()
        self.main_app = main_app
        self.archive_data = {}
        self.current_archive_path = None
        self.all_checked = True
        
        self.archive_timer = QTimer()
        self.archive_timer.setSingleShot(True)
        self.archive_timer.timeout.connect(self._process_archive_select)

        self.inner_timer = QTimer()
        self.inner_timer.setSingleShot(True)
        self.inner_timer.timeout.connect(self._process_inner_select)
        
        self.config = main_app.config
        
        self.setup_ui()

    def update_icons(self, is_dark):
        empty_c = "#aaaaaa" if is_dark else "#9CA3AF"
        draganddrop_path = get_resource_path('src/draganddrop1.png')
        if not os.path.exists(draganddrop_path):
            self.icon_empty_arch.setPixmap(qta.icon('fa5s.folder-open', color=empty_c).pixmap(64, 64))
        
        icon_c = 'white' if is_dark else '#1F2937'
        if hasattr(self, 'btn_minus_num'):
            self.btn_minus_num.setIcon(qta.icon('fa5s.minus', color=icon_c))
            self.btn_plus_num.setIcon(qta.icon('fa5s.plus', color=icon_c))

    def setup_ui(self):
        t = self.main_app.i18n[self.main_app.lang]
        layout = QHBoxLayout(self)
        left_frame = QFrame()
        left_layout = QVBoxLayout(left_frame)
        left_frame.setFixedWidth(280) 
        left_frame.setObjectName("panelFrame")

        self.lbl_cover_title = QLabel()
        self.lbl_cover_title.setObjectName("titleLabel")
        self.lbl_cover_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_cover_img = QLabel()
        self.lbl_cover_img.setObjectName("imageLabel")
        self.lbl_cover_img.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_cover_img.setMinimumHeight(250)
        self.lbl_cover_img.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        self.lbl_inner_title = QLabel()
        self.lbl_inner_title.setObjectName("titleLabel")
        self.lbl_inner_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_inner_img = QLabel()
        self.lbl_inner_img.setObjectName("imageLabel")
        self.lbl_inner_img.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_inner_img.setMinimumHeight(250)
        self.lbl_inner_img.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        divider = QFrame()
        divider.setFrameShape(QFrame.Shape.HLine)
        divider.setObjectName("divider")

        left_layout.addWidget(self.lbl_cover_title)
        left_layout.addWidget(self.lbl_cover_img, alignment=Qt.AlignmentFlag.AlignCenter)
        left_layout.addSpacing(5)
        left_layout.addWidget(divider)
        left_layout.addSpacing(5)
        left_layout.addWidget(self.lbl_inner_title)
        left_layout.addWidget(self.lbl_inner_img, alignment=Qt.AlignmentFlag.AlignCenter)
        left_layout.addStretch()

        right_frame = QFrame()
        right_layout = QVBoxLayout(right_frame)
        right_layout.setContentsMargins(0,0,0,0)
        
        options_frame = QFrame()
        options_frame.setObjectName("optionsFrame")
        options_layout = QHBoxLayout(options_frame)
        self.lbl_pattern = QLabel()
        self.lbl_pattern.setObjectName("boldLabel")
        self.cb_pattern = QComboBox()
        self.cb_pattern.setCursor(Qt.CursorShape.PointingHandCursor) 
        self.cb_pattern.currentTextChanged.connect(self.on_pattern_change)
        self.entry_custom = QLineEdit()
        self.entry_custom.setEnabled(False)
        self.entry_custom.textChanged.connect(self.update_inner_preview_list)
        
        self.lbl_start_num = QLabel(t.get("tab2_start_num", "시작 번호:"))
        self.lbl_start_num.setObjectName("boldLabel")
        
        saved_start_num = str(self.config.get("start_num", 0))
        self.le_start_num = QLineEdit(saved_start_num)
        self.le_start_num.setFixedWidth(50)
        self.le_start_num.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.le_start_num.setValidator(QIntValidator(0, 999999))
        
        is_dark = getattr(self.main_app, 'is_dark_mode', True)
        icon_c = 'white' if is_dark else '#1F2937'
        
        self.btn_minus_num = QPushButton()
        self.btn_minus_num.setIcon(qta.icon('fa5s.minus', color=icon_c))
        self.btn_minus_num.setFixedWidth(28)
        self.btn_minus_num.setCursor(Qt.CursorShape.PointingHandCursor)
        
        self.btn_plus_num = QPushButton()
        self.btn_plus_num.setIcon(qta.icon('fa5s.plus', color=icon_c))
        self.btn_plus_num.setFixedWidth(28)
        self.btn_plus_num.setCursor(Qt.CursorShape.PointingHandCursor)

        def change_num(delta):
            try:
                val = int(self.le_start_num.text() or 0)
            except ValueError:
                val = 0
            new_val = max(0, val + delta)
            self.le_start_num.setText(str(new_val))

        self.btn_minus_num.clicked.connect(lambda: change_num(-1))
        self.btn_plus_num.clicked.connect(lambda: change_num(1))
        
        def on_start_num_changed(text):
            try:
                val = int(text or 0)
            except ValueError:
                val = 0
            self.config["start_num"] = val
            save_config(self.config)
            self.update_inner_preview_list()

        self.le_start_num.textChanged.connect(on_start_num_changed)
        
        self.chk_keep_name = QCheckBox(t.get("tab2_keep_name", "내부 파일명 유지"))
        self.chk_keep_name.setCursor(Qt.CursorShape.PointingHandCursor)
        self.chk_keep_name.setStyleSheet("font-weight: bold; color: #E67E22;")
        self.chk_keep_name.toggled.connect(self.on_keep_name_toggled)
        
        options_layout.addWidget(self.lbl_pattern)
        options_layout.addWidget(self.cb_pattern, 1)
        options_layout.addWidget(self.entry_custom)
        
        options_layout.addWidget(self.lbl_start_num)
        options_layout.addWidget(self.le_start_num)
        options_layout.addWidget(self.btn_minus_num)
        options_layout.addWidget(self.btn_plus_num)
        
        options_layout.addWidget(self.chk_keep_name)
        right_layout.addWidget(options_frame)

        self.lbl_target = QLabel()
        self.lbl_target.setObjectName("boldLabel")
        right_layout.addWidget(self.lbl_target)

        # 🌟 1. '옵션 박스'와 동일한 디자인의 프레임(박스) 생성
        action_frame = QFrame()
        action_frame.setObjectName("optionsFrame") # 상단 파일명 패턴 박스와 동일한 CSS 적용
        
        action_layout = QHBoxLayout(action_frame)
        action_layout.setContentsMargins(10, 8, 10, 8) # 박스 내부 여백
        action_layout.setSpacing(8)
        
        self.btn_sel_all = QPushButton()
        self.btn_sel_all.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_sel_all.clicked.connect(self.toggle_all_items)
        
        self.btn_cap_all = QPushButton()
        self.btn_cap_all.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_cap_all.clicked.connect(self.toggle_all_cap)
        
        self.btn_exif_all = QPushButton()
        self.btn_exif_all.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_exif_all.clicked.connect(self.toggle_all_exif)
        
        # 🌟 2. 정렬 배치 로직 
        # [전체 선택(왼쪽)] --- (빈 공간 쭉 늘리기) --- [용량 최적화(오른쪽)] [EXIF 제거(오른쪽)]
        action_layout.addWidget(self.btn_sel_all)  # 왼쪽 정렬
        action_layout.addStretch()                 # 중간 여백 확장 (양쪽으로 밀어냄)
        action_layout.addWidget(self.btn_cap_all)  # 오른쪽 정렬
        action_layout.addWidget(self.btn_exif_all) # 오른쪽 정렬
        
        # 레이아웃에 프레임 추가
        right_layout.addWidget(action_frame)

        self.stacked_archives = QStackedWidget()
        page_empty = QWidget()
        layout_empty = QVBoxLayout(page_empty)
        
        self.icon_empty_arch = QLabel()
        import random
        draganddrop_path = get_resource_path(f'src/draganddrop{random.randint(1, 3)}.png')
        if os.path.exists(draganddrop_path):
            draganddrop_pixmap = QPixmap(draganddrop_path)
            self.icon_empty_arch.setPixmap(draganddrop_pixmap.scaled(256, 256, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
            from PyQt6.QtWidgets import QGraphicsOpacityEffect
            opacity_effect = QGraphicsOpacityEffect()
            opacity_effect.setOpacity(0.55)
            self.icon_empty_arch.setGraphicsEffect(opacity_effect)
        else:
            self.icon_empty_arch.setPixmap(qta.icon('fa5s.folder-open', color='#aaaaaa').pixmap(64, 64))
        self.icon_empty_arch.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        self.lbl_empty_arch = QLabel(t.get("drag_drop", ""))
        self.lbl_empty_arch.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_empty_arch.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s16']}px; font-weight: bold;")
        
        layout_empty.addStretch()
        layout_empty.addWidget(self.icon_empty_arch)
        layout_empty.addWidget(self.lbl_empty_arch)
        layout_empty.addStretch()
        self.stacked_archives.addWidget(page_empty)

        self.table_archives = ArchiveTableWidget(0, 5) # 컬럼 수 5개 확인
        self.table_archives.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table_archives.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table_archives.verticalHeader().setVisible(False) 
        
        self.table_archives.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.table_archives.customContextMenuRequested.connect(self.show_context_menu)
        
        self.table_archives.itemSelectionChanged.connect(self.on_archive_select)
        self.table_archives.itemChanged.connect(self.on_table_item_changed)
        self.table_archives.delete_pressed.connect(self.remove_highlighted)

        # 🌟 [추가됨] 전체 선택/해제 관리를 위한 초기값 설정 및 이벤트 연결
        self.all_checked = True
        self.cap_all_checked = False
        self.exif_all_checked = True
        
        self.stacked_archives.addWidget(self.table_archives)
        
        header_arch = self.table_archives.horizontalHeader()
        header_arch.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header_arch.setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)
        self.table_archives.setColumnWidth(1, 70)
        header_arch.setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)
        self.table_archives.setColumnWidth(2, 70)
        
        # 🌟 새로 추가된 3, 4번 컬럼 너비 고정
        header_arch.setSectionResizeMode(3, QHeaderView.ResizeMode.Fixed)
        self.table_archives.setColumnWidth(3, 90)
        header_arch.setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)
        self.table_archives.setColumnWidth(4, 80)
        
        self.table_archives.setMinimumHeight(150)
        
        right_layout.addWidget(self.stacked_archives, 1) 

        self.lbl_total_count = QLabel()
        self.lbl_total_count.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_total_count.setObjectName("infoLabel")
        right_layout.addWidget(self.lbl_total_count)

        self.lbl_inner = QLabel()
        self.lbl_inner.setObjectName("boldLabel")
        right_layout.addWidget(self.lbl_inner)

        self.table_inner = ReorderableTableWidget(0, 4)
        self.table_inner.parent_tab = self  # 테이블이 이 탭의 함수를 호출할 수 있도록 참조 전달
        self.table_inner.verticalHeader().setVisible(False)
        self.table_inner.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        
        header_inner = self.table_inner.horizontalHeader()
        header_inner.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header_inner.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header_inner.setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)
        header_inner.setSectionResizeMode(3, QHeaderView.ResizeMode.Fixed)
        self.table_inner.setColumnWidth(2, 90)
        self.table_inner.setColumnWidth(3, 120)
        self.table_inner.setMinimumHeight(150)
        self.table_inner.itemSelectionChanged.connect(self.on_inner_select)
        right_layout.addWidget(self.table_inner, 1)

        layout.addWidget(left_frame)
        layout.addWidget(right_frame, 1)

    # 🌟 우클릭 컨텍스트 메뉴 기능들 복구 🌟
    def show_context_menu(self, pos):
        item = self.table_archives.itemAt(pos)
        if not item: return
        
        row = item.row()
        fp = self.table_archives.item(row, 0).data(Qt.ItemDataRole.UserRole)
        if not fp or not os.path.exists(fp): return
        
        menu = QMenu(self)
        t = self.main_app.i18n[self.main_app.lang]
        
        action_open_dir = QAction(qta.icon('fa5s.folder-open'), t.get("action_find_path", "경로 찾기"), self)
        action_rename = QAction(qta.icon('fa5s.edit'), t.get("action_rename_file", "파일 이름 변경"), self)
        action_reload = QAction(qta.icon('fa5s.sync-alt'), t.get("action_reload_file", "다시 불러오기"), self)
        
        action_open_dir.triggered.connect(lambda: self._open_file_location(fp))
        action_rename.triggered.connect(lambda: self._rename_archive_file(fp, row))
        action_reload.triggered.connect(lambda: self._reload_archive_file(fp))
        
        menu.addAction(action_open_dir)
        menu.addAction(action_rename)
        menu.addAction(action_reload)
        
        menu.exec(self.table_archives.viewport().mapToGlobal(pos))

    def _open_file_location(self, filepath):
        try:
            if platform.system() == "Windows":
                subprocess.Popen(f'explorer /select,"{os.path.normpath(filepath)}"')
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", "-R", filepath])
            else:
                subprocess.Popen(["xdg-open", os.path.dirname(filepath)])
        except Exception as e:
            Toast.show(self.main_app, self.main_app.i18n[self.main_app.lang].get("msg_path_open_fail").format(e))

    def _rename_archive_file(self, old_filepath, row):
        t = self.main_app.i18n[self.main_app.lang]
        if not os.path.exists(old_filepath):
            QMessageBox.warning(self, t.get("dlg_err", "오류"), t.get("msg_file_not_exist", "파일이 존재하지 않습니다."))
            return
            
        old_dir = os.path.dirname(old_filepath)
        old_name = os.path.basename(old_filepath)
        
        new_name, ok = QInputDialog.getText(
            self, 
            t.get("msg_rename_title", "파일 이름 변경"), 
            t.get("msg_rename_desc", "새로운 파일 이름을 입력하세요:"), 
            QLineEdit.EchoMode.Normal, 
            old_name
        )
        
        if ok and new_name and new_name != old_name:
            new_filepath = os.path.join(old_dir, new_name)
            
            if os.path.exists(new_filepath):
                QMessageBox.warning(self, t.get("dlg_err", "오류"), t.get("msg_rename_dup", "동일한 파일이 존재합니다."))
                return
                
            try:
                os.rename(old_filepath, new_filepath)
                
                if old_filepath in self.archive_data:
                    data = self.archive_data.pop(old_filepath)
                    data['name'] = new_name
                    data['ext'] = Path(new_filepath).suffix.lower()
                    self.archive_data[new_filepath] = data
                
                if self.current_archive_path == old_filepath:
                    self.current_archive_path = new_filepath
                
                Toast.show(self.main_app, t.get("msg_rename_success", "이름 변경 성공"))
                self.refresh_list()
                
                for i in range(self.table_archives.rowCount()):
                    if self.table_archives.item(i, 0).data(Qt.ItemDataRole.UserRole) == new_filepath:
                        self.table_archives.selectRow(i)
                        break
                        
            except PermissionError:
                QMessageBox.critical(self, t.get("msg_perm_err_title", "권한 오류"), t.get("msg_perm_err_desc", "사용 중입니다."))
            except Exception as e:
                QMessageBox.critical(self, t.get("dlg_err", "오류"), t.get("msg_err_rename_fail", "실패: {0}").format(str(e)))

    def _reload_archive_file(self, filepath):
        t = self.main_app.i18n[self.main_app.lang]
        if filepath in self.archive_data:
            is_checked = self.archive_data[filepath].get('checked', True)
            del self.archive_data[filepath]
            
            if os.path.exists(filepath):
                success = self.load_archive_info(filepath)
                if success == True:
                    self.archive_data[filepath]['checked'] = is_checked
                    Toast.show(self.main_app, t.get("msg_reload_success", "다시 불러왔습니다."))
                elif success == "nested":
                    Toast.show(self.main_app, t.get("msg_reload_nested", "내부 압축 파일 포함됨."))
                else:
                    Toast.show(self.main_app, t.get("msg_reload_fail", "불러오기 실패."))
            else:
                Toast.show(self.main_app, t.get("msg_file_not_found", "파일 없음."))
                
            self.refresh_list()
            
            if self.table_archives.rowCount() > 0:
                self.table_archives.selectRow(0)

    def retranslate_ui(self, t, lang):
        self.lbl_cover_title.setText(t["cover_preview"])
        self.lbl_inner_title.setText(t["inner_preview"])
        self.lbl_pattern.setText(t["pattern_lbl"])
        self.lbl_empty_arch.setText(t.get("drag_drop", ""))
        self.chk_keep_name.setText(t.get("tab2_keep_name", "내부 파일명 유지"))
        self.lbl_start_num.setText(t.get("tab2_start_num", "시작 번호:"))
        
        self.cb_pattern.blockSignals(True)
        self.cb_pattern.clear()
        self.cb_pattern.addItems(t["patterns"])
        self.cb_pattern.blockSignals(False)
        self.cb_pattern.setCurrentIndex(0)
        
        self.lbl_target.setText(t["target_lbl"])
        self.lbl_inner.setText(t["inner_lbl"])

        
        col_name = QTableWidgetItem(t["col_name"])
        col_count = QTableWidgetItem(t["col_count"])
        col_size = QTableWidgetItem(t["col_size"])
        col_color = QTableWidgetItem(t.get("col_cap_opt", "용량 최적화"))
        col_exif = QTableWidgetItem(t.get("col_exif_rem", "EXIF 제거"))

        self.table_archives.setHorizontalHeaderItem(0, col_name)
        self.table_archives.setHorizontalHeaderItem(1, col_count)
        self.table_archives.setHorizontalHeaderItem(2, col_size)
        self.table_archives.setHorizontalHeaderItem(3, col_color)
        self.table_archives.setHorizontalHeaderItem(4, col_exif)

        self.table_inner.setHorizontalHeaderLabels([t["col_old"], t["col_new"], t["col_fsize"], t.get("col_order", "순서 변경")])   
        self.lbl_total_count.setText(t["total_files"].format(count=len(self.archive_data)))
        
        # 🌟 새로 추가한 버튼들 텍스트 업데이트 호출
        self.update_action_buttons()
        
        if not self.current_archive_path:
            self.render_image("cover", None, None)
            self.render_image("inner", None, None)

    def on_pattern_change(self, value):
        t = self.main_app.i18n[self.main_app.lang]["patterns"]
        if value == t[4]: self.entry_custom.setEnabled(True); self.entry_custom.setFocus()
        else: self.entry_custom.setEnabled(False)
        self.update_inner_preview_list()

    def on_keep_name_toggled(self, checked):
        self.cb_pattern.setEnabled(not checked)
        self.le_start_num.setEnabled(not checked)
        self.btn_minus_num.setEnabled(not checked)
        self.btn_plus_num.setEnabled(not checked)
        if checked:
            self.entry_custom.setEnabled(False)
        else:
            self.on_pattern_change(self.cb_pattern.currentText())
        self.update_inner_preview_list()

    def on_table_item_changed(self, item):
        # 🌟 0번(작업 포함 여부) 컬럼의 체크 상태만 처리하도록 조건 설정
        if item.column() == 0:
            fp = item.data(Qt.ItemDataRole.UserRole)
            if fp and fp in self.archive_data:
                self.archive_data[fp]['checked'] = (item.checkState() == Qt.CheckState.Checked)
                
                # 🌟 [추가] 개별 파일의 체크박스를 끄고 켤 때, 상단의 '전체 선택' 일괄 버튼도 실시간 동기화
                self.all_checked = all(d.get('checked', False) for d in self.archive_data.values())
                self.update_action_buttons()

    def refresh_list(self):
        if not self.archive_data:
            self.stacked_archives.setCurrentIndex(0)
            self.table_inner.setRowCount(0)
            self.lbl_image = self.lbl_cover_img
            self.render_image("cover", None, None)
            self.render_image("inner", None, None)
            self.lbl_total_count.setText(self.main_app.i18n[self.main_app.lang]["total_files"].format(count=0))
            
            # 🌟 [추가] 리스트가 텅 비었을 때, 상단 일괄 버튼들을 강제로 초기화
            self.all_checked = True
            self.cap_all_checked = False
            self.exif_all_checked = True
            self.update_action_buttons()
            return
            
        # 🌟 [핵심 해결] 리스트를 화면에 그리기 직전, 파일들의 실제 상태를 취합해 상단 버튼에 동기화합니다.
        # 작업이 끝나고 파일이 재로드되면 파일 내부의 cap_opt가 False로 초기화되어 있으므로, 
        # 이 로직을 거치면서 상단 '이미지 압축 일괄' 버튼의 체크가 자동으로 해제됩니다.
        self.all_checked = all(d.get('checked', False) for d in self.archive_data.values())
        self.cap_all_checked = any(d.get('cap_opt', False) for d in self.archive_data.values())
        self.exif_all_checked = any(d.get('exif_opt', True) for d in self.archive_data.values())
        self.update_action_buttons()

        self.stacked_archives.setCurrentIndex(1)
        self.table_archives.setUpdatesEnabled(False)
        self.table_archives.blockSignals(True)
        self.table_archives.clearContents()
        self.table_archives.setRowCount(0)
        
        fmt_key = self.main_app.config.get("target_format", "none")
        webp_on = self.main_app.config.get("webp_conversion", False)
        
        for row, (fp, data) in enumerate(self.archive_data.items()):
            self.table_archives.insertRow(row)
            name = data['name']
            ext = data['ext'].lower().replace('.', '')
            badges = []
            if fmt_key != "none" and ext != fmt_key: badges.append(fmt_key.upper())
            if webp_on: badges.append("WEBP")
            if badges: name += f" 🔄 ({'+'.join(badges)})"
                
            chk_item = QTableWidgetItem(name)
            chk_item.setData(Qt.ItemDataRole.UserRole, fp) 
            chk_item.setFlags(Qt.ItemFlag.ItemIsUserCheckable | Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable)
            chk_item.setCheckState(Qt.CheckState.Checked if data['checked'] else Qt.CheckState.Unchecked)
            
            c_item = QTableWidgetItem(str(len(data['entries'])))
            c_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            s_item = QTableWidgetItem(f"{data['size_mb']:.1f} MB")
            s_item.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            
            self.table_archives.setItem(row, 0, chk_item)
            self.table_archives.setItem(row, 1, c_item)
            self.table_archives.setItem(row, 2, s_item)

            # 🌟 개별 행의 체크박스를 클릭했을 때도 상단 마스터 버튼이 실시간으로 반응하도록 개선
            def create_centered_checkbox(is_checked, filepath, opt_key):
                widget = QWidget()
                layout = QHBoxLayout(widget)
                layout.setContentsMargins(0, 0, 0, 0)
                layout.setAlignment(Qt.AlignmentFlag.AlignCenter) 
                
                chk = QCheckBox()
                chk.setCursor(Qt.CursorShape.PointingHandCursor) 
                chk.setChecked(is_checked)
                
                def on_toggled(state, fp=filepath, key=opt_key):
                    if fp in self.archive_data:
                        self.archive_data[fp][key] = state
                        
                        # 체크박스를 조작할 때마다 데이터 상태를 재계산하여 상단 버튼 갱신
                        if key == 'cap_opt':
                            self.cap_all_checked = any(d.get('cap_opt', False) for d in self.archive_data.values())
                        elif key == 'exif_opt':
                            self.exif_all_checked = any(d.get('exif_opt', True) for d in self.archive_data.values())
                        self.update_action_buttons()
                
                chk.toggled.connect(on_toggled)
                layout.addWidget(chk)
                return widget
            
            self.table_archives.setCellWidget(row, 3, create_centered_checkbox(data.get('cap_opt', False), fp, 'cap_opt'))
            self.table_archives.setCellWidget(row, 4, create_centered_checkbox(data.get('exif_opt', True), fp, 'exif_opt'))
            
        self.table_archives.blockSignals(False)
        self.table_archives.setUpdatesEnabled(True)
        self.lbl_total_count.setText(self.main_app.i18n[self.main_app.lang]["total_files"].format(count=len(self.archive_data)))

    def update_inner_preview_list(self):
        if not self.current_archive_path or self.current_archive_path not in self.archive_data: return
        self.table_inner.setUpdatesEnabled(False)
        self.table_inner.blockSignals(True)
        self.table_inner.clearContents()
        self.table_inner.setRowCount(0)
        
        # copy() 대신 원본 배열을 직접 참조하여 사용자가 정렬한 순서를 그대로 렌더링
        entries = self.archive_data[self.current_archive_path]['entries']

        total = len(entries)
        stem = Path(self.current_archive_path).stem
        pat_idx = self.cb_pattern.currentIndex()
        cust_txt = self.entry_custom.text()
        flatten = self.main_app.config.get("flatten_folders", False)
        webp_on = self.main_app.config.get("webp_conversion", False)
        keep_name = self.chk_keep_name.isChecked()
        
        try:
            start_num = int(self.le_start_num.text() or 0)
        except ValueError:
            start_num = 0

        # 테마에 따른 아이콘 색상 결정
        is_dark = getattr(self.main_app, 'is_dark_mode', True)
        icon_c = 'white' if is_dark else '#1F2937'

        for idx, e in enumerate(entries):
            old = e['filename']
            ext = ".webp" if webp_on else (os.path.splitext(old)[1] or ".jpg")
            pad = 2 if total < 100 else (3 if total < 1000 else 4)
            
            n = start_num + idx
            
            if keep_name: new = os.path.splitext(os.path.basename(old))[0] + ext
            elif pat_idx == 1: new = f"Cover{ext}" if idx==0 else f"Page_{n:0{pad}d}{ext}"
            elif pat_idx == 2: new = f"{stem.replace(' ','_')}_{n:0{pad}d}{ext}"
            elif pat_idx == 3: new = f"{stem.replace(' ','_')}_Cover{ext}" if idx==0 else f"{stem.replace(' ','_')}_Page_{n:0{pad}d}{ext}"
            elif pat_idx == 4: new = f"{cust_txt.strip() or 'Custom'}_{n:0{pad}d}{ext}"
            else: new = f"{n:0{pad}d}{ext}"

            dir_name = os.path.dirname(old)
            if not flatten and dir_name: new = os.path.join(dir_name, new).replace('\\', '/')

            self.table_inner.insertRow(idx)
            i1 = QTableWidgetItem(os.path.basename(old) if flatten else old)
            i1.setData(Qt.ItemDataRole.UserRole, e['original_name']) 
            i2 = QTableWidgetItem(new)
            i3 = QTableWidgetItem(f"{e['file_size']/1024:.1f} KB")
            i3.setTextAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            self.table_inner.setItem(idx, 0, i1); self.table_inner.setItem(idx, 1, i2); self.table_inner.setItem(idx, 2, i3)
            
            # --- 위/아래 이동 버튼 추가 ---
            btn_widget = QWidget()
            btn_layout = QHBoxLayout(btn_widget)
            btn_layout.setContentsMargins(2, 2, 2, 2)
            btn_layout.setSpacing(2)
            
            btn_top = QPushButton()
            btn_top.setIcon(qta.icon('fa5s.angle-double-up', color=icon_c))
            btn_top.setFixedWidth(26)
            btn_top.setCursor(Qt.CursorShape.PointingHandCursor)
            btn_top.clicked.connect(lambda _, r=idx: self.move_inner_item(r, 0))
            if idx == 0: btn_top.setEnabled(False)

            btn_up = QPushButton()
            btn_up.setIcon(qta.icon('fa5s.caret-up', color=icon_c))
            btn_up.setFixedWidth(26)
            btn_up.setCursor(Qt.CursorShape.PointingHandCursor)
            btn_up.clicked.connect(lambda _, r=idx: self.move_inner_item(r, r - 1))
            if idx == 0: btn_up.setEnabled(False)

            btn_down = QPushButton()
            btn_down.setIcon(qta.icon('fa5s.caret-down', color=icon_c))
            btn_down.setFixedWidth(26)
            btn_down.setCursor(Qt.CursorShape.PointingHandCursor)
            btn_down.clicked.connect(lambda _, r=idx: self.move_inner_item(r, r + 1))
            if idx == len(entries) - 1: btn_down.setEnabled(False)

            btn_bottom = QPushButton()
            btn_bottom.setIcon(qta.icon('fa5s.angle-double-down', color=icon_c))
            btn_bottom.setFixedWidth(26)
            btn_bottom.setCursor(Qt.CursorShape.PointingHandCursor)
            btn_bottom.clicked.connect(lambda _, r=idx: self.move_inner_item(r, len(entries) - 1))
            if idx == len(entries) - 1: btn_bottom.setEnabled(False)

            btn_layout.addWidget(btn_top)
            btn_layout.addWidget(btn_up)
            btn_layout.addWidget(btn_down)
            btn_layout.addWidget(btn_bottom)
            self.table_inner.setCellWidget(idx, 3, btn_widget)
            # ------------------------------
            
        self.table_inner.blockSignals(False)
        self.table_inner.setUpdatesEnabled(True)

    def on_archive_select(self): self.archive_timer.start(150) 
    def on_inner_select(self): self.inner_timer.start(150)

    def _process_archive_select(self):
        selected = self.table_archives.selectedItems()
        if not selected: return
        fp = self.table_archives.item(selected[0].row(), 0).data(Qt.ItemDataRole.UserRole)
        if not fp or fp not in self.archive_data: return 
        
        self.current_archive_path = fp
        self.update_inner_preview_list()
        if self.table_inner.rowCount() > 0: self.table_inner.selectRow(0)

        entries = self.archive_data[fp]['entries'].copy()
        img_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}
        cover = next((e for e in entries if os.path.basename(e['filename']).lower().startswith('cover') and Path(e['filename']).suffix.lower() in img_exts), None)
        if cover: entries.remove(cover); entries.insert(0, cover)
        target = next((e for e in entries if Path(e['filename']).suffix.lower() in img_exts), None)
        
        if target: 
            threading.Thread(target=bg_load_image, args=(fp, target['original_name'], self.archive_data[fp]['ext'], "cover", self.main_app.seven_zip_path, self.main_app.signals), daemon=True).start()
        else: self.render_image("cover", fp, None)

    def _process_inner_select(self):
        selected = self.table_inner.selectedItems()
        if not selected or not getattr(self, 'current_archive_path', None): return
        orig_fp = self.table_inner.item(selected[0].row(), 0).data(Qt.ItemDataRole.UserRole)
        ext = self.archive_data[self.current_archive_path]['ext']
        threading.Thread(target=bg_load_image, args=(self.current_archive_path, orig_fp, ext, "inner", self.main_app.seven_zip_path, self.main_app.signals), daemon=True).start()

    def render_image(self, target_id, arc_path, img_data):
        if arc_path and getattr(self, 'current_archive_path', None) != arc_path:
            return

        label_widget = self.lbl_cover_img if target_id == "cover" else self.lbl_inner_img
        cw = 180
        ch = max(250, label_widget.height() - 10)
        
        if not img_data:
            p = get_resource_path("previewframe.png")
            if os.path.exists(p):
                try:
                    with open(p, "rb") as f: img_data = f.read()
                except: pass
        if not img_data:
            label_widget.setText(self.main_app.i18n[self.main_app.lang]["no_preview"] if target_id == "cover" else self.main_app.i18n[self.main_app.lang]["no_image"])
            return

        try:
            image = QImage.fromData(img_data)
            if image.isNull(): raise Exception()
            pixmap = QPixmap.fromImage(image).scaled(QSize(cw, ch), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
            target = QPixmap(pixmap.size()); target.fill(Qt.GlobalColor.transparent)
            painter = QPainter(target); painter.setRenderHint(QPainter.RenderHint.Antialiasing)
            path = QPainterPath(); path.addRoundedRect(0, 0, target.width(), target.height(), 10, 10)
            painter.setClipPath(path); painter.drawPixmap(0, 0, pixmap); painter.end()
            label_widget.setPixmap(target)
        except Exception:
            label_widget.setText(self.main_app.i18n[self.main_app.lang]["no_image"])

    def toggle_all_checkboxes(self):
        self.all_checked = not self.all_checked
        for fp in self.archive_data: self.archive_data[fp]['checked'] = self.all_checked
        self.refresh_list()

    def remove_selected(self):
        self.archive_timer.stop()
        self.inner_timer.stop()
        fps_to_remove = [fp for fp, data in self.archive_data.items() if data.get('checked', False)]
        for fp in fps_to_remove: del self.archive_data[fp]
        self.refresh_list()
        if self.table_archives.rowCount() > 0: self.table_archives.selectRow(0) 
        else: 
            self.table_inner.setRowCount(0); self.render_image("cover", None, None); self.render_image("inner", None, None)
            self.current_archive_path = None

    def remove_highlighted(self):
        self.archive_timer.stop()
        self.inner_timer.stop()
        selected_items = self.table_archives.selectedItems()
        if not selected_items: return
        rows_to_remove = set([item.row() for item in selected_items])
        next_select_row = sorted(list(rows_to_remove))[0]
        
        fps_to_remove = []
        for row in rows_to_remove:
            item = self.table_archives.item(row, 0)
            if item:
                fp = item.data(Qt.ItemDataRole.UserRole)
                if fp: fps_to_remove.append(fp)
                
        if not fps_to_remove: return
        for fp in fps_to_remove: del self.archive_data[fp]
        self.refresh_list()
        
        total_rows = self.table_archives.rowCount()
        if total_rows > 0: self.table_archives.selectRow(min(next_select_row, total_rows - 1)) 
        else: 
            self.table_inner.setRowCount(0); self.render_image("cover", None, None); self.render_image("inner", None, None)
            self.current_archive_path = None

    def clear_list(self):
        self.archive_timer.stop()
        self.inner_timer.stop()
        self.archive_data.clear()
        self.refresh_list()
        self.table_inner.setRowCount(0)
        self.render_image("cover", None, None); self.render_image("inner", None, None)
        self.current_archive_path = None

    def get_targets(self):
        return [fp for fp, d in self.archive_data.items() if d.get('checked', False)]

    def get_pattern(self):
        if self.chk_keep_name.isChecked():
            return "__KEEP_NAME__"
        return self.cb_pattern.currentText()

    def get_custom_text(self):
        return self.entry_custom.text()
    
    def get_start_num(self):
        try:
            return int(self.le_start_num.text() or 0)
        except ValueError:
            return 0

    def process_paths(self, paths):
        """
        폴더 탭(TabFolder) 등 외부에서 전달받은 파일/폴더 경로 리스트를 처리하여 목록에 추가합니다.
        """
        target_exts = {'.zip', '.cbz', '.cbr', '.rar', '.7z'}
        valid_paths = []
        
        for p in paths:
            path_obj = Path(p)
            if path_obj.is_file() and path_obj.suffix.lower() in target_exts:
                valid_paths.append(str(path_obj))
            elif path_obj.is_dir():
                for root, _, files in os.walk(p):
                    for f in files:
                        if Path(f).suffix.lower() in target_exts:
                            valid_paths.append(os.path.join(root, f))
        
        if not valid_paths:
            return
            
        for fp in valid_paths:
            if fp not in self.archive_data:
                self.load_archive_info(fp, batch_mode=True)
                
        self.refresh_list()
        
        # 목록이 갱신된 후, 선택된 항목이 없다면 첫 번째 항목을 자동 선택
        if self.table_archives.rowCount() > 0 and self.current_archive_path is None:
            self.table_archives.selectRow(0)

    def load_archive_info(self, filepath, batch_mode=False):
        try:
            size_mb = os.path.getsize(filepath) / (1024 * 1024)
            ext = Path(filepath).suffix.lower()
            if ext in ['.zip', '.cbz']:
                with zipfile.ZipFile(filepath, 'r') as zf:
                    entries = sorted([{
                        'original_name': info.filename,
                        'filename': info.filename.replace('\\', '/'),
                        'file_size': info.file_size
                    } for info in zf.infolist() if not info.is_dir()], key=lambda x: natural_keys(x['filename']))
            else:
                if not os.path.exists(self.main_app.seven_zip_path): return False
                task = FileLoadTask([], self.main_app.seven_zip_path, self.main_app.lang, self.main_app.signals)
                entries = sorted(task.get_7z_entries(filepath), key=lambda x: natural_keys(x['filename']))

            image_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'}
            img_entries = [e for e in entries if Path(e['filename']).suffix.lower() in image_exts]
            if not img_entries: return False 
            
            # 최초 로드 시 'Cover'라는 이름을 가진 파일이 있다면 배열 맨 앞으로 당겨옵니다.
            cover = next((e for e in img_entries if os.path.basename(e['filename']).lower().startswith('cover')), None)
            if cover:
                img_entries.remove(cover)
                img_entries.insert(0, cover)

            nested_exts = {'.zip', '.cbz', '.cbr', '.7z', '.rar', '.alz', '.egg'}
            if any(Path(e['filename']).suffix.lower() in nested_exts for e in entries):
                if not batch_mode:
                    msg = f"[{os.path.basename(filepath)}]\n" + self.main_app.i18n[self.main_app.lang].get("msg_reload_nested", "")
                    QMessageBox.warning(self, self.main_app.i18n[self.main_app.lang].get("dlg_warn", "Warning"), msg)
                return "nested"

            self.archive_data[filepath] = {
                'checked': True,
                'cap_opt': False,
                'exif_opt': True,
                'entries': img_entries, 'size_mb': size_mb, 'name': os.path.basename(filepath), 'ext': ext
            }

            return True
        except: return False

    def move_inner_item(self, from_idx, to_idx):
        if not self.current_archive_path or self.current_archive_path not in self.archive_data:
            return
        
        entries = self.archive_data[self.current_archive_path]['entries']
        
        # 인덱스 유효성 검사
        if from_idx < 0 or from_idx >= len(entries) or to_idx < 0 or to_idx >= len(entries):
            return
            
        # 데이터 배열 내에서 위치 교환
        item = entries.pop(from_idx)
        entries.insert(to_idx, item)
        
        # UI 목록 재구성 및 이동된 행 다시 선택
        self.update_inner_preview_list()
        self.table_inner.selectRow(to_idx)


    def update_action_buttons(self):
        """버튼 텍스트와 스타일을 갱신하고, 마우스 오버 시 표시될 툴팁을 설정합니다."""
        t = self.main_app.i18n[self.main_app.lang]
        qual = self.main_app.config.get("img_quality", 85)
        
        style_on = "background-color: #3498DB; color: white; font-weight: bold; border-radius: 4px; padding: 6px 12px; border: none;"
        style_off = "background-color: #3a3a3a; color: white; font-weight: bold; border-radius: 4px; padding: 6px 12px; border: 1px solid #555;"

        # 1. 전체 선택 버튼
        is_all = getattr(self, 'all_checked', True)
        self.btn_sel_all.setText(("☑ " if is_all else "☐ ") + t.get("btn_sel_all", "전체 선택"))
        self.btn_sel_all.setStyleSheet(style_on if is_all else style_off)
        # 전체 선택 버튼에도 툴팁이 필요하다면 아래 주석을 해제하세요.
        # self.btn_sel_all.setToolTip(t.get("toggle_all", "전체 선택/해제"))
        
        # 2. 이미지 압축 일괄 버튼 (기존 용량 최적화)
        is_cap = getattr(self, 'cap_all_checked', False)
        # 버튼 텍스트 설정 시 명칭 변경 반영 ("이미지 압축 일괄")
        self.btn_cap_all.setText(f"{'☑ ' if is_cap else '☐ '}{t.get('btn_cap_all', '이미지 압축 일괄')} ({qual}%)")
        self.btn_cap_all.setStyleSheet(style_on if is_cap else style_off)
        # 🌟 마우스 오버 시 tt_cap_opt 내용 표시
        self.btn_cap_all.setToolTip(t.get("tt_cap_opt", "이미지 압축 설명"))
        
        # 3. EXIF 제거 일괄 버튼
        is_exif = getattr(self, 'exif_all_checked', True)
        self.btn_exif_all.setText(("☑ " if is_exif else "☐ ") + t.get("btn_exif_all", "EXIF 제거 일괄"))
        self.btn_exif_all.setStyleSheet(style_on if is_exif else style_off)
        # 🌟 마우스 오버 시 tt_exif_rem 내용 표시
        self.btn_exif_all.setToolTip(t.get("tt_exif_rem", "EXIF 제거 설명"))

    def toggle_all_items(self):
        self.all_checked = not getattr(self, 'all_checked', True)
        for fp in self.archive_data:
            self.archive_data[fp]['checked'] = self.all_checked
        self.update_action_buttons()
        self.refresh_list()

    def toggle_all_cap(self):
        self.cap_all_checked = not getattr(self, 'cap_all_checked', False)
        for fp in self.archive_data:
            self.archive_data[fp]['cap_opt'] = self.cap_all_checked
        self.update_action_buttons()
        self.refresh_list()

    def toggle_all_exif(self):
        self.exif_all_checked = not getattr(self, 'exif_all_checked', True)
        for fp in self.archive_data:
            self.archive_data[fp]['exif_opt'] = self.exif_all_checked
        self.update_action_buttons()
        self.refresh_list()
