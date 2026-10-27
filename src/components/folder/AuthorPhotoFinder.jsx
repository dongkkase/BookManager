import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';

const LABELS = {
    ko: {
        title: '네이버 사진 검색', hint: '작가 이름이나 작품명으로 검색하고 사용할 사진을 선택하세요.',
        query: '작가 이름 또는 작품명', search: '검색', searching: '검색 중…', close: '닫기',
        select: '이 사진 사용', saving: '사진 저장 중…', more: '사진 더 보기', empty: '검색 결과가 없습니다. 다른 검색어를 입력해 보세요.',
        failed: '사진 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.', imageFailed: '사진을 불러오지 못했습니다.',
        missingKeys: '설정 → 메타데이터 검색 및 API → 검색 API 설정 → 저자 사진 검색에서 NAVER API HUB의 Client ID·Client Secret을 입력한 뒤 적용해 주세요.',
        invalidKeys: '설정에 입력한 NAVER API HUB의 Client ID·Client Secret을 확인해 주세요. HUB에 등록한 앱에서 NAVER 검색의 이미지를 활성화해야 합니다.',
        rateLimit: '네이버 검색 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
        timeout: '요청 시간이 초과되었습니다. 다시 시도해 주세요.', expired: '검색 결과가 만료되었습니다. 다시 검색해 주세요.',
        storage: '사진을 저장하지 못했습니다. 저장 공간과 폴더 권한을 확인해 주세요.',
    },
    en: {
        title: 'Naver photo search', hint: 'Search by author name or book title, then choose a photo.',
        query: 'Author name or book title', search: 'Search', searching: 'Searching…', close: 'Close',
        select: 'Use this photo', saving: 'Saving photo…', more: 'More photos', empty: 'No images found. Try another search.',
        failed: 'Unable to search for photos. Please try again later.', imageFailed: 'Unable to load this photo.',
        missingKeys: 'In Settings → Metadata search & API → Search API settings → Author photo search, enter your NAVER API HUB Client ID and Client Secret, then apply the settings.',
        invalidKeys: 'Check your NAVER API HUB Client ID and Client Secret in Settings. Enable Image under NAVER Search for your registered HUB application.',
        rateLimit: 'The Naver search request limit was reached. Please try again later.',
        timeout: 'The request timed out. Please try again.', expired: 'These results have expired. Please search again.',
        storage: 'Unable to save the photo. Check available storage and folder permissions.',
    },
    ja: {
        title: 'Naver写真検索', hint: '著者名や作品名で検索し、使用する写真を選択してください。',
        query: '著者名または作品名', search: '検索', searching: '検索中…', close: '閉じる',
        select: 'この写真を使用', saving: '写真を保存中…', more: '写真をもっと見る', empty: '画像が見つかりません。別のキーワードで検索してください。',
        failed: '写真を検索できませんでした。後で再試行してください。', imageFailed: '写真を読み込めませんでした。',
        missingKeys: '設定 → メタデータ検索とAPI → 検索API設定 → 著者の写真検索でNAVER API HUBのClient IDとClient Secretを入力して適用してください。',
        invalidKeys: '設定に入力したNAVER API HUBのClient IDとClient Secretを確認してください。HUBに登録したアプリでNAVER検索の画像を有効にしてください。',
        rateLimit: 'Naver検索のリクエスト上限に達しました。後で再試行してください。',
        timeout: 'リクエストがタイムアウトしました。再試行してください。', expired: '検索結果の有効期限が切れました。再検索してください。',
        storage: '写真を保存できませんでした。空き容量とフォルダの権限を確認してください。',
    },
};

function errorMessage(code, labels) {
    return labels[{
        AUTHOR_PHOTO_MISSING_KEYS: 'missingKeys', AUTHOR_PHOTO_INVALID_KEYS: 'invalidKeys',
        AUTHOR_PHOTO_RATE_LIMIT: 'rateLimit', AUTHOR_PHOTO_TIMEOUT: 'timeout',
        AUTHOR_PHOTO_INVALID_CANDIDATE: 'expired', AUTHOR_PHOTO_IMAGE_FAILED: 'imageFailed',
        AUTHOR_PHOTO_STORAGE_FAILED: 'storage',
    }[code]] || labels.failed;
}

function PhotoCandidate({ candidate, labels, disabled, selecting, onSelect }) {
    const [preview, setPreview] = useState('');
    const [failed, setFailed] = useState(false);
    const elementRef = useRef(null);
    useEffect(() => {
        let active = true;
        let requested = false;
        const load = async () => {
            if (requested) return;
            requested = true;
            try {
                const result = await window.electronAPI?.previewAuthorPhoto?.(candidate.id);
                if (!active) return;
                if (!result?.success || !/^data:image\/(?:png|jpeg);base64,/.test(result.dataUrl)) throw new Error('preview');
                setPreview(result.dataUrl);
            } catch {
                if (active) setFailed(true);
            }
        };
        const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
        }, { rootMargin: '160px' }) : null;
        if (observer && elementRef.current) observer.observe(elementRef.current);
        else void load();
        return () => { active = false; observer?.disconnect(); };
    }, [candidate.id]);
    return <button ref={elementRef} type="button" className="author-photo-candidate" disabled={disabled || !preview || failed}
        onClick={() => onSelect(candidate)} aria-label={`${labels.select}: ${candidate.title}`}>
        <span className="author-photo-preview">
            {preview && !failed ? <img src={preview} alt="" onError={() => setFailed(true)} />
                : <span>{failed ? labels.imageFailed : '…'}</span>}
        </span>
        <strong>{candidate.title}</strong>
        <small>{selecting ? labels.saving : labels.select}</small>
    </button>;
}

export function AuthorPhotoFinder({ author, language, onSelect, onClose }) {
    const labels = LABELS[language] || LABELS.ko;
    const [query, setQuery] = useState(author.name);
    const [searchedQuery, setSearchedQuery] = useState('');
    const [results, setResults] = useState(null);
    const [nextStart, setNextStart] = useState(null);
    const [busy, setBusy] = useState(false);
    const [selecting, setSelecting] = useState('');
    const [error, setError] = useState('');
    const inputRef = useRef(null);
    const requestRef = useRef(0);
    const selectingRef = useRef(false);
    const selectCallbackRef = useRef(onSelect);
    useEffect(() => { selectCallbackRef.current = onSelect; }, [onSelect]);
    useEffect(() => {
        inputRef.current?.focus();
        return () => {
            requestRef.current += 1;
            void Promise.resolve(window.electronAPI?.releaseAuthorPhotos?.()).catch(() => {});
        };
    }, []);
    const search = async (start = 1) => {
        const request = ++requestRef.current;
        const text = start === 1 ? query.trim() : searchedQuery;
        setBusy(true);
        setError('');
        if (start === 1) { setResults(null); setNextStart(null); setSearchedQuery(text); }
        try {
            const result = await window.electronAPI?.searchAuthorPhotos?.({ query: text, start });
            if (request !== requestRef.current) return;
            if (!result?.success) { setError(errorMessage(result?.code, labels)); return; }
            setResults(previous => start === 1 ? result.results : [...(previous || []), ...result.results]);
            setNextStart(result.hasNext ? result.nextStart : null);
        } catch {
            if (request === requestRef.current) setError(labels.failed);
        } finally {
            if (request === requestRef.current) setBusy(false);
        }
    };
    const select = async candidate => {
        if (selectingRef.current) return;
        selectingRef.current = true;
        const request = ++requestRef.current;
        setSelecting(candidate.id);
        setError('');
        try {
            const result = await window.electronAPI?.selectAuthorPhoto?.({ candidateId: candidate.id });
            if (request !== requestRef.current) return;
            if (!result?.success) { setError(errorMessage(result?.code, labels)); return; }
            await selectCallbackRef.current(result.photo);
        } catch {
            if (request === requestRef.current) setError(labels.imageFailed);
        } finally {
            if (request === requestRef.current) { setSelecting(''); selectingRef.current = false; }
        }
    };
    return <section className="author-profile-finder author-photo-finder" aria-label={labels.title}>
        <div className="author-section-heading"><h3>{labels.title}</h3><button type="button" onClick={onClose} aria-label={labels.close}><FaIcon name="xmark" /></button></div>
        <p>{labels.hint}</p>
        <form onSubmit={event => { event.preventDefault(); if (!busy && !selecting && query.trim()) void search(); }}>
            <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} maxLength={200} aria-label={labels.query} disabled={Boolean(selecting)} />
            <button type="submit" disabled={busy || Boolean(selecting) || !query.trim()}>{busy ? labels.searching : labels.search}</button>
        </form>
        {error && <p role="alert">{error}</p>}
        {results?.length === 0 && <p role="status">{labels.empty}</p>}
        {selecting && <p role="status">{labels.saving}</p>}
        <div className="author-photo-results" aria-busy={busy || Boolean(selecting)}>
            {results?.map(candidate => <PhotoCandidate key={candidate.id} candidate={candidate} labels={labels}
                disabled={busy || Boolean(selecting)} selecting={selecting === candidate.id} onSelect={select} />)}
        </div>
        {nextStart && <button type="button" className="author-load-more" disabled={busy || Boolean(selecting)} onClick={() => void search(nextStart)}>{labels.more}</button>}
    </section>;
}
