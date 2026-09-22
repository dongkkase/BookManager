import { useCallback, useEffect, useState } from 'react';

export default function useWorkspacePanels() {
    const [workspaceElement, workspaceRef] = useState(null);
    const [compact, setCompact] = useState(false);
    const [structure, setStructure] = useState(true);
    const [inspector, setInspector] = useState(true);
    const [focusMode, setFocusMode] = useState(false);
    useEffect(() => {
        if (!workspaceElement) return;
        const active = document.activeElement;
        const panel = active?.closest('.ee-sidebar, .ee-inspector');
        if (panel?.hidden && workspaceElement.contains(panel)) {
            const visiblePanel = workspaceElement.querySelector('.ee-sidebar:not([hidden]), .ee-inspector:not([hidden])');
            const target = visiblePanel?.querySelector('[aria-selected="true"]') || workspaceElement.querySelector(focusMode ? '.ee-focus-toggle' : `[data-panel-toggle="${panel.classList.contains('ee-sidebar') ? 'structure' : 'inspector'}"]`);
            target?.focus({ preventScroll: true });
        } else if (active?.dataset.panelToggle) {
            const shown = workspaceElement.querySelector(active.dataset.panelToggle === 'structure' ? '.ee-sidebar:not([hidden])' : '.ee-inspector:not([hidden])');
            shown?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
        }
    }, [workspaceElement, structure, inspector, focusMode]);
    useEffect(() => {
        const element = workspaceElement;
        if (!element) return undefined;
        let wasCompact = false;
        const observer = new ResizeObserver(([entry]) => {
            if (entry.contentRect.width <= 0 || !element.getClientRects().length) return;
            const next = entry.contentRect.width < 980;
            setCompact(next);
            if (next && !wasCompact) { setStructure(false); setInspector(false); }
            wasCompact = next;
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [workspaceElement]);
    const setShowStructure = useCallback(value => {
        setFocusMode(false);
        setStructure(value);
        if (compact && value) setInspector(false);
    }, [compact]);
    const setShowInspector = useCallback(value => {
        setFocusMode(false);
        setInspector(value);
        if (compact && value) setStructure(false);
    }, [compact]);
    return {
        workspaceRef, compact, focusMode, setFocusMode,
        showStructure: structure && !focusMode,
        showInspector: inspector && !focusMode,
        setShowStructure, setShowInspector,
    };
}
