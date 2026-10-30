import React, { Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { SmoothCoverImage } from '../SmoothCoverImage';
import { authorInitials, normalizeAuthorProfile } from '../../authorCatalog.js';
import { authorProfileSourceLabels } from '../../authorProfileSourceLabels.js';
import { extractCoverImageTransfer, isCoverImagePath } from '../../coverEditorImageTransfer.js';
import { animateCoverEditorImageArrival } from '../../coverEditorImageArrival.js';
import '../../styles/AuthorProfileEditorDialog.css';

const CoverImageEditorDialog = React.lazy(() => import('../../features/fileTools/coverEditor/CoverImageEditorDialog'));
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const LABELS = {
    ko: {
        title: '프로필 수정', profile: '프로필 찾기', photo: '프로필 사진 찾기', upload: '프로필 사진 업로드',
        editProfile: '프로필 편집', name: '이름', saveProfile: '변경사항 저장',
        profileEditHint: '이름, 출생·사망 정보, 대표작과 소개를 수정하세요.', requiredName: '이름을 입력해 주세요.', dateHint: '예: 1970 또는 1970-01-01',
        query: '저자 이름 또는 작품명', source: '검색 소스', all: '전체 소스', search: '검색', searching: '검색 중…', close: '닫기',
        webSearch: '검색 창에서 선택', webHint: '자동 검색이 제한되면 검색 창에서 직접 선택하세요.',
        googleProfileHint: '구글 검색 결과의 제목·요약을 확인하고 사용할 프로필을 선택하세요.', googlePhotoHint: '구글 목록은 썸네일입니다. 큰 사진은 검색 창에서 선택하세요.',
        profileHint: '이름과 대표작을 확인한 뒤 사용할 프로필을 선택하세요.', photoHint: '네이버·구글 이미지와 프로필 검색 소스에서 사진을 찾습니다.',
        searchHint: '검색어와 소스를 선택하고 검색하세요.', empty: '검색 결과가 없습니다. 다른 검색어를 입력해 보세요.',
        selectHint: '검색 결과를 선택하면 상세 정보를 확인할 수 있습니다.', selectPhotoHint: '사진을 선택하면 미리 보고 편집할 수 있습니다.',
        selectProfile: '이 프로필 선택', editSelectedProfile: '이 프로필 편집', selectPhoto: '이 사진 사용', edit: '사진 편집', current: '현재 사진 편집',
        uploadHint: '사진 파일을 선택하거나 파일·웹브라우저의 이미지를 이곳에 끌어 놓으세요.', chooseFile: '사진 파일 선택', formats: 'JPG, PNG, WebP, GIF, BMP · 최대 16MB',
        noPhoto: '사진 없음', loadingPhoto: '사진 불러오는 중…', saving: '저장 중…', more: '사진 더 보기',
        failed: '검색하지 못했습니다. 잠시 후 다시 시도해 주세요.', imageFailed: '사진을 불러오지 못했습니다. 다른 사진을 선택해 주세요.',
        cancelled: '검색을 취소했습니다.',
        saveFailed: '변경사항을 저장하지 못했습니다. 다시 시도해 주세요.', size: '16MB 이하의 이미지 파일 하나를 선택해 주세요.',
        sourceLink: '프로필 출처', imageSource: '사진 출처', birth: '출생', death: '사망', works: '대표작', description: '소개',
        missingKeys: '네이버 이미지 검색을 사용하려면 설정 → 메타데이터 검색 및 API에서 NAVER API HUB의 Client ID와 Client Secret을 입력하세요.',
        invalidKeys: '설정의 NAVER API HUB 인증 정보와 이미지 검색 활성화 여부를 확인해 주세요.',
        rateLimit: '네이버 검색 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.', timeout: '요청 시간이 초과되었습니다. 다시 시도해 주세요.',
        profileRateLimit: '검색 소스의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.', accessBlocked: '검색 소스에서 접속을 제한하고 있습니다. 잠시 후 다시 시도해 주세요.',
        expired: '검색 결과가 만료되었습니다. 다시 검색해 주세요.', storage: '사진을 저장하지 못했습니다. 저장 공간과 폴더 권한을 확인해 주세요.',
        edited: '편집한 사진', local: '업로드한 사진', results: '검색 결과', partial: '일부 소스를 검색하지 못했습니다.',
        editHint: '편집을 적용한 뒤 이 사진 사용을 눌러 저장하세요.',
        replacePhotoTitle: '프로필 사진 변경',
        replacePhoto: '프로필 정보와 함께 사진도 변경할까요?\n\n예: 선택한 프로필의 사진으로 변경합니다.\n아니오: 기존 사진을 유지하고 프로필 정보만 변경합니다.',
        removePhoto: '선택한 프로필에는 사진이 없습니다. 기존 사진을 지우고 이니셜로 표시할까요?\n\n예: 사진 없이 새 프로필을 저장합니다.\n아니오: 기존 사진을 유지하고 프로필 정보만 변경합니다.',
    },
    en: {
        title: 'Edit profile', profile: 'Find profile', photo: 'Find profile photo', upload: 'Upload profile photo',
        editProfile: 'Edit profile', name: 'Name', saveProfile: 'Save changes',
        profileEditHint: 'Edit the name, birth and death information, notable work, and biography.', requiredName: 'Enter a name.', dateHint: 'e.g. 1970 or 1970-01-01',
        query: 'Author name or book title', source: 'Search source', all: 'All sources', search: 'Search', searching: 'Searching…', close: 'Close',
        webSearch: 'Choose in search window', webHint: 'If automatic search is restricted, choose a result in the search window.',
        googleProfileHint: 'Review Google result titles and snippets before choosing a profile.', googlePhotoHint: 'Google lists thumbnails. Choose a larger photo in the search window.',
        profileHint: 'Check the name and notable works before choosing a profile.', photoHint: 'Find photos in Naver Images, Google Images, and profile sources.',
        searchHint: 'Choose a source and enter a search term.', empty: 'No results found. Try another search.',
        selectHint: 'Select a result to view its details.', selectPhotoHint: 'Select a photo to preview and edit it.',
        selectProfile: 'Use this profile', editSelectedProfile: 'Edit this profile', selectPhoto: 'Use this photo', edit: 'Edit photo', current: 'Edit current photo',
        uploadHint: 'Choose a photo, or drag an image here from a file or web browser.', chooseFile: 'Choose photo', formats: 'JPG, PNG, WebP, GIF, BMP · Up to 16MB',
        noPhoto: 'No photo', loadingPhoto: 'Loading photo…', saving: 'Saving…', more: 'More photos',
        failed: 'Unable to search. Please try again later.', imageFailed: 'Unable to load this photo. Choose another photo.',
        cancelled: 'Search cancelled.',
        saveFailed: 'Unable to save your changes. Please try again.', size: 'Choose one image file up to 16MB.',
        sourceLink: 'Profile source', imageSource: 'Image source', birth: 'Born', death: 'Died', works: 'Notable works', description: 'About',
        missingKeys: 'To use Naver Images, enter your NAVER API HUB Client ID and Client Secret in Settings → Metadata search & API.',
        invalidKeys: 'Check your NAVER API HUB credentials and that Image Search is enabled.',
        rateLimit: 'The Naver search request limit was reached. Please try again later.', timeout: 'The request timed out. Please try again.',
        profileRateLimit: 'The search source request limit was reached. Please try again later.', accessBlocked: 'The search source is restricting access. Please try again later.',
        expired: 'These results have expired. Please search again.', storage: 'Unable to save the photo. Check storage and folder permissions.',
        edited: 'Edited photo', local: 'Uploaded photo', results: 'Search results', partial: 'Some sources could not be searched.',
        editHint: 'Apply your edits, then choose Use this photo to save.',
        replacePhotoTitle: 'Change profile photo',
        replacePhoto: 'Change the photo along with the profile information?\n\nYes: Use the selected profile’s photo.\nNo: Keep the current photo and update only the profile information.',
        removePhoto: 'The selected profile has no photo. Remove the current photo and show initials?\n\nYes: Save the new profile without a photo.\nNo: Keep the current photo and update only the profile information.',
    },
    ja: {
        title: 'プロフィール編集', profile: 'プロフィールを探す', photo: 'プロフィール写真を探す', upload: 'プロフィール写真をアップロード',
        editProfile: 'プロフィール編集', name: '名前', saveProfile: '変更を保存',
        profileEditHint: '名前、生没情報、代表作、紹介を編集してください。', requiredName: '名前を入力してください。', dateHint: '例：1970 または 1970-01-01',
        query: '著者名または作品名', source: '検索ソース', all: 'すべてのソース', search: '検索', searching: '検索中…', close: '閉じる',
        webSearch: '検索ウィンドウで選択', webHint: '自動検索が制限される場合は検索ウィンドウで直接選択してください。',
        googleProfileHint: 'Google検索結果のタイトルと要約を確認してプロフィールを選択してください。', googlePhotoHint: 'Googleの一覧はサムネイルです。大きな写真は検索ウィンドウで選択してください。',
        profileHint: '名前と代表作を確認してプロフィールを選択してください。', photoHint: 'Naver画像、Google画像、プロフィールの検索ソースから写真を探します。',
        searchHint: '検索語とソースを選択して検索してください。', empty: '結果がありません。別のキーワードを入力してください。',
        selectHint: '検索結果を選択すると詳細を確認できます。', selectPhotoHint: '写真を選択してプレビューと編集ができます。',
        selectProfile: 'このプロフィールを使用', editSelectedProfile: 'このプロフィールを編集', selectPhoto: 'この写真を使用', edit: '写真を編集', current: '現在の写真を編集',
        uploadHint: '写真を選択するか、ファイルやWebブラウザーの画像をここにドラッグしてください。', chooseFile: '写真ファイルを選択', formats: 'JPG, PNG, WebP, GIF, BMP · 最大16MB',
        noPhoto: '写真なし', loadingPhoto: '写真を読み込み中…', saving: '保存中…', more: '写真をもっと見る',
        failed: '検索できませんでした。後で再試行してください。', imageFailed: '写真を読み込めませんでした。別の写真を選択してください。',
        cancelled: '検索をキャンセルしました。',
        saveFailed: '変更を保存できませんでした。再試行してください。', size: '16MB以下の画像ファイルを1つ選択してください。',
        sourceLink: 'プロフィール出典', imageSource: '写真の出典', birth: '生年月日', death: '没年月日', works: '代表作', description: '紹介',
        missingKeys: 'Naver画像検索には設定 → メタデータ検索とAPIでNAVER API HUBのClient IDとClient Secretを入力してください。',
        invalidKeys: 'NAVER API HUBの認証情報と画像検索の有効化を確認してください。',
        rateLimit: 'Naver検索の上限に達しました。後で再試行してください。', timeout: 'タイムアウトしました。再試行してください。',
        profileRateLimit: '検索ソースのリクエスト上限に達しました。後で再試行してください。', accessBlocked: '検索ソースがアクセスを制限しています。後で再試行してください。',
        expired: '検索結果の有効期限が切れました。再検索してください。', storage: '写真を保存できませんでした。空き容量とフォルダの権限を確認してください。',
        edited: '編集した写真', local: 'アップロードした写真', results: '検索結果', partial: '一部のソースを検索できませんでした。',
        editHint: '編集を適用してから「この写真を使用」で保存してください。',
        replacePhotoTitle: 'プロフィール写真の変更',
        replacePhoto: 'プロフィール情報と一緒に写真も変更しますか？\n\nはい：選択したプロフィールの写真に変更します。\nいいえ：現在の写真を保持し、プロフィール情報のみ変更します。',
        removePhoto: '選択したプロフィールには写真がありません。現在の写真を削除し、イニシャルを表示しますか？\n\nはい：写真なしで新しいプロフィールを保存します。\nいいえ：現在の写真を保持し、プロフィール情報のみ変更します。',
    },
};

function errorText(value, labels, fallback = 'failed') {
    return labels[{
        AUTHOR_PHOTO_MISSING_KEYS: 'missingKeys', AUTHOR_PHOTO_INVALID_KEYS: 'invalidKeys',
        AUTHOR_PHOTO_RATE_LIMIT: 'rateLimit', AUTHOR_PHOTO_TIMEOUT: 'timeout',
        AUTHOR_PHOTO_INVALID_CANDIDATE: 'expired', AUTHOR_PHOTO_IMAGE_FAILED: 'imageFailed',
        AUTHOR_PHOTO_STORAGE_FAILED: 'storage', AUTHOR_PHOTO_TOO_LARGE: 'size', COVER_IMAGE_TOO_LARGE: 'size',
        AUTHOR_PROFILE_RATE_LIMIT: 'profileRateLimit', AUTHOR_PROFILE_TIMEOUT: 'timeout', AUTHOR_PROFILE_ACCESS_BLOCKED: 'accessBlocked',
        AUTHOR_PROFILE_CANCELLED: 'cancelled',
    }[value?.code]] || labels[fallback];
}

function readImage(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function SourceLink({ url, children }) {
    if (!url) return null;
    return <a href={url} onClick={event => {
        event.preventDefault();
        void window.electronAPI?.openExternal?.(url);
    }}>{children}<FaIcon name="externalLink" size={10} /></a>;
}

function CandidateImage({ candidate, labels }) {
    const [image, setImage] = useState(candidate.profile?.photoUrl || '');
    const [failed, setFailed] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (candidate.source !== 'naver') return;
        let active = true;
        let started = false;
        const load = async () => {
            if (started) return;
            started = true;
            try {
                const value = await window.electronAPI?.previewAuthorPhoto?.(candidate.id);
                if (!active) return;
                if (!value?.success || !/^data:image\/(?:png|jpeg);base64,/.test(value.dataUrl)) throw new Error('preview');
                setImage(value.dataUrl);
            } catch { if (active) setFailed(true); }
        };
        const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
        }, { rootMargin: '160px' }) : null;
        if (observer && ref.current) observer.observe(ref.current);
        else void load();
        return () => { active = false; observer?.disconnect(); };
    }, [candidate.id, candidate.source]);
    return <span ref={ref} className="author-editor-result-image">
        {image && !failed ? <SmoothCoverImage src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
            : <span title={failed ? labels.imageFailed : labels.noPhoto}>{authorInitials(candidate.title)}</span>}
    </span>;
}

export function AuthorProfileEditorDialog({ author, profile, initialTab = 'profile', language = 'ko', t, onSaveProfile, onSavePhoto, onClose }) {
    const labels = LABELS[language] || LABELS.ko;
    const sources = authorProfileSourceLabels(language);
    const titleId = useId();
    const [tab, setTab] = useState(initialTab);
    const [profileDraft, setProfileDraft] = useState(null);
    const [profileDraftSource, setProfileDraftSource] = useState(null);
    const draftSource = profileDraftSource || profile;
    const draft = profileDraft || {
        name: draftSource?.name || author.name, birthDate: draftSource?.birthDate || '', deathDate: draftSource?.deathDate || '',
        topWork: draftSource?.topWork || '', description: draftSource?.description || '',
    };
    const hasDraftName = Boolean(draft.name.replace(/<[^>]*>/g, '').trim());
    const [source, setSource] = useState('all');
    const [query, setQuery] = useState(author.name);
    const [searchedQuery, setSearchedQuery] = useState('');
    const [results, setResults] = useState(null);
    const [selected, setSelected] = useState(null);
    const [photo, setPhoto] = useState(null);
    const [imageArrival, setImageArrival] = useState(null);
    const [arrivalHighlight, setArrivalHighlight] = useState(0);
    const [nextStart, setNextStart] = useState(null);
    const [searching, setSearching] = useState(false);
    const [loadingPhoto, setLoadingPhoto] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [editing, setEditing] = useState(false);
    const [dragging, setDragging] = useState(false);
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const inputRef = useRef(null);
    const nameRef = useRef(null);
    const focusDraftRef = useRef(false);
    const fileRef = useRef(null);
    const editRef = useRef(null);
    const uploadRef = useRef(null);
    const photoStageRef = useRef(null);
    const tabRefs = useRef({});
    const requestRef = useRef(0);
    const photoRequestRef = useRef(0);
    const savingRef = useRef(false);
    const mountedRef = useRef(true);
    const closeRef = useRef(onClose);
    const saveCallbacksRef = useRef({ onSaveProfile, onSavePhoto });
    closeRef.current = onClose;
    saveCallbacksRef.current = { onSaveProfile, onSavePhoto };
    const busy = saving || loadingPhoto;
    const close = () => { if (!savingRef.current && !editing) closeRef.current(); };
    useEffect(() => {
        mountedRef.current = true;
        const dialog = dialogRef.current;
        const previous = document.activeElement;
        dialog.showModal();
        (initialTab === 'edit' ? nameRef.current : initialTab === 'upload' ? fileRef.current?.previousElementSibling : inputRef.current)?.focus();
        const cancel = event => {
            if (event.target !== dialog) return;
            event.preventDefault();
            event.stopPropagation();
            if (!savingRef.current) closeRef.current();
        };
        dialog.addEventListener('cancel', cancel);
        return () => {
            mountedRef.current = false;
            requestRef.current += 1;
            photoRequestRef.current += 1;
            dialog.removeEventListener('cancel', cancel);
            dialog.close();
            void Promise.resolve(window.electronAPI?.releaseAuthorPhotos?.()).catch(() => {});
            void Promise.resolve(window.electronAPI?.cancelAuthorWebSearch?.()).catch(() => {});
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, []);
    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const active = document.activeElement;
        if (!dialog?.open || editing) return;
        if (!dialog.contains(active) || active?.matches(':disabled')) {
            const target = closeButtonRef.current?.disabled ? dialog : closeButtonRef.current;
            target?.focus({ preventScroll: true });
        }
    }, [busy, searching, editing]);
    useLayoutEffect(() => {
        if (tab === 'edit' && focusDraftRef.current) {
            focusDraftRef.current = false;
            nameRef.current?.focus({ preventScroll: true });
        }
    }, [tab]);
    useEffect(() => {
        if (!imageArrival) return;
        if (imageArrival.id !== photoRequestRef.current || tab !== 'upload' || busy || editing) {
            setImageArrival(null);
            return;
        }
        let cancelled = false;
        const cancel = animateCoverEditorImageArrival({
            sourceElement: uploadRef.current,
            targetElement: photoStageRef.current,
            container: dialogRef.current,
            image: imageArrival.image,
            onFinish: () => {
                if (cancelled || !mountedRef.current || imageArrival.id !== photoRequestRef.current) return;
                setImageArrival(current => current?.id === imageArrival.id ? null : current);
                setArrivalHighlight(imageArrival.id);
            },
        });
        return () => { cancelled = true; cancel(); };
    }, [imageArrival, tab, busy, editing]);
    const resetSearch = () => {
        void Promise.resolve(window.electronAPI?.cancelAuthorWebSearch?.()).catch(() => {});
        requestRef.current += 1;
        photoRequestRef.current += 1;
        setImageArrival(null);
        setArrivalHighlight(0);
        setSearching(false);
        setLoadingPhoto(false);
        setResults(null);
        setSelected(null);
        setNextStart(null);
        setError('');
        setNotice('');
    };
    const changeTab = value => {
        if (busy || editing || value === tab) return;
        resetSearch();
        setTab(value);
        if (value === 'profile' && source === 'naver') setSource('all');
    };
    const updateDraft = (field, value) => setProfileDraft(current => ({ ...(current || draft), [field]: value }));
    const editSelectedProfile = () => {
        if (busy || searching || editing || savingRef.current || !selected?.profile) return;
        const next = selected.profile;
        setProfileDraftSource(next);
        setProfileDraft({
            name: next.name, birthDate: next.birthDate, deathDate: next.deathDate,
            topWork: next.topWork || next.works.join(', '), description: next.description,
        });
        focusDraftRef.current = true;
        changeTab('edit');
    };
    const search = async (start = 1) => {
        if (busy || searching || !query.trim()) return;
        const request = ++requestRef.current;
        const text = start === 1 ? query.trim() : searchedQuery;
        const photos = tab === 'photo';
        setSearching(true);
        setError('');
        setNotice('');
        if (start === 1) {
            setResults(null);
            setSelected(null);
            setPhoto(null);
            setNextStart(null);
            setSearchedQuery(text);
        }
        const tasks = [];
        if (start === 1 && source !== 'naver') tasks.push((async () => {
            const value = await window.electronAPI?.searchAuthorProfiles?.(text, { allSources: true, source, photos });
            if (!value?.success) throw value || new Error();
            return { partial: value.partial, failedSources: value.failedSources, results: value.profiles.map(normalizeAuthorProfile).filter(item => item && (source === 'all' || source === item.provider) && (!photos || item.photoUrl))
                .map(item => ({ id: item.id, source: item.provider, title: item.name, profile: item })) };
        })());
        if (photos && (source === 'all' || source === 'naver')) tasks.push((async () => {
            const value = await window.electronAPI?.searchAuthorPhotos?.({ query: text, start });
            if (!value?.success) throw { ...value, failedSources: [{ source: 'naver', code: value?.code }] };
            return { results: value.results.map(item => ({ ...item, source: 'naver' })), nextStart: value.hasNext ? value.nextStart : null };
        })());
        const settled = await Promise.allSettled(tasks);
        if (!mountedRef.current || request !== requestRef.current) return;
        const successes = settled.filter(value => value.status === 'fulfilled').map(value => value.value);
        const failures = settled.filter(value => value.status === 'rejected');
        const found = successes.flatMap(value => value.results);
        const failedSources = [...successes, ...failures.map(value => value.reason)].flatMap(value => Array.isArray(value?.failedSources) ? value.failedSources : []);
        const failedNames = [...new Set(failedSources.map(value => sources[value?.source]).filter(Boolean))];
        const partialMessage = `${labels.partial}${failedNames.length ? ` (${failedNames.join(', ')})` : ''}`;
        if (successes.some(value => value.partial)) setNotice(partialMessage);
        if (failures.length) {
            const message = failures.map(value => errorText(value.reason, labels)).join(' ');
            if (successes.length) setNotice(`${partialMessage} ${message}`);
            else setError(`${failedNames.length ? `${failedNames.join(', ')}: ` : ''}${message}`);
        }
        setResults(previous => start === 1 ? found : [...(previous || []), ...found]);
        setNextStart(successes.find(value => value.nextStart)?.nextStart || null);
        setSearching(false);
    };
    const searchInWindow = async () => {
        if (busy || searching || !query.trim() || !['google', 'namuwiki'].includes(source)) return;
        const request = ++requestRef.current;
        setSearching(true);
        setError('');
        try {
            const value = await window.electronAPI?.openAuthorWebSearch?.({ source, query: query.trim(), kind: tab === 'photo' ? 'photo' : 'profile' });
            if (!mountedRef.current || request !== requestRef.current || value?.cancelled) return;
            if (tab === 'profile') {
                const profile = normalizeAuthorProfile(value?.profile);
                if (!profile) throw value || new Error();
                const candidate = { id: profile.id, source: profile.provider, title: profile.name, profile };
                setResults(current => [candidate, ...(current || []).filter(item => item.id !== candidate.id)]);
                setSelected(candidate);
            } else {
                if (!value?.dataUrl || !value.photo) throw value || new Error();
                const imported = await window.electronAPI?.importAuthorPhoto?.({ dataUrl: value.dataUrl, photo: value.photo });
                if (!mountedRef.current || request !== requestRef.current) return;
                if (!imported?.success || !imported.photo || !imported.dataUrl) throw imported || new Error();
                setImageArrival(null);
                setArrivalHighlight(0);
                setSelected(null);
                setPhoto({ ...imported, title: query.trim(), edited: false });
            }
        } catch (failure) {
            if (mountedRef.current && request === requestRef.current) setError(errorText(failure, labels));
        } finally {
            if (mountedRef.current && request === requestRef.current) setSearching(false);
        }
    };
    const choosePhoto = async (candidate, openEditor = false) => {
        if (savingRef.current || busy || searching) return;
        const request = ++photoRequestRef.current;
        setImageArrival(null);
        setArrivalHighlight(0);
        setSelected(candidate);
        setPhoto(null);
        setLoadingPhoto(true);
        setError('');
        try {
            const value = candidate.source === 'naver'
                ? await window.electronAPI?.selectAuthorPhoto?.({ candidateId: candidate.id, includeDataUrl: true })
                : await window.electronAPI?.saveAuthorProfilePhoto?.(candidate.profile, { includeDataUrl: true });
            if (!mountedRef.current || request !== photoRequestRef.current) return;
            if (!value?.success || !value.photo || !value.dataUrl) throw value || new Error();
            setPhoto({ ...value, title: candidate.title, edited: false });
            if (openEditor) setEditing(true);
        } catch (failure) {
            if (mountedRef.current && request === photoRequestRef.current) setError(errorText(failure, labels, 'imageFailed'));
        } finally {
            if (mountedRef.current && request === photoRequestRef.current) setLoadingPhoto(false);
        }
    };
    const upload = async transfer => {
        if (busy || editing) return;
        if (!transfer || transfer.errorKey) {
            setError(transfer?.errorKey === 'cover_editor_drop_one' ? labels.size : labels.imageFailed);
            return;
        }
        const { file, url } = transfer;
        if (file && (!file.size || file.size > MAX_IMAGE_BYTES
            || !/^image\/(?:jpeg|png|webp|gif|bmp|x-ms-bmp)$/i.test(file.type) && !(!file.type && isCoverImagePath(file.name)))) {
            setError(labels.size);
            return;
        }
        const request = ++photoRequestRef.current;
        let importedImage;
        setImageArrival(null);
        setArrivalHighlight(0);
        setLoadingPhoto(true);
        setError('');
        try {
            let dataUrl;
            if (file) {
                dataUrl = await readImage(file);
            } else {
                importedImage = await window.electronAPI?.previewCoverEditorImportedImage?.({ url });
                if (!mountedRef.current || request !== photoRequestRef.current) return;
                if (importedImage?.error || !importedImage?.dataUrl) throw importedImage || new Error();
                dataUrl = importedImage.dataUrl;
            }
            if (!mountedRef.current || request !== photoRequestRef.current) return;
            const value = await window.electronAPI?.importAuthorPhoto?.({ dataUrl });
            if (!mountedRef.current || request !== photoRequestRef.current) return;
            if (!value?.success || !value.photo || !value.dataUrl) throw value || new Error();
            setSelected(null);
            const nextPhoto = { ...value, title: file?.name || labels.local, edited: false };
            setImageArrival({ id: request, image: nextPhoto, previousPhoto: photo });
            setPhoto(nextPhoto);
        } catch (failure) {
            if (mountedRef.current && request === photoRequestRef.current) setError(errorText(failure, labels, 'imageFailed'));
        } finally {
            if (importedImage?.imagePath) void Promise.resolve(window.electronAPI?.releaseCoverEditorImages?.({ imagePath: importedImage.imagePath })).catch(() => {});
            if (mountedRef.current && request === photoRequestRef.current) setLoadingPhoto(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };
    const save = async () => {
        if (busy || searching || savingRef.current || (tab === 'edit' ? !hasDraftName : tab === 'profile' ? !selected?.profile : !photo)) return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            let saved;
            if (tab === 'edit' || tab === 'profile') {
                let next = tab === 'edit' ? normalizeAuthorProfile({
                    ...(draftSource || { provider: 'local', id: `local:${crypto.randomUUID()}` }), ...draft,
                }) : selected.profile;
                if (tab === 'edit' && !next?.name) { setError(labels.requiredName); return; }
                const current = normalizeAuthorProfile(profile);
                if ((tab === 'profile' || profileDraftSource) && current?.photoUrl) {
                    const choice = await window.electronAPI?.showMessage?.({
                        type: 'question', title: labels.replacePhotoTitle,
                        message: next.photoUrl ? labels.replacePhoto : labels.removePhoto,
                        buttons: 'yes-no-cancel', defaultChoice: 'no', language,
                    });
                    if (!mountedRef.current || !['yes', 'no'].includes(choice)) return;
                    if (choice === 'no') {
                        let preservedPhoto = current.photoOverride;
                        if (!preservedPhoto) {
                            let stored = current.storedPhoto;
                            if (!stored) {
                                const value = await window.electronAPI?.saveAuthorProfilePhoto?.(current);
                                if (!mountedRef.current) return;
                                if (!value?.success || !value.photo) throw value || new Error();
                                stored = value.photo;
                            }
                            preservedPhoto = {
                                id: stored.id, sourceUrl: stored.sourceUrl, source: current.provider,
                                query: current.name || author.name,
                                imageSourceUrl: current.imageSourceUrl, imageArtist: current.imageArtist, imageLicense: current.imageLicense,
                            };
                        }
                        next = normalizeAuthorProfile({ ...next, photoOverride: preservedPhoto });
                        if (!next?.photoOverride || next.photoOverride.id !== preservedPhoto.id) throw new Error();
                    }
                }
                if (!mountedRef.current) return;
                saved = await saveCallbacksRef.current.onSaveProfile(next);
            } else {
                let chosen = photo.photo;
                if (photo.edited) {
                    const value = await window.electronAPI?.importAuthorPhoto?.({ dataUrl: photo.dataUrl, photo: chosen });
                    if (!value?.success || !value.photo) throw value || new Error();
                    chosen = value.photo;
                }
                if (!mountedRef.current) return;
                saved = await saveCallbacksRef.current.onSavePhoto(chosen);
            }
            if (mountedRef.current && saved === false) setError(labels.saveFailed);
        } catch (failure) {
            if (mountedRef.current) setError(errorText(failure, labels, 'saveFailed'));
        } finally {
            savingRef.current = false;
            if (mountedRef.current) setSaving(false);
        }
    };
    const applyEdit = async blob => {
        if (blob.size > MAX_IMAGE_BYTES) throw new Error(labels.size);
        const dataUrl = await readImage(blob);
        if (!mountedRef.current) return;
        setPhoto(current => ({ ...current, dataUrl, edited: true }));
    };
    const chosenProfile = tab === 'profile' ? selected?.profile : null;
    const previewPhoto = imageArrival ? imageArrival.previousPhoto : photo;
    const preview = <div className="author-editor-preview" aria-busy={loadingPhoto}>
        {chosenProfile ? <>
            <div className="author-editor-profile-summary">
                <CandidateImage key={selected.id} candidate={selected} labels={labels} />
                <div><h3>{chosenProfile.name}</h3><SourceLink url={chosenProfile.sourceUrl}>{sources[chosenProfile.provider]}</SourceLink></div>
            </div>
            <dl className="author-editor-profile-fields">
                {[[labels.birth, chosenProfile.birthDate], [labels.death, chosenProfile.deathDate], [labels.works, chosenProfile.topWork || chosenProfile.works?.join(', ')]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            {chosenProfile.description && <div className="author-editor-description"><h4>{labels.description}</h4><p>{chosenProfile.description}</p></div>}
            <div className="author-editor-credit"><SourceLink url={chosenProfile.imageSourceUrl}>{labels.imageSource}</SourceLink><span>{[chosenProfile.imageArtist, chosenProfile.imageLicense].filter(Boolean).join(' · ')}</span></div>
        </> : tab !== 'profile' && photo ? <>
            <div ref={photoStageRef} className="author-editor-photo-stage">
                {previewPhoto ? <SmoothCoverImage src={previewPhoto.dataUrl} alt={previewPhoto.title} /> : <FaIcon name="image" size={32} />}
                {arrivalHighlight > 0 && <span key={arrivalHighlight} className="cover-editor-arrival-highlight" aria-hidden="true" />}
            </div>
            <div className="author-editor-photo-caption"><strong>{photo.title}</strong><small>{photo.edited ? labels.edited : photo.photo.source === 'local' ? labels.local : sources[photo.photo.source] || sources[selected?.source]}</small></div>
            <div className="author-editor-credit"><SourceLink url={photo.photo.imageSourceUrl || photo.photo.sourceUrl}>{labels.imageSource}</SourceLink><span>{[photo.photo.imageArtist, photo.photo.imageLicense].filter(Boolean).join(' · ')}</span></div>
            <button ref={editRef} type="button" className="author-editor-edit" disabled={busy} onClick={() => setEditing(true)}><FaIcon name="pen" />{labels.edit}</button>
        </> : <div className="author-editor-empty" role={loadingPhoto ? 'status' : undefined}><FaIcon name={tab === 'profile' ? 'user' : 'image'} size={32} /><p>{loadingPhoto ? labels.loadingPhoto : tab === 'profile' ? labels.selectHint : labels.selectPhotoHint}</p></div>}
    </div>;
    const tabs = ['edit', 'profile', 'photo', 'upload'];
    return <dialog ref={dialogRef} className="author-editor-dialog" tabIndex={-1} role="dialog" aria-labelledby={titleId} aria-modal="true"
        onClick={event => { if (event.target === event.currentTarget) close(); }}
        onDragEnter={event => { event.preventDefault(); event.stopPropagation(); }}
        onDragOver={event => {
            event.preventDefault();
            event.stopPropagation();
            if (!event.target.closest('.author-editor-upload')) event.dataTransfer.dropEffect = 'none';
        }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={event => {
            if (event.target.closest('dialog') !== dialogRef.current) {
                if (event.key === 'Escape') event.stopPropagation();
                return;
            }
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
            if (event.key !== 'Tab' || editing) return;
            const controls = [...dialogRef.current.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]')]
                .filter(element => !element.disabled && element.getClientRects().length && !element.closest('[inert]'));
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className="author-editor-shell">
            <header className="author-editor-header">
                <div><h2 id={titleId}>{labels.title}</h2><span>{author.name}</span></div>
                <button ref={closeButtonRef} type="button" className="author-editor-close" onClick={close} disabled={saving} aria-label={labels.close}><FaIcon name="xmark" /></button>
            </header>
            <div className="author-editor-tabs" role="tablist" aria-label={labels.title}>
                {tabs.map(value => <button key={value} ref={node => { tabRefs.current[value] = node; }} type="button" role="tab"
                    id={`${titleId}-${value}`} aria-controls={`${titleId}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
                    disabled={busy} onClick={() => changeTab(value)} onKeyDown={event => {
                        const index = tabs.indexOf(value);
                        const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
                            : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
                        if (next) { event.preventDefault(); changeTab(next); tabRefs.current[next]?.focus(); }
                    }}><FaIcon name={value === 'edit' ? 'pen' : value === 'profile' ? 'user' : value === 'photo' ? 'search' : 'image'} />{value === 'edit' ? labels.editProfile : labels[value]}</button>)}
            </div>
            <section id={`${titleId}-panel`} role="tabpanel" aria-labelledby={`${titleId}-${tab}`} className="author-editor-panel">
                {(tab === 'profile' || tab === 'photo') && <form className="author-editor-search" onSubmit={event => { event.preventDefault(); void search(); }}>
                    <select aria-label={labels.source} value={source} disabled={busy || searching} onChange={event => { resetSearch(); setPhoto(null); setSource(event.target.value); }}>
                        <option value="all">{labels.all}</option>
                        {Object.entries(sources).filter(([value]) => tab === 'photo' || value !== 'naver').map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                    </select>
                    <input ref={inputRef} value={query} maxLength={200} onChange={event => setQuery(event.target.value)} aria-label={labels.query} placeholder={labels.query} disabled={busy} />
                    <button type="submit" disabled={busy || searching || !query.trim()}><FaIcon name="search" />{searching ? labels.searching : labels.search}</button>
                    {['google', 'namuwiki'].includes(source) && <button type="button" title={labels.webHint} disabled={busy || searching || !query.trim()} onClick={() => void searchInWindow()}><FaIcon name="externalLink" />{labels.webSearch}</button>}
                </form>}
                <p className="author-editor-hint">{tab === 'edit' ? labels.profileEditHint : tab === 'profile' ? source === 'google' ? labels.googleProfileHint : labels.profileHint
                    : tab === 'photo' ? source === 'google' ? labels.googlePhotoHint : labels.photoHint : labels.editHint}</p>
                {error && <p className="author-editor-message is-error" role="alert">{error}</p>}
                {notice && <p className="author-editor-message" role="status">{notice}</p>}
                {tab === 'edit' ? <form className="author-editor-profile-form" aria-label={labels.editProfile}
                    onSubmit={event => { event.preventDefault(); void save(); }}>
                    {[['name', labels.name], ['birthDate', labels.birth], ['deathDate', labels.death], ['topWork', labels.works], ['description', labels.description]].map(([field, label]) => <label
                        key={field} className={`author-editor-profile-field${field === 'birthDate' || field === 'deathDate' ? '' : ' is-wide'}`}>
                        <span>{label}</span>
                        {field === 'description' ? <textarea value={draft[field]} maxLength={1000} rows={5} disabled={busy}
                            onChange={event => updateDraft(field, event.target.value)} />
                            : <input ref={field === 'name' ? nameRef : undefined} value={draft[field]} maxLength={1000} required={field === 'name'} disabled={busy}
                                placeholder={field === 'birthDate' || field === 'deathDate' ? labels.dateHint : undefined}
                                onChange={event => updateDraft(field, event.target.value)} />}
                    </label>)}
                    {draftSource?.sourceUrl && <div className="author-editor-profile-source"><span>{labels.sourceLink}</span><SourceLink url={draftSource.sourceUrl}>{sources[draftSource.provider]}</SourceLink></div>}
                </form> : <div className={`author-editor-body${tab !== 'profile' ? ' is-photo-layout' : ''}${tab === 'upload' ? ' is-upload' : ''}`}>
                    {tab !== 'profile' && preview}
                    {tab === 'upload' ? <div ref={uploadRef} className={`author-editor-upload${dragging ? ' is-dragging' : ''}`}
                        onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }}
                        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; }}
                        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
                        onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); void upload(extractCoverImageTransfer(event.dataTransfer)); }}>
                        <FaIcon name="image" size={36} /><p>{labels.uploadHint}</p>
                        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>{labels.chooseFile}</button>
                        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" aria-label={labels.upload} hidden onChange={event => void upload(extractCoverImageTransfer({ files: event.target.files }, { allowUrls: false }))} />
                        <small>{labels.formats}</small>
                    </div> : <div className={`author-editor-results${tab === 'photo' ? ' is-gallery' : ''}`} aria-label={labels.results} aria-busy={searching}>
                        {searching && !results && <p className="author-editor-empty" role="status">{labels.searching}</p>}
                        {!searching && (!results || !results.length) && <p className="author-editor-empty">{results ? labels.empty : labels.searchHint}</p>}
                        {results?.map(candidate => <button key={`${candidate.source}:${candidate.id}`} type="button"
                            className={`author-editor-result${selected?.id === candidate.id ? ' is-selected' : ''}`} aria-pressed={selected?.id === candidate.id}
                            disabled={busy || searching} onClick={() => {
                                if (tab === 'profile') { setSelected(candidate); setError(''); }
                                else void choosePhoto(candidate);
                            }}>
                            <CandidateImage candidate={candidate} labels={labels} />
                            <span><strong>{candidate.title}</strong><small>{sources[candidate.source]}</small>
                                {tab === 'profile' && candidate.profile && <small>{candidate.profile.topWork || candidate.profile.description}</small>}</span>
                            {selected?.id === candidate.id && <FaIcon name="check" size={12} />}
                        </button>)}
                        {nextStart && <button type="button" className="author-editor-more" disabled={busy || searching} onClick={() => void search(nextStart)}>{searching ? labels.searching : labels.more}</button>}
                    </div>}
                    {tab === 'profile' && preview}
                </div>}
            </section>
            <footer className="author-editor-footer">
                <div>{(tab === 'photo' || tab === 'upload') && profile?.photoUrl && <button type="button" disabled={busy || searching} onClick={() => void choosePhoto({ id: 'current', source: 'current', title: author.name, profile }, true)}><FaIcon name="pen" />{labels.current}</button>}</div>
                <div><button type="button" onClick={close} disabled={saving}>{labels.close}</button>
                    {tab === 'profile' && <button type="button" onClick={editSelectedProfile} disabled={busy || searching || !chosenProfile}><FaIcon name="pen" />{labels.editSelectedProfile}</button>}
                    <button type="button" className="primary" onClick={() => void save()} disabled={busy || searching || (tab === 'edit' ? !hasDraftName : tab === 'profile' ? !chosenProfile : !photo)}><FaIcon name="check" />{saving ? labels.saving : tab === 'edit' ? labels.saveProfile : tab === 'profile' ? labels.selectProfile : labels.selectPhoto}</button></div>
            </footer>
            {editing && photo && <Suspense fallback={<p role="status" className="author-editor-message">{labels.loadingPhoto}</p>}>
                <CoverImageEditorDialog image={photo} onApply={applyEdit} onClose={() => { setEditing(false); editRef.current?.focus(); }}
                    t={key => key === 'cover_editor_edit_hint' ? labels.editHint : t?.(key) || key} formatError={failure => failure?.message || labels.imageFailed} />
            </Suspense>}
        </div>
    </dialog>;
}
