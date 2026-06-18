export const TOAST_DUPLICATE_WINDOW_MS = 1000;

export function shouldShowToast(previousToast, message, now = Date.now()) {
    if (!previousToast) return true;
    if (previousToast.message !== message) return true;
    return now - previousToast.shownAt >= TOAST_DUPLICATE_WINDOW_MS;
}
