export const shortcuts = {
    save: 'Mod-S', saveAs: 'Mod-Shift-S', export: 'Mod-Alt-E', inspect: 'Mod-Alt-V',
    importText: 'Mod-Alt-O', splitChapter: 'Mod-Enter', mergeChapters: 'Mod-Alt-Shift-M',
    undo: 'Mod-Z', redo: 'Mod-Shift-Z', bold: 'Mod-B', italic: 'Mod-I', underline: 'Mod-U', strike: 'Mod-Shift-X',
    paragraph: 'Mod-Alt-0', heading1: 'Mod-Alt-1', heading2: 'Mod-Alt-2', heading3: 'Mod-Alt-3',
    heading4: 'Mod-Alt-4', heading5: 'Mod-Alt-5', heading6: 'Mod-Alt-6', paragraphFormat: 'Mod-Alt-Shift-P',
    textStyles: 'Mod-Alt-Shift-T', textBackground: 'Mod-Alt-Shift-B', highlight: 'Mod-Alt-Shift-F',
    superscript: 'Mod-Alt-Shift-6', subscript: 'Mod-Alt-Shift-5', media: 'Mod-Alt-Shift-Y', specialCharacters: 'Mod-Alt-Shift-7', emoji: 'Mod-Alt-Shift-8',
    bulletList: 'Mod-Shift-8', orderedList: 'Mod-Shift-7', blockquote: 'Mod-Shift-B', codeBlock: 'Mod-Alt-C',
    left: 'Mod-Shift-L', center: 'Mod-Shift-E', right: 'Mod-Shift-R', justify: 'Mod-Shift-J',
    increaseIndent: 'Mod-]', decreaseIndent: 'Mod-[', firstLineIndent: 'Mod-Alt-Shift-I', hangingIndent: 'Mod-Alt-Shift-O', noFirstLineIndent: 'Mod-Alt-Shift-0', inheritFirstLineIndent: 'Mod-Alt-Shift-D',
    link: 'Mod-K', search: 'Mod-F', color: 'Mod-Alt-Shift-C', reset: 'Mod-Alt-X', horizontalRule: 'Mod-Alt-H', columns: 'Mod-Alt-D',
    addImage: 'Mod-Alt-I', addTable: 'Mod-Alt-T', footnote: 'Mod-Alt-N', addAudio: 'Mod-Alt-A',
    templates: 'Mod-Alt-Shift-L',
    paragraphFormats: 'Mod-Alt-Shift-G',
    addRowBefore: 'Mod-Alt-ArrowUp', addRowAfter: 'Mod-Alt-ArrowDown', addColumnBefore: 'Mod-Alt-ArrowLeft', addColumnAfter: 'Mod-Alt-ArrowRight',
    mergeCells: 'Mod-Alt-M', splitCell: 'Mod-Alt-P', selectCells: 'Mod-Alt-R',
    deleteRow: 'Mod-Alt-Backspace', deleteColumn: 'Mod-Alt-Delete', deleteTable: 'Mod-Alt-Shift-Delete',
    toggleHeaderRow: 'Mod-Alt-Shift-H', toggleHeaderColumn: 'Mod-Alt-Shift-J',
    commonCss: 'Mod-Alt-S', chapterCss: 'Mod-Alt-Shift-S', source: 'Mod-Alt-U', preview: 'Mod-Alt-W', previewViewer: 'Mod-Alt-Shift-W',
    shortcuts: 'Alt-0', toolbar: 'Alt-F10', focusMode: 'Mod-Shift-F',
};
export function shortcutLabel(command) {
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    return (shortcuts[command] || '').replace('Mod', mac ? '⌘' : 'Ctrl').replace('Alt', mac ? '⌥' : 'Alt').replace(/-/g, '+').replace(/Arrow/g, '');
}

export function matchesShortcut(event, shortcut) {
    const parts = shortcut.split('-');
    const key = parts.at(-1);
    return !!(event.metaKey || event.ctrlKey) === parts.includes('Mod') && event.altKey === parts.includes('Alt') && event.shiftKey === parts.includes('Shift') &&
        (event.code === ({ '[': 'BracketLeft', ']': 'BracketRight' }[key] || (key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key)) || event.key.toLowerCase() === key.toLowerCase());
}
