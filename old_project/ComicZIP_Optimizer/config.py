import os
import sys
import json
import locale
import platform
import shutil

# 🌟 1. 경로를 찾는 기본 함수들을 가장 먼저 정의합니다.
def get_executable_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    elif "__compiled__" in globals():
        return os.path.dirname(os.path.abspath(sys.argv[0]))
    else:
        return os.path.dirname(os.path.abspath(__file__))

def get_resource_path(filename):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base_dir, filename)
    if os.path.exists(path): return path
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        path = os.path.join(sys._MEIPASS, filename)
        if os.path.exists(path): return path
    return os.path.join(get_executable_dir(), filename)

def get_font_path(font_filename):
    """fonts/ 폴더에서 폰트 파일 경로를 반환 (Windows/Mac 크로스플랫폼)"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    candidates = []
    
    # PyInstaller 빌드 환경
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        candidates.append(os.path.join(sys._MEIPASS, 'fonts', font_filename))
    
    candidates.append(os.path.join(base_dir, 'fonts', font_filename))
    candidates.append(os.path.join(get_executable_dir(), 'fonts', font_filename))
    
    for path in candidates:
        if os.path.exists(path):
            return path
    return None

# 🌟 2. 위에서 정의된 get_executable_dir()를 활용하는 탐색 함수를 정의합니다.
def get_bin_path(tool_name):
    system = platform.system()
    if system == "Windows":
        paths_to_check = []
        
        # PyInstaller 빌드 환경인 경우 _MEIPASS 우선 탐색
        if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
            paths_to_check.append(sys._MEIPASS)
            
        paths_to_check.append(get_executable_dir())
        paths_to_check.append(os.path.dirname(os.path.abspath(__file__)))
        
        for base_path in paths_to_check:
            paths = [
                os.path.join(base_path, "bin", "win", f"{tool_name}.exe"),
                os.path.join(base_path, "bin", f"{tool_name}.exe"),
                os.path.join(base_path, f"{tool_name}.exe")
            ]
            for p in paths:
                if os.path.exists(p): 
                    return p
        return None
    else:
        # Mac, Linux, NAS 등은 시스템 환경 변수에서 호출
        return shutil.which(tool_name)

# 🌟 3. 함수들이 모두 준비되었으므로 외부 도구 전역 변수를 안전하게 할당합니다.
TOOL_CWEBP = get_bin_path("cwebp")
TOOL_PNGQUANT = get_bin_path("pngquant")
TOOL_JPEGTRAN = get_bin_path("jpegtran")
TOOL_7Z = get_bin_path("7za")

CURRENT_VERSION = ""
try:
    _ver_path = get_resource_path("version.json")
    if os.path.exists(_ver_path):
        with open(_ver_path, "r", encoding="utf-8") as _vf:
            _vdata = json.load(_vf)
            if "latest_version" in _vdata:
                CURRENT_VERSION = _vdata["latest_version"]
except:
    pass

CONFIG_FILE = os.path.join(get_executable_dir(), 'config.json')

def get_system_language():
    try:
        lang_code, _ = locale.getdefaultlocale()
        if lang_code and lang_code.startswith('ko'): return 'ko'
    except: pass
    return 'en' 

def get_safe_thread_limits():
    total_cores = os.cpu_count() or 4
    safe_max = max(1, total_cores - 1) if total_cores <= 4 else max(1, total_cores - 2)
    default_threads = max(1, int(total_cores * 0.5))
    return total_cores, safe_max, default_threads

def load_config():
    sys_lang = get_system_language()
    total_cores, safe_max, default_threads = get_safe_thread_limits()
    default_config = {
        "lang": sys_lang, "target_format": "none", "backup_on": False,
        "flatten_folders": False, "webp_conversion": False,
        "img_quality": 100, 
        "jpg_quality": 85,
        "max_threads": default_threads,
        "play_sound": True,
        "viewer_path": "",
        "dup_check_folders": [],
        "font_family": "Default",
        "font_scale": 100,
        "btn_primary": "#0078d7",
        "start_num": 0,
        "completion_sound": "Default.wav",
    }
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                default_config.update(json.load(f))
                default_config["max_threads"] = min(default_config.get("max_threads", default_threads), safe_max)
    except: pass
    
    # 불러온 설정을 바탕으로 폰트 크기를 딕셔너리에 캐싱
    scale = default_config["font_scale"] / 100.0
    ff = default_config["font_family"]
    default_config["font_family_str"] = "'Jua', 'arial', 'Noto Sans KR', 'Segoe UI Emoji'" if ff == "Default" else f"'{ff}', 'Segoe UI Emoji'"
    
    # 공통 사이즈 동적 생성 (s10, s11, s12, s14, s15)
    for size in [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30]:
        default_config[f"s{size}"] = int(size * scale)
        
    return default_config

def save_config(config_data):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, ensure_ascii=False, indent=4)
    except: pass
