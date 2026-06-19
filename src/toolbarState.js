export function createToolbarState(items = [], isChecked = item => Boolean(item?.checked)) {
    const totalCount = items.length;
    const checkedCount = items.filter(isChecked).length;

    return {
        totalCount,
        checkedCount,
        hasItems: totalCount > 0,
        allChecked: totalCount === 0 || checkedCount === totalCount,
    };
}

export function emitToolbarState(tabId, state) {
    window.dispatchEvent(new CustomEvent('bookmanager:toolbar-state', {
        detail: { tabId, ...state },
    }));
}
