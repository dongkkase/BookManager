import React, { useEffect, useId, useRef, useState } from 'react';
import { CoverArtwork } from '../CoverArtwork';
import { detailMetadataValue } from './detailPanelCommon';
import { initialRating, ratingStarFill } from '../../ratingPolicy';
import '../../styles/RatingEditorDialog.css';

export function RatingEditorDialog({ file, t, onSave, onClose }) {
    const [rating, setRating] = useState(() => initialRating(detailMetadataValue(file, 'rating', 'CommunityRating')));
    const [hoverRating, setHoverRating] = useState(null);
    const [selectionEffect, setSelectionEffect] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [imageError, setImageError] = useState(false);
    const dialogRef = useRef(null);
    const savingRef = useRef(false);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const id = useId();
    const preview = hoverRating ?? rating;
    const labels = ['very_bad', 'bad', 'normal', 'good', 'very_good'];
    const selectRating = value => {
        if (savingRef.current) return;
        setRating(value);
        setHoverRating(null);
        setSelectionEffect({ value, sequence: (selectionEffect?.sequence || 0) + 1 });
    };

    useEffect(() => {
        const previousFocus = document.activeElement;
        const dialog = dialogRef.current;
        (dialog.querySelector('input:checked') || dialog.querySelector('input'))?.focus();
        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!savingRef.current) closeRef.current();
            } else if (event.key === 'Tab') {
                const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
                    .filter(element => element.type !== 'radio' || element.checked || (!dialog.querySelector('input:checked') && element.value === '1'));
                const first = focusable[0];
                const last = focusable.at(-1);
                if (!first) { event.preventDefault(); return; }
                if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            if (previousFocus?.isConnected) previousFocus.focus?.();
        };
    }, []);

    const submit = async event => {
        event.preventDefault();
        if (!rating || savingRef.current) return;
        savingRef.current = true;
        dialogRef.current?.focus();
        setSaving(true);
        setError('');
        try {
            const result = await onSave({ filePath: file.full_path || file.path, rating });
            if (!result?.success) throw new Error(result?.error || t('rating_save_failed'));
            onClose();
        } catch (saveError) {
            setError(`${t('rating_save_failed')} ${saveError.message || ''}`);
            setSaving(false);
        } finally {
            savingRef.current = false;
        }
    };
    const blockDrop = event => {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };

    return (
        <div className="rating-editor-backdrop" onMouseDown={event => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            if (!savingRef.current) onClose();
        }} onDragEnter={blockDrop} onDragOver={blockDrop} onDrop={blockDrop} onKeyDown={event => event.stopPropagation()}>
            <form ref={dialogRef} className="rating-editor-dialog" role="dialog" aria-modal="true"
                aria-labelledby={`${id}-title`} aria-busy={saving} tabIndex={-1} onSubmit={submit}>
                <button className="rating-editor-close" type="button" aria-label={t('rating_close')} onClick={onClose} disabled={saving}>×</button>
                <header className="rating-editor-book">
                    {file.cover && !imageError ? <img src={file.cover} alt="" onError={() => setImageError(true)} />
                        : <CoverArtwork className="rating-editor-cover" fallbackAlt="" />}
                    <div>
                        <div className="rating-editor-series">{detailMetadataValue(file, 'series', 'Series', 'album') || t('info_no_series')}</div>
                        <div className="rating-editor-book-title">{detailMetadataValue(file, 'title', 'Title') || file.name}</div>
                    </div>
                </header>
                <h2 id={`${id}-title`}>{t('rating_question')}</h2>
                <div className="rating-editor-stars" role="radiogroup" aria-label={t('rating_scale')}
                    onMouseLeave={() => setHoverRating(null)}>
                    {labels.map((label, index) => {
                        const bursting = selectionEffect && Math.ceil(selectionEffect.value / 2) === index + 1;
                        return <div className={`rating-editor-star${preview > index * 2 ? ' lit' : ''}${!saving && hoverRating !== null && Math.ceil(hoverRating / 2) === index + 1 ? ' hovered' : ''}`} key={label}>
                            <div className="rating-editor-star-visual" aria-hidden="true">
                                <span className="rating-editor-star-glow" />
                                <svg key={bursting ? selectionEffect.sequence : 'idle'} className={bursting ? 'is-bursting' : ''} viewBox="0 0 48 48">
                                    <defs>
                                        <radialGradient id={`${id}-gold-${index}`} cx="38%" cy="25%" r="80%">
                                            <stop offset="0%" stopColor="#fff3b5" />
                                            <stop offset="45%" stopColor="#ffd34e" />
                                            <stop offset="100%" stopColor="#e99416" />
                                        </radialGradient>
                                        <clipPath id={`${id}-fill-${index}`}>
                                            <rect width={48 * ratingStarFill(preview, index) / 100} height="48" />
                                        </clipPath>
                                    </defs>
                                    <path className="rating-editor-star-outline" d="M24 3 30.2 16.4 45 18.2 34.2 28.4 37 43 24 35.8 11 43 13.8 28.4 3 18.2 17.8 16.4Z" />
                                    <path className="rating-editor-star-fill" d="M24 3 30.2 16.4 45 18.2 34.2 28.4 37 43 24 35.8 11 43 13.8 28.4 3 18.2 17.8 16.4Z"
                                        clipPath={`url(#${id}-fill-${index})`} fill={`url(#${id}-gold-${index})`} />
                                </svg>
                                {bursting && <span key={`sparks-${selectionEffect.sequence}`} className="rating-editor-sparks">
                                    {Array.from({ length: 12 }, (_, spark) => {
                                        const angle = spark * Math.PI / 6;
                                        return <span key={spark} style={{
                                            '--spark-x': `${Math.round(Math.cos(angle) * (spark % 2 ? 46 : 35))}px`,
                                            '--spark-y': `${Math.round(Math.sin(angle) * (spark % 2 ? 46 : 35))}px`,
                                        }} />;
                                    })}
                                </span>}
                            </div>
                            {[1, 2].map(half => {
                                const value = index * 2 + half;
                                return <label key={half} className={`rating-editor-half half-${half}`} onMouseEnter={() => { if (!saving) setHoverRating(value); }}>
                                    <input type="radio" name={`${id}-rating`} value={value} checked={rating === value}
                                        disabled={saving} aria-label={t('rating_points', { rating: value })}
                                        onChange={() => selectRating(value)}
                                        onClick={() => { if (rating === value) selectRating(value); }} />
                                </label>;
                            })}
                        </div>;
                    })}
                </div>
                <div className="rating-editor-description" aria-live="polite" aria-atomic="true">
                    <div key={rating} className={`rating-editor-label${rating ? ' has-rating' : ''}`}>
                        {rating ? t(`rating_${labels[Math.ceil(rating / 2) - 1]}`) : t('rating_unrated')}
                    </div>
                    <div className="rating-editor-score">{rating ? `${rating} / 10` : '\u00a0'}</div>
                </div>
                {error && <div className="rating-editor-error" role="alert">{error}</div>}
                <button className="rating-editor-submit" type="submit" disabled={!rating || saving}>{t(saving ? 'rating_saving' : 'rating_submit')}</button>
            </form>
        </div>
    );
}
