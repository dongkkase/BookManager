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
    faUpRightAndDownLeftFromCenter,
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
    search: faMagnifyingGlass, shortcuts: faKeyboard, toolbar: faSliders, focusMode: faPen,
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
    imageProperties: faSliders, audioProperties: faSliders, cellProperties: faSliders,
    imageSize: faUpRightAndDownLeftFromCenter, imageEdit: faImage,
    tableRows: faTableColumns, tableColumns: faTableColumns,
    paragraphBefore: faArrowUp, paragraphAfter: faArrowDown,
};
const insertCommands = new Set(['addRowBefore', 'addRowAfter', 'addColumnBefore', 'addColumnAfter']);
const imageAlignments = { imageleft: 2, imagecenter: 7, imageright: 12 };

function ImageLayoutIcon({ command }) {
    const aligned = Object.hasOwn(imageAlignments, command);
    const textLeft = command === 'imageTextLeft';
    const x = aligned ? imageAlignments[command] : textLeft ? 14 : 2;
    const lines = aligned ? 'M2 3h20M2 21h20' : textLeft ? 'M2 5h8M2 10h8M2 15h8M2 21h20' : 'M14 5h8M14 10h8M14 15h8M2 21h20';
    return <span className="ee-command-icon ee-image-layout-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor">
        <path d={lines} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <svg x={x} y={aligned ? 7 : 5} width={aligned ? 10 : 8} height={aligned ? 10 : 11} viewBox={`0 0 ${faImage.icon[0]} ${faImage.icon[1]}`}><path d={faImage.icon[4]} /></svg>
    </svg></span>;
}

export default function EditorIcon({ command }) {
    if (Object.hasOwn(imageAlignments, command) || ['imageTextLeft', 'imageTextRight'].includes(command)) return <ImageLayoutIcon command={command} />;
    if (command === 'imageAlt') return <span className="ee-command-icon" aria-hidden="true"><span className="ee-image-alt-icon">ALT</span></span>;
    const icon = icons[command];
    if (!icon) return null;
    const modifier = command === 'imageEdit' ? faPen : insertCommands.has(command) ? faPlus : ['deleteRow', 'deleteColumn'].includes(command) ? faMinus : null;
    return <span className={`ee-command-icon${modifier ? ' has-modifier' : ''}`} aria-hidden="true">
        <FontAwesomeIcon icon={icon} rotation={['deleteRow', 'toggleHeaderRow', 'tableRows'].includes(command) ? 90 : undefined} />
        {['color', 'textBackground'].includes(command) && <span className="ee-color-underline" />}
        {modifier && <FontAwesomeIcon icon={modifier} className="ee-icon-modifier" />}
    </span>;
}
