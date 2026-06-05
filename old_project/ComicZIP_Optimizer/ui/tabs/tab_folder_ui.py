from PyQt6.QtWidgets import QWidget, QLayout, QFrame
from PyQt6.QtCore import Qt, QSize, QRect, QPoint
from PyQt6.QtGui import QPainter, QRadialGradient, QColor, QPainterPath, QPen, QLinearGradient, QFont

class GlowCard(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)

    def paintEvent(self, event):
        from PyQt6.QtGui import QPainter, QRadialGradient, QColor, QPainterPath
        painter = QPainter(self)

        try:
            painter.setRenderHint(QPainter.RenderHint.Antialiasing)

            w, h = self.width(), self.height()

            # 카드 배경 (둥근 모서리)
            path = QPainterPath()
            path.addRoundedRect(0, 0, w, h, 12, 12)
            painter.setClipPath(path)

            # 기본 배경색
            painter.fillPath(path, QColor(40, 40, 40, 210))

            # 우측 상단 빛 효과
            glow = QRadialGradient(w, 0, w * 0.7)   # 중심점(우상단), 반경
            glow.setColorAt(0.0, QColor(255, 255, 255, 5)) # 밝은 중심
            glow.setColorAt(0.5, QColor(255, 255, 255, 0))
            glow.setColorAt(1.0, QColor(255, 255, 255, 0))  # 투명하게 사라짐
            painter.fillPath(path, glow)

            # 테두리
            painter.setClipping(False)
            from PyQt6.QtGui import QPen
            painter.setPen(QPen(QColor(255, 255, 255, 20), 1))
            painter.drawRoundedRect(0, 0, w - 1, h - 1, 12, 12)
        finally:
            painter.end()


class FlowLayout(QLayout):
    def __init__(self, parent=None, margin=0, spacing=-1):
        super().__init__(parent)
        if parent is not None:
            self.setContentsMargins(margin, margin, margin, margin)
        self.itemList = []
        self.setSpacing(spacing)

    def __del__(self):
        item = self.takeAt(0)
        while item: item = self.takeAt(0)

    def addItem(self, item):
        self.itemList.append(item)

    def count(self):
        return len(self.itemList)

    def itemAt(self, index):
        if 0 <= index < len(self.itemList): return self.itemList[index]
        return None

    def takeAt(self, index):
        if 0 <= index < len(self.itemList): return self.itemList.pop(index)
        return None

    def expandingDirections(self):
        from PyQt6.QtCore import Qt
        return Qt.Orientation(0)

    def hasHeightForWidth(self):
        return True

    def heightForWidth(self, width):
        height = self._doLayout(from_rect=QRect(0, 0, width, 0), testOnly=True)
        return height

    def setGeometry(self, rect):
        super().setGeometry(rect)
        self._doLayout(rect, False)

    def sizeHint(self):
        return self.minimumSize()

    def minimumSize(self):
        from PyQt6.QtCore import QSize
        size = QSize()
        for item in self.itemList:
            size = size.expandedTo(item.minimumSize())
        margins = self.contentsMargins()
        size += QSize(margins.left() + margins.right(), margins.top() + margins.bottom())
        return size

    def _doLayout(self, from_rect, testOnly):
        from PyQt6.QtCore import QRect, QPoint
        x, y = from_rect.x(), from_rect.y()
        lineHeight = 0
        spacing = self.spacing()
        
        for item in self.itemList:
            wid = item.widget()
            spaceX = spacing
            spaceY = spacing
            nextX = x + item.sizeHint().width() + spaceX
            
            if nextX - spaceX > from_rect.right() and lineHeight > 0:
                x = from_rect.x()
                y = y + lineHeight + spaceY
                nextX = x + item.sizeHint().width() + spaceX
                lineHeight = 0
                
            if not testOnly:
                item.setGeometry(QRect(QPoint(x, y), item.sizeHint()))
                
            x = nextX
            lineHeight = max(lineHeight, item.sizeHint().height())
            
        return y + lineHeight - from_rect.y()


class DetailBackgroundWidget(QFrame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.bg_pixmap = None
        
    def set_cover_image(self, pixmap):
        self.bg_pixmap = pixmap
        self.update()

    def paintEvent(self, event):
        from PyQt6.QtGui import QPainter, QColor, QLinearGradient
        from PyQt6.QtCore import Qt
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        
        # 1. 기본 어두운 배경색
        painter.fillRect(self.rect(), QColor("#1e1e1e"))
        
        # 2. 썸네일 이미지가 있으면 화면에 꽉 차게 그리고 블러 처리
        if self.bg_pixmap and not self.bg_pixmap.isNull():
            scaled = self.bg_pixmap.scaled(
                self.size(),
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation
            )
            crop_x = (scaled.width() - self.width()) // 2
            crop_y = (scaled.height() - self.height()) // 2
            cropped = scaled.copy(crop_x, crop_y, self.width(), self.height())
            
            blur_factor = 10
            if self.width() > 0 and self.height() > 0:
                small = cropped.scaled(
                    max(1, self.width() // blur_factor), 
                    max(1, self.height() // blur_factor), 
                    Qt.AspectRatioMode.IgnoreAspectRatio, 
                    Qt.TransformationMode.SmoothTransformation
                )
                blurred = small.scaled(
                    self.width(), 
                    self.height(), 
                    Qt.AspectRatioMode.IgnoreAspectRatio, 
                    Qt.TransformationMode.SmoothTransformation
                )
                
                painter.setOpacity(0.6) # 이미지 투명도 조절
                painter.drawPixmap(0, 0, blurred)
                painter.setOpacity(1.0)
                
        # 3. 어둡게 덮는 오버레이 (상단에서 하단으로 갈수록 어두워지는 그라데이션)
        gradient = QLinearGradient(0, 0, 0, (self.height() / 10) * 9)
        gradient.setColorAt(0.0, QColor(20, 20, 20, 180))
        gradient.setColorAt(0.5, QColor(15, 15, 15, 210))
        gradient.setColorAt(1.0, QColor(10, 10, 10, 240))
        
        painter.fillRect(self.rect(), gradient)
        
        # 4. 테두리 (기존 패널 스타일과 동일하게)
        painter.setPen(QColor("#444444"))
        painter.drawRoundedRect(0, 0, self.width() - 1, self.height() - 1, 5, 5)
