import zipfile
import subprocess
import os

CREATE_NO_WINDOW = 0x08000000

def bg_load_image(arc_path, inner_path, ext, target_id, seven_z_exe, signals):
    img_data = None
    try:
        if ext in ['.zip', '.cbz']:
            with zipfile.ZipFile(arc_path, 'r') as zf:
                img_data = zf.read(inner_path)
        else:
            cmd = [seven_z_exe, 'e', '-so', str(arc_path), inner_path]
            res = subprocess.run(cmd, capture_output=True, creationflags=CREATE_NO_WINDOW)
            if res.returncode == 0 and res.stdout:
                img_data = res.stdout
    except Exception as e:
        print(f"Preview image load error ({arc_path}): {e}")

    # 🌟 수정됨: signals.py 구조에 맞춰 arc_path를 포함한 3개의 인자를 전송합니다.
    signals.image_loaded.emit(target_id, str(arc_path), img_data)