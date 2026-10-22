import React from 'react';
import { FaIcon } from './FaIcon';

export function SettingsDataFolder({ t }) {
    const [folderPath, setFolderPath] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [opening, setOpening] = React.useState(false);
    const [error, setError] = React.useState(null);
    const openingRef = React.useRef(false);

    React.useEffect(() => {
        let cancelled = false;
        async function loadPath() {
            try {
                const value = await window.electronAPI?.getAppDataPath?.();
                if (typeof value !== 'string' || !value) throw new Error();
                if (!cancelled) setFolderPath(value);
            } catch {
                if (!cancelled) setError({ key: 'settings.data_folder.load_failed' });
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        loadPath();
        return () => { cancelled = true; };
    }, []);

    async function openFolder() {
        if (!folderPath || openingRef.current) return;
        openingRef.current = true;
        setOpening(true);
        setError(null);
        try {
            const result = await window.electronAPI?.openAppDataFolder?.();
            if (!result?.success) {
                setError({ key: 'settings.data_folder.open_failed', message: result?.message });
            }
        } catch (failure) {
            setError({ key: 'settings.data_folder.open_failed', message: failure?.message });
        } finally {
            openingRef.current = false;
            setOpening(false);
        }
    }

    const openLabel = opening ? t('settings.data_folder.opening') : t('action_open_folder');

    return (
        <fieldset className="settings-fieldset settings-data-folder">
            <legend>{t('settings.data_folder.title')}</legend>
            <p className="settings-help" id="settings-data-folder-help">{t('settings.data_folder.description')}</p>
            <p className="settings-label" id="settings-data-folder-label">{t('settings.data_folder.path')}</p>
            <div className="settings-data-folder-location">
                <p
                    id="settings-data-folder-path"
                    className="settings-data-folder-path"
                    aria-labelledby="settings-data-folder-label"
                    aria-describedby="settings-data-folder-help"
                    aria-busy={loading}
                >
                    {loading ? t('settings.data_folder.loading') : folderPath}
                </p>
                <button
                    type="button"
                    className="settings-icon-btn"
                    title={openLabel}
                    aria-label={openLabel}
                    aria-busy={opening}
                    onClick={openFolder}
                    disabled={loading || opening || !folderPath}
                >
                    <FaIcon name="folderOpen" aria-hidden="true" />
                </button>
            </div>
            {error && (
                <p className="settings-help settings-data-folder-error" role="alert">
                    {t(error.key)}{error.message ? ` ${error.message}` : ''}
                </p>
            )}
        </fieldset>
    );
}
