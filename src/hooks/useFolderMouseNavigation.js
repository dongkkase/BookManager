import { useEffect, useRef } from 'react';
import { isApplePlatform, isTextEntryTarget } from '../interactionPolicy.js';

const NATIVE_MOUSE_PAIR_WINDOW_MS = 500;

export function folderHistoryKeyDirection(event, platform = '') {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey) return 0;
    const key = event.key || event.code;
    if (!event.altKey && !event.metaKey) {
        if (key === 'BrowserBack' || event.code === 'BrowserBack') return -1;
        if (key === 'BrowserForward' || event.code === 'BrowserForward') return 1;
    }
    const isMac = isApplePlatform(platform);
    if (event.altKey && !event.metaKey && !(isMac && isTextEntryTarget(event.target))) {
        if (key === 'ArrowLeft') return -1;
        if (key === 'ArrowRight') return 1;
    }
    if (isMac && event.metaKey && !event.altKey) {
        if (event.code === 'BracketLeft' || key === '[') return -1;
        if (event.code === 'BracketRight' || key === ']') return 1;
    }
    return 0;
}

export function attachFolderMouseNavigation({
    target,
    subscribeNative,
    isVisible,
    canNavigate,
    onNavigate,
    platform = '',
    now = () => performance.now(),
}) {
    let pendingInputs = [];
    let navigationQueue = Promise.resolve();
    let disposed = false;

    const navigate = (direction, source) => {
        const time = now();
        pendingInputs = pendingInputs.filter(input => time - input.time < NATIVE_MOUSE_PAIR_WINDOW_MS);
        const duplicateIndex = pendingInputs.findIndex(input => (
            input.direction === direction && input.source !== source
        ));
        if (duplicateIndex !== -1) {
            pendingInputs.splice(duplicateIndex, 1);
            return;
        }
        // 운영체제와 DOM에서 전달된 동일 입력만 짝지어 빠른 연속 클릭은 유지합니다.
        pendingInputs.push({ direction, source, time });
        if (!canNavigate()) return;
        navigationQueue = navigationQueue.then(async () => {
            if (disposed || !isVisible() || !canNavigate()) return;
            await onNavigate(direction);
        }).catch(error => {
            console.error('폴더 탐색 실패:', error);
        });
    };

    const handleMouseEvent = event => {
        if ((event.button !== 3 && event.button !== 4) || !isVisible()) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'mousedown') navigate(event.button === 3 ? -1 : 1, 'mouse');
    };
    const handleNativeNavigation = direction => {
        if ((direction === -1 || direction === 1) && isVisible()) navigate(direction, 'native');
    };
    const handleKeyDown = event => {
        const direction = folderHistoryKeyDirection(event, platform);
        if (!direction || !isVisible()) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) navigate(direction, 'keyboard');
    };
    const mouseEvents = ['mousedown', 'mouseup', 'auxclick'];
    mouseEvents.forEach(type => target.addEventListener(type, handleMouseEvent, true));
    target.addEventListener('keydown', handleKeyDown, true);
    const unsubscribeNative = subscribeNative?.(handleNativeNavigation);

    return () => {
        disposed = true;
        mouseEvents.forEach(type => target.removeEventListener(type, handleMouseEvent, true));
        target.removeEventListener('keydown', handleKeyDown, true);
        unsubscribeNative?.();
        pendingInputs = [];
    };
}

export function useFolderMouseNavigation({ isVisible, canNavigate, onNavigate }) {
    const callbacksRef = useRef({ isVisible, canNavigate, onNavigate });
    callbacksRef.current = { isVisible, canNavigate, onNavigate };

    useEffect(() => attachFolderMouseNavigation({
        target: window,
        platform: navigator.platform,
        subscribeNative: callback => window.electronAPI?.onHistoryNavigation?.(callback),
        isVisible: () => callbacksRef.current.isVisible(),
        canNavigate: () => callbacksRef.current.canNavigate(),
        onNavigate: direction => callbacksRef.current.onNavigate(direction),
    }), []);
}
