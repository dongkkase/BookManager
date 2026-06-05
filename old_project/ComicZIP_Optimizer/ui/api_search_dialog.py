import os
import difflib
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton, 
    QWidget, QFormLayout, QComboBox, QSplitter, QScrollArea, QFrame,
    QListWidget, QListWidgetItem, QSizePolicy, QApplication, QTextEdit
)
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QImage, QPixmap, QPainter, QPainterPath, QKeySequence, QShortcut
import qtawesome as qta

from config import get_resource_path
from ui.widgets import Toast
from tasks.api_workers import SearchWorker, TranslateWorker, ImageLoadThread

def similar(a, b): return difflib.SequenceMatcher(None, a, b).ratio()

class SearchResultWidget(QWidget):
    def __init__(self, data, config, parent=None):
        super().__init__(parent)
        self.config = config
        self.cover_url = data.get("CoverUrl", "")
        
        self.setStyleSheet("SearchResultWidget { background-color: transparent; }")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        
        def parse_val(val):
            if val is None or val == "" or val == "-": return ""
            if isinstance(val, list): return ", ".join(str(x) for x in val)
            if isinstance(val, str):
                v_str = val.strip()
                if v_str.startswith('[') and v_str.endswith(']'):
                    import ast
                    try:
                        parsed = ast.literal_eval(v_str)
                        if isinstance(parsed, list): return ", ".join(str(x) for x in parsed)
                    except:
                        try:
                            import json
                            parsed = json.loads(v_str)
                            if isinstance(parsed, list): return ", ".join(str(x) for x in parsed)
                        except: pass
            return str(val)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 10, 20, 10)
        layout.setSpacing(15)
        layout.setAlignment(Qt.AlignmentFlag.AlignTop) 
        
        self.lbl_thumb = QLabel()
        self.lbl_thumb.setFixedSize(45, 64)
        self.lbl_thumb.setStyleSheet("QLabel { background-color: transparent; border: none; }")
        self.lbl_thumb.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._set_default_thumb()
        
        layout.addWidget(self.lbl_thumb, alignment=Qt.AlignmentFlag.AlignTop)
        
        info_layout = QVBoxLayout()
        info_layout.setSpacing(4)
        info_layout.setAlignment(Qt.AlignmentFlag.AlignTop) 
        
        self.lbl_title = QLabel(parse_val(data.get("Title", "")))
        self.lbl_title.setWordWrap(True)
        self.lbl_title.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)
        self.lbl_title.setStyleSheet(f"QLabel {{ font-weight: bold; font-size: {self.config['s14']}px; color: #EAEAEA; background-color: transparent; border: none; outline: none; }}")
        info_layout.addWidget(self.lbl_title)
        
        raw_summary = parse_val(data.get("Summary", ""))
        clean_summary = raw_summary.replace("\n", " ").replace("\r", "").strip() if raw_summary else ""
        
        if len(clean_summary) > 38:
            clean_summary = clean_summary[:38] + "..."
            
        self.lbl_summary = QLabel(clean_summary)
        self.lbl_summary.setWordWrap(False) 
        self.lbl_summary.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)
        self.lbl_summary.setStyleSheet(f"QLabel {{ color: #999999; font-size: {self.config['s12']}px; background-color: transparent; border: none; outline: none; }}")
        
        if clean_summary:
            info_layout.addWidget(self.lbl_summary)
        
        meta_layout = QHBoxLayout()
        meta_layout.setSpacing(8)
        meta_layout.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignTop)
        
        writer = parse_val(data.get("Writer", ""))
        pub = parse_val(data.get("Publisher", ""))
        rating = parse_val(data.get("RatingScore", "")).strip()
        
        def add_meta_item(text, color):
            lbl = QLabel(text)
            lbl.setStyleSheet(f"QLabel {{ color: {color}; font-size: {self.config['s11']}px; background-color: transparent; border: none; outline: none; }}")
            meta_layout.addWidget(lbl)
            
        def add_divider():
            lbl = QLabel("|")
            lbl.setStyleSheet(f"QLabel {{ color: rgba(255, 255, 255, 0.3); font-size: {self.config['s9']}px; background-color: transparent; border: none; outline: none; }}")
            meta_layout.addWidget(lbl)

        items_added = 0
        if writer:
            add_meta_item(writer, "#AAAAAA")
            items_added += 1
            
        if pub:
            if items_added > 0: add_divider()
            add_meta_item(pub, "#AAAAAA")
            items_added += 1
            
        if rating and rating != "-":
            if items_added > 0: add_divider()
            star_layout = QHBoxLayout()
            star_layout.setContentsMargins(0,0,0,0)
            star_layout.setSpacing(4)
            
            star_icon = QLabel()
            star_icon.setPixmap(qta.icon('fa5s.star', color='#f1c40f').pixmap(11, 11))
            star_icon.setStyleSheet(f"QLabel {{ background-color: transparent; border: none; outline: none; }}") 
            
            star_lbl = QLabel(rating)
            star_lbl.setStyleSheet(f"QLabel {{ color: #F1C40F; font-size: {self.config['s11']}px; font-weight: bold; background-color: transparent; border: none; outline: none; }}")
            
            star_layout.addWidget(star_icon)
            star_layout.addWidget(star_lbl)
            meta_layout.addLayout(star_layout)
            
        meta_layout.addStretch()
        info_layout.addLayout(meta_layout)
        info_layout.addStretch() 
        
        layout.addLayout(info_layout)
        
        if self.cover_url:
            self.thread = ImageLoadThread(self.cover_url)
            self.thread.finished_data.connect(self.on_image_loaded)
            self.thread.start()

    def _set_default_thumb(self):
        p = get_resource_path("previewframe.png")
        if os.path.exists(p):
            try:
                pixmap = QPixmap(p).scaled(45, 64, Qt.AspectRatioMode.KeepAspectRatioByExpanding, Qt.TransformationMode.SmoothTransformation)
                crop_x = (pixmap.width() - 45) // 2
                crop_y = (pixmap.height() - 64) // 2
                cropped_pixmap = pixmap.copy(crop_x, crop_y, 45, 64)
                
                rounded_pixmap = QPixmap(45, 64)
                rounded_pixmap.fill(Qt.GlobalColor.transparent)
                
                painter = QPainter(rounded_pixmap)
                painter.setRenderHint(QPainter.RenderHint.Antialiasing)
                
                path = QPainterPath()
                path.addRoundedRect(0, 0, 45, 64, 5, 5) 
                
                painter.setClipPath(path)
                painter.drawPixmap(0, 0, cropped_pixmap)
                painter.end()
                
                self.lbl_thumb.setPixmap(rounded_pixmap)
            except:
                self.lbl_thumb.setStyleSheet("QLabel { background-color: #333; border-radius: 5px; }")
        else:
            self.lbl_thumb.setStyleSheet("QLabel { background-color: #333; border-radius: 5px; }")
            
    def on_image_loaded(self, img_data, url):
        try:
            if getattr(self, "lbl_thumb", None) is None: return
            if url == self.cover_url and img_data:
                image = QImage.fromData(img_data)
                if not image.isNull():
                    scaled_pixmap = QPixmap.fromImage(image).scaled(
                        45, 64, 
                        Qt.AspectRatioMode.KeepAspectRatioByExpanding, 
                        Qt.TransformationMode.SmoothTransformation
                    )
                    
                    crop_x = (scaled_pixmap.width() - 45) // 2
                    crop_y = (scaled_pixmap.height() - 64) // 2
                    cropped_pixmap = scaled_pixmap.copy(crop_x, crop_y, 45, 64)
                    
                    rounded_pixmap = QPixmap(45, 64)
                    rounded_pixmap.fill(Qt.GlobalColor.transparent)
                    
                    painter = QPainter(rounded_pixmap)
                    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
                    
                    path = QPainterPath()
                    path.addRoundedRect(0, 0, 45, 64, 5, 5) 
                    
                    painter.setClipPath(path)
                    painter.drawPixmap(0, 0, cropped_pixmap)
                    painter.end()
                    
                    self.lbl_thumb.setPixmap(rounded_pixmap)
        except RuntimeError: pass


class ApiSearchDialog(QDialog):
    def __init__(self, api_name, query, h1_text, parent=None, t=None):
        super().__init__(parent)
        self.current_api = api_name
        self.current_query = query
        self.h1_text = h1_text
        self.t = t if t else {}
        self.config = parent.main_app.config if parent and hasattr(parent, "main_app") else {}
        self.api_keys = self.config.get("api_keys", {})
        
        self.tag_rules = {}
        rules_text = self.api_keys.get("tag_rules", "")
        if rules_text:
            for line in rules_text.split('\n'):
                if '->' in line:
                    srcs, dst = line.split('->')
                    dst = dst.strip()
                    for src in srcs.split(','):
                        self.tag_rules[src.strip().lower()] = dst
                        
        self.target_lang = self.config.get("lang", "ko")
        
        self.search_results = []
        self.selected_raw_data = None  
        self.translated_data = None 
        self.is_translated = False
        self.current_cover_url = None
        self.search_worker = None 
        self.translate_worker = None
        
        self.current_page = 1 
        
        self.setWindowTitle(self.t.get("meta_search_title", "메타데이터 검색"))
        self.resize(1050, 750)
        self.setup_ui()
        self.perform_search()

    def setup_ui(self):
        self.setStyleSheet("""
            QScrollBar:vertical { border: none; background-color: #2b2b2b; width: 10px; border-radius: 5px; }
            QScrollBar::handle:vertical { background-color: #555; border-radius: 5px; min-height: 20px; }
            QScrollBar::handle:vertical:hover { background-color: #777; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0px; }
            QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background-color: transparent; }
            QScrollBar:horizontal { border: none; background-color: #2b2b2b; height: 10px; border-radius: 5px; }
            QScrollBar::handle:horizontal { background-color: #555; border-radius: 5px; min-width: 20px; }
            QScrollBar::handle:horizontal:hover { background-color: #777; }
            QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal { width: 0px; }
            QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal { background-color: transparent; }
        """)

        main_layout = QVBoxLayout(self)
        main_layout.setSpacing(15); main_layout.setContentsMargins(20, 20, 20, 20)
        
        header_layout = QHBoxLayout()
        self.lbl_h1 = QLabel(f"<h1 style='margin:0; color:#3498DB;'>{self.h1_text}</h1>")
        header_layout.addWidget(self.lbl_h1); header_layout.addStretch()
        
        self.cb_api = QComboBox()
        self.cb_api.addItems(["리디북스", "알라딘", "Google Books", "Anilist", "Vine"])
        self.cb_api.setCurrentText(self.current_api); self.cb_api.setFixedWidth(130)
        self.cb_api.setStyleSheet("padding: 6px; border: 1px solid #555; border-radius: 4px; background-color: #2b2b2b;")
        self.cb_api.setCursor(Qt.CursorShape.PointingHandCursor)
        
        self.cb_api.currentTextChanged.connect(self.on_api_combo_changed)
        
        self.le_query = QLineEdit(self.current_query)
        self.le_query.setFixedWidth(200)
        self.le_query.setStyleSheet("padding: 7px; border: 1px solid #555; border-radius: 4px; background-color: #2b2b2b;")
        self.le_query.returnPressed.connect(self.action_manual_search)
        
        self.btn_search = QPushButton(f" {self.t.get('btn_search', '검색')} (S)")
        self.btn_search.setIcon(qta.icon('fa5s.search', color='white'))
        self.btn_search.setStyleSheet("background-color: #444; color: white; border: 1px solid #555; padding: 7px 20px; border-radius: 4px; font-weight: bold;")
        self.btn_search.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_search.clicked.connect(self.action_manual_search)
        
        self.lbl_api_warning = QLabel(self.t.get("api_key_missing", "환경설정에서 API 키를 입력해주세요."))
        self.lbl_api_warning.setStyleSheet(f"color: #E74C3C; font-weight: bold; font-size: {self.config['s12']}px; margin-left: 10px;")
        self.lbl_api_warning.hide()
        
        header_layout.addWidget(self.cb_api); header_layout.addWidget(self.le_query); header_layout.addWidget(self.btn_search)
        header_layout.addWidget(self.lbl_api_warning) 
        main_layout.addLayout(header_layout)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        
        left_pane = QWidget()
        left_pane.setStyleSheet("QWidget { background-color: #444; border: 1px solid #444; border-radius: 6px; }")
        left_layout = QVBoxLayout(left_pane)
        left_layout.setContentsMargins(2, 2, 2, 5) 
        
        self.list_widget = QListWidget()
        self.list_widget.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.list_widget.setResizeMode(QListWidget.ResizeMode.Adjust)
        self.list_widget.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self.list_widget.setVerticalScrollMode(QListWidget.ScrollMode.ScrollPerPixel)
        self.list_widget.verticalScrollBar().setSingleStep(10)
        
        self.list_widget.setStyleSheet("""
            QListWidget { background-color: transparent; border: none; outline: none; }
            QListWidget::item { border-bottom: 1px solid #555; outline: none; }
            QListWidget::item:selected { background-color: #2980b9; border-radius: 4px; border: none; outline: none; }
            QListWidget::item:focus { outline: none; border: none; }
        """)
        self.list_widget.viewport().setCursor(Qt.CursorShape.PointingHandCursor)
        self.list_widget.itemSelectionChanged.connect(self.on_item_selected)
        left_layout.addWidget(self.list_widget)
        
        page_layout = QHBoxLayout()
        self.btn_prev_page = QPushButton(self.t.get("api_page_prev", "이전"))
        self.btn_prev_page.setIcon(qta.icon('fa5s.chevron-left', color='white'))
        self.btn_prev_page.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_prev_page.setStyleSheet("""
            QPushButton { background-color: #555; color: white; border-radius: 4px; padding: 4px; font-weight: bold; }
            QPushButton:disabled { background-color: #333; color: #777; }
        """)
        self.btn_prev_page.clicked.connect(self.action_prev_page)
        self.btn_prev_page.setEnabled(False)
        
        self.lbl_page_info = QLabel("1 페이지")
        self.lbl_page_info.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_page_info.setStyleSheet("color: #ddd; font-weight: bold; border: none;")
        
        self.btn_next_page = QPushButton(self.t.get("api_page_next", "다음"))
        self.btn_next_page.setIcon(qta.icon('fa5s.chevron-right', color='white'))
        self.btn_next_page.setLayoutDirection(Qt.LayoutDirection.RightToLeft) # 아이콘 위치 우측으로 변경
        self.btn_next_page.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_next_page.setStyleSheet("""
            QPushButton { background-color: #555; color: white; border-radius: 4px; padding: 4px; font-weight: bold; }
            QPushButton:disabled { background-color: #333; color: #777; }
        """)
        self.btn_next_page.clicked.connect(self.action_next_page)
        self.btn_next_page.setEnabled(False)
        
        page_layout.addWidget(self.btn_prev_page)
        page_layout.addWidget(self.lbl_page_info, 1)
        page_layout.addWidget(self.btn_next_page)
        left_layout.addLayout(page_layout)
        
        self.lbl_result_count = QLabel(f"{self.t.get('search_result_prefix', '검색 결과:')} 0{self.t.get('search_result_suffix', '건')}")
        self.lbl_result_count.setStyleSheet(f"color: #aaa; font-size: {self.config['s12']}px; margin-top: 5px; border: none; outline: none;")
        self.lbl_result_count.setAlignment(Qt.AlignmentFlag.AlignCenter)
        left_layout.addWidget(self.lbl_result_count)
        
        splitter.addWidget(left_pane)

        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setStyleSheet("QScrollArea { border: 1px solid #444; border-radius: 6px; background-color: #444; }")
        self.scroll_area.verticalScrollBar().setSingleStep(15)
        
        scroll_content = QWidget()
        scroll_content.setStyleSheet("background-color: #444; border: none;") 
        detail_layout = QVBoxLayout(scroll_content)
        detail_layout.setContentsMargins(15, 15, 15, 15)
        detail_layout.setSpacing(10)
        
        title_layout = QHBoxLayout()
        self.lbl_detail_title = QLabel("-")
        self.lbl_detail_title.setStyleSheet(f"font-size: {self.config['s20']}px; font-weight: bold; color: white; padding-bottom: 5px;")
        self.lbl_detail_title.setWordWrap(True)
        self.lbl_detail_title.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.lbl_detail_title.setCursor(Qt.CursorShape.IBeamCursor)
        
        self.btn_translate = QPushButton(f" {self.t.get('btn_translate_web', '번역')}")
        self.btn_translate.setIcon(qta.icon('fa5s.language', color='white'))
        self.btn_translate.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_translate.setStyleSheet(f"background-color: #27AE60; color: white; padding: 5px 15px; border-radius: 4px; font-weight: bold; font-size: {self.config['s11']}px;")
        self.btn_translate.clicked.connect(self.action_translate)
        self.btn_translate.hide()
        
        title_layout.addWidget(self.lbl_detail_title, 1) 
        title_layout.addWidget(self.btn_translate)
        detail_layout.addLayout(title_layout)
        
        line1 = QFrame(); line1.setFrameShape(QFrame.Shape.HLine); line1.setStyleSheet("color: #666;")
        detail_layout.addWidget(line1)
        
        info_layout = QHBoxLayout()
        info_layout.setSpacing(15)
        
        self.lbl_cover = QLabel()
        self.lbl_cover.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_cover.setFixedSize(160, 240)
        self.lbl_cover.setStyleSheet("background-color: transparent; border: none; outline: none; color: #555;")
        self._set_placeholder_image() 
        
        info_layout.addWidget(self.lbl_cover, alignment=Qt.AlignmentFlag.AlignTop)
        
        self.form_layout = QFormLayout()
        self.form_layout.setContentsMargins(0, 0, 0, 0)
        self.form_layout.setSpacing(10)
        
        self.detail_labels = {}
        fields_to_show = [
            ("Writer", self.t.get("meta_writer", "작가")), 
            ("Publisher", self.t.get("meta_publisher", "출판사")), 
            ("Genre", self.t.get("meta_genre", "장르")), 
            ("Count", self.t.get("meta_count", "전체권수"))
        ]
        
        for key, label_text in fields_to_show:
            lbl_val = QLabel("-")
            lbl_val.setWordWrap(True)
            lbl_val.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            lbl_val.setStyleSheet(f"color: #ddd; font-size: {self.config['s13']}px;")
            lbl_val.setCursor(Qt.CursorShape.IBeamCursor)
            
            lbl_title = QLabel(f"{label_text}")
            lbl_title.setStyleSheet("font-weight: bold; color: #aaa;")
            self.form_layout.addRow(lbl_title, lbl_val)
            self.detail_labels[key] = lbl_val
            
        rating_title = QLabel(self.t.get("meta_rating", "평점"))
        rating_title.setStyleSheet("font-weight: bold; color: #aaa;")
        
        rating_container = QWidget()
        rating_layout = QHBoxLayout(rating_container)
        rating_layout.setContentsMargins(0, 0, 0, 0)
        rating_layout.setSpacing(5)
        
        self.detail_star_icon = QLabel()
        self.detail_star_icon.setPixmap(qta.icon('fa5s.star', color='#f1c40f').pixmap(12, 12))
        self.detail_star_icon.setStyleSheet("QLabel { background-color: transparent; border: none; outline: none; }")
        self.detail_star_icon.hide() 
        
        lbl_rating = QLabel("-")
        lbl_rating.setWordWrap(True)
        lbl_rating.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        lbl_rating.setStyleSheet(f"color: #ddd; font-size: {self.config['s13']}px;")
        lbl_rating.setCursor(Qt.CursorShape.IBeamCursor)
        
        rating_layout.addWidget(self.detail_star_icon)
        rating_layout.addWidget(lbl_rating, 1)
        
        self.form_layout.addRow(rating_title, rating_container)
        self.detail_labels["Rating"] = lbl_rating
        
        fields_to_show_bottom = [
            ("AgeRating", self.t.get("meta_age_rating", "연령등급")), 
            ("PubDate", self.t.get("meta_pub_date", "출간일"))
        ]
        for key, label_text in fields_to_show_bottom:
            lbl_val = QLabel("-")
            lbl_val.setWordWrap(True)
            lbl_val.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
            lbl_val.setStyleSheet(f"color: #ddd; font-size: {self.config['s13']}px;")
            lbl_val.setCursor(Qt.CursorShape.IBeamCursor)
            
            lbl_title = QLabel(f"{label_text}")
            lbl_title.setStyleSheet("font-weight: bold; color: #aaa;")
            self.form_layout.addRow(lbl_title, lbl_val)
            self.detail_labels[key] = lbl_val
            
        info_layout.addLayout(self.form_layout)
        detail_layout.addLayout(info_layout)
        
        line2 = QFrame(); line2.setFrameShape(QFrame.Shape.HLine); line2.setStyleSheet("color: #666;")
        detail_layout.addWidget(line2)
        
        def _add_bottom_section(title):
            lbl_t = QLabel(f"{title}")
            lbl_t.setStyleSheet("font-weight: bold; color: #aaa; margin-top: 10px;")
            lbl_v = QLabel("-")
            lbl_v.setWordWrap(True)
            lbl_v.setTextInteractionFlags(Qt.TextInteractionFlag.TextBrowserInteraction)
            lbl_v.setOpenExternalLinks(True)
            lbl_v.setStyleSheet(f"color: #ddd; font-size: {self.config['s13']}px; line-height: 1.5;")
            lbl_v.setCursor(Qt.CursorShape.IBeamCursor)
            
            detail_layout.addWidget(lbl_t); detail_layout.addWidget(lbl_v)
            return lbl_v

        self.lbl_summary = _add_bottom_section(self.t.get("meta_summary", "줄거리"))
        self.lbl_tags = _add_bottom_section(self.t.get("meta_tags_lbl", "태그"))
        self.lbl_web = _add_bottom_section(self.t.get("meta_link", "링크"))
        self.lbl_web.setCursor(Qt.CursorShape.PointingHandCursor)
        
        detail_layout.addStretch()
        self.scroll_area.setWidget(scroll_content)
        splitter.addWidget(self.scroll_area)
        
        splitter.setSizes([450, 600]) 
        main_layout.addWidget(splitter, 1)

        btn_layout = QHBoxLayout()
        
        self.lbl_cache_notice = QLabel(self.t.get("api_cache_notice", "빠른 표시를 위해 검색 결과는 7일간 캐싱됩니다."))
        self.lbl_cache_notice.setStyleSheet(f"color: #888; font-size: {self.config['s11']}px; border: none;")
        btn_layout.addWidget(self.lbl_cache_notice)
        
        btn_layout.addStretch()
        self.btn_close = QPushButton(self.t.get("btn_close", "닫기"))
        self.btn_close.setIcon(qta.icon('fa5s.times', color='white'))
        self.btn_close.setStyleSheet("background-color: #555; color: white; padding: 8px 25px; border-radius: 4px; font-weight: bold;")
        self.btn_close.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_close.clicked.connect(self.reject)
        
        self.btn_select = QPushButton(f"{self.t.get('btn_select', '선택')} (C)")
        self.btn_select.setIcon(qta.icon('fa5s.check', color='white'))
        self.btn_select.setStyleSheet("background-color: #3498DB; color: white; padding: 8px 25px; border-radius: 4px; font-weight: bold;")
        self.btn_select.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_select.clicked.connect(self.action_apply)
        
        btn_layout.addWidget(self.btn_close); btn_layout.addWidget(self.btn_select)
        main_layout.addLayout(btn_layout)

        self.shortcut_s = QShortcut(QKeySequence(Qt.Key.Key_S), self)
        self.shortcut_s.activated.connect(self._trigger_s)
        self.shortcut_s.setContext(Qt.ShortcutContext.WidgetWithChildrenShortcut)

        self.shortcut_c = QShortcut(QKeySequence(Qt.Key.Key_C), self)
        self.shortcut_c.activated.connect(self._trigger_c)
        self.shortcut_c.setContext(Qt.ShortcutContext.WidgetWithChildrenShortcut)

        QApplication.instance().focusChanged.connect(self._on_focus_changed)

    def _on_focus_changed(self, old, new):
        if new is None:
            self.shortcut_s.setEnabled(True)
            self.shortcut_c.setEnabled(True)
            return

        is_input = isinstance(new, (QLineEdit, QTextEdit, QComboBox))
        if not is_input and new.parent() is not None:
            is_input = isinstance(new.parent(), (QLineEdit, QTextEdit, QComboBox))

        if is_input:
            self.shortcut_s.setEnabled(False)
            self.shortcut_c.setEnabled(False)
        else:
            self.shortcut_s.setEnabled(True)
            self.shortcut_c.setEnabled(True)

    def _trigger_s(self):
        if self.btn_search.isEnabled():
            self.action_manual_search()

    def _trigger_c(self):
        if getattr(self, 'btn_select', None) and self.btn_select.isEnabled():
            self.action_apply()

    def done(self, r):
        try:
            QApplication.instance().focusChanged.disconnect(self._on_focus_changed)
        except TypeError:
            pass
        super().done(r)

    def on_api_combo_changed(self, text):
        if self.parent() and hasattr(self.parent(), "main_app"):
            self.parent().main_app.config["last_meta_api"] = text
            try:
                from config import save_config
                save_config(self.parent().main_app.config)
            except: pass
            
            if hasattr(self.parent(), "cb_meta_api"):
                self.parent().cb_meta_api.blockSignals(True)
                self.parent().cb_meta_api.setCurrentText(text)
                self.parent().cb_meta_api.blockSignals(False)

    def _set_placeholder_image(self):
        p = get_resource_path("previewframe.png")
        if os.path.exists(p):
            try:
                pixmap = QPixmap(p).scaled(160, 240, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation)
                rounded_pixmap = QPixmap(pixmap.size())
                rounded_pixmap.fill(Qt.GlobalColor.transparent)
                painter = QPainter(rounded_pixmap)
                painter.setRenderHint(QPainter.RenderHint.Antialiasing)
                path = QPainterPath()
                path.addRoundedRect(0, 0, pixmap.width(), pixmap.height(), 5, 5)
                painter.setClipPath(path)
                painter.drawPixmap(0, 0, pixmap)
                painter.end()
                self.lbl_cover.setPixmap(rounded_pixmap)
            except:
                self.lbl_cover.setText(self.t.get("no_image", "이미지 없음"))
        else:
            self.lbl_cover.setText(self.t.get("no_image", "이미지 없음"))

    def action_manual_search(self):
        self.btn_search.setEnabled(False)
        QTimer.singleShot(1500, lambda: self.btn_search.setEnabled(True))
        
        self.current_api = self.cb_api.currentText()
        self.current_query = self.le_query.text().strip()
        self.current_page = 1 
        self.perform_search()
        
    def action_prev_page(self):
        if self.current_page > 1:
            self.current_page -= 1
            self.perform_search()

    def action_next_page(self):
        self.current_page += 1
        self.perform_search()

    def perform_search(self):
        self.lbl_api_warning.hide()
        
        if self.current_api == "알라딘" and not self.api_keys.get("aladin", "").strip():
            self.lbl_api_warning.show()
            self._clear_results()
            return
            
        if self.current_api == "Vine" and not self.api_keys.get("vine", "").strip():
            self.lbl_api_warning.show()
            self._clear_results()
            return
            
        if self.current_api == "Google Books" and not self.api_keys.get("google", "").strip():
            self.lbl_api_warning.show()
            self._clear_results()
            return
        
        self.list_widget.clear()
        self.btn_prev_page.setEnabled(False)
        self.btn_next_page.setEnabled(False)
        
        page_str = self.t.get("api_page_info", "{page} 페이지").format(page=self.current_page)
        self.lbl_page_info.setText(page_str)
        
        self.lbl_result_count.setText("⏳ 검색 중... (Loading...)")
        self._set_placeholder_image()
        
        QApplication.processEvents()
        
        self.search_worker = SearchWorker(self.current_api, self.current_query, getattr(self, 'api_keys', {}), self.current_page)
        self.search_worker.finished_results.connect(self._on_search_finished)
        self.search_worker.start()
        
    def _clear_results(self):
        self.list_widget.clear()
        self.lbl_result_count.setText(f"{self.t.get('search_result_prefix', '검색 결과:')} 0{self.t.get('search_result_suffix', '건')}")
        self.btn_prev_page.setEnabled(False)
        self.btn_next_page.setEnabled(False)

    def _on_search_finished(self, raw_results, actual_query):
        if isinstance(raw_results, list) and not raw_results and actual_query == "RATE_LIMIT":
            Toast.show(self, self.t.get("api_rate_limit", "API 호출 한도 초과입니다. 잠시 후 다시 시도해주세요."))
            self.lbl_result_count.setText("⚠️ API 호출 제한")
            return

        # 검색어와 결과 제목의 유사도를 비교하여 내림차순 정렬
        if isinstance(raw_results, list) and raw_results:
            query_lower = self.current_query.lower()
            raw_results.sort(key=lambda x: similar(query_lower, str(x.get("Title", "")).lower()), reverse=True)

        self.search_results = raw_results 
        count = len(self.search_results)
        
        res_text = f"{self.t.get('search_result_prefix', '검색 결과:')} {count}{self.t.get('search_result_suffix', '건')}"
        if actual_query and actual_query.lower() != self.current_query.lower():
            res_text += f" <span style='color:#E67E22;'>(번역된 키워드: {actual_query})</span>"
            
        self.lbl_result_count.setText(res_text)
        
        for data in self.search_results:
            item = QListWidgetItem(self.list_widget)
            widget = SearchResultWidget(data, self.config)
            item.setSizeHint(widget.sizeHint())
            self.list_widget.setItemWidget(item, widget)
            
        if self.list_widget.count() > 0:
            self.list_widget.setCurrentRow(0)
            self.list_widget.setFocus() 
            
        self.btn_prev_page.setEnabled(self.current_page > 1)
        self.btn_next_page.setEnabled(count >= 20)

    def on_item_selected(self):
        selected_items = self.list_widget.selectedItems()
        if not selected_items: return
        
        row = self.list_widget.row(selected_items[0])
        self.selected_raw_data = self.search_results[row].copy()
        
        # --- 리디북스의 경우 책을 선택하는 순간 상세페이지에서 출간일 스크래핑 ---
        if self.current_api == "리디북스" and self.selected_raw_data.get("b_id"):
            if not self.selected_raw_data.get("Month"): 
                from core.api_fetcher import MetaApiFetcher
                b_id = self.selected_raw_data["b_id"]
                pub_date = MetaApiFetcher.get_ridi_publish_date(b_id)
                if pub_date:
                    self.selected_raw_data["PubDate"] = pub_date
                    parts = pub_date.split('-')
                    if len(parts) >= 1: self.selected_raw_data["Year"] = parts[0]
                    if len(parts) >= 2: self.selected_raw_data["Month"] = str(int(parts[1]))
                    if len(parts) >= 3: self.selected_raw_data["Day"] = str(int(parts[2]))
                    
                    self.search_results[row]["PubDate"] = pub_date
                    self.search_results[row]["Year"] = self.selected_raw_data.get("Year", "")
                    self.search_results[row]["Month"] = self.selected_raw_data.get("Month", "")
                    self.search_results[row]["Day"] = self.selected_raw_data.get("Day", "")
        # ------------------------------------------------------------------
        
        self.is_translated = False
        
        self.btn_translate.setEnabled(True)
        self.btn_translate.setText(f" {self.t.get('btn_translate_web', '번역')}")
        self.btn_translate.setIcon(qta.icon('fa5s.language', color='white'))
        self.btn_translate.setStyleSheet("background-color: #27AE60; color: white; padding: 5px 15px; border-radius: 4px; font-weight: bold;")
        
        if self.current_api in ["Anilist", "Vine", "Google Books"]: self.btn_translate.show()
        else: self.btn_translate.hide()
            
        self.update_detail_panel()

    def _apply_tag_rules(self, text):
        if not text or not self.tag_rules: return text
        items = [x.strip() for x in text.split(',')]
        new_items = []
        for item in items:
            l_item = item.lower()
            if l_item in self.tag_rules:
                mapped = self.tag_rules[l_item]
                if mapped and mapped not in new_items: new_items.append(mapped)
            else:
                if item and item not in new_items: new_items.append(item)
        return ", ".join(new_items)

    def _parse_list_to_string(self, val):
        if val is None or val == "" or val == "-": return "-"
        if isinstance(val, list): 
            if len(val) == 0: return "-"
            return ", ".join(str(x) for x in val)
        if isinstance(val, str):
            v_str = val.strip()
            if v_str.startswith('[') and v_str.endswith(']'):
                import ast
                try:
                    parsed = ast.literal_eval(v_str)
                    if isinstance(parsed, list): 
                        if len(parsed) == 0: return "-"
                        return ", ".join(str(x) for x in parsed)
                except:
                    try:
                        import json
                        parsed = json.loads(v_str)
                        if isinstance(parsed, list): 
                            if len(parsed) == 0: return "-"
                            return ", ".join(str(x) for x in parsed)
                    except: pass
        return str(val)

    def update_detail_panel(self):
        if not self.selected_raw_data: return
        
        data = self.translated_data if self.is_translated else self.selected_raw_data
        
        self.lbl_detail_title.setText(self._parse_list_to_string(data.get("Title", "-")))
        
        for key, lbl_widget in self.detail_labels.items():
            val = self._parse_list_to_string(data.get(key, ""))
            if key == "Genre": val = self._apply_tag_rules(val)
            lbl_widget.setText(val)
            
            if key == "Rating":
                if val and val != "-":
                    self.detail_star_icon.show()
                    lbl_widget.setStyleSheet(f"color: #F1C40F; font-size: {self.config['s13']}px; font-weight: bold;")
                else:
                    self.detail_star_icon.hide()
                    lbl_widget.setStyleSheet(f"color: #ddd; font-size: {self.config['s13']}px;")
            
        self.lbl_summary.setText(self._parse_list_to_string(data.get("Summary", "-")))
        
        raw_tags = self._parse_list_to_string(data.get("Tags", "-"))
        self.lbl_tags.setText(self._apply_tag_rules(raw_tags))
        
        web_link = data.get("Web", "")
        if web_link:
            self.lbl_web.setText(f"<a href='{web_link}' style='color: #3498DB;'>{web_link}</a>")
        else:
            self.lbl_web.setText("-")
        
        cover_url = data.get("CoverUrl", "")
        self.current_cover_url = cover_url 
        if cover_url:
            self._set_placeholder_image() 
            thread = ImageLoadThread(cover_url)
            thread.finished_data.connect(self._on_cover_loaded)
            thread.start()
        else:
            self._set_placeholder_image()

    def _on_cover_loaded(self, img_data, url):
        try:
            if getattr(self, "lbl_cover", None) is None or self.current_cover_url != url: return
            if img_data:
                image = QImage.fromData(img_data)
                if not image.isNull():
                    scaled_pixmap = QPixmap.fromImage(image).scaled(
                        160, 240, 
                        Qt.AspectRatioMode.KeepAspectRatio, 
                        Qt.TransformationMode.SmoothTransformation
                    )
                    
                    rounded_pixmap = QPixmap(scaled_pixmap.size())
                    rounded_pixmap.fill(Qt.GlobalColor.transparent)
                    
                    painter = QPainter(rounded_pixmap)
                    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
                    
                    path = QPainterPath()
                    path.addRoundedRect(0, 0, scaled_pixmap.width(), scaled_pixmap.height(), 5, 5)
                    
                    painter.setClipPath(path)
                    painter.drawPixmap(0, 0, scaled_pixmap)
                    painter.end()
                    
                    self.lbl_cover.setPixmap(rounded_pixmap)
                    return
            self._set_placeholder_image()
        except RuntimeError: pass

    def action_translate(self):
        if not self.selected_raw_data: return
        self.is_translated = not self.is_translated
        
        if self.is_translated:
            self.btn_translate.setText(f" {self.t.get('btn_translating', '번역 중...')}")
            self.btn_translate.setIcon(qta.icon('fa5s.spinner', spin=True, color='white'))
            self.btn_translate.setEnabled(False)
            
            self.translate_worker = TranslateWorker(self.selected_raw_data, getattr(self, 'api_keys', {}), self.target_lang)
            self.translate_worker.finished_translation.connect(self._on_translation_finished)
            self.translate_worker.start()
        else:
            self.btn_translate.setText(f" {self.t.get('btn_translate_web', '번역')}")
            self.btn_translate.setIcon(qta.icon('fa5s.language', color='white'))
            self.btn_translate.setStyleSheet("background-color: #27AE60; color: white; padding: 5px 15px; border-radius: 4px; font-weight: bold;")
            self.update_detail_panel()
            
    def _on_translation_finished(self, raw_data, translated_data):
        if self.selected_raw_data != raw_data:
            return
            
        self.btn_translate.setEnabled(True)
        self.btn_translate.setText(f" {self.t.get('btn_original_web', '원문')}")
        self.btn_translate.setIcon(qta.icon('fa5s.undo', color='white'))
        self.btn_translate.setStyleSheet("background-color: #E67E22; color: white; padding: 5px 15px; border-radius: 4px; font-weight: bold;")
        
        self.translated_data = translated_data
        self.update_detail_panel()

    def action_apply(self):
        if not self.selected_raw_data: return
        result_data = self.translated_data if self.is_translated else self.selected_raw_data
        self.selected_raw_data = result_data
        self.accept()

    def get_selected_data(self): return self.selected_raw_data