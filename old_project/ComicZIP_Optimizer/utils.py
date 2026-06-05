# utils.py 전체 교체
import os
import re
import sys
import ctypes
from config import get_resource_path, get_executable_dir, load_config

def play_sound_file(sound_filename):
    try:
        sound_path = get_resource_path(os.path.join('sounds', sound_filename))
        if not os.path.exists(sound_path):
            sound_path = os.path.join(get_executable_dir(), 'sounds', sound_filename)

        if not os.path.exists(sound_path) and sound_filename == "Default.wav":
            sound_path = get_resource_path('Default.wav')
            if not os.path.exists(sound_path):
                sound_path = os.path.join(get_executable_dir(), 'sounds', 'Default.wav')

        if not os.path.exists(sound_path):
            return

        if sys.platform == 'win32':
            mciSendString = ctypes.windll.winmm.mciSendStringW
            mciSendString(f'close All', None, 0, None)
            mciSendString(f'open "{sound_path}" alias sound', None, 0, None)
            mciSendString(f'play sound', None, 0, None)
        else:
            if sys.platform == 'darwin':
                os.system(f'afplay "{sound_path}" &')
            else:
                if sound_path.lower().endswith('.mp3'):
                    os.system(f'mpg123 "{sound_path}" &')
                else:
                    os.system(f'aplay "{sound_path}" &')
    except Exception:
        pass

def play_complete_sound():
    try:
        config = load_config()
        if not config.get("play_sound", True):
            return
            
        sound_filename = config.get("completion_sound", "Default.wav")
        play_sound_file(sound_filename)
    except Exception:
        pass

def natural_keys(text):
    return [
        [f"{int(c):010d}" if c.isdigit() else c.lower()
         for c in re.split(r'(\d+)', p) if c]
        for p in str(text).replace('\\', '/').split('/')
    ]