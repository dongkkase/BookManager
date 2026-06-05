import os
import time
from PyQt6.QtWidgets import (
    QTreeWidget, QTableWidget, QLabel, QGraphicsOpacityEffect, 
    QComboBox, QCompleter, QMenu, QMessageBox, QWidget
)
from PyQt6.QtCore import pyqtSignal, Qt, QTimer, QPropertyAnimation, QEasingCurve, QSortFilterProxyModel

class OrgTreeWidget(QTreeWidget):
    delete_pressed = pyqtSignal()
    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Delete: self.delete_pressed.emit()
        super().keyPressEvent(event)

class ArchiveTableWidget(QTableWidget):
    delete_pressed = pyqtSignal()
    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Delete: self.delete_pressed.emit()
        super().keyPressEvent(event)


class _ToastWidget(QLabel):
    def __init__(self, parent, message):
        super().__init__(parent)
        self.config = parent.config if hasattr(parent, 'config') else {}
        self.setText(message)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        
        # 🌟 [수정] 오렌지색 배경 적용 및 폰트 사이즈(15px) 2포인트 증가
        self.setStyleSheet(f"""
            QLabel {{
                background-color: rgba(187, 121, 15, 240);
                color: #ffffff;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: bold;
                font-size: {self.config['s15']}px;
                border: 1px solid #E67E22;
            }}
        """)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.adjustSize()
        
        if parent:
            x = (parent.width() - self.width()) // 2
            y = parent.height() - self.height() - 90
            self.move(x, y)

        self.opacity_effect = QGraphicsOpacityEffect(self)
        self.setGraphicsEffect(self.opacity_effect)
        self.opacity_effect.setOpacity(0.0) 

    def show_animation(self, duration):
        self.show()
        self.raise_() 
        
        self.anim_in = QPropertyAnimation(self.opacity_effect, b"opacity", self)
        self.anim_in.setDuration(300) 
        self.anim_in.setStartValue(0.0) 
        self.anim_in.setEndValue(1.0) 
        self.anim_in.setEasingCurve(QEasingCurve.Type.OutQuad)
        
        self.anim_out = QPropertyAnimation(self.opacity_effect, b"opacity", self)
        self.anim_out.setDuration(400) 
        self.anim_out.setStartValue(1.0) 
        self.anim_out.setEndValue(0.0) 
        self.anim_out.setEasingCurve(QEasingCurve.Type.InQuad)
        
        self.anim_out.finished.connect(self.deleteLater)
        
        self.anim_in.start()
        
        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.timeout.connect(self.anim_out.start)
        self.timer.start(duration)


class Toast:
    @staticmethod
    def show(parent, message, duration=2500):
        if parent is None:
            return
            
        try:
            if hasattr(parent, '_current_toast') and parent._current_toast is not None:
                parent._current_toast.hide()
                parent._current_toast.deleteLater()
        except RuntimeError:
            pass 
            
        toast = _ToastWidget(parent, message)
        parent._current_toast = toast 
        toast.show_animation(duration)


class SearchableComboBox(QComboBox):
    """PyQt6 네이티브 기능을 활용한 깔끔한 검색형 콤보박스"""
    delete_requested = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setEditable(True)
        self.setInsertPolicy(QComboBox.InsertPolicy.NoInsert)
        
        # 입력된 텍스트를 기반으로 항목을 필터링하는 모델
        self.filter_model = QSortFilterProxyModel(self)
        self.filter_model.setFilterCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        self.filter_model.setSourceModel(self.model())
        
        # 콤보박스 아래에 드롭다운을 띄우는 자동완성(Completer)
        self.completer_obj = QCompleter(self.filter_model, self)
        self.completer_obj.setCompletionMode(QCompleter.CompletionMode.PopupCompletion)
        self.completer_obj.setCaseSensitivity(Qt.CaseSensitivity.CaseInsensitive)
        self.setCompleter(self.completer_obj)
        
        # 타이핑할 때마다 필터링 업데이트
        self.lineEdit().textEdited.connect(self.filter_model.setFilterFixedString)
        self.completer_obj.activated.connect(self.on_completer_activated)
        
        # 우클릭 삭제 메뉴
        self.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_context_menu)

    def on_completer_activated(self, text):
        if text:
            self.setCurrentText(text)

    def set_items(self, items):
        self.clear()
        self.addItem("")  # 기본 빈 값
        self.addItems(sorted(list(set(items))))

    def _show_context_menu(self, pos):
        menu = QMenu(self)
        is_ko = True # 필요시 메인 앱 언어 체크 로직 추가 가능
        delete_action = menu.addAction("선택된 항목 저장목록에서 삭제" if is_ko else "Delete from saved list")
        
        action = menu.exec(self.mapToGlobal(pos))
        if action == delete_action:
            text = self.currentText().strip()
            if text:
                self.delete_requested.emit(text)
    
    def text(self):
        return self.currentText()

    def setText(self, text):
        self.setCurrentText(text)


class DimOverlay(QWidget):
    def __init__(self, parent=None, show_spinner=False, text="", play_sound_on_hide=False):
        super().__init__(parent)
        self.show_spinner = show_spinner
        self.play_sound_on_hide = play_sound_on_hide
        self._text = text
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, False)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self._show_time = 0
        
        self.opacity_effect = QGraphicsOpacityEffect(self)
        self.setGraphicsEffect(self.opacity_effect)
        self.anim_fade = QPropertyAnimation(self.opacity_effect, b"opacity", self)
        
        self.movie = None
        
        if self.show_spinner:
            from PyQt6.QtGui import QMovie
            from PyQt6.QtWidgets import QLabel, QVBoxLayout
            import os
            
            layout = QVBoxLayout(self)
            layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            
            self.anim_label = QLabel()
            self.anim_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.anim_label.setStyleSheet("background: transparent; border: none;")
            
            # Lottie 대신 고화질 WebP 또는 GIF 애니메이션 파일 사용 권장
            from config import get_resource_path
            anim_path = get_resource_path(os.path.join("src", "rainbow cat remix.gif"))
            

            if anim_path:
                self.movie = QMovie(anim_path)
                self.movie.setCacheMode(QMovie.CacheMode.CacheAll)
                from PyQt6.QtGui import QImageReader
                from PyQt6.QtCore import QSize
                orig_size = QImageReader(anim_path).size()
                if orig_size.isValid():
                    self.movie.setScaledSize(QSize(orig_size.width() * 1, orig_size.height() * 1))
                self.anim_label.setMovie(self.movie)
            else:
                # 지정된 파일이 없을 경우 기존 스피너 아이콘으로 폴백
                import qtawesome as qta
                self.anim_label.setPixmap(qta.icon('fa5s.spinner', color='#3498DB').pixmap(62, 62))
                
            layout.addWidget(self.anim_label)
            
            self.text_label = QLabel(self._text)
            self.text_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self.text_label.setStyleSheet("color: white; font-size: 14px; font-weight: bold; background: transparent; border: none; margin-top: 15px;")
            layout.addWidget(self.text_label)
            
        self.hide()

    @property
    def text(self):
        return self._text

    @text.setter
    def text(self, value):
        self._text = value
        if hasattr(self, 'text_label'):
            self.text_label.setText(value)

    def paintEvent(self, event):
        from PyQt6.QtGui import QPainter, QColor
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor(0, 0, 0, 178))  # rgba(0,0,0,0.7)
        painter.end()

    def showEvent(self, event):
        self._show_time = time.time()
        self.raise_()
        self.resize(self.parent().size())
        if self.parent():
            self.resize(self.parent().size())
        if self.movie:
            self.movie.start()
            
        self.anim_fade.stop()
        self.anim_fade.setDuration(100)
        self.anim_fade.setStartValue(0.0)
        self.anim_fade.setEndValue(1.0)
        self.anim_fade.start()
        
        super().showEvent(event)
        
    def hideEvent(self, event):
        if self.movie:
            self.movie.stop()
            
        if getattr(self, 'play_sound_on_hide', False) and getattr(self, '_show_time', 0) > 0:
            elapsed = time.time() - self._show_time
            if elapsed >= 60:
                self._play_meow_sound()
            self._show_time = 0
            
        super().hideEvent(event)
        
    def _play_meow_sound(self):
        try:
            from utils import play_sound_file
            play_sound_file("meow-1.mp3")
        except Exception:
            pass