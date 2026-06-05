import os
import ast

def main():
    source_path = 'c:/Users/eyeca/Desktop/test/ComicZIP_Optimizer/ui/tabs/tab_folder.py'
    threads_dest = 'c:/Users/eyeca/Desktop/test/ComicZIP_Optimizer/ui/tabs/tab_folder_threads.py'
    models_dest = 'c:/Users/eyeca/Desktop/test/ComicZIP_Optimizer/ui/tabs/tab_folder_models.py'
    ui_dest = 'c:/Users/eyeca/Desktop/test/ComicZIP_Optimizer/ui/tabs/tab_folder_ui.py'

    with open(source_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Define ranges based on ast parsing previously done
    thread_ranges = [(169, 243), (245, 294), (296, 583), (588, 727), (875, 1006), (1640, 1778)]
    model_ranges = [(750, 800), (805, 870), (1011, 1362), (1367, 1398), (1403, 1552)]
    ui_ranges = [(48, 82), (87, 164), (730, 745), (1557, 1615)]
    regex_range = (1621, 1638)

    def get_code(ranges):
        code = []
        for start, end in ranges:
            code.extend(lines[start-1:end])
            code.append('\n\n')
        return code

    threads_code = get_code(thread_ranges)
    models_code = get_code(model_ranges)
    ui_code = get_code(ui_ranges)
    regex_code = lines[regex_range[0]-1:regex_range[1]]

    # Write tab_folder_threads.py
    with open(threads_dest, 'w', encoding='utf-8') as f:
        f.write('import os\nimport hashlib\nimport zipfile\nimport time\nimport traceback\nimport subprocess\nimport xml.etree.ElementTree as ET\n')
        f.write('from collections import defaultdict\nfrom PyQt6.QtCore import QThread, pyqtSignal, QDir, Qt\n')
        f.write('from PyQt6.QtGui import QImage\n')
        f.write('import re\nfrom datetime import datetime\n')
        f.write('from core.library_db import db\n\n')
        f.writelines(regex_code)
        f.write('\n\n')
        f.writelines(threads_code)

    # Write tab_folder_models.py
    with open(models_dest, 'w', encoding='utf-8') as f:
        f.write('from PyQt6.QtWidgets import QHeaderView, QTableView, QStyledItemDelegate, QDialog, QVBoxLayout, QLabel, QCheckBox, QDialogButtonBox, QWidget, QListWidgetItem, QListWidget, QStyle, QRubberBand\n')
        f.write('from PyQt6.QtCore import Qt, QAbstractTableModel, QModelIndex, QSize, QRect, QPoint, QCoreApplication, pyqtSignal, QTimer, QVariant, QItemSelectionModel, QMimeData, QItemSelection, QUrl\n')
        f.write('from PyQt6.QtGui import QPainter, QColor, QFont, QFontMetrics, QPixmap, QImage, QPixmapCache, QPen, QPainterPath, QLinearGradient\n')
        f.write('import os\nimport sys\nimport subprocess\nimport hashlib\nfrom datetime import datetime\nfrom core.library_db import db\n')
        f.write('from core.i18n import get_i18n\n')
        f.write('def _(key):\n')
        f.write('    from core.i18n import get_i18n\n')
        f.write('    _TRANSLATIONS = get_i18n()\n')
        f.write('    _CURRENT_LANG = "ko"\n')
        f.write('    return _TRANSLATIONS.get(_CURRENT_LANG, _TRANSLATIONS["ko"]).get(key, key)\n\n')
        f.writelines(models_code)

    # Write tab_folder_ui.py
    with open(ui_dest, 'w', encoding='utf-8') as f:
        f.write('from PyQt6.QtWidgets import QWidget, QLayout, QFrame\n')
        f.write('from PyQt6.QtCore import Qt, QSize, QRect, QPoint\n')
        f.write('from PyQt6.QtGui import QPainter, QRadialGradient, QColor, QPainterPath, QPen, QLinearGradient, QFont\n\n')
        f.writelines(ui_code)

    # Modify tab_folder.py
    all_ranges = thread_ranges + model_ranges + ui_ranges + [regex_range]
    all_ranges.sort()

    new_lines = []
    current_line = 1
    range_idx = 0

    while current_line <= len(lines):
        if range_idx < len(all_ranges):
            start, end = all_ranges[range_idx]
            if current_line == start:
                current_line = end + 1
                range_idx += 1
                continue
        new_lines.append(lines[current_line - 1])
        current_line += 1

    content = "".join(new_lines)
    
    import_stmts = (
        "from .tab_folder_threads import DupScanThread, IndexSyncThread, DupMatchThread, MemoryExtractThread, FolderScanThread, MissingCheckThread\n"
        "from .tab_folder_models import CustomHeaderView, CustomTableView, ThumbnailDelegate, ColumnSelectDialog, LibraryTableModel\n"
        "from .tab_folder_ui import GlowCard, FlowLayout, DimOverlay, DetailBackgroundWidget\n"
    )
    content = content.replace("from core.library_db import db\n", "from core.library_db import db\n" + import_stmts, 1)

    with open(source_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print("Success")

if __name__ == '__main__':
    main()