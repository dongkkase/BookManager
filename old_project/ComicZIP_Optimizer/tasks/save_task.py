import concurrent.futures
from PyQt6.QtCore import QThread, pyqtSignal

class SaveWorker(QThread):
    progress = pyqtSignal(int, int)          
    finished_all = pyqtSignal(int, int)      
    finished_single = pyqtSignal(bool, str)  

    def __init__(self, target_dict, tab_instance, is_single=False, max_workers=4):
        super().__init__()
        self.target_dict = target_dict
        self.tab = tab_instance
        self.is_single = is_single
        self.max_workers = max_workers

    def run(self):
        if self.is_single:
            fp, data = list(self.target_dict.items())[0]
            xml_str = self.tab._create_comicinfo_xml(data)
            success, msg = self.tab._inject_xml_to_archive(fp, xml_str)
            self.finished_single.emit(success, msg)
        else:
            success_count, fail_count = 0, 0
            total = len(self.target_dict)
            current = 0
            
            def process_file(fp, data):
                xml_str = self.tab._create_comicinfo_xml(data)
                return self.tab._inject_xml_to_archive(fp, xml_str)

            with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = {executor.submit(process_file, fp, data): fp for fp, data in self.target_dict.items()}
                for future in concurrent.futures.as_completed(futures):
                    success, _ = future.result()
                    if success: success_count += 1
                    else: fail_count += 1
                    current += 1
                    self.progress.emit(current, total)
                    
            self.finished_all.emit(success_count, fail_count)