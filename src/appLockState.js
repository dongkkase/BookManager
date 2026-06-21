import { isTaskActive } from './statusState.js';

const LIBRARY_SCAN_TASKS = new Set(['folder:updateIndex']);

export function resolveEffectiveWorkingTab(workingTab, statusStates = {}, activeTab = '') {
    if (workingTab) return workingTab;
    if (activeTab && isTaskActive(statusStates[activeTab]?.phase)) return activeTab;
    return Object.entries(statusStates)
        .find(([, state]) => isTaskActive(state?.phase))?.[0] || null;
}

export function shouldUseLibraryScanSlide(effectiveWorkingTab, status = {}) {
    return effectiveWorkingTab === 'folder'
        && isTaskActive(status?.phase)
        && (
            status?.display === 'library-slide'
            || LIBRARY_SCAN_TASKS.has(status?.task)
        );
}

export function isLibraryIndexingPhase(status = {}) {
    return status?.libraryPhase === 'indexing'
        && status?.libraryTaskMode !== 'metadata';
}

export function shouldCollectLibraryScanSlideItem(tabId, status = {}) {
    return tabId === 'folder'
        && shouldUseLibraryScanSlide('folder', status)
        && !isLibraryIndexingPhase(status)
        && status?.slideItemReady === true
        && Boolean(status?.currentItem || status?.currentItemName);
}
