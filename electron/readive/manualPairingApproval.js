import { sharingText } from '../servers/shared/sharingCommon.js';

export async function approveManualPairing({ dialog, window, config, code, deviceName, signal }) {
    if (signal.aborted || !window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const t = (key, values) => sharingText(config, `readive.${key}`, key, values);
    const result = await dialog.showMessageBox(window, {
        type: 'question', title: t('manual_approval_title'),
        message: t('manual_approval_message'),
        detail: t('manual_approval_detail', { device: deviceName, code }),
        buttons: [t('manual_deny'), t('manual_approve')],
        defaultId: 0, cancelId: 0, noLink: true, signal,
    });
    return !signal.aborted && !window.isDestroyed() && !window.webContents.isDestroyed() && result.response === 1;
}
