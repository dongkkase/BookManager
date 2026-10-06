import React, { useEffect, useId, useRef, useState } from 'react';
import { FaIcon } from '../FaIcon';
import '../../styles/ReadingCollections.css';

export function ReadingCollectionsDialog({ collections, paths = null, initialCollectionId = '', initialAction = '', mutate, onClose, t }) {
    const dialogRef = useRef(null);
    const busyRef = useRef(false);
    const initialCollection = collections.find(collection => collection.id === initialCollectionId);
    const [selectedId, setSelectedId] = useState(initialCollectionId);
    const [name, setName] = useState(initialAction === 'rename' ? initialCollection?.name || '' : '');
    const [editingId, setEditingId] = useState(initialAction === 'rename' ? initialCollectionId : '');
    const [deleting, setDeleting] = useState(initialAction === 'delete' ? initialCollection || null : null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const id = useId();
    useEffect(() => {
        const previous = document.activeElement;
        const dialog = dialogRef.current;
        dialog.showModal();
        return () => {
            dialog.close();
            if (previous?.isConnected) previous.focus?.();
        };
    }, []);
    const run = async action => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try { await action(); } catch (failure) { setError(failure.message || t('reading_lists.save_failed')); }
        finally { busyRef.current = false; setBusy(false); }
    };
    const saveName = event => {
        event.preventDefault();
        void run(async () => {
            const result = await mutate({ operation: editingId ? 'rename' : 'create', id: editingId, name });
            setSelectedId(result.id);
            setEditingId('');
            setName('');
        });
    };
    const addBooks = () => void run(async () => {
        const result = await mutate({ operation: 'add', id: selectedId, paths });
        if (result.errors?.length) {
            setNotice(`${t('reading_lists.added', [result.changes])} ${t('reading_lists.partial', [result.errors.length])}`);
        } else if (!result.matchedCount) setNotice(t('reading_lists.no_books'));
        else onClose();
    });
    const close = () => { if (!busyRef.current) onClose(); };
    return <dialog ref={dialogRef} className="reading-collections-dialog" data-folder-modal aria-labelledby={`${id}-title`} aria-busy={busy}
        onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()}>
        <header className="dialog-titlebar">
            <h2 id={`${id}-title`}>{t(paths ? 'reading_lists.collection_add' : 'reading_lists.manage')}</h2>
            <button type="button" className="reading-collections-close" aria-label={t('reading_lists.close')} disabled={busy} onClick={close}>×</button>
        </header>
        <div className="file-action-dialog-body reading-collections-body">
            {paths && <p className="reading-list-muted">{t('reading_lists.selected_count', [paths.length])} · {t('reading_lists.folder_hint')}</p>}
            <div className="reading-collections-picker" aria-label={t('reading_lists.select')}>
                {collections.length === 0 && <p className="reading-list-muted">{t('reading_lists.collections_empty')}</p>}
                {collections.map(collection => <div className={`reading-collection-row${selectedId === collection.id ? ' selected' : ''}`} key={collection.id}>
                    <label>
                        {paths && <input type="radio" name={`${id}-collection`} checked={selectedId === collection.id} disabled={busy}
                            onChange={() => setSelectedId(collection.id)} />}
                        <FaIcon name="layers" />
                        <span className="reading-collection-name">{collection.name}</span>
                        <small>{t('reading_lists.count', [collection.count])}</small>
                    </label>
                    <button type="button" disabled={busy} aria-label={`${t('reading_lists.rename')}: ${collection.name}`} onClick={() => {
                        setEditingId(collection.id); setName(collection.name); setDeleting(null);
                    }}><FaIcon name="pen" /></button>
                    <button type="button" disabled={busy} aria-label={`${t('reading_lists.delete')}: ${collection.name}`} onClick={() => setDeleting(collection)}><FaIcon name="trash" /></button>
                </div>)}
            </div>
            {deleting && <div className="reading-collection-confirm" role="alert">
                <p>{t('reading_lists.delete_confirm', [deleting.name])}</p>
                <button type="button" disabled={busy} onClick={() => void run(async () => {
                    await mutate({ operation: 'delete', id: deleting.id });
                    if (selectedId === deleting.id) setSelectedId('');
                    if (editingId === deleting.id) { setEditingId(''); setName(''); }
                    setDeleting(null);
                })}>{t('reading_lists.delete')}</button>
                <button type="button" disabled={busy} onClick={() => setDeleting(null)}>{t('reading_lists.cancel')}</button>
            </div>}
            <form className="reading-collection-form" onSubmit={saveName}>
                <label htmlFor={`${id}-name`}>{t(editingId ? 'reading_lists.rename' : 'reading_lists.create')}</label>
                <div>
                    <input id={`${id}-name`} value={name} maxLength={100} required disabled={busy} placeholder={t('reading_lists.name_hint')}
                        onChange={event => setName(event.target.value)} />
                    <button type="submit" disabled={busy || !name.trim()}>{t(editingId ? 'reading_lists.save' : 'reading_lists.create')}</button>
                    {editingId && <button type="button" disabled={busy} onClick={() => { setEditingId(''); setName(''); }}>{t('reading_lists.cancel')}</button>}
                </div>
            </form>
            {error && <p role="alert" className="reading-list-error">{error}</p>}
            {notice && <p role="status">{notice}</p>}
        </div>
        <footer className="layout-dialog-footer">
            <button type="button" disabled={busy} onClick={close}>{t('reading_lists.close')}</button>
            {paths && <button type="button" className="primary" disabled={busy || !collections.some(collection => collection.id === selectedId)} onClick={addBooks}>
                {busy ? t('reading_lists.loading') : t('reading_lists.add')}
            </button>}
        </footer>
    </dialog>;
}
