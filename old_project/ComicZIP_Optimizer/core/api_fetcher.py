import os
import json
import sqlite3
import requests
import re
import urllib.parse
from pathlib import Path
from datetime import datetime
import cloudscraper

DB_PATH = ".api_cache.db"

scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False})

def init_db():
    with sqlite3.connect(DB_PATH, timeout=10) as conn:
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS search_cache (
                api TEXT, query TEXT, results TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (api, query)
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS img_cache (
                url TEXT PRIMARY KEY, 
                data BLOB
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS trans_cache (
                original TEXT PRIMARY KEY, 
                translated TEXT
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS ridi_date_cache (
                b_id TEXT PRIMARY KEY,
                pub_date TEXT
            )
        ''')
        conn.commit()

init_db()

class MetaApiFetcher:
    
    @staticmethod
    def _translate_ko_to_en(text, api_keys=None):
        if not api_keys: api_keys = {}
        if not re.search(r'[가-힣]', text): return text 
            
        ai_enabled = api_keys.get("ai_trans_enabled", False)
        ai_provider = api_keys.get("ai_provider", "Gemini")
        ai_key = api_keys.get("ai_key", "").strip()

        if ai_enabled and ai_key:
            prompt = f"다음 한국어 만화/코믹스 제목을 미국 Comic Vine이나 해외 DB에서 검색하기 가장 좋은 공식 영문 발매명(Official English Title) 딱 1개만 출력해. 부가 설명, 마침표, 특수기호 없이 오직 JSON의 value 값으로만 1개 출력할 것. 형식: {{\"title\": \"영문제목\"}} 입력: {text}"
            try:
                if ai_provider == "OpenAI":
                    url = "https://api.openai.com/v1/chat/completions"
                    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
                    payload = {"model": "gpt-4o-mini", "response_format": {"type": "json_object"}, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3}
                    resp = requests.post(url, headers=headers, json=payload, timeout=7)
                    if resp.status_code == 200: return json.loads(resp.json()["choices"][0]["message"]["content"]).get("title", text)
                elif ai_provider == "Gemini":
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={ai_key}"
                    headers = {"Content-Type": "application/json"}
                    payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.3, "responseMimeType": "application/json"}}
                    resp = requests.post(url, headers=headers, json=payload, timeout=7)
                    if resp.status_code == 200: return json.loads(resp.json()["candidates"][0]["content"]["parts"][0]["text"]).get("title", text)
            except: pass

        try:
            url = "https://translate.googleapis.com/translate_a/single"
            params = {"client": "gtx", "sl": "ko", "tl": "en", "dt": "t", "q": text}
            resp = scraper.get(url, params=params, timeout=5)
            if resp.status_code == 200: return resp.json()[0][0][0]
        except: pass
        return text

    # API별로 제각각인 날짜 포맷을 정밀하게 추출하여 연/월/일 분리
    @staticmethod
    def _parse_date(date_str):
        if not date_str: return "", "", ""
        clean_str = re.sub(r'<[^>]+>', '', str(date_str)).strip()
        match = re.search(r'(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})', clean_str)
        if match: return match.group(1), str(int(match.group(2))), str(int(match.group(3)))
        match = re.search(r'(\d{4})[^\d]+(\d{1,2})', clean_str)
        if match: return match.group(1), str(int(match.group(2))), ""
        match = re.search(r'(\d{4})', clean_str)
        if match: return match.group(1), "", ""
        return "", "", ""

    # 리디북스 상세페이지 출간일 스크래핑 및 DB 저장
    @staticmethod
    def get_ridi_publish_date(b_id):
        if not b_id: return ""
        with sqlite3.connect(DB_PATH, timeout=10) as conn:
            c = conn.cursor()
            c.execute("SELECT pub_date FROM ridi_date_cache WHERE b_id=?", (b_id,))
            row = c.fetchone()
            if row: return row[0]
            
        url = f"https://ridibooks.com/books/{b_id}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        try:
            resp = scraper.get(url, headers=headers, timeout=5)
            if resp.status_code == 200:
                match = re.search(r'(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?:<[^>]+>|\s|&nbsp;|)*출간', resp.text)
                if match:
                    y, m, d = match.groups()
                    pub_date = f"{y}-{int(m):02d}-{int(d):02d}"
                    with sqlite3.connect(DB_PATH, timeout=10) as conn:
                        c = conn.cursor()
                        c.execute("INSERT OR REPLACE INTO ridi_date_cache (b_id, pub_date) VALUES (?, ?)", (b_id, pub_date))
                        conn.commit()
                    return pub_date
        except: pass
        return ""

    @staticmethod
    def search(api_name, query, api_keys=None, page=1):
        if not query: return [], query
        if api_keys is None: api_keys = {}
        
        actual_query = query
        if api_name in ["Vine", "Anilist"]:
            actual_query = MetaApiFetcher._translate_ko_to_en(query, api_keys)
            
        # [핵심] 기존 꼬여버린 캐시를 완벽히 무시하도록 v6 캐시태그 적용
        cache_query = f"{query}::p{page}::v6"
            
        with sqlite3.connect(DB_PATH, timeout=10) as conn:
            c = conn.cursor()
            c.execute("SELECT results, updated_at FROM search_cache WHERE api=? AND query=?", (api_name, cache_query))
            row = c.fetchone()
            if row:
                try:
                    updated_at = datetime.strptime(row[1], "%Y-%m-%d %H:%M:%S")
                    if (datetime.now() - updated_at).total_seconds() < 604800:
                        return json.loads(row[0]), actual_query
                except: pass
        
        results = []
        is_rate_limited = False
        
        if api_name == "리디북스": results = MetaApiFetcher._search_ridibooks(query, page)
        elif api_name == "알라딘": results = MetaApiFetcher._search_aladin(query, api_keys.get("aladin", ""), page)
        elif api_name == "Google Books": results = MetaApiFetcher._search_google_books(query, api_keys.get("google", ""), page)
        elif api_name == "Anilist": results, is_rate_limited = MetaApiFetcher._search_anilist(actual_query, page)
        elif api_name == "Vine": results, is_rate_limited = MetaApiFetcher._search_vine(actual_query, api_keys.get("vine", ""), page)
            
        if is_rate_limited: return "RATE_LIMIT", actual_query
            
        if results:
            with sqlite3.connect(DB_PATH, timeout=10) as conn:
                c = conn.cursor()
                c.execute("INSERT OR REPLACE INTO search_cache (api, query, results, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", (api_name, cache_query, json.dumps(results, ensure_ascii=False)))
                conn.commit()
                
        return results, actual_query

    @staticmethod
    def _search_anilist(query, page=1):
        url = "https://graphql.anilist.co"
        graphql_query = "query ($page: Int, $perPage: Int, $search: String) { Page (page: $page, perPage: $perPage) { media (search: $search, type: MANGA) { title { romaji english native } description(asHtml: false) coverImage { extraLarge } staff { edges { role node { name { full } } } } genres tags { name } volumes chapters averageScore startDate { year month day } } } }"
        variables = {"search": query, "page": page, "perPage": 20}
        results = []
        try:
            resp = requests.post(url, json={"query": graphql_query, "variables": variables}, timeout=15)
            if resp.status_code == 429: return [], True 
            if resp.status_code == 200:
                for item in resp.json().get("data", {}).get("Page", {}).get("media", []):
                    title_dict = item.get("title", {})
                    title = title_dict.get("english") or title_dict.get("romaji") or title_dict.get("native") or ""
                    desc = re.sub(r'<[^>]+>', '', item.get("description", "")).strip() if item.get("description") else ""
                    
                    writer = []; penciller = []
                    for edge in item.get("staff", {}).get("edges", []):
                        role = edge.get("role", "").lower(); name = edge.get("node", {}).get("name", {}).get("full", "")
                        if "story" in role or "writer" in role: writer.append(name)
                        if "art" in role or "illustrator" in role: penciller.append(name)
                        
                    score = item.get("averageScore")
                    rating_score = str(score / 10.0) if score else "-"
                    rating_detail = f"{rating_score} / 10.0" if score else "-"
                    community_rating = str(score / 10.0) if score else ""
                    
                    sd = item.get("startDate", {})
                    y = sd.get("year"); m = sd.get("month"); d = sd.get("day")
                    year = str(y) if y else ""; month = str(m) if m else ""; day = str(d) if d else ""
                    pub_date = f"{y}-{m:02d}-{d:02d}" if y and m and d else year

                    results.append({
                        "Title": title, "Writer": ", ".join(writer), "Penciller": ", ".join(penciller), "Publisher": "", 
                        "Summary": desc, "Series": title, "Web": "", 
                        "CoverUrl": item.get("coverImage", {}).get("extraLarge", ""), 
                        "Tags": ", ".join([t.get("name", "") for t in item.get("tags", [])]), "Genre": ", ".join(item.get("genres", [])), 
                        "LocalizedSeries": title_dict.get("native", title), "Count": str(item.get("volumes") or item.get("chapters") or ""), 
                        "Rating": rating_detail, "RatingScore": rating_score, "CommunityRating": community_rating, "AgeRating": "", 
                        "PubDate": pub_date, "Year": year, "Month": month, "Day": day, 
                        "Volume": "", "Number": "", "Characters": ""
                    })
        except: pass
        return results, False

    @staticmethod
    def _search_google_books(query, api_key, page=1):
        if not api_key: return []
        url = "https://www.googleapis.com/books/v1/volumes"
        params = {"q": query, "key": api_key, "startIndex": str((page - 1) * 20), "maxResults": "20"}
        results = []
        try:
            resp = scraper.get(url, params=params, timeout=10)
            if resp.status_code == 200:
                for item in resp.json().get("items", []):
                    v_info = item.get("volumeInfo", {})
                    pub_date = v_info.get("publishedDate", "")
                    year, month, day = MetaApiFetcher._parse_date(pub_date)
                    desc = re.sub(r'<[^>]+>', '', v_info.get("description", "")).strip() if v_info.get("description") else ""
                    categories = ", ".join(v_info.get("categories", []))
                    
                    results.append({
                        "Title": v_info.get("title", ""), "Writer": ", ".join(v_info.get("authors", [])), "Publisher": v_info.get("publisher", ""), 
                        "Summary": desc, "Series": v_info.get("title", ""), "Web": v_info.get("infoLink", ""), 
                        "CoverUrl": v_info.get("imageLinks", {}).get("thumbnail", "").replace("http:", "https:"), 
                        "Tags": categories, "Genre": categories, "LocalizedSeries": v_info.get("title", ""),
                        "Count": "", "Rating": "-", "RatingScore": "-", "CommunityRating": "", "AgeRating": "", 
                        "PubDate": pub_date, "Year": year, "Month": month, "Day": day, 
                        "Volume": "", "Number": "", "Characters": "", "PageCount": str(v_info.get("pageCount", ""))
                    })
        except: pass
        return results

    @staticmethod
    def _search_vine(query, api_key, page=1):
        if not api_key: return [], False
        url = "https://comicvine.gamespot.com/api/search/"
        params = {"api_key": api_key, "format": "json", "resources": "volume", "query": query, "limit": "20", "page": str(page)}
        results = []
        try:
            response = scraper.get(url, params=params, headers={"User-Agent": "ComicZIP_Optimizer_App/1.0"}, timeout=15)
            if response.status_code == 429: return [], True 
            if response.status_code == 200:
                for item in response.json().get("results", []):
                    pub_obj = item.get("publisher")
                    synopsis = re.sub(r'<[^>]+>', '', item.get("description", "")).strip() if item.get("description") else ""
                    cover_obj = item.get("image", {})
                    
                    results.append({
                        "Title": item.get("name", ""), "Writer": "", "Publisher": pub_obj.get("name", "") if isinstance(pub_obj, dict) else "", 
                        "Summary": synopsis, "Series": item.get("name", ""), "Web": item.get("site_detail_url", ""), 
                        "CoverUrl": cover_obj.get("medium_url", "") if isinstance(cover_obj, dict) else "", "Tags": "", "Genre": "", 
                        "LocalizedSeries": item.get("name", ""), "Count": str(item.get("count_of_issues", "")), 
                        "Rating": "-", "RatingScore": "-", "CommunityRating": "", "AgeRating": "", 
                        "PubDate": str(item.get("start_year", "")), "Year": str(item.get("start_year", "")), "Month": "", "Day": "", 
                        "Volume": "", "Number": "", "Characters": ""
                    })
        except: pass
        return results, False

    @staticmethod
    def _search_aladin(query, ttbkey, page=1):
        if not ttbkey: return []
        url = "http://www.aladin.co.kr/ttb/api/ItemSearch.aspx"
        params = {
            "ttbkey": ttbkey, "Query": query, "QueryType": "Keyword", "MaxResults": "20", "start": str(page), 
            "SearchTarget": "Book", "output": "js", "Version": "20131101", "Cover": "Big", "OptResult": "categoryId,Story" 
        }
        results = []
        try:
            response = scraper.get(url, params=params, timeout=10)
            if response.status_code == 200:
                for item in response.json().get("item", []):
                    author_raw = item.get("author", "")
                    w_list = []; p_list = []
                    # 알라딘 작가 파싱 (괄호 내용으로 역할 분리, 콤마 단위로 파싱)
                    for part in author_raw.split(','):
                        part = part.strip()
                        if not part: continue
                        
                        name_match = re.match(r'^([^\(]+)', part)
                        name = name_match.group(1).strip() if name_match else part.strip()
                        
                        if '(옮긴이)' in part or '(번역)' in part: continue
                        elif '(그림)' in part or '(일러스트)' in part or '(작화)' in part: p_list.append(name)
                        elif '(지은이)' in part or '(글)' in part or '(원작)' in part or '(저자)' in part: w_list.append(name)
                        else:
                            if '(' not in part: w_list.append(name) 
                                
                    writer = ", ".join(w_list)
                    penciller = ", ".join(p_list)
                    
                    pub_date = item.get("pubDate", "")
                    year, month, day = MetaApiFetcher._parse_date(pub_date)
                    
                    synopsis = re.sub(r'<[^>]+>', '', item.get("description", "")).strip() if item.get("description") else ""
                    category = item.get("categoryName", "")
                    genre = category.split(">")[-1] if category else ""
                    
                    # 알라딘 평점: 원본(customerReviewRank)이 이미 10점 만점 데이터임
                    r_score = item.get("customerReviewRank", 0)
                    rating_score = str(r_score) if r_score else "-"
                    rating_detail = f"{rating_score} / 10.0" if r_score else "-"
                    community_rating = str(r_score) if r_score else ""

                    results.append({
                        "Title": item.get("title", ""), "Writer": writer, "Penciller": penciller, "Publisher": item.get("publisher", ""), 
                        "Summary": synopsis, "Series": item.get("title", ""), "Web": item.get("link", ""), 
                        "CoverUrl": item.get("cover", ""), "Tags": genre, "Genre": genre, "LocalizedSeries": item.get("title", ""),
                        "Count": "", "Rating": rating_detail, "RatingScore": rating_score, "CommunityRating": community_rating, "AgeRating": "", 
                        "PubDate": pub_date, "Year": year, "Month": month, "Day": day, 
                        "Volume": "", "Number": "", "Characters": ""
                    })
        except: pass
        return results

    @staticmethod
    def _search_ridibooks(query, page=1):
        url = "https://ridibooks.com/apps/search/search"
        params = [
            ("keyword", query), 
            ("adult_exclude", "n"), 
            ("where", "book"), 
            ("where", "author"), 
            ("what", "instant"), 
            ("size", "200"), 
            ("site", "ridi-store")
        ]
        
        encoded_query = urllib.parse.quote_plus(query)
        referer = f"https://ridibooks.com/search?q={encoded_query}&adult_exclude=n&tab=COMIC&page={page}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
            "Referer": referer
        }
        
        results = []
        
        # [터미널 출력] 통신 시작 로그
        print(f"\n[RidiBooks API] --------------------------------------------------")
        print(f"[RidiBooks API] 통신 시작 - Query: '{query}', Page: {page}")
        
        try:
            response = scraper.get(url, params=params, headers=headers, timeout=10)
            
            # [터미널 출력] 상태 코드 로그
            print(f"[RidiBooks API] 통신 상태 코드: {response.status_code}")
            
            if response.status_code == 200:
                all_books = response.json().get("book", {}).get("books", [])
                
                # [터미널 출력] 전체 도서 개수 로그
                print(f"[RidiBooks API] 응답 데이터 내 전체 책 개수: {len(all_books)}개")
                
                start_idx = (page - 1) * 20
                end_idx = page * 20
                paged_books = all_books[start_idx:end_idx]
                
                for b in paged_books:
                    b_id = b.get("b_id", "")
                    title = b.get("title", "")
                    
                    author = b.get("author", "")
                    if isinstance(author, list): 
                        author = ", ".join([str(a.get("name", a)) if isinstance(a, dict) else str(a) for a in author])
                    
                    synopsis = re.sub(r'<[^>]+>', '', str(b.get("desc", b.get("synopsis", "")))).strip() if b.get("desc") or b.get("synopsis") else ""
                    
                    cover_obj = b.get("cover", {})
                    cover = cover_obj.get("xxlarge", "") if isinstance(cover_obj, dict) else str(cover_obj)

                    tags_info = b.get("tags_info", [])
                    genre = ", ".join([c for c in [b.get("category_name", ""), b.get("category_name2", "")] if c])
                    
                    r_score = b.get("buyer_rating_score")
                    r_count = b.get("buyer_rating_count")
                    rating_score = str(round(r_score * 2, 1)) if r_score is not None else "-"
                    rating_detail = f"{rating_score} / 10.0 ({r_count})" if r_score is not None and r_count is not None else "-"
                    community_rating = str(round(r_score * 2, 1)) if r_score is not None else ""
                    
                    pub_date = b.get("web_title_pub_date", "") or b.get("publication_date", "")
                    year, month, day = MetaApiFetcher._parse_date(pub_date)

                    results.append({
                        "b_id": b_id,
                        "Title": title, "Writer": author, "Publisher": b.get("publisher", ""), 
                        "Summary": synopsis, "Series": title, "Web": f"https://ridibooks.com/books/{b_id}" if b_id else "", 
                        "CoverUrl": cover, 
                        "Tags": ", ".join([t.get("tag_name", "") for t in tags_info if isinstance(t, dict) and t.get("tag_name")]), 
                        "Genre": genre, "LocalizedSeries": title, "Count": str(b.get("book_count", "")), 
                        "Rating": rating_detail, "RatingScore": rating_score, "CommunityRating": community_rating, 
                        "AgeRating": "19세 이상" if b.get("is_adult_only") else str(b.get("age_limit", "전체 이용가")), 
                        "PubDate": pub_date, "Year": year, "Month": month, "Day": day, 
                        "Volume": "", "Number": "", "Characters": ""
                    })
                
                # [터미널 출력] 최종 파싱 결과 요약
                print(f"[RidiBooks API] 현재 페이지({page}) 파싱된 결과 수: {len(results)}개")
                for idx, res in enumerate(results):
                    print(f"  └ [{idx+1}] 제목: {res['Title'][:20]}... | 작가: {res['Writer'][:15]} | 출간일: {res['PubDate']}")
            else:
                # [터미널 출력] 통신 실패 시 로그
                print(f"[RidiBooks API] ⚠️ 통신 실패! 응답 데이터: {response.text}")
                
        except Exception as e: 
            # [터미널 출력] 예외 발생 시 (네트워크 오류, 타임아웃 등) 로그
            print(f"[RidiBooks API] ❌ 통신 중 오류 발생: {e}")
            pass
        
        print(f"[RidiBooks API] --------------------------------------------------\n")
        return results