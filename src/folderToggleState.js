export function folderToggleLabelKey(type, checked) {
    if (type === 'subfolders') {
        return checked ? 'folder_inc_sub_on' : 'folder_inc_sub_off';
    }
    if (type === 'duplicates') {
        return checked ? 'folder_dup_check_on' : 'folder_dup_check_off';
    }
    return '';
}

export function shouldDisableFolderToggles(scanning, preparingDuplicates) {
    return Boolean(scanning || preparingDuplicates);
}
