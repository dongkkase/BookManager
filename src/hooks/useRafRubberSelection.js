import { useCallback, useEffect, useRef } from 'react';

export function useRafRubberSelection({
    getContainer,
    stateRef,
    itemSelector,
    itemPath,
    selectionBoxRef,
    onSelectPaths,
    selectedClassName = 'selected',
}) {
    const frameRef = useRef(0);
    const pointerRef = useRef(null);
    const selectedElementsRef = useRef(new Set());
    const selectedPathsRef = useRef([]);

    const hideSelectionBox = useCallback(() => {
        const box = selectionBoxRef?.current;
        if (!box) return;
        box.style.display = 'none';
    }, [selectionBoxRef]);

    const clearElementSelection = useCallback(() => {
        for (const element of selectedElementsRef.current) {
            element.classList.remove(selectedClassName);
        }
        selectedElementsRef.current.clear();
        selectedPathsRef.current = [];
    }, [selectedClassName]);

    const cancel = useCallback(() => {
        if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        pointerRef.current = null;
        hideSelectionBox();
        clearElementSelection();
    }, [clearElementSelection, hideSelectionBox]);

    const begin = useCallback(() => {
        if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        pointerRef.current = null;
        hideSelectionBox();
        clearElementSelection();
    }, [clearElementSelection, hideSelectionBox]);

    const updateSelectionBox = useCallback((box) => {
        const element = selectionBoxRef?.current;
        if (!element) return;
        element.style.display = 'block';
        element.style.left = `${box.left}px`;
        element.style.top = `${box.top}px`;
        element.style.width = `${box.width}px`;
        element.style.height = `${box.height}px`;
    }, [selectionBoxRef]);

    const updateElementSelection = useCallback(elements => {
        const nextElements = new Set(elements);
        for (const element of selectedElementsRef.current) {
            if (!nextElements.has(element)) element.classList.remove(selectedClassName);
        }
        for (const element of nextElements) {
            if (!selectedElementsRef.current.has(element)) element.classList.add(selectedClassName);
        }
        selectedElementsRef.current = nextElements;
    }, [selectedClassName]);

    const applySelection = useCallback(() => {
        frameRef.current = 0;
        const pointer = pointerRef.current;
        const state = stateRef.current;
        const container = getContainer?.();
        if (!pointer || !state?.active || !container) return;

        const left = Math.min(state.startX, pointer.clientX);
        const top = Math.min(state.startY, pointer.clientY);
        const right = Math.max(state.startX, pointer.clientX);
        const bottom = Math.max(state.startY, pointer.clientY);
        const moved = Math.abs(pointer.clientX - state.startX) > 3
            || Math.abs(pointer.clientY - state.startY) > 3;
        stateRef.current.moved = moved;
        if (!moved) return;

        const rect = container.getBoundingClientRect();
        updateSelectionBox({
            left: left - rect.left + container.scrollLeft,
            top: top - rect.top + container.scrollTop,
            width: right - left,
            height: bottom - top,
        });

        const selectedElements = Array.from(container.querySelectorAll(itemSelector))
            .filter(element => {
                const itemRect = element.getBoundingClientRect();
                return itemRect.right >= left
                    && itemRect.left <= right
                    && itemRect.bottom >= top
                    && itemRect.top <= bottom;
            });
        updateElementSelection(selectedElements);
        selectedPathsRef.current = selectedElements.map(itemPath).filter(Boolean);
    }, [getContainer, itemPath, itemSelector, stateRef, updateElementSelection, updateSelectionBox]);

    const update = useCallback(event => {
        const state = stateRef.current;
        if (!state?.active) return;
        const moved = Math.abs(event.clientX - state.startX) > 3
            || Math.abs(event.clientY - state.startY) > 3;
        if (moved) event.preventDefault();
        pointerRef.current = {
            clientX: event.clientX,
            clientY: event.clientY,
        };
        if (frameRef.current) return;
        frameRef.current = window.requestAnimationFrame(applySelection);
    }, [applySelection, stateRef]);

    const commit = useCallback(() => {
        if (frameRef.current) {
            window.cancelAnimationFrame(frameRef.current);
            applySelection();
        }
        hideSelectionBox();
        if (stateRef.current?.moved) onSelectPaths?.(selectedPathsRef.current);
    }, [applySelection, hideSelectionBox, onSelectPaths]);

    useEffect(() => cancel, [cancel]);

    return { begin, update, commit, cancel };
}
