export const TOAST_DUPLICATE_WINDOW_MS = 1000;

export function createToastDescriptor(input, duration = 2500) {
    if (input && typeof input === 'object' && input.key) {
        return {
            key: String(input.key),
            values: input.values,
            suffix: String(input.suffix || ''),
            duration,
        };
    }
    return {
        message: String(input || ''),
        duration,
    };
}

export function resolveToastMessage(toast, translate) {
    if (!toast) return '';
    if (toast.key) return `${translate(toast.key, toast.values)}${toast.suffix || ''}`;
    return String(toast.message || '');
}

export function toastIdentity(toast) {
    if (!toast) return '';
    if (toast.key) {
        return JSON.stringify([toast.key, toast.values ?? null, toast.suffix || '']);
    }
    return String(toast.message || '');
}

export function shouldShowToast(previousToast, identity, now = Date.now()) {
    if (!previousToast) return true;
    if (previousToast.identity !== identity && previousToast.message !== identity) return true;
    return now - previousToast.shownAt >= TOAST_DUPLICATE_WINDOW_MS;
}
