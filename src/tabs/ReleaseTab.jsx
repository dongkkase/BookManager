import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import { parseReleaseMarkdown } from '../releasePolicy';
import { releaseNotificationKey } from '../releaseNotificationPolicy';
import { isMotionReduced, subscribeMotionPreference } from '../motionPolicy';
import '../styles/ReleaseTab.css';

function InlineContent({ tokens, onOpenExternal }) {
    return tokens.map((token, index) => {
        if (token.type === 'link') {
            return (
                <button
                    key={`${token.url}-${index}`}
                    type="button"
                    className="release-inline-link"
                    onClick={() => onOpenExternal(token.url)}
                >
                    {token.label}
                </button>
            );
        }
        if (token.type === 'strong') {
            return <strong key={index}>{token.value}</strong>;
        }
        if (token.type === 'code') {
            return <code key={index}>{token.value}</code>;
        }
        return <React.Fragment key={index}>{token.value}</React.Fragment>;
    });
}

function MarkdownList({ items, onOpenExternal }) {
    const List = items.every(item => item.ordered) ? 'ol' : 'ul';
    return (
        <List>
            {items.map((item, index) => (
                <li key={index}>
                    <InlineContent tokens={item.content} onOpenExternal={onOpenExternal} />
                    {item.children.length > 0 && (
                        <MarkdownList items={item.children} onOpenExternal={onOpenExternal} />
                    )}
                </li>
            ))}
        </List>
    );
}

function ReleaseImage({ image, onOpenExternal }) {
    const [imageSrc, setImageSrc] = useState('');
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setImageSrc('');
        setFailed(false);
        const fetchImageDataUrl = window.electronAPI?.fetchImageDataUrl;
        if (typeof fetchImageDataUrl !== 'function') {
            setFailed(true);
            return () => {
                cancelled = true;
            };
        }
        fetchImageDataUrl(image.src)
            .then(dataUrl => {
                if (cancelled) return;
                if (dataUrl) setImageSrc(dataUrl);
                else setFailed(true);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [image.src]);

    if (!imageSrc && !failed) {
        return <div className="release-image-loading" aria-hidden="true" />;
    }
    if (failed) {
        return (
            <button
                type="button"
                className="release-image-fallback"
                onClick={() => onOpenExternal(image.src)}
            >
                {image.alt || 'Image'}
            </button>
        );
    }
    return (
        <button
            type="button"
            className="release-image-button"
            aria-label={image.alt || 'Image'}
            onClick={() => onOpenExternal(image.src)}
        >
            <img
                className="release-card-image"
                src={imageSrc}
                alt={image.alt}
                width={image.width}
                height={image.height}
                loading="lazy"
                decoding="async"
                onError={() => setFailed(true)}
            />
        </button>
    );
}

function MarkdownBody({ markdown, onOpenExternal }) {
    const blocks = useMemo(() => parseReleaseMarkdown(markdown), [markdown]);

    return blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === 'heading') {
            const Heading = block.level === 1 ? 'h2' : 'h3';
            return <Heading key={key}><InlineContent tokens={block.content} onOpenExternal={onOpenExternal} /></Heading>;
        }
        if (block.type === 'list') {
            return (
                <MarkdownList
                    key={key}
                    items={block.items}
                    onOpenExternal={onOpenExternal}
                />
            );
        }
        if (block.type === 'code') {
            return <pre key={key}><code>{block.value}</code></pre>;
        }
        if (block.type === 'image') {
            return (
                <ReleaseImage
                    key={key}
                    image={block}
                    onOpenExternal={onOpenExternal}
                />
            );
        }
        return (
            <p key={key}>
                <InlineContent tokens={block.content} onOpenExternal={onOpenExternal} />
            </p>
        );
    });
}

function getReleaseScrollInset(navigation) {
    const horizontal = navigation && getComputedStyle(navigation).getPropertyValue('--release-nav-horizontal').trim() === '1';
    return horizontal ? navigation.offsetHeight + 30 : 15;
}

function revealVersionInList(list, active) {
    if (!list || !active) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < listRect.top) list.scrollTop += activeRect.top - listRect.top;
    else if (activeRect.bottom > listRect.bottom) list.scrollTop += activeRect.bottom - listRect.bottom;
    if (activeRect.left < listRect.left) list.scrollLeft += activeRect.left - listRect.left;
    else if (activeRect.right > listRect.right) list.scrollLeft += activeRect.right - listRect.right;
}

function ReleaseTab({ t, isActive, releases, loading, loadError, unread, onViewed }) {
    const [error, setError] = useState('');
    const [highlighted, setHighlighted] = useState(() => new Set());
    const [activeReleaseId, setActiveReleaseId] = useState(null);
    const scrollAreaRef = useRef(null);
    const contentRef = useRef(null);
    const navigationRef = useRef(null);
    const versionListRef = useRef(null);
    const articleRefs = useRef(new Map());
    const versionRefs = useRef(new Map());
    const navigationTargetRef = useRef(null);

    useEffect(() => {
        const scrollArea = scrollAreaRef.current;
        if (!isActive || loading || !scrollArea || releases.length === 0) return undefined;
        let frame = 0;
        let settleTimer = 0;
        const updateActiveRelease = () => {
            frame = 0;
            if (!scrollArea.clientHeight) return;
            scrollArea.style.setProperty('--release-viewport-height', `${scrollArea.clientHeight}px`);
            const threshold = scrollArea.getBoundingClientRect().top + getReleaseScrollInset(navigationRef.current) + 2;
            let currentId = releases[0].id;
            for (const item of releases) {
                const article = articleRefs.current.get(item.id);
                if (!article || article.getBoundingClientRect().top > threshold) break;
                currentId = item.id;
            }
            if (scrollArea.scrollTop > 0 && scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - 2) {
                currentId = releases[releases.length - 1].id;
            }
            setActiveReleaseId(navigationTargetRef.current ?? currentId);
            if (navigationTargetRef.current === null) {
                revealVersionInList(versionListRef.current, versionRefs.current.get(currentId));
            }
        };
        const scheduleUpdate = () => {
            if (!frame) frame = requestAnimationFrame(updateActiveRelease);
        };
        const finishNavigation = event => {
            if (event && event.target !== scrollArea) return;
            window.clearTimeout(settleTimer);
            navigationTargetRef.current = null;
            scheduleUpdate();
        };
        const interruptNavigation = () => {
            if (navigationTargetRef.current === null) return;
            scrollArea.scrollTo({ top: scrollArea.scrollTop, behavior: 'instant' });
            finishNavigation();
        };
        const onScroll = () => {
            if (navigationTargetRef.current !== null) {
                window.clearTimeout(settleTimer);
                settleTimer = window.setTimeout(finishNavigation, 180);
            }
            scheduleUpdate();
        };
        const observer = new ResizeObserver(scheduleUpdate);
        observer.observe(scrollArea);
        if (contentRef.current) observer.observe(contentRef.current);
        if (navigationRef.current) observer.observe(navigationRef.current);
        scrollArea.addEventListener('scroll', onScroll, { passive: true });
        scrollArea.addEventListener('scrollend', finishNavigation);
        scrollArea.addEventListener('wheel', interruptNavigation, { passive: true });
        scrollArea.addEventListener('touchstart', interruptNavigation, { passive: true });
        const unsubscribeMotion = subscribeMotionPreference(() => {
            if (!isMotionReduced() || navigationTargetRef.current === null) return;
            const article = articleRefs.current.get(navigationTargetRef.current);
            if (article) {
                const top = scrollArea.scrollTop + article.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top - getReleaseScrollInset(navigationRef.current);
                scrollArea.scrollTo({ top, behavior: 'instant' });
            }
            finishNavigation();
        });
        scheduleUpdate();
        return () => {
            unsubscribeMotion();
            cancelAnimationFrame(frame);
            window.clearTimeout(settleTimer);
            navigationTargetRef.current = null;
            observer.disconnect();
            scrollArea.removeEventListener('scroll', onScroll);
            scrollArea.removeEventListener('scrollend', finishNavigation);
            scrollArea.removeEventListener('wheel', interruptNavigation);
            scrollArea.removeEventListener('touchstart', interruptNavigation);
        };
    }, [isActive, loading, releases]);

    const scrollToRelease = id => {
        const scrollArea = scrollAreaRef.current;
        const article = articleRefs.current.get(id);
        if (!scrollArea || !article) return;
        const top = scrollArea.scrollTop + article.getBoundingClientRect().top - scrollArea.getBoundingClientRect().top - getReleaseScrollInset(navigationRef.current);
        const targetTop = Math.max(0, Math.min(top, scrollArea.scrollHeight - scrollArea.clientHeight));
        if (Math.abs(targetTop - scrollArea.scrollTop) <= 1) return;
        const reducedMotion = isMotionReduced();
        navigationTargetRef.current = reducedMotion ? null : id;
        setActiveReleaseId(id);
        scrollArea.scrollTo({ top: targetTop, behavior: reducedMotion ? 'instant' : 'smooth' });
    };

    useEffect(() => {
        if (!isActive) {
            setHighlighted(current => current.size ? new Set() : current);
            return undefined;
        }
        if (loading || loadError || releases.length === 0) return undefined;
        const markVisible = () => {
            if (document.visibilityState === 'hidden') return;
            if (unread.length > 0) {
                setHighlighted(current => new Set([...current, ...unread.map(releaseNotificationKey)]));
            }
            onViewed(releases);
        };
        markVisible();
        document.addEventListener('visibilitychange', markVisible);
        return () => document.removeEventListener('visibilitychange', markVisible);
    }, [isActive, loading, loadError, releases, unread, onViewed]);

    const openExternal = url => {
        window.electronAPI?.openExternal?.(url).catch(openError => {
            setError(openError.message || 'OPEN_EXTERNAL_FAILED');
        });
    };

    return (
        <div className="release-tab">
            <div className="release-scroll-area" ref={scrollAreaRef}>
                <div className={`release-page-layout${!loading && releases.length > 0 ? ' has-version-nav' : ''}`}>
                    <div className="release-content-container" ref={contentRef}>
                        {loading ? (
                            <div className="release-loading">{t('msg_loading_list')}</div>
                        ) : releases.length === 0 ? (
                            <div className="release-error">{t('msg_release_load_fail')}</div>
                        ) : (
                            <>
                                {(error || loadError) && (
                                    <div className="release-error compact">
                                        {t('msg_release_load_fail')}
                                    </div>
                                )}
                                {releases.map(item => (
                                    <article
                                        key={item.id}
                                        id={`release-note-${encodeURIComponent(item.id)}`}
                                        ref={element => {
                                            if (element) articleRefs.current.set(item.id, element);
                                            else articleRefs.current.delete(item.id);
                                        }}
                                        className={`release-card${highlighted.has(releaseNotificationKey(item)) ? ' is-new' : ''}`}
                                    >
                                        <div className="release-card-title">
                                            <FaIcon name="archive" size={18} />
                                            <span>{item.name}</span>
                                            {highlighted.has(releaseNotificationKey(item)) && <span className="release-new-badge">NEW</span>}
                                            {item.date && <span className="release-card-date">({item.date})</span>}
                                        </div>
                                        <div className="release-card-body">
                                            <MarkdownBody markdown={item.body} onOpenExternal={openExternal} />
                                        </div>
                                        {item.url && (
                                            <button
                                                type="button"
                                                className="release-card-link"
                                                onClick={() => openExternal(item.url)}
                                            >
                                                GitHub
                                            </button>
                                        )}
                                    </article>
                                ))}
                            </>
                        )}
                    </div>
                    {!loading && releases.length > 0 && (
                        <nav className="release-version-nav" aria-label={t('release_versions')} ref={navigationRef}>
                            <h2 className="release-version-heading">{t('release_versions')}</h2>
                            <div className="release-version-list" ref={versionListRef}>
                                {releases.map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="release-version-link"
                                        aria-controls={`release-note-${encodeURIComponent(item.id)}`}
                                        aria-current={(activeReleaseId ?? releases[0].id) === item.id ? 'location' : undefined}
                                        title={[item.name, item.date].filter(Boolean).join('\n')}
                                        ref={element => {
                                            if (element) versionRefs.current.set(item.id, element);
                                            else versionRefs.current.delete(item.id);
                                        }}
                                        onClick={() => scrollToRelease(item.id)}
                                    >
                                        <span className="release-version-name">{item.tag || item.name}</span>
                                        {highlighted.has(releaseNotificationKey(item)) && <span className="release-version-new-dot" aria-label="NEW" />}
                                    </button>
                                ))}
                            </div>
                        </nav>
                    )}
                </div>
            </div>
        </div>
    );
}

export { ReleaseTab };
export default ReleaseTab;
