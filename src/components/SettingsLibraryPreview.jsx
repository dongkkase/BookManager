import React from 'react';
import { FaIcon } from './FaIcon';
import { buildLibraryItems, groupLibraryItems } from '../libraryPresentation';
import { fontVarsForConfig } from '../fontPolicy';

export function SettingsLibraryPreview({ entries, selectedPath, onSelect, config, t }) {
    const groups = groupLibraryItems(buildLibraryItems(entries.map(entry => entry.path), entries));

    return (
        <aside className="settings-library-preview" aria-labelledby="settings-library-preview-title">
            <h3 id="settings-library-preview-title">{t('settings.library_preview.title')}</h3>
            <p className="settings-help">{t('settings.library_preview.description')}</p>
            <div className="settings-library-preview-canvas" style={fontVarsForConfig(config)}>
                <div className="settings-library-preview-header">
                    <span>{t('folder.sidebar.libraries')}</span>
                    <FaIcon name="angleDown" size={10} />
                </div>
                {entries.length === 0 ? (
                    <p className="settings-library-preview-empty">{t('folder.sidebar.empty_libraries')}</p>
                ) : (
                    <ul className="settings-library-preview-list">
                        {groups.map(group => (
                            <li className="settings-library-preview-group" data-group={group.label} key={group.key}>
                                {group.label && <h4 title={group.label}>{group.label}</h4>}
                                <ul>
                                    {group.items.map(item => (
                                        <li key={item.path}>
                                            <button
                                                type="button"
                                                className={`settings-library-preview-item ${group.label ? 'is-grouped' : ''}`}
                                                data-library-path={item.path}
                                                aria-pressed={selectedPath === item.path}
                                                title={`${item.name}\n${item.path}`}
                                                onClick={() => onSelect(item.path)}
                                            >
                                                <span>{item.name}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <p className="settings-help settings-library-preview-hint">{t('settings.library_preview.hint')}</p>
        </aside>
    );
}
