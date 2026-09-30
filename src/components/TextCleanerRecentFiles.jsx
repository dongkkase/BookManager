import React, { useState } from 'react';
import { FaIcon } from './FaIcon';
import { readRecentTextFiles, writeRecentTextFiles } from '../textCleanerRecentFiles';

export default function TextCleanerRecentFiles({ t, busy, onOpen }) {
    const [recent, setRecent] = useState(readRecentTextFiles);
    const remove = filePath => setRecent(writeRecentTextFiles(recent.filter(file => file.filePath !== filePath)));
    return (
        <section className="text-cleaner-recent" aria-label={t('tools.text_cleaner.recent_title')} aria-busy={busy}>
            <h2>{t('tools.text_cleaner.recent_title')}</h2>
            {recent.length ? <ul className="text-cleaner-recent-list">
                {recent.map(file => <li className="text-cleaner-recent-item" key={file.filePath}>
                    <button type="button" className="text-cleaner-recent-open" disabled={busy}
                        onClick={() => onOpen(file.filePath)} aria-label={t('tools.text_cleaner.recent_open', { name: file.fileName })}>
                        <FaIcon name="fileLines" size={14} />
                        <span>
                            <strong title={file.fileName}>{file.fileName}</strong>
                            <small className="text-cleaner-recent-meta">
                                <span className="text-cleaner-recent-path" title={file.filePath}>{file.filePath}</span>
                                <time dateTime={new Date(file.updatedAt).toISOString()}>{new Date(file.updatedAt).toLocaleString()}</time>
                            </small>
                        </span>
                        <FaIcon name="chevronRight" size={12} />
                    </button>
                    <div className="text-cleaner-recent-actions">
                        <button type="button" className="text-cleaner-button text-cleaner-recent-remove" disabled={busy}
                            onClick={() => remove(file.filePath)} aria-label={t('tools.text_cleaner.recent_remove', { name: file.fileName })}>
                            <FaIcon name="trash" size={12} />
                            {t('tools.text_cleaner.recent_remove_button')}
                        </button>
                    </div>
                </li>)}
            </ul> : <p className="text-cleaner-recent-empty">{t('tools.text_cleaner.recent_empty')}</p>}
            <p className="text-cleaner-recent-hint">{t('tools.text_cleaner.recent_hint')}</p>
        </section>
    );
}
