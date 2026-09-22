import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faFileImport, faScissors, faLayerGroup, faIndent, faOutdent,
    faBold, faItalic, faUnderline, faStrikethrough,
    faAlignLeft, faAlignCenter, faAlignRight, faAlignJustify,
    faListUl, faListOl, faQuoteLeft, faEraser, faCode,
    faImage, faTableCells, faTableColumns, faSuperscript, faMusic,
    faLink, faMinus, faPlus, faKeyboard, faObjectGroup, faObjectUngroup,
    faArrowUp, faArrowDown, faArrowLeft, faArrowRight,
    faRotateLeft, faRotateRight, faHeading, faParagraph,
    faFileCode, faEye, faFloppyDisk, faCopy, faDownload,
    faCircleCheck, faMagnifyingGlass, faTrash, faBorderAll,
    faPen, faSliders, faPalette, faLinkSlash, faRepeat,
    faMobileScreenButton, faTabletScreenButton, faDesktop, faBookOpen, faFont,
    faSubscript, faHighlighter, faFillDrip, faVideo, faFaceSmile, faSection, faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';

const icons = {
    importText: faFileImport, splitChapter: faScissors, mergeChapters: faLayerGroup,
    increaseIndent: faIndent, decreaseIndent: faOutdent, firstLineIndent: faIndent, hangingIndent: faOutdent, noFirstLineIndent: faAlignLeft, inheritFirstLineIndent: faRotateLeft,
    undo: faRotateLeft, redo: faRotateRight,
    bold: faBold, italic: faItalic, underline: faUnderline, strike: faStrikethrough,
    color: faFont,
    textBackground: faFillDrip, highlight: faHighlighter, superscript: faSuperscript, subscript: faSubscript,
    paragraphFormat: faParagraph, textStyles: faPalette, heading4: faHeading, heading5: faHeading, heading6: faHeading,
    paragraphFormats: faSliders, paragraphFormatCreate: faPlus,
    media: faVideo, editMedia: faPen, openMedia: faArrowUpRightFromSquare, specialCharacters: faSection, emoji: faFaceSmile,
    paragraph: faParagraph, heading1: faHeading, heading2: faHeading, heading3: faHeading,
    left: faAlignLeft, center: faAlignCenter, right: faAlignRight, justify: faAlignJustify,
    bulletList: faListUl, orderedList: faListOl, blockquote: faQuoteLeft,
    codeBlock: faCode, reset: faEraser, horizontalRule: faMinus,
    addImage: faImage, addTable: faTableCells, footnote: faSuperscript,
    addAudio: faMusic, link: faLink, columns: faTableColumns,
    templates: faObjectGroup,
    search: faMagnifyingGlass, shortcuts: faKeyboard, toolbar: faSliders,
    selectCells: faBorderAll, mergeCells: faObjectGroup, splitCell: faObjectUngroup,
    addRowBefore: faArrowUp, addRowAfter: faArrowDown,
    addColumnBefore: faArrowLeft, addColumnAfter: faArrowRight,
    deleteRow: faTableColumns, deleteColumn: faTableColumns, deleteTable: faTrash,
    toggleHeaderRow: faTableColumns, toggleHeaderColumn: faTableColumns,
    save: faFloppyDisk, saveAs: faCopy, export: faDownload, inspect: faCircleCheck,
    commonCss: faPalette, chapterCss: faFileCode, source: faCode, preview: faEye, previewViewer: faBookOpen,
    write: faPen, design: faSliders,
    narrow: faMobileScreenButton, medium: faTabletScreenButton, wide: faDesktop,
    editLink: faPen, unlink: faLinkSlash, remove: faTrash, loop: faRepeat,
    imageleft: faAlignLeft, imagecenter: faAlignCenter, imageright: faAlignRight,
    imageProperties: faSliders, audioProperties: faSliders, cellProperties: faSliders,
    tableRows: faTableColumns, tableColumns: faTableColumns,
    paragraphBefore: faArrowUp, paragraphAfter: faArrowDown,
};
const insertCommands = new Set(['addRowBefore', 'addRowAfter', 'addColumnBefore', 'addColumnAfter']);

export default function EditorIcon({ command }) {
    const icon = icons[command];
    if (!icon) return null;
    const modifier = insertCommands.has(command) ? faPlus : ['deleteRow', 'deleteColumn'].includes(command) ? faMinus : null;
    return <span className={`ee-command-icon${modifier ? ' has-modifier' : ''}`} aria-hidden="true">
        <FontAwesomeIcon icon={icon} rotation={['deleteRow', 'toggleHeaderRow', 'tableRows'].includes(command) ? 90 : undefined} />
        {['color', 'textBackground'].includes(command) && <span className="ee-color-underline" />}
        {modifier && <FontAwesomeIcon icon={modifier} className="ee-icon-modifier" />}
    </span>;
}
