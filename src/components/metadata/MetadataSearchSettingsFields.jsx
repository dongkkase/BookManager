import React, { useId, useMemo, useState } from 'react';
import { TagInput } from './MetadataTagInput';
import { METADATA_SEARCH_SETTING_TYPES, metadataSearchTerms, normalizeMetadataSearchSettings } from '../../metadataSearchSettings';
import '../../styles/MetadataSearchSettingsFields.css';

export function MetadataSearchSettingsFields({ settings, initialType = 'comic', onChange, disabled = false, settingsPage = false, t }) {
    const [type, setType] = useState(initialType);
    const id = useId();
    const normalized = useMemo(() => normalizeMetadataSearchSettings(settings), [settings]);
    const label = key => t(`metadata_search_settings.${key}`);

    return (
        <div className="meta-search-settings-fields">
            <label className={`meta-search-settings-type${settingsPage ? ' settings-control-field' : ''}`}>
                <span className={settingsPage ? 'settings-field-label' : undefined}>{label('book_type')}</span>
                <select className={settingsPage ? 'settings-select' : undefined} value={type} disabled={disabled} onChange={event => setType(event.target.value)}>
                    {METADATA_SEARCH_SETTING_TYPES.map(value => <option key={value} value={value}>{label(value)}</option>)}
                </select>
            </label>
            <p className="meta-search-settings-hint">{label('input_hint')}</p>
            {['excludedTitleTerms', 'excludedResultTags', 'excludedTags'].map(field => (
                <section key={field} data-search-setting={field} aria-labelledby={`${id}-${field}`}>
                    <h3 id={`${id}-${field}`}>{label(field)}</h3>
                    <p>{label(`${field}_hint`)}</p>
                    <TagInput key={`${type}:${field}`} className="meta-input" value={normalized[type][field].join(', ')}
                        ariaLabel={label(field)} disabled={disabled} placeholder={t('enter_after_input')}
                        onChange={value => onChange({
                            ...normalized,
                            [type]: { ...normalized[type], [field]: metadataSearchTerms(value) },
                        })} />
                </section>
            ))}
        </div>
    );
}
