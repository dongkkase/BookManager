import json
import sqlite3
import requests
from PyQt6.QtCore import QThread, pyqtSignal
from core.api_fetcher import MetaApiFetcher

DB_PATH = ".api_cache.db" 
_active_image_threads = []

class ImageLoadThread(QThread):
    finished_data = pyqtSignal(bytes, str)
    def __init__(self, url):
        super().__init__()
        self.url = url
        _active_image_threads.append(self)
        self.finished.connect(self._cleanup)
        
    def run(self):
        if not self.url:
            self.finished_data.emit(b"", self.url)
            return
            
        try:
            with sqlite3.connect(DB_PATH, timeout=10) as conn:
                c = conn.cursor()
                c.execute("SELECT data FROM img_cache WHERE url=?", (self.url,))
                row = c.fetchone()
                if row and row[0]:
                    self.finished_data.emit(row[0], self.url)
                    return
        except: pass

        try:
            resp = requests.get(self.url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
            if resp.status_code == 200:
                img_data = resp.content
                try:
                    with sqlite3.connect(DB_PATH, timeout=10) as conn:
                        c = conn.cursor()
                        c.execute("INSERT OR REPLACE INTO img_cache (url, data) VALUES (?, ?)", (self.url, img_data))
                        conn.commit()
                except: pass
                self.finished_data.emit(img_data, self.url)
                return
        except: pass
        self.finished_data.emit(b"", self.url)
        
    def _cleanup(self):
        if self in _active_image_threads: _active_image_threads.remove(self)

class SearchWorker(QThread):
    finished_results = pyqtSignal(list, str)
    def __init__(self, api_name, query, api_keys, page):
        super().__init__()
        self.api_name = api_name
        self.query = query
        self.api_keys = api_keys
        self.page = page 
        
    def run(self):
        results, actual_query = MetaApiFetcher.search(self.api_name, self.query, self.api_keys, self.page)
        if isinstance(results, str) and results == "RATE_LIMIT":
            self.finished_results.emit([], "RATE_LIMIT")
        else:
            self.finished_results.emit(results, actual_query)

class TranslateWorker(QThread):
    finished_translation = pyqtSignal(dict, dict)
    
    def __init__(self, raw_data, api_keys, target_lang="ko"):
        super().__init__()
        self.raw_data = raw_data
        self.api_keys = api_keys
        self.target_lang = target_lang
        
    def run(self):
        translated_data = self.raw_data.copy()
        fields_to_translate = ["Title", "LocalizedSeries", "Writer", "Penciller", "Publisher", "Genre", "Tags", "Summary", "Characters"]
        
        def ensure_string(text):
            if not text or text == "-": return text
            if isinstance(text, list): return ", ".join(str(x) for x in text)
            if isinstance(text, str) and text.startswith('['):
                import ast
                try:
                    parsed = ast.literal_eval(text)
                    if isinstance(parsed, list): return ", ".join(str(x) for x in parsed)
                except:
                    try:
                        import json
                        parsed = json.loads(text)
                        if isinstance(parsed, list): return ", ".join(str(x) for x in parsed)
                    except: pass
            return text
            
        for f in fields_to_translate:
            if translated_data.get(f):
                translated_data[f] = ensure_string(translated_data[f])

        uncached_data = {}
        
        try:
            with sqlite3.connect(DB_PATH, timeout=10) as conn:
                c = conn.cursor()
                c.execute("CREATE TABLE IF NOT EXISTS trans_cache (original TEXT PRIMARY KEY, translated TEXT)")
                for f in fields_to_translate:
                    original_text = translated_data.get(f)
                    if not original_text or original_text == "-": continue
                    
                    cache_key = f"{original_text}::lang_{self.target_lang}"
                    c.execute("SELECT translated FROM trans_cache WHERE original=?", (cache_key,))
                    row = c.fetchone()
                    if row and row[0]:
                        translated_data[f] = row[0]
                    else:
                        uncached_data[f] = original_text
        except:
            uncached_data = {f: translated_data[f] for f in fields_to_translate if translated_data.get(f) and translated_data.get(f) != "-"}

        if not uncached_data:
            self.finished_translation.emit(self.raw_data, translated_data)
            return

        ai_enabled = self.api_keys.get("ai_trans_enabled", False)
        ai_provider = self.api_keys.get("ai_provider", "Gemini")
        ai_key = self.api_keys.get("ai_key", "").strip()

        ai_success = False
        lang_map = {"ko": "Korean", "en": "English", "ja": "Japanese"}
        lang_name = lang_map.get(self.target_lang, "Korean")
        
        if ai_enabled and ai_key:
            prompt = (
                "You are an expert translator specializing in comic books, manga, and graphic novels. "
                f"Translate the values of the following JSON object into natural {lang_name}. "
                "Keep in mind the premise that this is comic book metadata (e.g., Summary is a book synopsis, Tags/Genres are comic genres, Characters are fictional names). "
                f"Use terminology commonly used in the {lang_name} comic/manga market. "
                "Preserve the exact JSON keys. Output ONLY valid JSON."
            )
            
            try:
                res_text = ""
                if ai_provider == "OpenAI":
                    url = "https://api.openai.com/v1/chat/completions"
                    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
                    payload = {
                        "model": "gpt-4o-mini",
                        "response_format": {"type": "json_object"},
                        "messages": [
                            {"role": "system", "content": prompt},
                            {"role": "user", "content": json.dumps(uncached_data, ensure_ascii=False)}
                        ],
                        "temperature": 0.3
                    }
                    resp = requests.post(url, headers=headers, json=payload, timeout=15)
                    if resp.status_code == 200:
                        res_text = resp.json()["choices"][0]["message"]["content"].strip()
                elif ai_provider == "Gemini":
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={ai_key}"
                    headers = {"Content-Type": "application/json"}
                    payload = {
                        "contents": [{"parts": [{"text": prompt + "\n\n" + json.dumps(uncached_data, ensure_ascii=False)}]}],
                        "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json"}
                    }
                    resp = requests.post(url, headers=headers, json=payload, timeout=15)
                    if resp.status_code == 200:
                        res_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
                        
                if res_text:
                    parsed_json = json.loads(res_text)
                    try:
                        with sqlite3.connect(DB_PATH, timeout=10) as conn:
                            c = conn.cursor()
                            for k, original_val in uncached_data.items():
                                translated_val = parsed_json.get(k)
                                if translated_val:
                                    translated_data[k] = translated_val
                                    c.execute("INSERT OR REPLACE INTO trans_cache (original, translated) VALUES (?, ?)", (f"{original_val}::lang_{self.target_lang}", translated_val))
                            conn.commit()
                        ai_success = True
                    except: pass
            except Exception as e:
                pass

        if not ai_success:
            def fallback_translate(text):
                try:
                    url = "https://translate.googleapis.com/translate_a/single"
                    params = {"client": "gtx", "sl": "auto", "tl": self.target_lang, "dt": "t", "q": text}
                    resp = requests.get(url, params=params, timeout=5)
                    if resp.status_code == 200:
                        return "".join([s[0] for s in resp.json()[0]])
                except: pass
                return text

            try:
                with sqlite3.connect(DB_PATH, timeout=10) as conn:
                    c = conn.cursor()
                    for k, original_val in uncached_data.items():
                        translated_val = fallback_translate(original_val)
                        translated_data[k] = translated_val
                        if translated_val != original_val:
                            c.execute("INSERT OR REPLACE INTO trans_cache (original, translated) VALUES (?, ?)", (f"{original_val}::lang_{self.target_lang}", translated_val))
                    conn.commit()
            except:
                for k, original_val in uncached_data.items():
                    translated_data[k] = fallback_translate(original_val)
                    
        self.finished_translation.emit(self.raw_data, translated_data)