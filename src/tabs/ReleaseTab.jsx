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
