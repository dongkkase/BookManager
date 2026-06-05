from PyQt6.QtCore import QObject, pyqtSignal

class WorkerSignals(QObject):
    progress = pyqtSignal(int, str)
    load_done = pyqtSignal(dict, list, list)
    rename_done = pyqtSignal(dict, dict, bool)
    org_load_done = pyqtSignal(dict, list)
    org_process_done = pyqtSignal(dict, list, bool)
    
    # 수정됨: target_id(str), arc_path(str), img_data(object) 총 3개를 받도록 수정
    image_loaded = pyqtSignal(str, str, object)
    
    version_checked = pyqtSignal(str)
    release_notes_loaded = pyqtSignal(object)
    
    # 자동 업데이트를 위한 시그널 추가
    update_ready = pyqtSignal(str)