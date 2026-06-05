import re
import os
import json
import sqlite3
import qtawesome as qta
from datetime import datetime
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QAbstractTableModel, QModelIndex, QTimer
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QTextEdit, QPushButton, 
    QFormLayout, QComboBox, QSlider, QFrame, QCheckBox, QDialogButtonBox,
    QTabWidget, QWidget, QLineEdit, QMessageBox, QGroupBox, QListWidget,
    QGridLayout, QTableWidget, QTableWidgetItem, QHeaderView, QAbstractItemView,
    QTableView, QSpinBox, QStackedWidget, QProgressBar
)
from PyQt6.QtGui import QColor
from ui.widgets import Toast

class PreviewTableModel(QAbstractTableModel):
    def __init__(self, data=None, headers=None):
        super().__init__()
        self._data = data or []
        self._headers = headers or ["Old Name", "New Name", "Status", "Path"]

    def rowCount(self, parent=QModelIndex()): return len(self._data)
    def columnCount(self, parent=QModelIndex()): return len(self._headers)
    
    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid(): return None
        row = self._data[index.row()]
        
        if role == Qt.ItemDataRole.DisplayRole:
            return str(row[index.column()])
            
        elif role == Qt.ItemDataRole.ForegroundRole:
            if index.column() == 1: # New Name
                return QColor("#3498DB") if row[0] != row[1] else QColor("white")
            elif index.column() == 2: # Status
                if row[2] == "OK" or row[2] == "정상" or row[2] == "正常": return QColor("#2ECC71")
                else: return QColor("#E74C3C") # Conflict / Invalid
        return None

    def headerData(self, section, orientation, role=Qt.ItemDataRole.DisplayRole):
        if role == Qt.ItemDataRole.DisplayRole and orientation == Qt.Orientation.Horizontal:
            return self._headers[section]
        return None

    def update_data(self, new_data):
        self.beginResetModel()
        self._data = new_data
        self.endResetModel()

# --- [수정됨] 여러 규칙을 동시에 순차적으로 적용하도록 개편된 Worker ---
class PreviewWorker(QThread):
    preview_ready = pyqtSignal(list)

    def __init__(self, file_paths, rule_data, i18n):
        super().__init__()
        self.file_paths = file_paths
        self.rule_data = rule_data
        self.i18n = i18n
        self.is_cancelled = False

    def run(self):
        import re
        import os
        
        result_data = []
        seen_new_paths = set()
        invalid_chars = re.compile(r'[\\/:*?"<>|]')
        
        status_ok = self.i18n.get("tf_status_ok", "정상")
        status_conflict = self.i18n.get("tf_status_conflict", "중복")
        status_invalid = self.i18n.get("tf_status_invalid", "불가")

        old_str = self.rule_data.get("old_str", "")
        new_str = self.rule_data.get("new_str", "")
        use_regex = self.rule_data.get("use_regex", False)
        case_sens = self.rule_data.get("case_sens", False)
        
        use_num = self.rule_data.get("use_num", False)
        num_start = self.rule_data.get("num_start", 1)
        num_digits = self.rule_data.get("num_digits", 3)
        num_pos = self.rule_data.get("num_pos", 0)
        
        use_padding = self.rule_data.get("use_padding", False)
        pad_digits = self.rule_data.get("pad_digits", 3)

        for i, old_path in enumerate(self.file_paths):
            if self.is_cancelled: return
            
            dir_name = os.path.dirname(old_path)
            old_name = os.path.basename(old_path)
            name_no_ext, ext = os.path.splitext(old_name)
            
            # 1. 사용자가 입력한 형식에 '.cbz' 등의 확장자가 포함되어 있다면, 
            # 이름과 확장자를 분리하지 않고 파일명 전체를 대상으로 변환을 시도합니다.
            if ext and ((old_str and ext.lower() in old_str.lower()) or (new_str and ext.lower() in new_str.lower())):
                curr_name = old_name
                curr_ext = ""
            else:
                curr_name = name_no_ext
                curr_ext = ext
            
            try:
                flags = 0 if case_sens else re.IGNORECASE
                
                if old_str:
                    if use_regex:
                        curr_name = re.sub(old_str, new_str, curr_name, flags=flags)
                    else:
                        has_wildcard = bool(re.search(r'%\d+|\*|\?', old_str))
                        if not has_wildcard:
                            escaped_old = re.escape(old_str)
                            curr_name = re.sub(escaped_old, lambda m: new_str, curr_name, flags=flags)
                        else:
                            pattern_str = ""
                            var_map = {}
                            group_idx = 1
                            
                            tokens = re.split(r'(%\d+|\*|\?)', old_str)
                            for token in tokens:
                                if not token: continue
                                if re.match(r'%\d+', token):
                                    var_map[group_idx] = int(token[1:])
                                    pattern_str += r'(.*?)'
                                    group_idx += 1
                                elif token == '*':
                                    pattern_str += r'(.*?)'
                                    group_idx += 1
                                elif token == '?':
                                    pattern_str += r'(.)'
                                    group_idx += 1
                                else:
                                    pattern_str += re.escape(token)
                                    
                            regex_pattern = f"^{pattern_str}$"
                            match = re.match(regex_pattern, curr_name, flags=flags)
                            
                            if match:
                                extracted_vars = {}
                                for g_idx, v_id in var_map.items():
                                    extracted_vars[v_id] = match.group(g_idx)
                                    
                                def build_new_str(m):
                                    var_id = int(m.group(1))
                                    return extracted_vars.get(var_id, m.group(0))
                                    
                                curr_name = re.sub(r'%(\d+)', build_new_str, new_str)
                else:
                    if new_str:
                        def build_new_from_empty(m):
                            return name_no_ext
                        curr_name = re.sub(r'%(\d+)', build_new_from_empty, new_str)

                # 2. 숫자 자리수 맞추기 (단순 zfill 문자 채우기가 아닌 실제 정수화 후 0 패딩 처리)
                if use_padding:
                    def pad_match(m):
                        val_int = int(m.group(0))  # 001과 같은 데이터를 실제 1로 변환
                        return f"{val_int:0{pad_digits}d}" # 사용자가 지정한 자리수에 맞춰 새롭게 0을 채움
                    curr_name = re.sub(r'\d+', pad_match, curr_name)

                # 3. 순번 적용
                if use_num:
                    num_str = f"{num_start + i:0{num_digits}d}"
                    if num_pos == 0: curr_name = f"{num_str}_{curr_name}"
                    else: curr_name = f"{curr_name}_{num_str}"

            except Exception as e:
                print(f"[Rename Error] {e}")

            new_name = f"{curr_name}{curr_ext}"
            new_path = os.path.join(dir_name, new_name)
            status = status_ok
            
            if invalid_chars.search(new_name):
                status = status_invalid
            elif new_path != old_path:
                if new_path.lower() in seen_new_paths or os.path.exists(new_path):
                    status = status_conflict
            
            seen_new_paths.add(new_path.lower())
            result_data.append((old_name, new_name, status, old_path))
            
        self.preview_ready.emit(result_data)
        
class RenameWorker(QThread):
    progress = pyqtSignal(int, int)
    finished_batch = pyqtSignal(dict, list)

    def __init__(self, rename_tasks):
        super().__init__()
        self.rename_tasks = rename_tasks

    def run(self):
        success_map = {}
        errors = []
        total = len(self.rename_tasks)
        
        for i, (old_path, new_path) in enumerate(self.rename_tasks):
            if old_path != new_path:
                try:
                    os.rename(old_path, new_path)
                    success_map[new_path] = old_path 
                except Exception as e:
                    errors.append(f"{os.path.basename(old_path)}: {str(e)}")
            self.progress.emit(i + 1, total)
            
        self.finished_batch.emit(success_map, errors)


# --- [추가됨] 한글 조합 중에도 실시간으로 이벤트를 발생시키는 커스텀 입력창 ---
class IMELineEdit(QLineEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._preedit_text = ""

    def inputMethodEvent(self, event):
        super().inputMethodEvent(event)
        # 현재 한글 조합 중인(밑줄 친) 글자를 실시간으로 저장합니다.
        self._preedit_text = event.preeditString()
        # 조합 중인 텍스트가 바뀔 때마다 실시간으로 이벤트를 발생시킵니다.
        self.textChanged.emit(self.text())

    def text(self):
        # 1. 이미 조합이 완료된 기존 텍스트를 가져옵니다.
        base_text = super().text()
        
        # 2. 조합 중인 글자가 있다면, 현재 커서 위치에 해당 글자를 끼워 넣어서 반환합니다.
        if self._preedit_text:
            cursor = self.cursorPosition()
            return base_text[:cursor] + self._preedit_text + base_text[cursor:]
            
        return base_text

# --- [수정됨] Everything 스타일 복합 다이얼로그 UI ---
class MultiRenameDialog(QDialog):
    def __init__(self, file_paths, i18n, parent=None):
        super().__init__(parent)
        self.file_paths = file_paths
        self.i18n = i18n
        # 부모로부터 config 로드하여 폰트 배율 가져오기
        self.config = parent.config if parent and hasattr(parent, 'config') else {}
        
        self.setWindowTitle(i18n.get("tf_rename_title", "여러 파일 이름 바꾸기"))
        self.resize(1000, 650)
        
        self.preview_thread = None
        self.debounce_timer = QTimer()
        self.debounce_timer.setSingleShot(True)
        self.debounce_timer.timeout.connect(self._run_preview_worker)
        
        self.setup_ui()
        self.auto_infer_patterns() # 자동 패턴 추론
        self.schedule_preview()

    def setup_ui(self):
        main_layout = QVBoxLayout(self)
        
        opt_group = QGroupBox(self.i18n.get("tf_rename_mode", "이름 바꾸기 규칙"))
        opt_group.setStyleSheet("QGroupBox { font-weight: bold; border: 1px solid #555; margin-top: 10px; padding-top: 15px; }")
        grid = QGridLayout(opt_group)
        
        grid.addWidget(QLabel(self.i18n.get("tf_old_format", "기존 형식:")), 0, 0)
        self.le_old = IMELineEdit() 
        grid.addWidget(self.le_old, 0, 1)

        grid.addWidget(QLabel(self.i18n.get("tf_new_format", "새 형식:")), 1, 0)
        self.le_new = IMELineEdit()
        grid.addWidget(self.le_new, 1, 1)

        checkbox_layout = QHBoxLayout()
        self.chk_case = QCheckBox(self.i18n.get("tf_case_sensitive", "대소문자 구분"))
        self.chk_regex = QCheckBox(self.i18n.get("tf_use_regex", "정규식(Regex) 모드"))
        self.chk_folder_name = QCheckBox(self.i18n.get("tf_use_folder_name", "폴더명으로 이름 바꾸기"))
        
        # [추가됨] 숫자 자리수 맞추기 위젯
        self.chk_pad = QCheckBox(self.i18n.get("tf_use_padding", "숫자 자리수 맞추기:"))
        self.sp_pad = QSpinBox()
        self.sp_pad.setRange(1, 4)
        self.sp_pad.setValue(3)
        self.sp_pad.setEnabled(False)
        self.chk_pad.stateChanged.connect(lambda state: self.sp_pad.setEnabled(state == Qt.CheckState.Checked.value))
        
        checkbox_layout.addWidget(self.chk_case)
        checkbox_layout.addWidget(self.chk_regex)
        checkbox_layout.addWidget(self.chk_folder_name)
        checkbox_layout.addWidget(self.chk_pad)
        checkbox_layout.addWidget(self.sp_pad)
        checkbox_layout.addStretch()
        grid.addLayout(checkbox_layout, 2, 1)

        num_layout = QHBoxLayout()
        self.chk_num = QCheckBox(self.i18n.get("tf_rule_numbering", "순번 추가"))
        self.sp_start = QSpinBox(); self.sp_start.setRange(0, 99999); self.sp_start.setValue(1)
        self.sp_digits = QSpinBox(); self.sp_digits.setRange(1, 10); self.sp_digits.setValue(3)
        self.cb_pos = QComboBox()
        self.cb_pos.addItems([self.i18n.get("tf_pos_front", "앞(Front)"), self.i18n.get("tf_pos_back", "뒤(Back)")])
        
        self.num_widgets = [self.sp_start, self.sp_digits, self.cb_pos]
        for w in self.num_widgets: w.setEnabled(False)
        self.chk_num.stateChanged.connect(lambda state: [w.setEnabled(state == Qt.CheckState.Checked.value) for w in self.num_widgets])
        
        num_layout.addWidget(self.chk_num)
        num_layout.addWidget(QLabel(self.i18n.get("tf_num_start", "시작:")))
        num_layout.addWidget(self.sp_start)
        num_layout.addWidget(QLabel(self.i18n.get("tf_num_digits", "자리수:")))
        num_layout.addWidget(self.sp_digits)
        num_layout.addWidget(QLabel(self.i18n.get("tf_num_pos", "위치:")))
        num_layout.addWidget(self.cb_pos)
        num_layout.addStretch()
        grid.addLayout(num_layout, 3, 0, 1, 2)

        main_layout.addWidget(opt_group)
        
        for widget in [self.le_old, self.le_new]:
            widget.textChanged.connect(self.schedule_preview)
        # [수정됨] 새로 추가된 체크박스 이벤트 바인딩
        for widget in [self.chk_case, self.chk_num, self.chk_pad]:
            widget.stateChanged.connect(self.schedule_preview)
            
        self.chk_regex.stateChanged.connect(self.toggle_regex_mode)
        self.chk_folder_name.stateChanged.connect(self.toggle_folder_name_mode)
        
        # [수정됨] 스핀박스 변경 이벤트 바인딩 추가
        for widget in [self.sp_start, self.sp_digits, self.sp_pad]:
            widget.valueChanged.connect(self.schedule_preview)
        self.cb_pos.currentIndexChanged.connect(self.schedule_preview)

        headers = [self.i18n.get("tf_col_old_name", "이전 파일 이름"), 
                   self.i18n.get("tf_col_new_name", "새 파일 이름"), 
                   self.i18n.get("tf_col_status", "상태"), 
                   self.i18n.get("tf_col_path", "경로")]
        
        self.table_model = PreviewTableModel([], headers)
        self.table_view = QTableView()
        self.table_view.setModel(self.table_model)
        self.table_view.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Interactive)
        self.table_view.horizontalHeader().setStretchLastSection(True)
        self.table_view.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table_view.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table_view.verticalHeader().hide()
        main_layout.addWidget(self.table_view)
        
        bottom_layout = QHBoxLayout()
        self.progress_bar = QProgressBar(); self.progress_bar.hide()
        bottom_layout.addWidget(self.progress_bar)
        
        self.btn_ok = QPushButton(self.i18n.get("btn_ok", "확인"))
        self.btn_ok.setStyleSheet(f"background-color: {self.config['btn_primary']};")
        self.btn_ok.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_cancel = QPushButton(self.i18n.get("btn_cancel", "취소"))
        self.btn_cancel.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_ok.clicked.connect(self.execute_rename)
        self.btn_cancel.clicked.connect(self.reject)
        bottom_layout.addWidget(self.btn_ok); bottom_layout.addWidget(self.btn_cancel)
        main_layout.addLayout(bottom_layout)
        
        self.table_view.setColumnWidth(0, 300); self.table_view.setColumnWidth(1, 300); self.table_view.setColumnWidth(2, 80)
        
        self.table_view.setStyleSheet(f"font-size: {self.config['s11']}px;")
        self.table_view.horizontalHeader().setStyleSheet(f"font-size: {self.config['s11']}px;")

    def toggle_regex_mode(self, state):
        import re
        old_text = self.le_old.text()
        new_text = self.le_new.text()
        
        self.le_old.blockSignals(True)
        self.le_new.blockSignals(True)
        
        if state == Qt.CheckState.Checked.value:
            # 일반 -> 정규식 변환 시 애브리띵처럼 (.*) 포맷 사용
            new_old = re.sub(r'%\d+', r'(.*)', old_text)
            new_new = re.sub(r'%(\d+)', r'\\\1', new_text)
        else:
            # 정규식 -> 일반 복구
            counter = [1]
            def replace_group(match):
                val = f"%{counter[0]}"
                counter[0] += 1
                return val
            new_old = re.sub(r'\(\.\*\?\)|\(\.\*\)|\(\\d\+\)', replace_group, old_text)
            new_new = re.sub(r'\\(\d+)', r'%\1', new_text)
            
        self.le_old.setText(new_old)
        self.le_new.setText(new_new)
        
        self.le_old.blockSignals(False)
        self.le_new.blockSignals(False)
        self.schedule_preview()

    def toggle_folder_name_mode(self, state):
        import re
        import os
        from PyQt6.QtCore import Qt
        
        if state == Qt.CheckState.Checked.value:
            self._saved_new_text = self.le_new.text()
            
            if self.file_paths:
                folder_name = os.path.basename(os.path.dirname(self.file_paths[0]))
                current_text = self.le_new.text()
                
                var_symbol = r'\\' if self.chk_regex.isChecked() else r'%'
                pattern = rf'^(.*?)({var_symbol}\d+)(.*)$'
                
                match = re.match(pattern, current_text)
                if match:
                    new_text = f"{folder_name} {match.group(2)}{match.group(3)}"
                    self.le_new.setText(new_text)
                else:
                    suffix = r'\1' if self.chk_regex.isChecked() else '%1'
                    self.le_new.setText(f"{folder_name} {suffix}")
        else:
            if hasattr(self, '_saved_new_text'):
                self.le_new.setText(self._saved_new_text)

    def auto_infer_patterns(self):
        import re
        import os
        import difflib
        
        if not self.file_paths: return
        
        names = [os.path.basename(p) for p in self.file_paths]
        if len(names) < 1: return

        # 파일명을 언어(한글/영문 등), 숫자, 공백, 기호 단위로 스마트하게 쪼개기(Tokenize)
        def tokenize(s):
            # [^\d\W_]+ : 언어 문자 (영어, 한글, 일본어 등)
            # \d+ : 숫자 덩어리
            # \s+ : 공백 덩어리
            # [^\w\s]+ : 특수기호 덩어리 (., -, [ 등)
            # _ : 언더바
            return [t for t in re.split(r'([^\d\W_]+|\d+|\s+|[^\w\s]+|_)', s) if t]

        # 첫 번째 파일명을 기준으로 삼음
        ref_tokens = tokenize(names[0])
        common_mask = [True] * len(ref_tokens)

        # 나머지 파일들과 비교하여 토큰(단어/기호) 단위로 완벽하게 동일한 부분만 남김
        for name in names[1:]:
            tokens = tokenize(name)
            matcher = difflib.SequenceMatcher(None, ref_tokens, tokens)
            blocks = matcher.get_matching_blocks()
            
            new_mask = [False] * len(ref_tokens)
            for i, j, n in blocks:
                for k in range(n):
                    new_mask[i + k] = True
                    
            # 모든 파일에서 공통으로 등장하는 토큰만 True 유지
            for i in range(len(ref_tokens)):
                common_mask[i] = common_mask[i] and new_mask[i]

        old_pattern = ""
        new_pattern = ""
        var_idx = 1
        in_diff = False

        # 분석된 Mask를 바탕으로 %1, %2 등의 변수와 고정 문자열 조립
        for i in range(len(ref_tokens)):
            if common_mask[i]:
                if in_diff:
                    in_diff = False
                old_pattern += ref_tokens[i]
                new_pattern += ref_tokens[i]
            else:
                if not in_diff:
                    old_pattern += f"%{var_idx}"
                    new_pattern += f"%{var_idx}"
                    var_idx += 1
                    in_diff = True

        # 만약 전체가 달라서 패턴이 빈 값이라면 기본값 처리
        if not old_pattern:
            old_pattern = "%1"
            new_pattern = "%1"

        # 정규식 모드가 켜져있다면 (.*) 포맷으로 치환
        if self.chk_regex.isChecked():
            old_pattern = re.sub(r'%\d+', r'(.*)', old_pattern)
            new_pattern = re.sub(r'%(\d+)', r'\\\1', new_pattern)

        self.le_old.setText(old_pattern)
        self.le_new.setText(new_pattern)

    def schedule_preview(self):
        self.debounce_timer.start(100)

    def _run_preview_worker(self):
        if self.preview_thread and self.preview_thread.isRunning():
            self.preview_thread.is_cancelled = True
            self.preview_thread.wait()

        rule_data = {
            "old_str": self.le_old.text(),
            "new_str": self.le_new.text(),
            "use_regex": self.chk_regex.isChecked(),
            "case_sens": self.chk_case.isChecked(),
            "use_num": self.chk_num.isChecked(),
            "num_start": self.sp_start.value(),
            "num_digits": self.sp_digits.value(),
            "num_pos": self.cb_pos.currentIndex(),
            "use_padding": self.chk_pad.isChecked(), # [추가됨] 자리수 맞추기 상태
            "pad_digits": self.sp_pad.value()        # [추가됨] 선택된 자리수
        }

        self.preview_thread = PreviewWorker(self.file_paths, rule_data, self.i18n)
        self.preview_thread.preview_ready.connect(self.table_model.update_data)
        self.preview_thread.start()

    def execute_rename(self):
        tasks = []
        for row in self.table_model._data:
            old_name, new_name, status, path = row
            if (status == self.i18n.get("tf_status_ok", "정상") or status == "OK") and old_name != new_name:
                tasks.append((path, os.path.join(os.path.dirname(path), new_name)))
        if not tasks: self.accept(); return
        self.btn_ok.setEnabled(False); self.progress_bar.show(); self.progress_bar.setMaximum(len(tasks))
        self.rename_thread = RenameWorker(tasks)
        self.rename_thread.progress.connect(self.progress_bar.setValue)
        self.rename_thread.finished_batch.connect(self.on_rename_finished)
        self.rename_thread.start()

    def on_rename_finished(self, success_map, errors):
        if success_map:
            try:
                import json; from datetime import datetime
                history_file = os.path.join(os.getcwd(), "rename_history.json")
                history = []
                if os.path.exists(history_file):
                    with open(history_file, "r", encoding="utf-8") as f: history = json.load(f)
                history.append({"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "mapping": success_map})
                if len(history) > 10: history = history[-10:]
                with open(history_file, "w", encoding="utf-8") as f: json.dump(history, f, ensure_ascii=False, indent=2)
            except: pass
        if errors: QMessageBox.warning(self, self.i18n.get("msg_notice", "알림"), self.i18n.get("msg_multi_rename_errors").format(len(success_map), "\n".join(errors[:10])))
        else: from ui.widgets import Toast; Toast.show(self.parent(), self.i18n.get("msg_multi_rename_done").format(len(success_map)))
        self.accept()

class LogDialog(QDialog):
    def __init__(self, parent, stats, i18n, show_continue_btn=False, continue_key="btn_continue_tab2"):
        super().__init__(parent)
        
        parent_config = parent.config if hasattr(parent, 'config') else {}
        s14 = parent_config.get("s14", 14)
        s11 = parent_config.get("s11", 11)
        
        self.setWindowTitle(i18n["log_title"])
        self.resize(550, 400)
        self.setWindowFlags(self.windowFlags() & ~Qt.WindowType.WindowContextHelpButtonHint)
        
        self.setStyleSheet("""
            QDialog { background-color: #1e1e1e; color: #ffffff; font-family: 'Segoe UI Emoji'; }
            QLabel { color: #ffffff; }
        """)
        
        layout = QVBoxLayout(self)
        lbl_summary = QLabel(f"Success: {len(stats['success'])}  |  Skip: {len(stats['skip'])}  |  Error: {len(stats['error'])}")
        # 하드코딩된 font-size를 배율이 적용된 s14로 변경
        lbl_summary.setStyleSheet(f"font-weight: bold; font-size: {s14}px; margin-bottom: 10px; color: #ffffff;")
        layout.addWidget(lbl_summary)
        
        self.text_edit = QTextEdit()
        self.text_edit.setReadOnly(True)
        # 폰트 크기 s11 적용
        self.text_edit.setStyleSheet(f"background-color: #1a1a1a; color: #e0e0e0; font-family: Consolas, monospace; font-size: {s11}px; padding: 10px; border: none; border-radius: 4px;")
        
        log_content = ""
        if stats['error']: log_content += "[ERRORS]\n" + "\n".join(stats['error']) + "\n\n"
        if stats['success']: log_content += "[SUCCESS]\n" + "\n".join(stats['success']) + "\n\n"
        if stats['skip']: log_content += "[SKIPPED]\n" + "\n".join(stats['skip']) + "\n"
        self.text_edit.setText(log_content)
        layout.addWidget(self.text_edit)
        
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        if show_continue_btn:
            btn_cont = QPushButton(i18n.get(continue_key, "Continue"))
            btn_cont.setCursor(Qt.CursorShape.PointingHandCursor)
            btn_cont.setStyleSheet("background-color: #27AE60; color: white; font-weight: bold; padding: 8px 15px; border-radius: 4px; border: none;")
            btn_cont.clicked.connect(self.accept)
            btn_layout.addWidget(btn_cont)
            
        btn_close = QPushButton(i18n["btn_close"])
        btn_close.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_close.setStyleSheet("background-color: #555; color: white; font-weight: bold; padding: 8px 15px; border-radius: 4px; border: none;")
        btn_close.clicked.connect(self.reject)
        btn_layout.addWidget(btn_close)
        layout.addLayout(btn_layout)

class SettingsDialog(QDialog):
    def __init__(self, parent, config, format_keys, i18n):
        super().__init__(parent)
        self.config = config
        self.i18n = i18n[config["lang"]]
        self.setWindowTitle(self.i18n.get("settings_title", "환경 설정"))
        
        # self.setFixedSize(500, 750) 
        self.resize(500, 750)
        self.setMinimumSize(500, 750)

        self.setWindowFlags(self.windowFlags() & ~Qt.WindowType.WindowContextHelpButtonHint)

        self.chk_pass_skip_meta = QCheckBox(self.i18n.get("opt_pass_skip_meta", "스킵된 파일도 메타데이터 관리로 넘기기"))
        self.chk_pass_skip_meta.setToolTip(self.i18n.get("opt_pass_skip_meta_tip", ""))
        self.chk_pass_skip_meta.setChecked(self.config.get("pass_skip_meta", False))

        # 🌟 CSS에 동적 폰트 패밀리 적용
        self.setStyleSheet(f"""
            QDialog, QWidget {{ background-color: #1e1e1e; color: #ffffff; font-family: {self.config['font_family_str']}; }}
            QLabel, QCheckBox {{ background-color: transparent; color: #ffffff; }}
            
            QTabWidget::pane {{ border: 1px solid #444; border-radius: 5px; background: #1e1e1e; }}
            
            QTabBar::tab {{ background: #2b2b2b; color: #888; border: 1px solid #444; padding: 8px 20px; font-weight: bold; }}
            QTabBar::tab:selected {{ background: #3a7ebf; color: #ffffff; }}
            
            QGroupBox {{ border: 1px solid #555; border-radius: 6px; margin-top: 15px; padding-top: 15px; font-weight: bold; color: #ffffff; background-color: transparent; }}
            QGroupBox::title {{ subcontrol-origin: margin; left: 10px; padding: 0 5px; color: #3498DB; }}
            
            QComboBox, QLineEdit, QTextEdit {{ background-color: #3a3a3a; color: #ffffff; border: 1px solid #555; border-radius: 4px; padding: 5px; }}
            QPushButton {{ background-color: #3a3a3a; color: white; border-radius: 4px; padding: 6px 12px; font-weight: bold; border: 1px solid #555; }}
            QPushButton:hover {{ background-color: #4a4a4a; }}
            
            QSlider::groove:horizontal {{ border-radius: 4px; height: 8px; background: #3a3a3a; }}
            QSlider::handle:horizontal {{ background: #3498DB; width: 16px; height: 16px; margin: -4px 0; border-radius: 8px; }}
        """)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(15, 15, 15, 15)
        
        self.tabs = QTabWidget()
        self.tab_basic = QWidget()
        basic_layout = QVBoxLayout(self.tab_basic)
        basic_layout.setContentsMargins(15, 15, 15, 15)
        basic_layout.setSpacing(15)
        
        form_layout = QFormLayout()
        form_layout.setSpacing(15)


        self.cb_lang = QComboBox()
        self.cb_lang.setCursor(Qt.CursorShape.PointingHandCursor)
        self.cb_lang.addItems(["한국어", "English", "日本語"])
        
        if config["lang"] == "ko": lang_text = "한국어"
        elif config["lang"] == "ja": lang_text = "日本語"
        else: lang_text = "English"
        self.cb_lang.setCurrentText(lang_text)
        
        form_layout.addRow(self.i18n.get("lang_lbl", "언어:"), self.cb_lang)

        # ---------------- 알림 소리 설정 항목 추가 ----------------
        self.cb_sound = QComboBox()
        self.cb_sound.setCursor(Qt.CursorShape.PointingHandCursor)
        
        from config import get_resource_path, get_executable_dir
        import os
        
        # 내부 번들링된 리소스 경로 우선 탐색
        sound_dir = get_resource_path('sounds')
        
        # 내부에 없다면 실행 파일과 같은 위치의 외부 sounds 폴더 탐색 (커스텀 추가 지원)
        if not os.path.exists(sound_dir):
            sound_dir = os.path.join(get_executable_dir(), 'sounds')
            
        sound_files = []
        
        if os.path.exists(sound_dir):
            for f in os.listdir(sound_dir):
                if f.lower().endswith(('.mp3', '.wav')):
                    sound_files.append(f)
                    
        default_file = "Default.wav"
        if default_file in sound_files:
            sound_files.remove(default_file)
        
        sound_files.sort()
        sound_files.insert(0, default_file)
        
        for f in sound_files:
            display_name = os.path.splitext(f)[0]
            self.cb_sound.addItem(display_name, f)
        
        curr_sound_file = self.config.get("completion_sound", "Default.wav")
        idx = -1
        for i in range(self.cb_sound.count()):
            if self.cb_sound.itemData(i) == curr_sound_file:
                idx = i
                break
                
        if idx >= 0:
            self.cb_sound.setCurrentIndex(idx)
        else:
            self.cb_sound.setCurrentIndex(0)
            
        def preview_sound(index):
            if index >= 0:
                filename = self.cb_sound.itemData(index)
                from utils import play_sound_file
                play_sound_file(filename)
                
        self.cb_sound.activated.connect(preview_sound)
            
        form_layout.addRow(self.i18n.get("sound_lbl", "완료 알림 소리:"), self.cb_sound)
        # ---------------------------------------------------
        

        # ---------------- 폰트 설정 항목 추가 (수정됨) ----------------
        from PyQt6.QtGui import QFontDatabase
        
        self.cb_font_family = QComboBox()
        self.cb_font_family.setCursor(Qt.CursorShape.PointingHandCursor)
        self.cb_font_family.addItem("Default")
        
        # PyQt6 방식 적용
        for family in QFontDatabase.families():
            self.cb_font_family.addItem(family)
            
        self.cb_font_family.setCurrentText(self.config.get("font_family", "Default"))
        form_layout.addRow(self.i18n.get("font_family_lbl", "글꼴:"), self.cb_font_family)
        
        self.cb_font_scale = QComboBox()
        self.cb_font_scale.setCursor(Qt.CursorShape.PointingHandCursor)
        for val in range(80, 155, 5):
            self.cb_font_scale.addItem(f"{val}%", val)
            
        curr_scale = self.config.get("font_scale", 100)
        idx = self.cb_font_scale.findData(curr_scale)
        if idx >= 0:
            self.cb_font_scale.setCurrentIndex(idx)
        form_layout.addRow(self.i18n.get("font_size_lbl", "크기:"), self.cb_font_scale)
        # ---------------------------------------------------


        self.cb_format = QComboBox()
        self.cb_format.setCursor(Qt.CursorShape.PointingHandCursor)
        self.cb_format.addItems(self.i18n.get("format_opts", ["None"]))
        try: fmt_idx = format_keys.index(config["target_format"])
        except ValueError: fmt_idx = 0
        self.cb_format.setCurrentIndex(fmt_idx)
        form_layout.addRow(self.i18n.get("format_lbl", "포맷:"), self.cb_format)

        from config import get_safe_thread_limits
        total_cores, safe_max, default_threads = get_safe_thread_limits()
        self.slider_threads = QSlider(Qt.Orientation.Horizontal)
        self.slider_threads.setRange(1, safe_max)
        self.slider_threads.setValue(config.get("max_threads", default_threads))
        self.slider_threads.setCursor(Qt.CursorShape.PointingHandCursor)
        
        if config["lang"] == "ko": th_lbl_txt = f"{self.slider_threads.value()} 코어"
        elif config["lang"] == "ja": th_lbl_txt = f"{self.slider_threads.value()} コア"
        else: th_lbl_txt = f"{self.slider_threads.value()} Cores"
        
        self.lbl_threads_val = QLabel(th_lbl_txt)
        self.lbl_threads_val.setFixedWidth(60)
        
        th_layout = QHBoxLayout()
        th_layout.addWidget(self.slider_threads)
        th_layout.addWidget(self.lbl_threads_val)
        
        def update_th_label(v):
            if config["lang"] == "ko": txt = f"{v} 코어"
            elif config["lang"] == "ja": txt = f"{v} コア"
            else: txt = f"{v} Cores"
            self.lbl_threads_val.setText(txt)
            
        self.slider_threads.valueChanged.connect(update_th_label)
        
        lbl_threads_desc = QLabel(self.i18n.get("threads_desc", ""))
        lbl_threads_desc.setWordWrap(True)
        lbl_threads_desc.setStyleSheet(f"color: #E74C3C; font-size: {{self.config['s11']}}px; margin-top: 5px;")
        form_layout.addRow(self.i18n.get("max_threads", "스레드:"), th_layout)
        form_layout.addRow("", lbl_threads_desc)
        basic_layout.addLayout(form_layout)

        line = QFrame(); line.setFrameShape(QFrame.Shape.HLine); line.setObjectName("divider")
        basic_layout.addWidget(line)

        opt_layout = QVBoxLayout(); opt_layout.setSpacing(5)
        self.chk_sound = QCheckBox(self.i18n.get("play_sound", "Play completion sound"))
        self.chk_sound.setCursor(Qt.CursorShape.PointingHandCursor)
        self.chk_sound.setChecked(config.get("play_sound", True))
        opt_layout.addWidget(self.chk_sound)
        opt_layout.addSpacing(15)

        self.chk_backup = QCheckBox(self.i18n.get("backup", "Backup"))
        self.chk_backup.setCursor(Qt.CursorShape.PointingHandCursor)
        self.chk_backup.setChecked(config.get("backup_on", False))
        opt_layout.addWidget(self.chk_backup)

        opt_layout.addSpacing(15)
        self.chk_flatten = QCheckBox(self.i18n.get("flatten", "Flatten"))
        self.chk_flatten.setCursor(Qt.CursorShape.PointingHandCursor)
        self.chk_flatten.setChecked(config.get("flatten_folders", False))
        lbl_flatten_desc = QLabel(self.i18n.get("flatten_desc", ""))
        lbl_flatten_desc.setWordWrap(True)
        lbl_flatten_desc.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px; margin-left: 25px;")
        opt_layout.addWidget(self.chk_flatten)
        opt_layout.addWidget(lbl_flatten_desc)

        opt_layout.addSpacing(15)
        self.chk_pass_skip_meta = QCheckBox(self.i18n.get("opt_pass_skip_meta", "스킵된 파일도 메타데이터 관리로 넘기기"))
        self.chk_pass_skip_meta.setCursor(Qt.CursorShape.PointingHandCursor)
        self.chk_pass_skip_meta.setChecked(config.get("pass_skip_meta", False))
        self.chk_pass_skip_meta.setToolTip(self.i18n.get("opt_pass_skip_meta_tip", ""))
        opt_layout.addWidget(self.chk_pass_skip_meta)

        opt_layout.addSpacing(15)
        
        self.slider_quality = QSlider(Qt.Orientation.Horizontal)
        self.slider_quality.setRange(1, 100)
        self.slider_quality.setValue(config.get("img_quality", 100)) 
        self.slider_quality.setCursor(Qt.CursorShape.PointingHandCursor)
        self.lbl_quality_val = QLabel()
        self.lbl_quality_val.setFixedWidth(90)
        
        qual_layout = QHBoxLayout()
        qual_layout.setContentsMargins(0, 5, 0, 5) 
        
        lbl_qual_title = QLabel(self.i18n.get("common_quality", "이미지 압축 품질 (Quality) :"))
        
        self.slider_quality = QSlider(Qt.Orientation.Horizontal)
        self.slider_quality.setRange(1, 100)
        self.slider_quality.setValue(config.get("img_quality", 85))
        self.slider_quality.setCursor(Qt.CursorShape.PointingHandCursor)
        
        self.lbl_quality_val = QLabel()
        self.lbl_quality_val.setFixedWidth(90)
        
        qual_layout.addWidget(lbl_qual_title)
        qual_layout.addWidget(self.slider_quality)
        qual_layout.addWidget(self.lbl_quality_val)
        
        def update_qual_label(v):
            txt = f"{v}%"
            if v == 100: txt += " (Lossless)"
            self.lbl_quality_val.setText(txt)
        self.slider_quality.valueChanged.connect(update_qual_label)
        update_qual_label(self.slider_quality.value())

        opt_layout.addLayout(qual_layout)

        self.lbl_qual_desc = QLabel(self.i18n.get("tt_img_quality_desc", ""))
        self.lbl_qual_desc.setWordWrap(True)
        self.lbl_qual_desc.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px; margin-left: 25px; margin-bottom: 10px;")
        opt_layout.addWidget(self.lbl_qual_desc)

        opt_layout.addSpacing(10)
        self.chk_webp = QCheckBox(self.i18n.get("webp", "모든 이미지를 WebP로 일괄 변환"))
        self.chk_webp.setCursor(Qt.CursorShape.PointingHandCursor)
        self.chk_webp.setChecked(config.get("webp_conversion", False))
        
        lbl_webp_desc = QLabel(self.i18n.get("webp_desc", "모든 이미지를 고효율 WebP 포맷으로 변환하여 확장자 통일성을 보장합니다."))
        lbl_webp_desc.setWordWrap(True)
        lbl_webp_desc.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px; margin-left: 25px;") 
        
        opt_layout.addWidget(self.chk_webp)
        opt_layout.addWidget(lbl_webp_desc)

        viewer_line = QFrame()
        viewer_line.setFrameShape(QFrame.Shape.HLine)
        viewer_line.setObjectName("divider")
        opt_layout.addWidget(viewer_line)
        
        viewer_layout = QFormLayout()
        viewer_layout.setSpacing(10)
        
        viewer_path_layout = QHBoxLayout()
        viewer_path_layout.setSpacing(5)
        
        self.le_viewer_path = QLineEdit(config.get("viewer_path", ""))
        self.le_viewer_path.setPlaceholderText(self.i18n.get("viewer_placeholder", "뷰어 프로그램(.exe) 경로를 선택하세요"))
        self.le_viewer_path.setReadOnly(True)
        
        self.btn_find_viewer = QPushButton(self.i18n.get("btn_find", "찾기"))
        self.btn_find_viewer.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_find_viewer.clicked.connect(self.browse_viewer_path)
        
        viewer_path_layout.addWidget(self.le_viewer_path)
        viewer_path_layout.addWidget(self.btn_find_viewer)
        
        viewer_layout.addRow(self.i18n.get("viewer_lbl", "뷰어 프로그램:"), viewer_path_layout)
        opt_layout.addLayout(viewer_layout)

        basic_layout.addLayout(opt_layout)
        basic_layout.addStretch()

        self.tab_folder_settings = QWidget()
        folder_set_layout = QVBoxLayout(self.tab_folder_settings)
        folder_set_layout.setContentsMargins(15, 15, 15, 15)
        folder_set_layout.setSpacing(15)
        
        grp_dup_folders = QGroupBox(self.i18n.get("grp_dup_folders_title", "라이브러리 폴더 등록"))
        grp_dup_layout = QVBoxLayout(grp_dup_folders)
        grp_dup_layout.setContentsMargins(15, 20, 15, 15)
        grp_dup_layout.setSpacing(10)

        lbl_dup_desc = QLabel(self.i18n.get("dup_folder_desc", "관리할 라이브러리 대상 폴더를 추가하세요. (등록된 폴더는 중복 검사에도 사용됩니다.)\nNAS나 대용량 드라이브의 폴더를 지정할 수 있습니다."))
        lbl_dup_desc.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px;")
        grp_dup_layout.addWidget(lbl_dup_desc)

        self.list_dup_folders = QListWidget()
        self.list_dup_folders.setStyleSheet("background-color: #3a3a3a; color: white; border: 1px solid #555; border-radius: 4px;")
        for folder in config.get("dup_check_folders", []):
            self.list_dup_folders.addItem(folder)
        grp_dup_layout.addWidget(self.list_dup_folders)

        dup_btn_layout = QHBoxLayout()
        dup_btn_layout.addStretch()
        self.btn_add_dup_folder = QPushButton(self.i18n.get("btn_add", "추가"))
        self.btn_add_dup_folder.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_remove_dup_folder = QPushButton(self.i18n.get("btn_remove", "삭제"))
        self.btn_remove_dup_folder.setCursor(Qt.CursorShape.PointingHandCursor)
        
        dup_btn_layout.addWidget(self.btn_add_dup_folder)
        dup_btn_layout.addWidget(self.btn_remove_dup_folder)
        grp_dup_layout.addLayout(dup_btn_layout)

        self.btn_add_dup_folder.clicked.connect(self.add_dup_folder)
        self.btn_remove_dup_folder.clicked.connect(self.remove_dup_folder)
        
        folder_set_layout.addWidget(grp_dup_folders)

        grp_cache = QGroupBox(self.i18n.get("grp_cache_title", "인덱스 및 캐시 관리"))
        grp_cache_layout = QVBoxLayout(grp_cache)
        grp_cache_layout.setContentsMargins(15, 20, 15, 15)
        grp_cache_layout.setSpacing(15)

        idx_layout = QHBoxLayout()
        lbl_idx_desc = QLabel(self.i18n.get("setting_update_index_desc", "등록된 대상 폴더의 변경사항을 확인하여 인덱스를 동기화합니다."))
        lbl_idx_desc.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px;")
        lbl_idx_desc.setWordWrap(True)
        
        self.btn_update_index = QPushButton(self.i18n.get("setting_update_index", "인덱스 색인 갱신"))
        self.btn_update_index.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_update_index.setStyleSheet("background-color: #27AE60; color: white; padding: 6px 12px; border-radius: 4px; font-weight: bold; border: none;")
        self.btn_update_index.setFixedWidth(160)
        self.btn_update_index.clicked.connect(self.action_update_index)
        
        idx_layout.addWidget(lbl_idx_desc, 1)
        idx_layout.addWidget(self.btn_update_index)
        grp_cache_layout.addLayout(idx_layout)

        cache_layout = QHBoxLayout()
        lbl_cache_desc = QLabel(self.i18n.get("folder_clear_cache_desc", "저장된 모든 중복 파일 매칭 결과 캐시를 초기화합니다."))
        lbl_cache_desc.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px;")
        lbl_cache_desc.setWordWrap(True)

        self.btn_clear_dup_cache = QPushButton(self.i18n.get("folder_clear_cache", "중복 매칭 캐시 초기화"))
        import qtawesome as qta
        self.btn_clear_dup_cache.setIcon(qta.icon('fa5s.trash-alt', color='white'))
        self.btn_clear_dup_cache.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_clear_dup_cache.setStyleSheet("background-color: #E74C3C; color: white; padding: 6px 12px; border-radius: 4px; font-weight: bold; border: none;")
        self.btn_clear_dup_cache.setFixedWidth(160)
        self.btn_clear_dup_cache.clicked.connect(self.action_clear_dup_cache)

        cache_layout.addWidget(lbl_cache_desc, 1)
        cache_layout.addWidget(self.btn_clear_dup_cache)
        grp_cache_layout.addLayout(cache_layout)
        
        folder_set_layout.addWidget(grp_cache)
        folder_set_layout.addStretch()

        self.tab_api = QWidget()
        api_layout = QFormLayout(self.tab_api)
        api_layout.setSpacing(12)
        api_layout.setContentsMargins(20, 20, 20, 20)
        
        api_keys = config.get("api_keys", {})
        
        def _make_pw_field(value, placeholder):
            w = QWidget()
            ly = QHBoxLayout(w)
            ly.setContentsMargins(0, 0, 0, 0)
            ly.setSpacing(5)
            
            le = QLineEdit(value)
            le.setPlaceholderText(placeholder)
            le.setEchoMode(QLineEdit.EchoMode.Password)
            
            btn = QPushButton()
            btn.setIcon(qta.icon('fa5s.eye', color='#dddddd'))
            btn.setFixedSize(28, 28)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            
            def toggle_visibility():
                if le.echoMode() == QLineEdit.EchoMode.Password:
                    le.setEchoMode(QLineEdit.EchoMode.Normal)
                    btn.setIcon(qta.icon('fa5s.eye-slash', color='white'))
                    btn.setStyleSheet("background-color: #3498DB; border: 1px solid #3498DB; border-radius: 4px;")
                else:
                    le.setEchoMode(QLineEdit.EchoMode.Password)
                    btn.setIcon(qta.icon('fa5s.eye', color='#dddddd'))
                    btn.setStyleSheet("background-color: #3a3a3a; border: 1px solid #555; border-radius: 4px;")
            
            btn.clicked.connect(toggle_visibility)
            ly.addWidget(le)
            ly.addWidget(btn)
            return w, le
        
        ai_group = QGroupBox(self.i18n.get("ai_trans_group", "AI 검색어 최적화"))
        ai_group_layout = QFormLayout(ai_group)
        ai_group_layout.setContentsMargins(10, 15, 10, 10)
        ai_group_layout.setSpacing(10)

        self.chk_ai_trans = QCheckBox(self.i18n.get("ai_trans_enable", "AI를 활용한 공식 영문명 변환 사용"))
        self.chk_ai_trans.setChecked(api_keys.get("ai_trans_enabled", False))
        self.chk_ai_trans.setCursor(Qt.CursorShape.PointingHandCursor)
        ai_group_layout.addRow(self.chk_ai_trans)

        self.cb_ai_provider = QComboBox()
        self.cb_ai_provider.addItems(["Gemini", "OpenAI"])
        self.cb_ai_provider.setCurrentText(api_keys.get("ai_provider", "Gemini"))
        self.cb_ai_provider.setCursor(Qt.CursorShape.PointingHandCursor)
        ai_group_layout.addRow(self.i18n.get("ai_provider", "AI 모델 선택:"), self.cb_ai_provider)

        self.ai_key_widget, self.le_ai_key = _make_pw_field(api_keys.get("ai_key", ""), "API Key")
        ai_group_layout.addRow(self.i18n.get("ai_api_key", "API Key:"), self.ai_key_widget)

        lbl_ai_notice = QLabel(self.i18n.get("ai_notice", "해외 DB 검색 시 정확도를 대폭 높입니다."))
        lbl_ai_notice.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px;")
        lbl_ai_notice.setWordWrap(True)
        ai_group_layout.addRow(lbl_ai_notice)

        def toggle_ai_inputs(checked):
            self.cb_ai_provider.setEnabled(checked)
            self.ai_key_widget.setEnabled(checked)
            
        self.chk_ai_trans.toggled.connect(toggle_ai_inputs)
        toggle_ai_inputs(self.chk_ai_trans.isChecked())

        api_layout.addRow(ai_group)
        
        api_header_layout = QHBoxLayout()
        api_header_layout.addStretch()
        self.btn_api_manual = QPushButton(self.i18n.get("btn_api_manual", "API 발급 매뉴얼"))
        self.btn_api_manual.setIcon(qta.icon('fa5s.book-open', color='white'))
        self.btn_api_manual.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_api_manual.setStyleSheet("background-color: #2b5797; color: white; padding: 6px 12px; border-radius: 4px; font-weight: bold; border: none;")
        self.btn_api_manual.clicked.connect(self.show_api_manual)
        api_header_layout.addWidget(self.btn_api_manual)
        
        api_layout.addRow(api_header_layout)
        
        self.aladin_widget, self.le_aladin_key = _make_pw_field(api_keys.get("aladin", ""), "Aladin TTBKey")
        api_layout.addRow("Aladin TTBKey:", self.aladin_widget)
        
        self.google_widget, self.le_google_key = _make_pw_field(api_keys.get("google", ""), "Google Books API Key")
        api_layout.addRow("Google Books API:", self.google_widget)
        
        self.vine_widget, self.le_vine_key = _make_pw_field(api_keys.get("vine", ""), "Comic Vine API Key")
        api_layout.addRow("Comic Vine API:", self.vine_widget)
        
        tag_group = QGroupBox(self.i18n.get("tag_rules_group", "태그 표준화 규칙"))
        tag_group_layout = QVBoxLayout(tag_group)
        tag_group_layout.setContentsMargins(10, 15, 10, 10)
        
        lbl_tag_notice = QLabel(self.i18n.get("tag_rules_desc", "치환할 태그를 '기존태그 -> 새태그' 형식으로 입력하세요."))
        lbl_tag_notice.setStyleSheet(f"color: #aaaaaa; font-size: {self.config['s11']}px;")
        lbl_tag_notice.setWordWrap(True)
        tag_group_layout.addWidget(lbl_tag_notice)
        
        self.te_tag_rules = QTextEdit()
        self.te_tag_rules.setFixedHeight(70)
        self.te_tag_rules.setPlaceholderText("Shounen, 소년만화 -> 소년\nAction -> 액션")
        self.te_tag_rules.setPlainText(api_keys.get("tag_rules", ""))
        tag_group_layout.addWidget(self.te_tag_rules)
        
        api_layout.addRow(tag_group)
        
        cache_layout = QHBoxLayout()
        cache_layout.addStretch()
        self.btn_clear_cache = QPushButton(self.i18n.get("btn_clear_cache", "검색 캐시 비우기"))
        self.btn_clear_cache.setIcon(qta.icon('fa5s.trash-alt', color='white'))
        self.btn_clear_cache.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_clear_cache.setStyleSheet("background-color: #E74C3C; color: white; padding: 6px 12px; border-radius: 4px; font-weight: bold; border: none;")
        self.btn_clear_cache.clicked.connect(self.action_clear_cache)
        cache_layout.addWidget(self.btn_clear_cache)
        api_layout.addRow(cache_layout)

        self.tabs.addTab(self.tab_basic, self.i18n.get("tab_basic", "기본 설정"))
        self.tabs.addTab(self.tab_folder_settings, self.i18n.get("tab_folder_settings", "폴더 탭 설정"))
        self.tabs.addTab(self.tab_api, self.i18n.get("tab_api", "API 검색 설정"))
        
        main_layout.addWidget(self.tabs)

        btn_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        btn_box.button(QDialogButtonBox.StandardButton.Ok).setText(self.i18n.get("btn_save", "저장"))
        btn_box.button(QDialogButtonBox.StandardButton.Cancel).setText(self.i18n.get("btn_cancel", "취소"))
        btn_box.button(QDialogButtonBox.StandardButton.Ok).setCursor(Qt.CursorShape.PointingHandCursor)
        btn_box.button(QDialogButtonBox.StandardButton.Cancel).setCursor(Qt.CursorShape.PointingHandCursor)
        btn_box.button(QDialogButtonBox.StandardButton.Ok).setStyleSheet("background-color: #3498DB; color: white; font-weight: bold;")
        
        btn_box.accepted.connect(self.accept)
        btn_box.rejected.connect(self.reject)
        main_layout.addWidget(btn_box)
    
    def accept(self):
        # 환경설정 창이 닫힐 때 빠른 이동 목록 즉시 갱신 (메인 윈도우의 config 갱신 후 반영되도록 100ms 지연)
        main_win = self.parent()
        if hasattr(main_win, 'tab_folder'):
            QTimer.singleShot(100, main_win.tab_folder.populate_quick_access)
        super().accept()

    def action_clear_cache(self):
        try:
            with sqlite3.connect(".api_cache.db", timeout=10) as conn:
                c = conn.cursor()
                c.execute("DELETE FROM search_cache")
                c.execute("DELETE FROM img_cache")
                c.execute("DELETE FROM trans_cache")
                conn.commit()
            Toast.show(self, self.i18n.get("msg_cache_cleared", "캐시가 초기화되었습니다."))
        except Exception as e:
            pass

    def action_clear_dup_cache(self):
        reply = QMessageBox.question(
            self,
            self.i18n.get("folder_clear_cache", "중복 매칭 캐시 초기화"),
            self.i18n.get("folder_clear_cache_confirm", "저장된 모든 중복 매칭 결과 캐시를 삭제하시겠습니까?\n(매칭 속도가 일시적으로 느려질 수 있습니다.)"),
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )
        if reply == QMessageBox.StandardButton.Yes:
            from core.library_db import db
            if hasattr(db, 'clear_dup_cache') and db.clear_dup_cache():
                Toast.show(self, self.i18n.get("folder_clear_cache_done", "중복 매칭 캐시가 초기화되었습니다."))

    def show_api_manual(self):
        msg = QMessageBox(self)
        msg.setWindowTitle(self.i18n.get("api_manual_title", "API 발급 매뉴얼"))
        
        if self.config.get("lang") == "en":
            text = (
                "<b>[ Aladin ]</b><br>"
                "1. Visit <a href='https://blog.aladin.co.kr/openapi' style='color:#3498DB;'>Aladin OpenAPI</a> and login.<br>"
                "2. Apply for a 'TTBKey' in the menu.<br><br>"
                "<b>[ Comic Vine ]</b><br>"
                "1. Visit <a href='https://comicvine.gamespot.com/api/' style='color:#3498DB;'>Comic Vine API</a> and sign in.<br>"
                "2. Copy the API Key from your developer page.<br><br>"
                "<b>[ Google Books ]</b><br>"
                "1. Visit <a href='https://console.cloud.google.com/' style='color:#3498DB;'>Google Cloud Console</a>.<br>"
                "2. Create a project and enable 'Google Books API'.<br>"
                "3. Generate an API Key under 'Credentials'."
            )
        elif self.config.get("lang") == "ja":
            text = (
                "<b>[ Aladin ]</b><br>"
                "1. <a href='https://blog.aladin.co.kr/openapi' style='color:#3498DB;'>Aladin OpenAPI</a> に接続してログイン<br>"
                "2. 'TTBKey 発行申請' メニューから発行<br><br>"
                "<b>[ Comic Vine ]</b><br>"
                "1. <a href='https://comicvine.gamespot.com/api/' style='color:#3498DB;'>Comic Vine API</a> にサインイン<br>"
                "2. 開発者ページから API Key をコピー<br><br>"
                "<b>[ Google Books ]</b><br>"
                "1. <a href='https://console.cloud.google.com/' style='color:#3498DB;'>Google Cloud Console</a> に接続<br>"
                "2. プロジェクトを作成し 'Google Books API' を有効化<br>"
                "3. '認証情報' メニューから API Key を作成"
            )
        else:
            text = (
                "<b>[ 알라딘 (Aladin) ]</b><br>"
                "1. <a href='https://blog.aladin.co.kr/openapi' style='color:#3498DB;'>알라딘 OpenAPI 홈페이지</a> 접속 및 로그인<br>"
                "2. 'TTBKey 발급 신청' 메뉴에서 발급<br><br>"
                "<b>[ Comic Vine ]</b><br>"
                "1. <a href='https://comicvine.gamespot.com/api/' style='color:#3498DB;'>Comic Vine API 홈페이지</a> 가입 및 로그인<br>"
                "2. 개발자 페이지에서 API Key 복사<br><br>"
                "<b>[ Google Books ]</b><br>"
                "1. <a href='https://console.cloud.google.com/' style='color:#3498DB;'>Google Cloud Console</a> 접속<br>"
                "2. 새 프로젝트 생성 후 'Google Books API' 사용 설정<br>"
                "3. '사용자 인증 정보' 메뉴에서 API Key 생성"
            )
            
        msg.setTextFormat(Qt.TextFormat.RichText)
        msg.setText(text)
        msg.exec()

    def browse_viewer_path(self):
        from PyQt6.QtWidgets import QFileDialog
        path, _ = QFileDialog.getOpenFileName(self, "Select Viewer Program", "", "Executable Files (*.exe);;All Files (*)")
        if path:
            self.le_viewer_path.setText(path)

    def add_dup_folder(self):
        from PyQt6.QtWidgets import QFileDialog
        folder = QFileDialog.getExistingDirectory(self, self.i18n.get("dlg_sel_dup_folder", "라이브러리 폴더 선택"))
        if folder:
            # 중복 방지
            items = [self.list_dup_folders.item(i).text() for i in range(self.list_dup_folders.count())]
            if folder not in items:
                self.list_dup_folders.addItem(folder)

    def remove_dup_folder(self):
        selected_items = self.list_dup_folders.selectedItems()
        if not selected_items: return
        for item in selected_items:
            self.list_dup_folders.takeItem(self.list_dup_folders.row(item))

    def get_data(self):
        format_keys = ["none", "zip", "cbz", "cbr", "7z"]
        
        lang_text = self.cb_lang.currentText()
        if lang_text == "한국어": lang_val = "ko"
        elif lang_text == "日本語": lang_val = "ja"
        else: lang_val = "en"
        
        dup_folders = [self.list_dup_folders.item(i).text() for i in range(self.list_dup_folders.count())]

        return {
            "lang": lang_val,
            "target_format": format_keys[self.cb_format.currentIndex()],
            "backup_on": self.chk_backup.isChecked(),
            "flatten_folders": self.chk_flatten.isChecked(),
            "webp_conversion": self.chk_webp.isChecked(),
            "img_quality": self.slider_quality.value(),
            "max_threads": self.slider_threads.value(),
            "play_sound": self.chk_sound.isChecked(),
            "play_sound": self.chk_sound.isChecked(),
            "completion_sound": self.cb_sound.currentData(),
            "viewer_path": self.le_viewer_path.text().strip(),

            "dup_check_folders": dup_folders,
            "pass_skip_meta": self.chk_pass_skip_meta.isChecked(),
            
            "api_keys": {
                "aladin": self.le_aladin_key.text().strip(),
                "vine": self.le_vine_key.text().strip(),
                "google": self.le_google_key.text().strip(),
                
                "ai_trans_enabled": self.chk_ai_trans.isChecked(),
                "ai_provider": self.cb_ai_provider.currentText(),
                "ai_key": self.le_ai_key.text().strip(),
                
                "tag_rules": self.te_tag_rules.toPlainText()
            },
            "font_family": self.cb_font_family.currentText(),
            "font_scale": self.cb_font_scale.currentData(),
        }
    
    def action_update_index(self):
        main_win = self.parent()
        if hasattr(main_win, 'tab_folder'):
            main_win.tab_folder.start_index_update_task(force_rescan=True)
            Toast.show(self, self.i18n.get("setting_update_index_msg", "인덱스가 갱신되었습니다."))


def quick_archive_preview(filepath):
    import zipfile
    from PIL import Image
    import io
    info = {"size": "0 B", "res": "0x0", "img_bytes": None}
    try:
        info["size"] = f"{os.path.getsize(filepath) / 1024:.1f} KB"
        ext = os.path.splitext(filepath)[1].lower()
        if ext in ['.zip', '.cbz']:
            with zipfile.ZipFile(filepath, 'r') as zf:
                img_files = [f for f in zf.namelist() if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
                if img_files:
                    img_files.sort()
                    cover = next((f for f in img_files if 'cover' in f.lower()), img_files[0])
                    img_bytes = zf.read(cover)
                    info["img_bytes"] = img_bytes
                    try:
                        with Image.open(io.BytesIO(img_bytes)) as img:
                            info["res"] = f"{img.width} x {img.height}"
                    except: pass
    except: pass
    return info


class ConflictResolutionDialog(QDialog):
    def __init__(self, src_path, dest_path, i18n, parent=None):
        super().__init__(parent)
        self.src_path = src_path
        self.dest_path = dest_path
        self.i18n = i18n
        self.setWindowTitle(i18n.get("dlg_conflict_title", "파일 이름 중복"))
        self.resize(600, 400)
        self.setStyleSheet("QDialog { background-color: #2b2b2b; color: white; } QLabel { color: white; }")
        self.setup_ui()

    def setup_ui(self):
        from PyQt6.QtGui import QPixmap, QImage
        from PyQt6.QtCore import Qt
        layout = QVBoxLayout(self)
        
        lbl_desc = QLabel(self.i18n.get("lbl_conflict_desc", "이동할 경로에 이미 같은 이름의 파일이 존재합니다."))
        lbl_desc.setStyleSheet("font-size: 14px; font-weight: bold; color: #E74C3C;")
        layout.addWidget(lbl_desc)
        
        lbl_path = QLabel(f"Target: {self.dest_path}")
        lbl_path.setStyleSheet("color: #aaaaaa; font-size: 11px;")
        lbl_path.setWordWrap(True)
        layout.addWidget(lbl_path)
        
        compare_layout = QHBoxLayout()
        
        src_info = quick_archive_preview(self.src_path)
        dest_info = quick_archive_preview(self.dest_path)
        
        def create_card(title, info, path):
            card = QFrame()
            card.setStyleSheet("background-color: #1e1e1e; border: 1px solid #444; border-radius: 8px;")
            vbox = QVBoxLayout(card)
            
            lbl_t = QLabel(title)
            lbl_t.setStyleSheet("font-weight: bold; color: #3498DB; border: none;")
            lbl_t.setAlignment(Qt.AlignmentFlag.AlignCenter)
            vbox.addWidget(lbl_t)
            
            lbl_img = QLabel()
            lbl_img.setAlignment(Qt.AlignmentFlag.AlignCenter)
            lbl_img.setFixedSize(200, 280)
            lbl_img.setStyleSheet("background-color: #1a1a1a; border-radius: 4px;")
            if info["img_bytes"]:
                img = QImage.fromData(info["img_bytes"])
                pix = QPixmap.fromImage(img).scaled(190, 270, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
                lbl_img.setPixmap(pix)
            else:
                lbl_img.setText("No Image")
            vbox.addWidget(lbl_img)
            
            lbl_stat = QLabel(f"Size: {info['size']} | Res: {info['res']}")
            lbl_stat.setStyleSheet("font-size: 11px; color: #ccc; border: none;")
            lbl_stat.setAlignment(Qt.AlignmentFlag.AlignCenter)
            vbox.addWidget(lbl_stat)
            return card
            
        compare_layout.addWidget(create_card(self.i18n.get("col_source", "Source (이동할 파일)"), src_info, self.src_path))
        compare_layout.addWidget(create_card(self.i18n.get("col_dest", "Destination (기존 파일)"), dest_info, self.dest_path))
        layout.addLayout(compare_layout)
        
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        
        btn_over = QPushButton(self.i18n.get("btn_overwrite", "덮어쓰기"))
        btn_over.setStyleSheet("background-color: #E74C3C; color: white; border-radius: 4px; padding: 6px 15px;")
        btn_over.clicked.connect(lambda: self.done(1))
        
        btn_ren = QPushButton(self.i18n.get("btn_rename_new", "새 이름으로 저장"))
        btn_ren.setStyleSheet("background-color: #3498DB; color: white; border-radius: 4px; padding: 6px 15px;")
        btn_ren.clicked.connect(lambda: self.done(2))
        
        btn_skip = QPushButton(self.i18n.get("btn_skip", "건너뛰기"))
        btn_skip.setStyleSheet("background-color: #555; color: white; border-radius: 4px; padding: 6px 15px;")
        btn_skip.clicked.connect(lambda: self.done(0))
        
        btn_layout.addWidget(btn_over)
        btn_layout.addWidget(btn_ren)
        btn_layout.addWidget(btn_skip)
        layout.addLayout(btn_layout)


class MoveToLibraryDialog(QDialog):
    def __init__(self, move_plans, libraries, i18n, is_folder_mode=False, parent=None):
        super().__init__(parent)
        self.move_plans = move_plans # [{'src': path, 'base_name': name, 'current_dir_name': dir_name}]
        self.libraries = libraries
        self.i18n = i18n
        self.is_folder_mode = is_folder_mode
        
        self.setWindowTitle(i18n.get("dlg_move_lib_title", "라이브러리 폴더로 이동"))
        self.resize(750, 450)
        self.setStyleSheet("QDialog { background-color: #2b2b2b; color: white; } QLabel { color: white; }")
        self.setup_ui()
        self.update_preview()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        
        opt_layout = QHBoxLayout()
        opt_layout.addWidget(QLabel(self.i18n.get("lbl_select_lib", "이동할 라이브러리 선택:")))
        
        self.cb_lib = QComboBox()
        self.cb_lib.addItems(self.libraries)
        self.cb_lib.setStyleSheet("QComboBox { background-color: #1e1e1e; border: 1px solid #555; padding: 4px; }")
        self.cb_lib.currentIndexChanged.connect(self.update_preview)
        opt_layout.addWidget(self.cb_lib, 1)
        layout.addLayout(opt_layout)
        
        self.chk_folder = QCheckBox(self.i18n.get("chk_create_folder", "현 폴더 이름으로 폴더 생성하고 이동"))
        self.chk_folder.setChecked(True)
        self.chk_folder.stateChanged.connect(self.update_preview)
        if self.is_folder_mode:
            self.chk_folder.hide()
        layout.addWidget(self.chk_folder)
        
        layout.addWidget(QLabel(self.i18n.get("lbl_preview_move", "이동 경로 미리보기:")))
        
        self.table = QTableWidget()
        self.table.setColumnCount(2)
        self.table.setHorizontalHeaderLabels([self.i18n.get("col_source_path", "Source (현재 경로)"), self.i18n.get("col_dest_path", "Destination (이동할 경로)")])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.setStyleSheet("QTableWidget { background-color: #1e1e1e; gridline-color: #444; } QHeaderView::section { background-color: #333; }")
        layout.addWidget(self.table)
        
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()
        btn_ok = QPushButton(self.i18n.get("btn_ok", "확인"))
        btn_ok.setStyleSheet("background-color: #3498DB; color: white; border-radius: 4px; padding: 6px 20px;")
        btn_ok.clicked.connect(self.accept)
        btn_cancel = QPushButton(self.i18n.get("btn_cancel", "취소"))
        btn_cancel.setStyleSheet("background-color: #555; color: white; border-radius: 4px; padding: 6px 20px;")
        btn_cancel.clicked.connect(self.reject)
        btn_layout.addWidget(btn_ok)
        btn_layout.addWidget(btn_cancel)
        layout.addLayout(btn_layout)

    def update_preview(self):
        self.table.setRowCount(0)
        target_lib = self.cb_lib.currentText()
        create_folder = self.chk_folder.isChecked()
        
        for i, plan in enumerate(self.move_plans):
            self.table.insertRow(i)
            src = plan['src']
            if self.is_folder_mode:
                # 폴더 자체가 통째로 이동
                dest = os.path.join(target_lib, plan['base_name'])
            else:
                if create_folder:
                    dest = os.path.join(target_lib, plan['current_dir_name'], plan['base_name'])
                else:
                    dest = os.path.join(target_lib, plan['base_name'])
                    
            self.table.setItem(i, 0, QTableWidgetItem(src))
            self.table.setItem(i, 1, QTableWidgetItem(dest))
            plan['dest'] = dest