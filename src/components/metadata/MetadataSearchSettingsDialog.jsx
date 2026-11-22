import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '../FaIcon';
import { normalizeMetadataSearchSettings } from '../../metadataSearchSettings';
import { MetadataSearchSettingsFields } from './MetadataSearchSettingsFields';

export function MetadataSearchSettingsDialog({ settings, initialType, onSave, onClose, onClearCache, clearingCache, cacheError, searchLoading, t }) {
    const dialogRef = useRef(null);
    const savingRef = useRef(false);
    const [draft, setDraft] = useState(() => normalizeMetadataSearchSettings(settings));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const label = key => t(`metadata_search_settings.${key}`);
    const close = () => { if (!savingRef.current) onClose(); };

    useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const previousFocus = document.activeElement;
        dialog.showModal();
        return () => {
            dialog.close();
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
    }, []);

    const save = async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            await onSave(draft);
            onClose();
        } catch (error) {
            setError(t('config_save_failed', { msg: error?.message || String(error) }));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    return createPortal(
        <dialog ref={dialogRef} className="meta-search-settings-dialog" aria-labelledby="meta-search-settings-title"
            onCancel={event => { event.preventDefault(); close(); }}
            onKeyDown={event => event.stopPropagation()}>
            <header>
                <h2 id="meta-search-settings-title"><FaIcon name="gear" /> {label('title')}</h2>
                <button type="button" onClick={close} disabled={saving} aria-label={t('btn_close')}><FaIcon name="xmark" /></button>
            </header>
            <div className="meta-search-settings-content">
                <MetadataSearchSettingsFields settings={draft} initialType={initialType} onChange={setDraft} disabled={saving} t={t} />
                <section className="meta-search-settings-cache">
                    <div><h3>{t('btn_clear_cache')}</h3><p>{label('cache_hint')}</p></div>
                    <button type="button" onClick={onClearCache} disabled={saving || searchLoading || clearingCache}>
                        <FaIcon name="trash" /> {clearingCache ? t('meta_cache_clearing') : t('btn_clear_cache')}
                    </button>
                </section>
                {cacheError && <p className="meta-search-settings-error" role="alert">{cacheError}</p>}
                {error && <p className="meta-search-settings-error" role="alert">{error}</p>}
            </div>
            <footer>
                <button type="button" onClick={close} disabled={saving}>{t('btn_cancel')}</button>
                <button type="button" className="primary" onClick={save} disabled={saving}>{saving ? label('saving') : t('settings.apply')}</button>
            </footer>
        </dialog>,
        document.body,
    );
}
