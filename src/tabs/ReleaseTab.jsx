import React, { useEffect, useMemo, useState } from 'react';
import { FaIcon } from '../components/FaIcon';
import { normalizeReleaseList, parseReleaseMarkdown } from '../releasePolicy';
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

function ReleaseTab({ t }) {
    const [releases, setReleases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let isMounted = true;

        window.electronAPI?.getReleases?.()
            .then(result => {
                if (!isMounted) return;
                const items = Array.isArray(result) ? result : result?.releases;
                setReleases(normalizeReleaseList(items));
                setError(Array.isArray(result) ? '' : String(result?.error || ''));
            })
            .catch(loadError => {
                if (!isMounted) return;
                setError(loadError.message || 'NETWORK_ERROR');
                setReleases([]);
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const openExternal = url => {
        window.electronAPI?.openExternal?.(url).catch(openError => {
            setError(openError.message || 'OPEN_EXTERNAL_FAILED');
        });
    };

    return (
        <div className="release-tab">
            <div className="release-scroll-area">
                <div className="release-content-container">
                    {loading ? (
                        <div className="release-loading">{t('msg_loading_list')}</div>
                    ) : releases.length === 0 ? (
                        <div className="release-error">{t('msg_release_load_fail')}</div>
                    ) : (
                        <>
                            {error && (
                                <div className="release-error compact">
                                    {t('msg_release_load_fail')}
                                </div>
                            )}
                            {releases.map(item => (
                                <article key={item.id} className="release-card">
                                    <div className="release-card-title">
                                        <FaIcon name="archive" size={18} />
                                        <span>{item.name}</span>
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
            </div>
        </div>
    );
}

export { ReleaseTab };
export default ReleaseTab;
