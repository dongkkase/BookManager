from PyQt6.QtWidgets import QFrame, QHBoxLayout, QLabel, QPushButton, QLineEdit, QLayout, QSizePolicy
from PyQt6.QtCore import Qt, QSize, QRect, QPoint

class FlowLayout(QLayout):
    def __init__(self, parent=None, margin=4, spacing=4):
        super().__init__(parent)
        if parent is not None: self.setContentsMargins(margin, margin, margin, margin)
        self.itemList = []
        self.setSpacing(spacing)
    def __del__(self):
        item = self.takeAt(0)
        while item: item = self.takeAt(0)
    def addItem(self, item): self.itemList.append(item)
    def count(self): return len(self.itemList)
    def itemAt(self, index):
        if 0 <= index < len(self.itemList): return self.itemList[index]
        return None
    def takeAt(self, index):
        if 0 <= index < len(self.itemList): return self.itemList.pop(index)
        return None
    def expandingDirections(self): return Qt.Orientation(0)
    def hasHeightForWidth(self): return True
    def heightForWidth(self, width): return self.doLayout(QRect(0, 0, width, 0), True)
    def setGeometry(self, rect):
        super().setGeometry(rect)
        self.doLayout(rect, False)
    def sizeHint(self): return self.minimumSize()
    def minimumSize(self):
        size = QSize()
        for item in self.itemList: size = size.expandedTo(item.minimumSize())
        margins = self.contentsMargins()
        size += QSize(margins.left() + margins.right(), margins.top() + margins.bottom())
        return size
    def doLayout(self, rect, testOnly):
        margins = self.contentsMargins()
        effective_rect = rect.adjusted(margins.left(), margins.top(), -margins.right(), -margins.bottom())
        x = effective_rect.x(); y = effective_rect.y(); lineHeight = 0; spacing = self.spacing()
        for item in self.itemList:
            nextX = x + item.sizeHint().width() + spacing
            if nextX - spacing > effective_rect.right() and lineHeight > 0:
                x = effective_rect.x(); y = y + lineHeight + spacing
                nextX = x + item.sizeHint().width() + spacing; lineHeight = 0
            if not testOnly: item.setGeometry(QRect(QPoint(x, y), item.sizeHint()))
            x = nextX; lineHeight = max(lineHeight, item.sizeHint().height())
        return y + lineHeight - rect.y() + margins.bottom()

class TagWidget(QFrame):
    def __init__(self, text, remove_cb, config):
        super().__init__()
        self.text_val = text
        self.config = config
        self.setStyleSheet(f"QFrame {{ background-color: #3a7ebf; border-radius: 4px; }} QLabel {{ color: white; padding: 4px 2px 4px 6px; border: none; background: transparent; font-weight: bold; font-size: {self.config['s11']}px; }} QPushButton {{ border: none; background: transparent; color: white; padding: 4px 6px 4px 2px; font-weight: bold; }} QPushButton:hover {{ color: #ffcccc; }}")
        layout = QHBoxLayout(self); layout.setContentsMargins(0, 0, 0, 0); layout.setSpacing(2)
        lbl = QLabel(text); btn = QPushButton("×"); btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(lambda: remove_cb(self)); layout.addWidget(lbl); layout.addWidget(btn)

class TagLineEdit(QLineEdit):
    def __init__(self, parent_area, *args, **kwargs):
        super().__init__(*args, **kwargs); self.parent_area = parent_area
        
    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Backspace and not self.text(): 
            self.parent_area.remove_last_tag()
        elif event.text() == ',':
            self.parent_area.add_tag_from_input()
            return
        super().keyPressEvent(event)

class TagInputArea(QFrame):
    def __init__(self, i18n_dict, config, on_change_cb=None):
        super().__init__()
        self.i18n = i18n_dict
        self.config = config
        self.tags = []
        self.on_change_cb = on_change_cb
        
        self.setMinimumHeight(45)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Minimum)
        self.setStyleSheet("TagInputArea { background-color: #1a1a1a; border: 1px solid #555; border-radius: 4px; }")
        
        self.flow_layout = FlowLayout(self, margin=10, spacing=8)
        self.line_edit = TagLineEdit(self)
        self.line_edit.setStyleSheet("background: transparent; border: none; color: white; padding-left: 2px;")
        self.line_edit.setMinimumWidth(80)
        
        self.line_edit.setPlaceholderText(self.i18n.get("enter_after_input", "입력 후 Enter..."))
        
        self.line_edit.returnPressed.connect(self.add_tag_from_input)
        self.line_edit.editingFinished.connect(self.add_tag_from_input)
        self.flow_layout.addWidget(self.line_edit)
        
    def mousePressEvent(self, event): self.line_edit.setFocus()
    
    def add_tag_from_input(self):
        text = self.line_edit.text().strip()
        if text:
            for t in text.split(','):
                t = t.strip()
                if t and t not in self.tags: self._add_tag_ui(t)
        self.line_edit.clear()
        
    def _add_tag_ui(self, text):
        if text in self.tags: return
        self.tags.append(text); tag_widget = TagWidget(text, self.remove_tag, self.config)
        self.flow_layout.removeWidget(self.line_edit); self.flow_layout.addWidget(tag_widget); self.flow_layout.addWidget(self.line_edit)
        if self.on_change_cb: self.on_change_cb()
        
    def remove_tag(self, tag_widget):
        if tag_widget.text_val in self.tags: self.tags.remove(tag_widget.text_val)
        self.flow_layout.removeWidget(tag_widget); tag_widget.deleteLater()
        if self.on_change_cb: self.on_change_cb()
        
    def remove_last_tag(self):
        if self.tags:
            last_tag = self.tags[-1]
            for i in reversed(range(self.flow_layout.count())):
                w = self.flow_layout.itemAt(i).widget()
                if isinstance(w, TagWidget) and w.text_val == last_tag: self.remove_tag(w); break
                
    def set_tags(self, text_list):
        for i in reversed(range(self.flow_layout.count())):
            w = self.flow_layout.itemAt(i).widget()
            if w != self.line_edit: self.flow_layout.removeWidget(w); w.deleteLater()
        self.tags.clear()
        for t in text_list:
            if t: self._add_tag_ui(t)
        if self.on_change_cb: self.on_change_cb()
        
    def text(self): return ", ".join(self.tags)
    def setText(self, txt): 
        temp_cb = self.on_change_cb; self.on_change_cb = None
        self.set_tags([x.strip() for x in txt.split(',') if x.strip()])
        self.on_change_cb = temp_cb
        if self.on_change_cb: self.on_change_cb()

    def update_i18n(self, i18n_dict):
        self.i18n = i18n_dict
        self.line_edit.setPlaceholderText(self.i18n.get("enter_after_input", "입력 후 Enter..."))