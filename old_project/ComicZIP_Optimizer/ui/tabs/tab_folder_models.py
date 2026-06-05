from PyQt6.QtWidgets import QHeaderView, QTableView, QStyledItemDelegate, QDialog, QVBoxLayout, QLabel, QCheckBox, QDialogButtonBox, QWidget, QListWidgetItem, QListWidget, QStyle, QRubberBand
from PyQt6.QtCore import Qt, QAbstractTableModel, QModelIndex, QSize, QRect, QPoint, QCoreApplication, pyqtSignal, QTimer, QVariant, QItemSelectionModel, QMimeData, QItemSelection, QUrl
from PyQt6.QtGui import QPainter, QColor, QFont, QFontMetrics, QPixmap, QImage, QPixmapCache, QPen, QPainterPath, QLinearGradient
import os
import sys
import subprocess
import hashlib
from datetime import datetime
from core.library_db import db
from core.i18n import get_i18n
def _(key):
    from core.i18n import get_i18n
    from config import load_config
    _TRANSLATIONS = get_i18n()
    _CURRENT_LANG = load_config().get("language", load_config().get("lang", "ko"))
    return _TRANSLATIONS.get(_CURRENT_LANG, _TRANSLATIONS["ko"]).get(key, key)

class CustomHeaderView(QHeaderView):
    def __init__(self, orientation, parent=None):
        super().__init__(orientation, parent)

    def paintSection(self, painter, rect, logicalIndex):
        from PyQt6.QtGui import QColor, QPainter
        from PyQt6.QtCore import Qt, QRect

        # 1. 스타일시트로 지정된 기본 배경, 테두리, 정렬 화살표만 먼저 그립니다 (텍스트는 제외)
        painter.save()
        super().paintSection(painter, rect, logicalIndex)
        painter.restore()

        model = self.model()
        if not model: return

        # 모델의 UserRole에서 순수 텍스트를 가져옵니다.
        text = model.headerData(logicalIndex, self.orientation(), Qt.ItemDataRole.UserRole)
        if not text: return

        is_sorted = (self.sortIndicatorSection() == logicalIndex)
        
        # 정렬 상태에 따른 강조색 결정
        color = QColor("#3498DB") if is_sorted else QColor("#cccccc")

        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # 2. 점 6개 그립 아이콘 그리기
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(color)
        y_offset = rect.y() + (rect.height() - 13) // 2
        x_offset = rect.x() + 8
        for row in range(3):
            for col in range(2):
                painter.drawEllipse(x_offset + col * 4, y_offset + row * 5, 2, 2)

        # 3. 텍스트 그리기 (QSS를 무시하고 직접 색상 적용)
        font = model.headerData(logicalIndex, self.orientation(), Qt.ItemDataRole.FontRole)
        if font:
            painter.setFont(font)
        painter.setPen(color)
        
        # 우측 네이티브 정렬 화살표와 텍스트가 겹치지 않도록 우측 여백(마진) 확보
        right_margin = 20 if is_sorted else 5
        text_rect = QRect(x_offset + 16, rect.y(), rect.width() - 24 - right_margin, rect.height())
        
        # 텍스트가 길면 자동으로 잘리도록(Clip) 설정하여 그립니다.
        painter.drawText(text_rect, Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, text)
        
        painter.restore()


class CustomTableView(QTableView):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._rubber_band = None
        self._origin = QPoint()

    def mousePressEvent(self, event):
        index = self.indexAt(event.pos())
        if index.isValid() and event.button() == Qt.MouseButton.LeftButton:
            row_data = self.model()._data[index.row()]
            if row_data.get("is_dup_folder"):
                from PyQt6.QtGui import QFont, QFontMetrics
                
                text = f"📁 {row_data.get('path', '')} - ~{int(row_data.get('max_ratio', 0))}%"
                font = QFont("Jua", 10, QFont.Weight.Bold)
                fm = QFontMetrics(font)
                text_width = fm.horizontalAdvance(text)
                
                rect = self.visualRect(index)
                btn_rect = QRect(rect.left() + 20 + text_width + 15, rect.top() + 5, 90, 24)
                
                if btn_rect.contains(event.pos()):
                    path = row_data.get("path")
                    if os.name == 'nt': os.startfile(path)
                    else: subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', path])
                    return # 이벤트 소비

        if event.button() == Qt.MouseButton.LeftButton and not self.indexAt(event.pos()).isValid():
            if not self._rubber_band:
                self._rubber_band = QRubberBand(QRubberBand.Shape.Rectangle, self.viewport())
            self._origin = event.pos()
            self._rubber_band.setGeometry(QRect(self._origin, QSize()))
            self._rubber_band.show()
            
            if not (event.modifiers() & (Qt.KeyboardModifier.ControlModifier | Qt.KeyboardModifier.ShiftModifier)):
                self.clearSelection()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._rubber_band and self._rubber_band.isVisible():
            rect = QRect(self._origin, event.pos()).normalized()
            self._rubber_band.setGeometry(rect)
            
            row_count = self.model().rowCount()
            if row_count > 0:
                selection = QItemSelection()
                for r in range(row_count):
                    row_rect = self.visualRect(self.model().index(r, 0))
                    row_rect.setWidth(self.viewport().width())
                    
                    if row_rect.intersects(rect):
                        selection.select(self.model().index(r, 0), self.model().index(r, self.model().columnCount() - 1))
                
                if not (event.modifiers() & Qt.KeyboardModifier.ControlModifier):
                    self.selectionModel().select(selection, QItemSelectionModel.SelectionFlag.ClearAndSelect)
                else:
                    self.selectionModel().select(selection, QItemSelectionModel.SelectionFlag.Select)
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self._rubber_band and self._rubber_band.isVisible():
            self._rubber_band.hide()
            return
        super().mouseReleaseEvent(event)


class ThumbnailDelegate(QStyledItemDelegate):
    def __init__(self, parent=None, thumb_dir=""):
        super().__init__(parent)
        self.view_mode = "thumbnail"
        self.item_size = 360
        self.thumb_dir = thumb_dir
        
        # --- [추가됨] 부드러운 확대 애니메이션을 위한 변수 및 타이머 ---
        self.hover_targets = {}
        self.current_scales = {}
        self.anim_timer = QTimer(self)
        self.anim_timer.setInterval(15) # 약 60FPS
        self.anim_timer.timeout.connect(self._on_anim_tick)

    def _on_anim_tick(self):
        needs_update = False
        for row, target in list(self.hover_targets.items()):
            current = self.current_scales.get(row, 1.0)
            diff = target - current
            
            # 목표 배율에 거의 도달하면 타이머 갱신 종료
            if abs(diff) < 0.005:
                self.current_scales[row] = target
                if target == 1.0:
                    del self.hover_targets[row]
                    if row in self.current_scales:
                        del self.current_scales[row]
            else:
                # 현재 값에서 목표 값으로 30%씩 부드럽게 이동 (Easing 효과)
                self.current_scales[row] = current + diff * 0.3
                needs_update = True
                
        # 변경된 스케일이 있다면 화면을 다시 그리도록 요청
        if needs_update:
            if self.parent() and hasattr(self.parent(), 'currentWidget'):
                view = self.parent().currentWidget()
                if view and hasattr(view, 'viewport'):
                    view.viewport().update()
        else:
            self.anim_timer.stop()

    def paint(self, painter, option, index):
        from PyQt6.QtGui import QPen, QPainterPath, QLinearGradient
        from PyQt6.QtCore import QRectF, QRect

        if not index.isValid(): return
        
        row_data = index.model()._data[index.row()]
        
        font_family = "Jua"
        p = self.parent()
        while p:
            if hasattr(p, 'config') and isinstance(p.config, dict):
                font_family = p.config.get("font_family_str", "Jua")
                break
            p = p.parent()
        
        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        if row_data.get("is_group"):
            painter.fillRect(option.rect, QColor("#2b2b2b"))
            painter.setPen(QColor("#3498DB"))
            font = QFont(font_family, 11, QFont.Weight.Bold)
            painter.setFont(font)
            text = _("group_header").format(row_data['name'], row_data['count'])
            flags = Qt.AlignmentFlag.AlignLeft.value | Qt.AlignmentFlag.AlignVCenter.value
            painter.drawText(option.rect.adjusted(10, 0, -10, -5), flags, text)
            
            # 누락 권수 뱃지 텍스트 렌더링
            missing = row_data.get("missing", [])
            if missing:
                if len(missing) > 5:
                    missing_str = _("tf_missing_vols_more").format(', '.join(missing[:4]), len(missing))
                else:
                    missing_str = _("tf_missing_vols").format(', '.join(missing))
                    
                fm = painter.fontMetrics()
                text_width = fm.horizontalAdvance(text)
                
                painter.setPen(QColor("#E74C3C"))
                font_missing = QFont(font_family, 10, QFont.Weight.Bold)
                painter.setFont(font_missing)
                painter.drawText(option.rect.adjusted(10 + text_width + 10, 0, -10, -5), flags, missing_str)
            
            painter.setPen(QColor("#555555"))
            painter.drawLine(option.rect.left() + 5, option.rect.bottom() - 2, option.rect.right() - 5, option.rect.bottom() - 2)
            painter.restore()
            return
        
        if row_data.get("is_dup_folder"):
            painter.fillRect(option.rect, QColor("#1e1e1e"))
            painter.setPen(QColor("#e67e22"))
            font = QFont(font_family, 10, QFont.Weight.Bold)
            painter.setFont(font)
            text = f"📁 {row_data['path']} - ~{int(row_data['max_ratio'])}%"
            
            flags = Qt.AlignmentFlag.AlignLeft.value | Qt.AlignmentFlag.AlignVCenter.value
            painter.drawText(option.rect.adjusted(20, 0, 0, 0), flags, text)
            
            fm = painter.fontMetrics()
            text_width = fm.horizontalAdvance(text)
            
            btn_rect = QRect(option.rect.left() + 20 + text_width + 15, option.rect.top() + 5, 90, 24)
            painter.fillRect(btn_rect, QColor("#3a3a3a"))
            painter.setPen(QColor("#ffffff"))
            painter.drawRect(btn_rect)
            flags_center = Qt.AlignmentFlag.AlignCenter.value
            painter.drawText(btn_rect, flags_center, _("btn_open_folder"))
            painter.restore()
            return

        if row_data.get("is_dup_child"):
            painter.fillRect(option.rect, QColor("#1e1e1e"))
            painter.setPen(QColor("#aaaaaa"))
            font = QFont(font_family, 9)
            painter.setFont(font)
            text = f"      └ 📦 {row_data['name']} ({row_data['size_str']}) - {int(row_data['ratio'])}%"
            flags = Qt.AlignmentFlag.AlignLeft.value | Qt.AlignmentFlag.AlignVCenter.value
            painter.drawText(option.rect.adjusted(20, 0, -10, 0), flags, text)
            painter.restore()
            return
            
        if self.view_mode == "detail":
            col_id = index.model().active_columns[index.column()]
            if col_id == "cover":
                file_hash = row_data.get("hash", "")
                pixmap = QPixmap()
                if file_hash:
                    cached_pixmap = QPixmapCache.find(file_hash)
                    if cached_pixmap is not None and not cached_pixmap.isNull():
                        pixmap = cached_pixmap
                    else:
                        thumb_path = os.path.join(self.thumb_dir, f"{file_hash}.webp")
                        if row_data.get("thumb_processed") and os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
                            pixmap.load(thumb_path)
                            if not pixmap.isNull():
                                QPixmapCache.insert(file_hash, pixmap)
                
                if option.state & QStyle.StateFlag.State_Selected:
                    painter.fillRect(option.rect, QColor(0, 0, 0, 127))
                    
                if not pixmap.isNull():
                    rect = option.rect
                    target_rect = rect.adjusted(2, 2, -2, -2)
                    scaled_pixmap = pixmap.scaled(
                        target_size:=target_rect.size(),
                        Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                        Qt.TransformationMode.SmoothTransformation
                    )
                    crop_x = (scaled_pixmap.width() - target_rect.width()) // 2
                    crop_y = (scaled_pixmap.height() - target_rect.height()) // 2
                    cropped_pixmap = scaled_pixmap.copy(crop_x, crop_y, target_rect.width(), target_rect.height())
                    painter.drawPixmap(target_rect.topLeft(), cropped_pixmap)
                painter.restore()
                return 
            else:
                super().paint(painter, option, index)
                painter.restore()
                return

        file_name = row_data.get("name", "")
        file_hash = row_data.get("hash", "")
        
        pixmap = QPixmap()
        if file_hash:
            cached_pixmap = QPixmapCache.find(file_hash)
            if cached_pixmap is not None and not cached_pixmap.isNull():
                pixmap = cached_pixmap
            else:
                thumb_path = os.path.join(self.thumb_dir, f"{file_hash}.webp")
                if row_data.get("thumb_processed") and os.path.exists(thumb_path):
                    if os.path.getsize(thumb_path) > 0:
                        pixmap.load(thumb_path)
                        if not pixmap.isNull():
                            QPixmapCache.insert(file_hash, pixmap)
        
        is_hovered = option.state & QStyle.StateFlag.State_MouseOver
        is_selected = option.state & QStyle.StateFlag.State_Selected

        row = index.row()
        target_scale = 1.05 if (is_hovered and self.view_mode in ["thumbnail", "tile"]) else 1.0
        
        if self.hover_targets.get(row, 1.0) != target_scale:
            self.hover_targets[row] = target_scale
            if not self.anim_timer.isActive():
                self.anim_timer.start()
                
        current_scale = self.current_scales.get(row, 1.0)

        # 선택 박스를 8px 라운드 처리 (약간의 여백을 주어 가장자리가 잘리지 않게 함)
        if is_selected:
            painter.setBrush(QColor("#3a7ebf"))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawRoundedRect(option.rect.adjusted(2, 2, -2, -2), 8, 8)
        else:
            painter.setPen(QColor("#cccccc"))
            
        rect = option.rect.adjusted(5, 5, -5, -5)

        if current_scale > 1.0:
            center = rect.center()
            painter.translate(center)
            painter.scale(current_scale, current_scale)
            painter.translate(-center)
        
        if self.view_mode == "thumbnail":
            img_size = int(self.item_size) - 10 
            fixed_w = int(img_size / 1.414) # 책 커버 표준 비율(1:1.414)로 캔버스 너비 고정
            
            if pixmap.isNull():
                pw, ph = 100, 141
            else:
                pw, ph = pixmap.width(), pixmap.height()
                if pw == 0 or ph == 0: pw, ph = 100, 141
                
            # 이미지 실제 크기가 아닌 고정 캔버스 영역 안에서만 스케일링 되도록 제한
            ratio = min(fixed_w / pw, img_size / ph)
            nw, nh = int(pw * ratio), int(ph * ratio)
            
            stack_offset = 5
            visual_w = nw + (stack_offset * 2)
            visual_h = nh + (stack_offset * 2)
            
            x = rect.x() + (rect.width() - visual_w) // 2
            y = rect.y() + (rect.height() - visual_h) // 2 
            
            img_rect = QRect(x, y, nw, nh)
            
            painter.setPen(QPen(QColor(0, 0, 0, 150), 1))
            painter.setBrush(QColor(255, 255, 255, 80))
            painter.drawRoundedRect(img_rect.translated(stack_offset * 2, stack_offset * 2), 4, 4)
            painter.drawRoundedRect(img_rect.translated(stack_offset, stack_offset), 4, 4)
            
            path = QPainterPath()
            path.addRoundedRect(QRectF(img_rect), 4, 4)
            painter.save()
            painter.setClipPath(path)
            
            if not pixmap.isNull():
                painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
                painter.drawPixmap(img_rect, pixmap)
            else:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor("#2a2a2a"))
                painter.drawRect(img_rect)
            
            # 하단 1px 빈틈 수정: bottom() 대신 y() + height()를 사용해 정확한 좌표 지정
            grad_h = int(nh * 0.4) 
            grad_rect = QRect(img_rect.x(), img_rect.y() + img_rect.height() - grad_h, nw, grad_h)
            gradient = QLinearGradient(0, grad_rect.y(), 0, grad_rect.y() + grad_rect.height())
            gradient.setColorAt(0.0, QColor(0, 0, 0, 0))
            gradient.setColorAt(0.6, QColor(0, 0, 0, 180))
            gradient.setColorAt(1.0, QColor(0, 0, 0, 240))
            painter.fillRect(grad_rect, gradient)
            
            # --- [추가] 커버 상단 뱃지 (별점, 페이지 수) ---
            full_meta = row_data.get("full_meta", {})
            rating = row_data.get("rating", "") or full_meta.get("rating", "") or full_meta.get("Rating", "")
            page_count = row_data.get("page_count", "") or full_meta.get("page_count", "") or full_meta.get("PageCount", "")
            
            font_badge = QFont(font_family, 9, QFont.Weight.Bold)
            fm_badge = QFontMetrics(font_badge)
            painter.setFont(font_badge)
            
            # 좌측 상단: 별점
            if rating and str(rating) != "-" and str(rating).strip():
                rating_text = f"★ {rating}"
                bw = fm_badge.horizontalAdvance(rating_text) + 12
                bh = fm_badge.height() + 4
                bx = img_rect.x() + 4
                by = img_rect.y() + 4
                badge_rect = QRect(bx, by, bw, bh)
                
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor(0, 0, 0, 180))
                painter.drawRoundedRect(badge_rect, 4, 4)
                
                painter.setPen(QColor("#F5A623")) # 주황/노란색 별점 강조
                painter.drawText(badge_rect, Qt.AlignmentFlag.AlignCenter, rating_text)

            # 우측 상단: 페이지수
            if page_count and str(page_count) != "-" and str(page_count).strip():
                page_text = f"{page_count}p"
                bw = fm_badge.horizontalAdvance(page_text) + 12
                bh = fm_badge.height() + 4
                bx = img_rect.right() - bw - 4
                by = img_rect.y() + 4
                badge_rect = QRect(bx, by, bw, bh)
                
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor(0, 0, 0, 180))
                painter.drawRoundedRect(badge_rect, 4, 4)
                
                painter.setPen(QColor("#cccccc"))
                painter.drawText(badge_rect, Qt.AlignmentFlag.AlignCenter, page_text)
            # -----------------------------------------------

            painter.restore() 
            
            painter.setPen(QPen(QColor(150, 150, 150, 150), 1))
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawRoundedRect(img_rect, 4, 4)

            font = QFont(font_family, 10, QFont.Weight.Bold)
            painter.setFont(font)
            painter.setPen(QColor(255, 255, 255)) 
            text_rect = grad_rect.adjusted(6, 0, -6, -6) 
            flags = Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignHCenter | Qt.TextFlag.TextWordWrap.value
            painter.drawText(text_rect, flags, file_name)
            
        elif self.view_mode == "tile":
            img_size = int(self.item_size) - 10
            fixed_w = int(img_size / 1.414) # 타일 모드에서도 커버 규격 고정
            
            if pixmap.isNull():
                pw, ph = 100, 141
            else:
                pw, ph = pixmap.width(), pixmap.height()
                if pw == 0 or ph == 0: pw, ph = 100, 141
                
            # 타일 모드에서도 가로가 긴 이미지가 텍스트 영역을 침범하지 않도록 제한
            ratio = min(fixed_w / pw, img_size / ph)
            nw, nh = int(pw * ratio), int(ph * ratio)
            x = rect.x() + 5
            y = rect.y() + (rect.height() - nh) // 2
            
            img_rect = QRect(x, y, nw, nh)
            stack_offset = 4
            
            painter.setPen(QPen(QColor(0, 0, 0, 150), 1))
            painter.setBrush(QColor(255, 255, 255, 80))
            painter.drawRoundedRect(img_rect.translated(stack_offset * 2, stack_offset * 2), 4, 4)
            painter.drawRoundedRect(img_rect.translated(stack_offset, stack_offset), 4, 4)
            
            if not pixmap.isNull():
                path = QPainterPath()
                path.addRoundedRect(QRectF(img_rect), 4, 4)
                painter.save()
                painter.setClipPath(path)
                painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
                painter.drawPixmap(img_rect, pixmap)
                painter.restore()
            else:
                painter.setPen(Qt.PenStyle.NoPen)
                painter.setBrush(QColor("#2a2a2a"))
                painter.drawRoundedRect(img_rect, 4, 4)
                
            painter.setPen(QPen(QColor(150, 150, 150, 150), 1))
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.drawRoundedRect(img_rect, 4, 4)
            
            # --- [타일 모드 UI 렌더링 변경] ---
            full_meta = row_data.get("full_meta", {})
            
            text_x = img_rect.right() + 18
            text_y = img_rect.top()
            max_text_width = rect.right() - text_x - 5
            
            font_title = QFont(font_family, 11, QFont.Weight.Bold)
            font_sub = QFont(font_family, 10)
            font_desc = QFont(font_family, 9)
            
            fm_title = QFontMetrics(font_title)
            fm_sub = QFontMetrics(font_sub)
            
            # 1. 파일 이름
            painter.setFont(font_title)
            painter.setPen(QColor(255, 255, 255))
            
            title_rect = QRect(text_x, text_y, max_text_width, fm_title.height() * 2)
            flags_title = Qt.AlignmentFlag.AlignLeft.value | Qt.AlignmentFlag.AlignTop.value | Qt.TextFlag.TextWordWrap.value
            
            br_title = painter.boundingRect(title_rect, flags_title, file_name)
            painter.drawText(title_rect, flags_title, file_name)
            
            current_y = text_y + min(br_title.height(), fm_title.height() * 2) + 6
            
            # 2. 작가·출판사·장르
            painter.setFont(font_sub)
            painter.setPen(QColor("#aaaaaa"))
            
            writer = row_data.get("writer", "") or full_meta.get("writer", "") or full_meta.get("Writer", "")
            publisher = row_data.get("publisher", "") or full_meta.get("publisher", "") or full_meta.get("Publisher", "")
            genre = row_data.get("genre", "") or full_meta.get("genre", "") or full_meta.get("Genre", "")
            
            sub1_parts = [str(p) for p in [writer, publisher, genre] if p and str(p).strip() and str(p) != "-"]
            sub1_text = " · ".join(sub1_parts) if sub1_parts else _("info_no_series")
                
            sub1_elided = fm_sub.elidedText(sub1_text, Qt.TextElideMode.ElideRight, max_text_width)
            painter.drawText(text_x, current_y + fm_sub.ascent(), sub1_elided)
            current_y += fm_sub.height() + 4
            
            # 3. 페이지수·평점
            page_count = row_data.get("page_count", "") or full_meta.get("page_count", "") or full_meta.get("PageCount", "")
            rating = row_data.get("rating", "") or full_meta.get("rating", "") or full_meta.get("Rating", "")
            
            sub2_parts = []
            if page_count and str(page_count) != "-": sub2_parts.append(f"{page_count}p")
            if rating and str(rating) != "-": sub2_parts.append(f"★ {rating}")
            
            sub2_text = " · ".join(sub2_parts)
            if sub2_text:
                sub2_elided = fm_sub.elidedText(sub2_text, Qt.TextElideMode.ElideRight, max_text_width)
                painter.drawText(text_x, current_y + fm_sub.ascent(), sub2_elided)
                current_y += fm_sub.height() + 8
            else:
                current_y += 4
                
            # 4. 줄거리
            summary = row_data.get("summary", "") or full_meta.get("summary", "") or full_meta.get("Summary", "")
            if summary and summary != "-":
                painter.setFont(font_desc)
                painter.setPen(QColor("#888888"))
                desc_rect = QRect(text_x, current_y, max_text_width, rect.bottom() - current_y)
                flags_desc = Qt.AlignmentFlag.AlignLeft.value | Qt.AlignmentFlag.AlignTop.value | Qt.TextFlag.TextWordWrap.value
                
                painter.save()
                painter.setClipRect(desc_rect)
                painter.drawText(desc_rect, flags_desc, str(summary))
                painter.restore()
            
        painter.restore()

    def sizeHint(self, option, index):
        from PyQt6.QtCore import QSize
        
        row_data = index.model()._data[index.row()]
        if row_data.get("is_group") or row_data.get("is_dup_folder") or row_data.get("is_dup_child"):
            width = self.parent().viewport().width() if hasattr(self.parent(), 'viewport') else 800
            return QSize(width - 20, 35)

        if self.view_mode == "thumbnail":
            img_size = int(self.item_size) - 10
            stack_offset = 8 
            
            # 가로가 긴 이미지 때문에 그리드 레이아웃이 깨지는 것을 방지하기 위해, 
            # 모든 썸네일 아이템이 일정한 고정 너비(fixed_nw)를 갖도록 강제합니다.
            # (QImageReader 로 실제 파일 사이즈를 디스크에서 계속 읽어오던 I/O 병목도 제거)
            fixed_nw = int(img_size / 1.414)
            return QSize(fixed_nw + stack_offset + 22, int(self.item_size) + 25)
            
        elif self.view_mode == "tile":
            return QSize(int(self.item_size) * 2 + 25, int(self.item_size) + 25)
            
        return super().sizeHint(option, index)


class ColumnSelectDialog(QDialog):
    def __init__(self, parent, current_columns, all_columns):
        super().__init__(parent)
        self.setWindowTitle(_("dlg_edit_lay_title"))
        self.setFixedSize(320, 500)
        self.setStyleSheet("background-color: #2b2b2b; color: white;")
        self.selected_columns = list(current_columns)
        self.all_columns = all_columns
        self.checkboxes = {}
        self.setup_ui()

    def setup_ui(self):
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(_("dlg_edit_lay_msg")))
        
        self.list_widget = QListWidget()
        self.list_widget.setStyleSheet("background-color: #1e1e1e; border: 1px solid #444;")
        for col_id, col_name in self.all_columns.items():
            item = QListWidgetItem(self.list_widget)
            chk = QCheckBox(col_name)
            chk.setChecked(col_id in self.selected_columns)
            self.checkboxes[col_id] = chk
            self.list_widget.setItemWidget(item, chk)
            
        layout.addWidget(self.list_widget)
        btn_box = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        btn_box.accepted.connect(self.accept)
        btn_box.rejected.connect(self.reject)
        layout.addWidget(btn_box)

    def get_selected(self):
        return [col_id for col_id, chk in self.checkboxes.items() if chk.isChecked()]


class LibraryTableModel(QAbstractTableModel):
    def __init__(self, data=None, thumb_dir=""):
        super().__init__()
        self._data = data or []
        self.thumb_dir = thumb_dir
        self.ALL_COLUMNS = {
            "cover": _("col_cover"),
            "name": _("col_name"), "size": _("col_size"), "res": _("col_res"), "mtime": _("col_mtime"), "ctime": _("col_ctime"), 
            "path": _("col_path"), "ext": _("col_ext"), "series": _("col_series"), "title": _("col_title"), 
            "vol": _("col_vol"), "num": _("col_num"), "writer": _("col_writer"),
            "series_group": _("col_series_group"), "creators": _("col_creators"), "publisher": _("col_publisher"), "imprint": _("col_imprint"),
            "genre": _("col_genre"), "volume_count": _("col_vol_count"), "page_count": _("col_page_count"), "format": _("col_format"),
            "manga": _("col_manga"), "language": _("col_language"), "rating": _("col_rating"), "age_rating": _("col_age_rating"), 
            "publish_date": _("col_pub_date"), "summary": _("col_summary"), "characters": _("col_characters"), 
            "teams": _("col_teams"), "locations": _("col_locations"), "story_arc": _("col_story_arc"), 
            "tags": _("col_tags"), "notes": _("col_notes"), "web": _("col_web")
        }
        self.active_columns = ["cover", "name", "size", "mtime", "series", "title", "writer"]

    def set_columns(self, columns):
        self.beginResetModel()
        self.active_columns = [c for c in columns if c in self.ALL_COLUMNS]
        self.endResetModel()

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid() or index.row() >= len(self._data): return None
        row_data = self._data[index.row()]

        if row_data.get("is_group"):
            if role == Qt.ItemDataRole.DisplayRole and index.column() == 0:
                return _("group_header").format(row_data['name'], row_data['count'])
            elif role == Qt.ItemDataRole.BackgroundRole:
                return QColor("#222222")
            elif role == Qt.ItemDataRole.ForegroundRole:
                return QColor("#3498DB")
            elif role == Qt.ItemDataRole.FontRole:
                font = QFont()
                font.setBold(True)
                return font
            return None

        col_id = self.active_columns[index.column()]

        if col_id == "cover" and role == Qt.ItemDataRole.DisplayRole:
            return None 

        if role == Qt.ItemDataRole.TextAlignmentRole:
            if col_id in ["res", "vol", "num", "size", "mtime", "ctime", "volume_count", "page_count", "rating", "age_rating", "publish_date"]:
                return Qt.AlignmentFlag.AlignCenter.value
            return Qt.AlignmentFlag.AlignLeft.value | Qt.AlignmentFlag.AlignVCenter.value

        if role == Qt.ItemDataRole.DisplayRole:
            if col_id in row_data and row_data[col_id] != "":
                val = row_data[col_id]
            else:
                val = row_data.get("full_meta", {}).get(col_id, "")
            return str(val) if val is not None else ""
            
        elif role == Qt.ItemDataRole.UserRole:
            return row_data.get("full_path", "")
        return None

    def flags(self, index):
        flags = super().flags(index)
        if not index.isValid(): return flags
        row_data = self._data[index.row()]
        # 중복행들도 클릭(선택)이 안되도록 처리
        if row_data.get("is_group") or row_data.get("is_dup_folder") or row_data.get("is_dup_child"):
            flags &= ~Qt.ItemFlag.ItemIsSelectable 
        return flags

    def mimeTypes(self):
        return ["text/uri-list"]

    def mimeData(self, indexes):
        mime_data = QMimeData()
        urls = []
        processed_rows = set()
        for index in indexes:
            row = index.row()
            if row in processed_rows:
                continue
            processed_rows.add(row)
            
            if not self._data[row].get("is_group"):
                path = self._data[row].get("full_path")
                if path and os.path.exists(path):
                    urls.append(QUrl.fromLocalFile(path))
        
        mime_data.setUrls(urls)
        return mime_data

    def rowCount(self, parent=QModelIndex()):
        return len(self._data)

    def columnCount(self, parent=QModelIndex()):
        return len(self.active_columns)

    def headerData(self, section, orientation, role=Qt.ItemDataRole.DisplayRole):
        from PyQt6.QtGui import QFont
        from PyQt6.QtCore import Qt
        
        if orientation == Qt.Orientation.Horizontal:
            if section >= len(self.active_columns): return None
            col_id = self.active_columns[section]
            
            is_sorted = False
            config = None
            
            if hasattr(self, 'table_view'):
                if self.table_view.horizontalHeader().sortIndicatorSection() == section:
                    is_sorted = True
                p = self.table_view
                while p:
                    if hasattr(p, 'config') and isinstance(p.config, dict):
                        config = p.config
                        break
                    p = p.parent()

            text = f"{self.ALL_COLUMNS.get(col_id, '')}"
            
            if config:
                ff = config.get("font_family", "Default")
                font_family = "Jua" if ff == "Default" else ff
                base_size = config.get("s12", 12)
            else:
                font_family = "Jua"
                base_size = 12

            if role == Qt.ItemDataRole.DisplayRole:
                # CustomHeaderView에서 직접 그리므로, 기본 텍스트 렌더링 엔진 작동을 막습니다.
                return None  
                
            elif role == Qt.ItemDataRole.UserRole:
                # CustomHeaderView 텍스트 드로잉에 사용할 원본 텍스트 전달
                return text  
                
            elif role == Qt.ItemDataRole.FontRole:
                font = QFont(font_family)
                font.setPixelSize(base_size + 1)
                if is_sorted: 
                    font.setBold(True)
                return font
                
        return None

    def update_data(self, new_data):
        self.beginResetModel()
        self._data = new_data
        self.endResetModel()
