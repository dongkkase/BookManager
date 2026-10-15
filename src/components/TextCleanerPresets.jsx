import React, { useState } from 'react';
import { DEFAULT_TEXT_CLEANER_OPTIONS } from '../textCleanerPolicy';
import { MAX_TEXT_CLEANER_PRESET_NAME_LENGTH } from '../textCleanerSettings';

export default function TextCleanerPresets({ t, presets, disabled, onApply, onSave, onDelete }) {
    const [selectedName, setSelectedName] = useState('');
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');
    const [invalid, setInvalid] = useState(false);
    const selected = presets.find(preset => preset.name === selectedName);

    const save = event => {
        event.preventDefault();
        try {
            const saved = onSave(name);
            setSelectedName(name.trim());
            setName(name.trim());
            setInvalid(false);
            setMessage(saved ? 'preset_saved' : '');
        } catch (error) {
            setInvalid(true);
            setMessage(error.code === 'PRESET_LIMIT_EXCEEDED' ? 'preset_limit' : 'preset_invalid_name');
        }
    };

    const remove = () => {
        if (!selected) return;
        const saved = onDelete(selected.name);
        setSelectedName('');
        setName('');
        setInvalid(false);
        setMessage(saved ? 'preset_deleted' : '');
    };

    return (
        <details className="text-cleaner-presets">
            <summary>{t('tools.text_cleaner.presets')}</summary>
            <div className="text-cleaner-preset-controls">
                <select
                    aria-label={t('tools.text_cleaner.preset_select')}
                    value={selected?.name || ''}
                    disabled={disabled || presets.length === 0}
                    onChange={event => {
                        setSelectedName(event.target.value);
                        setName(event.target.value);
                        setMessage('');
                    }}
                >
                    <option value="">{t('tools.text_cleaner.preset_select')}</option>
                    {presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
                </select>
                <button type="button" disabled={disabled || !selected} onClick={() => {
                    if (onApply(selected.options)) setMessage('');
                }}>{t('tools.text_cleaner.preset_apply')}</button>
                <button type="button" disabled={disabled || !selected} onClick={remove}>{t('tools.text_cleaner.preset_delete')}</button>
                <button type="button" disabled={disabled} onClick={() => {
                    if (onApply(DEFAULT_TEXT_CLEANER_OPTIONS)) {
                        setSelectedName('');
                        setName('');
                        setMessage('');
                    }
                }}>{t('tools.text_cleaner.preset_reset')}</button>
                <form onSubmit={save}>
                    <input
                        type="text"
                        aria-label={t('tools.text_cleaner.preset_name')}
                        placeholder={t('tools.text_cleaner.preset_name')}
                        value={name}
                        maxLength={MAX_TEXT_CLEANER_PRESET_NAME_LENGTH}
                        disabled={disabled}
                        onChange={event => { setName(event.target.value); setMessage(''); }}
                    />
                    <button type="submit" disabled={disabled || !name.trim()}>{t('tools.text_cleaner.preset_save')}</button>
                </form>
            </div>
            {message && <p className={invalid ? 'is-error' : ''} role={invalid ? 'alert' : 'status'}>
                {t(`tools.text_cleaner.${message}`)}
            </p>}
        </details>
    );
}
