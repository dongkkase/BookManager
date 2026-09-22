import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveAssetDropPosition } from './assetDropPosition';

export default function useAssetDropIndicator({ editor, stageRef, chapterId, mode, disabled }) {
    const [indicator, setIndicator] = useState(null);
    const pointer = useRef(null);
    const frame = useRef(null);
    const clear = useCallback(() => {
        pointer.current = null;
        cancelAnimationFrame(frame.current);
        frame.current = null;
        setIndicator(null);
    }, []);
    const locate = useCallback(point => {
        const stage = stageRef.current;
        if (disabled || !editor || editor.isDestroyed || !stage || !stage.getClientRects().length) return null;
        const stageBounds = stage.getBoundingClientRect();
        const bounds = { left: stageBounds.left, right: stageBounds.right, top: stageBounds.top, bottom: stageBounds.bottom };
        const studio = stage.closest('.ee-studio.is-compact');
        if (studio) {
            for (const selector of ['.ee-sidebar', '.ee-inspector']) {
                const panel = studio.querySelector(`${selector}:not([hidden])`);
                if (!panel?.getClientRects().length) continue;
                const panelBounds = panel.getBoundingClientRect();
                if (panelBounds.bottom <= bounds.top || panelBounds.top >= bounds.bottom) continue;
                if (selector === '.ee-sidebar') bounds.left = Math.max(bounds.left, panelBounds.right);
                else bounds.right = Math.min(bounds.right, panelBounds.left);
            }
        }
        if (bounds.right <= bounds.left) return null;
        if (point.left < bounds.left || point.left > bounds.right || point.top < bounds.top || point.top > bounds.bottom) return null;
        const target = resolveAssetDropPosition(editor.view, point);
        if (!target) return null;
        const left = Math.max(target.rect.left, bounds.left);
        const top = Math.max(target.rect.top, bounds.top);
        const right = Math.min(target.rect.left + target.rect.width, bounds.right);
        const bottom = Math.min(target.rect.top + target.rect.height, bounds.bottom);
        if (right <= left || bottom <= top) return null;
        return { ...target, rect: { left, top, width: right - left, height: bottom - top }, alignEnd: right > bounds.right - 120, labelBelow: top < bounds.top + 30 };
    }, [editor, stageRef, disabled]);
    const show = useCallback(point => {
        pointer.current = point;
        const target = locate(point);
        setIndicator(previous => previous?.position === target?.position && previous?.inline === target?.inline && previous?.rect.left === target?.rect.left && previous?.rect.top === target?.rect.top && previous?.rect.width === target?.rect.width && previous?.rect.height === target?.rect.height && previous?.alignEnd === target?.alignEnd && previous?.labelBelow === target?.labelBelow ? previous : target);
        return target;
    }, [locate]);
    useEffect(() => { clear(); }, [chapterId, mode, disabled, clear]);
    useEffect(() => {
        const refresh = () => {
            if (!pointer.current || frame.current != null) return;
            frame.current = requestAnimationFrame(() => {
                frame.current = null;
                if (pointer.current) show(pointer.current);
            });
        };
        const leave = event => {
            if (!event.relatedTarget) clear();
        };
        const escape = event => { if (event.key === 'Escape') clear(); };
        window.addEventListener('scroll', refresh, true);
        window.addEventListener('resize', refresh);
        window.addEventListener('drop', clear, true);
        window.addEventListener('dragend', clear, true);
        window.addEventListener('blur', clear);
        window.addEventListener('dragleave', leave);
        window.addEventListener('keydown', escape, true);
        return () => {
            window.removeEventListener('scroll', refresh, true);
            window.removeEventListener('resize', refresh);
            window.removeEventListener('drop', clear, true);
            window.removeEventListener('dragend', clear, true);
            window.removeEventListener('blur', clear);
            window.removeEventListener('dragleave', leave);
            window.removeEventListener('keydown', escape, true);
            cancelAnimationFrame(frame.current);
            frame.current = null;
        };
    }, [show, clear]);
    return { indicator, show, clear, locate };
}
