import React, { useEffect, useRef, useState } from 'react';
import { FaIcon } from '../../../components/FaIcon';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';

export default function RecentProjects({ projects, busy, onOpen, onManage }) {
    const [deleting, setDeleting] = useState(null);
    const [deleteError, setDeleteError] = useState(null);
    const [focusId, setFocusId] = useState(null);
    const heading = useRef(null);
    const buttons = useRef(new Map());
    useEffect(() => {
        if (focusId == null || deleting) return;
        (buttons.current.get(focusId) || heading.current)?.focus({ preventScroll: true });
        setFocusId(null);
    }, [focusId, projects, deleting]);
    const duplicate = async item => {
        const result = await onManage('recoveryDuplicate', item);
        if (result?.duplicatedId) setFocusId(result.duplicatedId);
    };
    const remove = async () => {
        const index = projects.findIndex(item => item.id === deleting.id);
        const nextId = projects[index + 1]?.id || projects[index - 1]?.id || '';
        setDeleteError(null);
        const result = await onManage('recoveryDelete', deleting);
        if (!result) return;
        if (result.error) { setDeleteError(result.error); return; }
        setDeleting(null);
        setFocusId(nextId);
    };
    return <section className="ee-recent" aria-label={l('recent')} aria-busy={busy}>
        <h2 ref={heading} tabIndex={-1}>{l('recent')}</h2>
        {projects.length ? <ul className="ee-recent-list">{projects.map(item => <li className="ee-recent-item" key={item.id}>
            <button className="ee-recent-open" ref={element => { if (element) buttons.current.set(item.id, element); else buttons.current.delete(item.id); }} disabled={busy} onClick={() => onOpen(item.id)}>
                <FaIcon name="book" /><span><strong title={item.title}>{item.title || l('newBook')}</strong><small>{new Date(item.updatedAt).toLocaleString()}</small></span><FaIcon name="chevronRight" />
            </button>
            <div className="ee-recent-actions">
                <button type="button" className="ee-button" disabled={busy} aria-label={`${l('duplicateProject')} · ${item.title}`} onClick={() => duplicate(item)}><FaIcon name="copy" />{l('duplicateAction')}</button>
                <button type="button" className="ee-button ee-danger" disabled={busy} aria-label={`${l('deleteProject')} · ${item.title}`} onClick={() => { setDeleteError(null); setDeleting(item); }}><FaIcon name="trash" />{l('remove')}</button>
            </div>
        </li>)}</ul> : <p className="ee-recent-empty">{l('recentEmpty')}</p>}
        {deleting && <EditorDialog title={l('deleteProject')} className="ee-recent-delete-dialog" onClose={() => { if (!busy) setDeleting(null); }} onSubmit={event => { event.preventDefault(); if (!busy) void remove(); }} footer={<><button type="button" autoFocus className="ee-button" disabled={busy} onClick={() => setDeleting(null)}>{l('cancel')}</button><button type="submit" className="ee-button ee-danger" disabled={busy}>{l(busy ? 'working' : 'remove')}</button></>}>
            <p className="ee-recent-delete-title">{deleting.title || l('newBook')}</p>
            <p className="ee-muted">{new Date(deleting.updatedAt).toLocaleString()}</p>
            <p>{l('deleteProjectHint')}</p>
            {deleteError && <p role="alert" className="ee-danger">{deleteError}</p>}
        </EditorDialog>}
    </section>;
}
