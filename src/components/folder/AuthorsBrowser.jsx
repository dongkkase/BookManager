import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import { CoverImage } from './CoverImage';
import { FolderCharacterIndex } from './FolderCharacterIndex';
import { AuthorPhotoFinder } from './AuthorPhotoFinder';
import { ToolbarSelect } from './ToolbarDropdown';
import { authorHue, authorInitials, buildAuthorIndex, getAuthorCatalog, normalizeAuthorProfile } from '../../authorCatalog.js';
import { AUTHOR_PROFILES_KEY, AUTOMATIC_AUTHOR_PROFILES_KEY, createAuthorProfileStore } from '../../authorProfileStore.js';
import '../../styles/AuthorsBrowser.css';

const LABELS = {
    ko: {
        empty: '표시할 저자가 없습니다.', emptyHint: '라이브러리를 스캔하고 도서 정보에 저자를 등록하면 이곳에 표시됩니다.',
        noResults: '검색 조건에 맞는 저자가 없습니다.', search: '저자 이름 또는 도서 제목으로 검색', bookSearch: '소장 도서 검색',
        owned: '소장 도서', lastAdded: '최근 추가', name: '제목순', recent: '최근 추가순',
        grid: '표지 보기', list: '목록 보기', more: '더 보기', find: '프로필 찾기', change: '프로필 변경', clear: '이니셜로 표시', automatic: '자동으로 찾기',
        source: '프로필 출처', imageSource: '사진 출처', photoSearch: '네이버 사진 검색', findTitle: '프로필 찾기', findHint: 'Wikidata, Wikipedia, Open Library에서 검색합니다. 이름과 대표작을 확인한 뒤 선택하세요. 사진이 없는 저자도 있습니다.',
        searchAction: '검색', searching: '검색 중…', close: '닫기', noProfiles: '일치하는 후보가 없습니다. 다른 이름으로 검색해 보세요.',
        failed: '프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', saveFailed: '프로필 선택을 저장하지 못했습니다.',
        select: '이 프로필 선택', local: '저자 프로필', allLetters: '전체', index: '저자 초성·알파벳 탐색',
    },
    en: {
        empty: 'No authors yet.', emptyHint: 'Scan your libraries and add authors to book information to see them here.',
        noResults: 'No authors match your search.', search: 'Search author names or book titles', bookSearch: 'Search your books',
        owned: 'In your library', lastAdded: 'Last added', name: 'Title', recent: 'Recently added', grid: 'Cover view', list: 'List view', more: 'Show more',
        find: 'Find profile', change: 'Change profile', clear: 'Show initials', automatic: 'Find automatically', source: 'Profile source', imageSource: 'Image source', photoSearch: 'Naver photo search', findTitle: 'Find a profile',
        findHint: 'Search Wikidata, Wikipedia, and Open Library. Check the name and top work before selecting an author. Some authors have no photo.', searchAction: 'Search', searching: 'Searching…',
        close: 'Close', noProfiles: 'No candidates found. Try another name.', failed: 'Unable to load profiles. Please try again later.',
        saveFailed: 'Unable to save the selected profile.', select: 'Select this profile', local: 'Author profile', allLetters: 'All', index: 'Author character index',
    },
    ja: {
        empty: '著者がまだありません。', emptyHint: 'ライブラリをスキャンし、書籍情報に著者を登録するとここに表示されます。',
        noResults: '検索条件に一致する著者がありません。', search: '著者名または書籍名で検索', bookSearch: '所蔵書籍を検索',
        owned: '所蔵書籍', lastAdded: '最近追加', name: 'タイトル順', recent: '追加順', grid: '表紙表示', list: 'リスト表示', more: 'もっと見る',
        find: 'プロフィールを探す', change: 'プロフィール変更', clear: 'イニシャルを表示', automatic: '自動で探す', source: 'プロフィール出典', imageSource: '画像の出典', photoSearch: 'Naver写真検索', findTitle: 'プロフィールを探す',
        findHint: 'Wikidata、Wikipedia、Open Libraryから検索します。名前と代表作を確認して選択してください。写真がない著者もいます。', searchAction: '検索', searching: '検索中…',
        close: '閉じる', noProfiles: '候補が見つかりません。別の名前で検索してください。', failed: 'プロフィールを取得できませんでした。後で再試行してください。',
        saveFailed: 'プロフィールを保存できませんでした。', select: 'このプロフィールを選択', local: '著者プロフィール', allLetters: 'すべて', index: '著者の文字索引',
    },
};

function profileSourceName(profile) {
    return { wikidata: 'Wikidata', wikipedia: 'Wikipedia', naver: 'Naver' }[profile?.provider] || 'Open Library';
}

function ProfileImageCredit({ profile, labels }) {
    if (!profile?.imageSourceUrl) return null;
    return <small className="author-image-credit">
        <a href={profile.imageSourceUrl} onClick={event => {
            event.preventDefault();
            void window.electronAPI?.openExternal?.(profile.imageSourceUrl);
        }}>{labels.imageSource}</a>
        {[profile.imageArtist, profile.imageLicense].filter(Boolean).map((text, index) => <span key={index}>{text}</span>)}
    </small>;
}

export function AuthorAvatar({ name, profile, className = '' }) {
    const [imageState, setImageState] = useState(null);
    useEffect(() => {
        setImageState(current => current?.status === 'failed' || current?.src !== profile?.photoUrl ? null : current);
    }, [profile]);
    const loaded = imageState?.src === profile?.photoUrl && imageState?.status === 'loaded';
    const failed = imageState?.src === profile?.photoUrl && imageState?.status === 'failed';
    return <span className={`author-avatar ${className}`} style={{ '--author-hue': authorHue(name) }}>
        <span aria-hidden="true">{authorInitials(name)}</span>
        {profile?.photoUrl && !failed && <img key={profile.photoUrl} src={profile.photoUrl} alt="" loading="lazy" referrerPolicy="no-referrer"
            style={{ opacity: loaded ? 1 : 0 }} onLoad={event => setImageState({ src: profile.photoUrl, status: event.currentTarget.naturalWidth > 0 ? 'loaded' : 'failed' })}
            onError={() => setImageState({ src: profile.photoUrl, status: 'failed' })} />}
    </span>;
}

function ProfileFinder({ author, labels, onSelect, onClose }) {
    const [query, setQuery] = useState(author.name);
    const [profiles, setProfiles] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const requestRef = useRef(0);
    const inputRef = useRef(null);
    useEffect(() => {
        inputRef.current?.focus();
        return () => { requestRef.current += 1; };
    }, []);
    const search = async event => {
        event.preventDefault();
        const request = ++requestRef.current;
        setBusy(true);
        setError('');
        setProfiles(null);
        try {
            const result = await window.electronAPI?.searchAuthorProfiles?.(query.trim(), { allSources: true });
            if (request !== requestRef.current) return;
            if (!result?.success) throw new Error('unavailable');
            setProfiles(result.profiles.map(normalizeAuthorProfile).filter(Boolean));
        } catch {
            if (request === requestRef.current) setError(labels.failed);
        } finally {
            if (request === requestRef.current) setBusy(false);
        }
    };
    return <section className="author-profile-finder" aria-label={labels.findTitle}>
        <div className="author-section-heading"><h3>{labels.findTitle}</h3><button type="button" onClick={onClose} aria-label={labels.close}><FaIcon name="xmark" /></button></div>
        <p>{labels.findHint}</p>
        <form onSubmit={search}>
            <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} maxLength={200} aria-label={labels.searchAction} />
            <button type="submit" disabled={busy || !query.trim()}>{busy ? labels.searching : labels.searchAction}</button>
        </form>
        {error && <p role="alert">{error}</p>}
        {profiles?.length === 0 && <p role="status">{labels.noProfiles}</p>}
        <div className="author-profile-candidates" aria-busy={busy}>
            {profiles?.map(profile => <div key={profile.id} className="author-profile-result">
                <button type="button" className="author-profile-candidate" onClick={() => onSelect(profile)} title={labels.select}>
                    <AuthorAvatar name={profile.name} profile={profile} />
                    <span><strong>{profile.name}</strong><small>{[profileSourceName(profile), [profile.birthDate, profile.deathDate].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}</small><small>{profile.topWork || profile.description}</small></span>
                    <FaIcon name="plus" />
                </button>
                <ProfileImageCredit profile={profile} labels={labels} />
            </div>)}
        </div>
    </section>;
}

function AuthorDetail({ author, profile, hasOverride, onAutomaticProfile, onSaveProfile, labels, language, thumbnailScale, onOpenFile, onSelectBook, selectedBookPath, t }) {
    const [finding, setFinding] = useState('');
    const [error, setError] = useState('');
    const [sort, setSort] = useState('name');
    const [layout, setLayout] = useState('grid');
    const [limit, setLimit] = useState(100);
    const [query, setQuery] = useState('');
    const headingRef = useRef(null);
    const findRef = useRef(null);
    const photoFindRef = useRef(null);
    const imageWidth = Math.round(72 + Number(thumbnailScale || 50) * 1.08);
    const imageHeight = Math.round(imageWidth * 1.42);
    const gap = Math.max(14, Math.min(24, Math.round(imageWidth * 0.12)));
    const profileDates = [profile?.birthDate, profile?.deathDate].filter(Boolean).join(' – ');
    const closeFinder = () => {
        setFinding('');
        (finding === 'photo' ? photoFindRef : findRef).current?.focus();
    };
    useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);
    useLayoutEffect(() => () => onSelectBook?.(null), [onSelectBook]);
    const books = useMemo(() => author.books.filter(file => `${file.title} ${file.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice().sort((a, b) =>
        sort === 'recent' ? (Date.parse(b.readingListAddedAt) || 0) - (Date.parse(a.readingListAddedAt) || 0)
            : (a.title || a.name).localeCompare(b.title || b.name, language, { numeric: true })), [author, language, query, sort]);
    useLayoutEffect(() => {
        if (selectedBookPath && !books.some(file => (file.full_path || file.path) === selectedBookPath)) onSelectBook?.(null);
    }, [books, onSelectBook, selectedBookPath]);
    const saveProfile = value => {
        if (!onSaveProfile(author.key, value)) { setError(labels.saveFailed); return; }
        setError('');
        closeFinder();
    };
    const savePhoto = photo => {
        const next = normalizeAuthorProfile({
            ...(profile && profile.provider !== 'naver' ? profile : { provider: 'naver', id: photo?.id, name: author.name }), photoOverride: photo,
        });
        if (!next?.photoOverride || next.photoOverride.id !== photo?.id) { setError(labels.saveFailed); return; }
        saveProfile(next);
    };
    return <div className="author-detail" onKeyDown={event => {
        if (event.key === 'Escape' && finding && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            closeFinder();
        }
    }}>
        <section className="author-profile" aria-labelledby="author-profile-heading">
            <AuthorAvatar name={author.name} profile={profile} className="author-profile-portrait" />
            <div className="author-profile-info">
                <span className="author-eyebrow">{labels.local}</span><h2 id="author-profile-heading" ref={headingRef} tabIndex={-1}>{author.name}</h2>
                {profile && <div className="author-profile-meta">
                    {profile.name !== author.name && <span>{profile.name}</span>}
                    {profileDates && <span>{profileDates}</span>}
                    <a href={profile.sourceUrl} onClick={event => { event.preventDefault(); void window.electronAPI?.openExternal?.(profile.sourceUrl); }} title={labels.source}>
                        {profileSourceName(profile)} <FaIcon name="externalLink" size={10} />
                    </a>
                </div>}
                {profile?.description && <p className="author-profile-description">{profile.description}</p>}
                <ProfileImageCredit profile={profile} labels={labels} />
            </div>
            <dl className="author-profile-stats">
                <div><dt>{labels.owned}</dt><dd>{author.books.length.toLocaleString(language)}</dd></div>
                {author.lastAdded > 0 && <div><dt>{labels.lastAdded}</dt><dd className="author-profile-date">{new Date(author.lastAdded).toLocaleDateString(language)}</dd></div>}
            </dl>
            <div className="author-profile-actions">
                <div className="author-profile-edit-actions">
                    <button ref={findRef} type="button" className="author-profile-edit" onClick={() => setFinding(current => current === 'profile' ? '' : 'profile')}
                        aria-expanded={finding === 'profile'} aria-controls={finding === 'profile' ? 'author-profile-search' : undefined}>
                        <FaIcon name="user" />{profile ? labels.change : labels.find}
                    </button>
                    <button ref={photoFindRef} type="button" onClick={() => setFinding(current => current === 'photo' ? '' : 'photo')}
                        aria-expanded={finding === 'photo'} aria-controls={finding === 'photo' ? 'author-profile-search' : undefined}>
                        <FaIcon name="image" />{labels.photoSearch}
                    </button>
                </div>
                {(profile || hasOverride) && <div className="author-profile-reset-actions">
                    {profile && <button type="button" onClick={() => saveProfile(null)}>{labels.clear}</button>}
                    {hasOverride && <button type="button" onClick={() => {
                        setFinding('');
                        setError(onAutomaticProfile(author.key) ? '' : labels.saveFailed);
                        findRef.current?.focus();
                    }}><FaIcon name="rotateLeft" />{labels.automatic}</button>}
                </div>}
            </div>
        </section>
        {error && <p role="alert">{error}</p>}
        {finding && <div id="author-profile-search">
            {finding === 'profile' ? <ProfileFinder author={author} labels={labels} onSelect={saveProfile} onClose={closeFinder} />
                : <AuthorPhotoFinder author={author} language={language} onSelect={savePhoto} onClose={closeFinder} />}
        </div>}
        <section className="author-books">
            <div className="author-section-heading"><h3>{labels.owned}<span>{books.length}</span></h3>
                <div className="author-book-controls">
                    <label className="author-book-search"><FaIcon name="search" size={12} aria-hidden="true" />
                        <input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(100); }} placeholder={labels.bookSearch} aria-label={labels.bookSearch} />
                    </label>
                    <ToolbarSelect label={t('reading_lists.sort')} value={sort} onChange={setSort} options={[
                        { value: 'name', label: labels.name },
                        { value: 'recent', label: labels.recent },
                    ]} />
                    <div className="author-layout-switch">{['grid', 'list'].map(value => <button key={value} type="button" aria-label={labels[value]} title={labels[value]} aria-pressed={layout === value} onClick={() => setLayout(value)}><FaIcon name={value === 'grid' ? 'tableCells' : 'list'} /></button>)}</div>
                </div>
            </div>
            <div className={`author-book-shelf is-${layout}${layout === 'grid' ? ' thumbnail-grid' : ''}`} style={layout === 'grid' ? {
                '--thumb-item-width': `${imageWidth}px`,
                '--thumb-image-width': `${imageWidth}px`,
                '--thumb-image-height': `${imageHeight}px`,
                '--thumb-gap-x': `${gap}px`,
                '--thumb-gap-y': `${gap}px`,
            } : undefined}>
                {books.slice(0, limit).map(file => <button type="button" key={file.path}
                    className={`author-book${layout === 'grid' ? ' thumbnail-item' : ''}${selectedBookPath === (file.full_path || file.path) ? ' is-selected selected' : ''}`}
                    data-author-book-path={file.full_path || file.path}
                    aria-pressed={selectedBookPath === (file.full_path || file.path)}
                    onClick={() => onSelectBook?.(file)} onDoubleClick={() => onOpenFile(file)}>
                    {layout === 'grid' ? <div className="thumbnail-cover-card">
                        <CoverImage src={file.cover} file={file} className="thumb-image" t={t} showLoadingIndicator={false} />
                        <span className="thumb-label">{file.title || file.name}</span>
                    </div> : <>
                        <CoverImage src={file.cover} file={file} className="author-book-cover" t={t} showLoadingIndicator={false} />
                        <span className="author-book-description"><strong>{file.title || file.name}</strong>
                            {file.series && file.series !== (file.title || file.name) && <small>{file.series}</small>}
                        </span>
                        <span className="author-book-detail-icon" aria-hidden="true"><FaIcon name="angleRight" size={12} /></span>
                    </>}
                </button>)}
            </div>
            {!books.length && <p className="author-empty">{t('reading_lists.empty')}</p>}
            {books.length > limit && <button type="button" className="author-load-more" onClick={() => setLimit(current => current + 100)}>{labels.more} ({books.length - limit})</button>}
        </section>
    </div>;
}

export function AuthorsBrowser({ files, query = '', language = 'ko', thumbnailScale = 50, onOpenFile, onSelectBook, selectedBookPath = '', onBackActionChange, t }) {
    const labels = LABELS[language] || LABELS.ko;
    const authors = useMemo(() => getAuthorCatalog(files, language), [files, language]);
    const [selected, setSelected] = useState('');
    const [profileStore, setProfileStore] = useState(null);
    const [, updateProfiles] = useState(0);
    const [navigation, setNavigation] = useState('');
    const [limit, setLimit] = useState(180);
    const rootRef = useRef(null);
    const loadMoreRef = useRef(null);
    const listScrollRef = useRef(0);
    const restoreAuthorRef = useRef('');
    const selectedAuthor = authors.find(author => author.key === selected);
    useLayoutEffect(() => {
        restoreAuthorRef.current = '';
        setSelected('');
        setNavigation('');
        setLimit(180);
        if (rootRef.current) rootRef.current.scrollTop = 0;
    }, [query]);
    useLayoutEffect(() => {
        if (selectedAuthor || !restoreAuthorRef.current || !rootRef.current) return;
        rootRef.current.scrollTop = listScrollRef.current;
        [...rootRef.current.querySelectorAll('[data-author-key]')].find(node => node.dataset.authorKey === restoreAuthorRef.current)?.focus({ preventScroll: true });
        restoreAuthorRef.current = '';
    }, [selectedAuthor]);
    useEffect(() => {
        let active = true;
        let storage;
        try { storage = window.localStorage; } catch { storage = null; }
        const store = createAuthorProfileStore({
            storage,
            search: name => window.electronAPI?.searchAuthorProfiles?.(name),
            onChange: () => { if (active) updateProfiles(value => value + 1); },
        });
        setProfileStore(store);
        const reload = event => {
            if (!event.key || [AUTHOR_PROFILES_KEY, AUTOMATIC_AUTHOR_PROFILES_KEY].includes(event.key)) store.reload();
        };
        window.addEventListener('storage', reload);
        window.addEventListener('focus', reload);
        return () => {
            active = false;
            store.dispose();
            window.removeEventListener('storage', reload);
            window.removeEventListener('focus', reload);
        };
    }, []);
    const filtered = useMemo(() => {
        const value = query.trim().toLocaleLowerCase();
        if (!value) return authors;
        return authors.filter(author => author.name.toLocaleLowerCase().includes(value) || author.books.some(file => `${file.title} ${file.name}`.toLocaleLowerCase().includes(value)));
    }, [authors, query]);
    const index = useMemo(() => buildAuthorIndex(filtered, language), [filtered, language]);
    const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
    useLayoutEffect(() => {
        if (!navigation || !rootRef.current) return;
        const group = [...rootRef.current.querySelectorAll('[data-author-group]')].find(node => node.dataset.authorGroup === navigation);
        if (group) rootRef.current.scrollTop += group.getBoundingClientRect().top - rootRef.current.getBoundingClientRect().top - 16;
        setNavigation('');
    }, [navigation]);
    useEffect(() => {
        if (!profileStore) return;
        if (selectedAuthor || typeof IntersectionObserver !== 'function') {
            profileStore.setAuthors(selectedAuthor ? [selectedAuthor] : visible);
            return () => profileStore.setAuthors([]);
        }
        const inView = new Set();
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const key = entry.target.dataset.authorKey;
                if (entry.isIntersecting) inView.add(key);
                else inView.delete(key);
            }
            profileStore.setAuthors(visible.filter(author => inView.has(author.key)));
        }, { root: rootRef.current, rootMargin: '160px 0px' });
        rootRef.current?.querySelectorAll('[data-author-key]').forEach(node => observer.observe(node));
        return () => { observer.disconnect(); profileStore.setAuthors([]); };
    }, [profileStore, selectedAuthor, visible]);
    const groups = useMemo(() => {
        const byInitial = new Map();
        for (const author of visible) {
            if (!byInitial.has(author.initial)) byInitial.set(author.initial, []);
            byInitial.get(author.initial).push(author);
        }
        return index.filter(entry => byInitial.has(entry.label)).map(entry => ({ ...entry, authors: byInitial.get(entry.label) }));
    }, [index, visible]);
    const total = filtered.length;
    useEffect(() => {
        const sentinel = loadMoreRef.current;
        if (selectedAuthor || !sentinel || total <= limit) return;
        let active = true;
        const observer = new IntersectionObserver(entries => {
            if (!active || !entries.some(entry => entry.isIntersecting)) return;
            active = false;
            observer.disconnect();
            setLimit(current => Math.min(total, current + 180));
        }, { root: rootRef.current, rootMargin: '0px 0px 400px 0px' });
        observer.observe(sentinel);
        return () => { active = false; observer.disconnect(); };
    }, [filtered, limit, selectedAuthor, total]);
    const navigate = entry => {
        const position = filtered.findIndex(author => author.key === entry.path);
        if (position < 0) return;
        setLimit(current => Math.max(current, Math.min(total, position + 180)));
        setNavigation(entry.key);
    };
    const saveProfile = (key, profile) => profileStore?.setManual(key, profile) || false;
    const back = useCallback(() => {
        restoreAuthorRef.current = selected;
        setSelected('');
    }, [selected]);
    useLayoutEffect(() => {
        onBackActionChange?.(selectedAuthor ? back : null);
        return () => onBackActionChange?.(null);
    }, [back, onBackActionChange, selectedAuthor]);
    return <div className="authors-browser-shell">
        <div className={`authors-browser${!selectedAuthor && index.length ? ' has-character-index' : ''}`} ref={rootRef}>
            {selectedAuthor ? <AuthorDetail key={selectedAuthor.key} author={selectedAuthor} profile={profileStore?.getProfile(selectedAuthor.key)}
                hasOverride={profileStore?.hasOverride(selectedAuthor.key)} onAutomaticProfile={key => profileStore?.useAutomatic(key) || false}
                onSaveProfile={saveProfile} labels={labels} language={language} thumbnailScale={thumbnailScale} onOpenFile={onOpenFile}
                onSelectBook={onSelectBook} selectedBookPath={selectedBookPath} t={t} /> : <>
                <div className="author-groups">{groups.map(group => <section className="author-group" key={group.key} data-author-group={group.key} aria-label={group.label}>
                    <div className="author-group-heading"><h3>{group.label}</h3><span /><small>{group.count}</small></div>
                    <div className="author-grid">{group.authors.map(author => <button type="button" className="author-card" key={author.key} data-author-key={author.key} onClick={() => {
                        listScrollRef.current = rootRef.current.scrollTop;
                        setSelected(author.key);
                        rootRef.current.scrollTop = 0;
                    }}>
                        <span className="author-card-image"><AuthorAvatar name={author.name} profile={profileStore?.getProfile(author.key)} /><span className="author-book-count">{author.books.length}</span></span>
                        <strong>{author.name}</strong>
                    </button>)}</div>
                </section>)}</div>
                {visible.length === 0 && <div className="author-empty"><FaIcon name="users" size={32} /><h3>{authors.length ? labels.noResults : labels.empty}</h3><p>{authors.length ? labels.search : labels.emptyHint}</p></div>}
                {total > limit && <div ref={loadMoreRef} className="author-scroll-sentinel" aria-hidden="true" />}
            </>}
        </div>
        {!selectedAuthor && <FolderCharacterIndex entries={index} onNavigate={navigate} scrollContainerRef={rootRef} t={t} />}
    </div>;
}
