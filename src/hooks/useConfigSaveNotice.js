import { useCallback, useRef } from 'react';

export function useConfigSaveNotice(saveConfig, showToast) {
    const callbacksRef = useRef({ saveConfig, showToast });
    callbacksRef.current = { saveConfig, showToast };

    return useCallback(async updates => {
        try {
            await callbacksRef.current.saveConfig?.(updates);
            return true;
        } catch (error) {
            callbacksRef.current.showToast?.({
                key: 'config_save_failed',
                values: { msg: error?.message || String(error) },
            });
            return false;
        }
    }, []);
}
