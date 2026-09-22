import React, { useState } from 'react';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import EditorDialog from './EditorDialog';
import { editorText as l } from './labels';

export const tableCommands = ['addRowBefore', 'addRowAfter', 'addColumnBefore', 'addColumnAfter', 'deleteRow', 'deleteColumn', 'mergeCells', 'splitCell', 'toggleHeaderRow', 'toggleHeaderColumn', 'deleteTable'];

export function tableContext(editor) {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type.name === 'table') return { node: $from.node(depth), start: $from.start(depth), map: TableMap.get($from.node(depth)) };
    }
    return null;
}

export function selectTableRange(editor, fromRow, fromCol, toRow, toCol) {
    const context = tableContext(editor);
    if (!context) return false;
    const { map, start } = context;
    if (![fromRow, fromCol, toRow, toCol].every(Number.isInteger) || Math.min(fromRow, fromCol, toRow, toCol) < 1 || Math.max(fromRow, toRow) > map.height || Math.max(fromCol, toCol) > map.width) return false;
    const anchor = start + map.map[(fromRow - 1) * map.width + fromCol - 1];
    const head = start + map.map[(toRow - 1) * map.width + toCol - 1];
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, anchor, head)));
    return true;
}

export function TablePicker({ onInsert, onClose }) {
    const [rows, setRows] = useState(3);
    const [cols, setCols] = useState(3);
    const [header, setHeader] = useState(true);
    const [hoverSize, setHoverSize] = useState(null);
    const valid = Number.isInteger(rows) && Number.isInteger(cols) && rows >= 1 && rows <= 30 && cols >= 1 && cols <= 20;
    const gridRow = Math.max(1, Math.min(8, Math.trunc(rows)));
    const gridCol = Math.max(1, Math.min(8, Math.trunc(cols)));
    return <EditorDialog title={l('addTable')} onClose={onClose} onSubmit={event => { event.preventDefault(); if (valid) onInsert(rows, cols, header); }} footer={<>
        <div className="ee-number-pair"><label>{l('rows')}<input type="number" min="1" max="30" value={rows} onChange={event => setRows(Number(event.target.value))} /></label><label>{l('columnsCount')}<input type="number" min="1" max="20" value={cols} onChange={event => setCols(Number(event.target.value))} /></label></div>
        <label className="ee-check"><input type="checkbox" checked={header} onChange={event => setHeader(event.target.checked)} />{l('headerRow')}</label>
        <button className="ee-button ee-primary" disabled={!valid}>{l('addTable')} · {rows} × {cols}</button>
    </>}>
        <p className="ee-muted">{l('tablePickerHint')}</p>
        <div className="ee-table-grid" aria-label={l('tableSize')} onMouseLeave={() => setHoverSize(null)}>
            {Array.from({ length: 64 }, (_, index) => {
                const row = Math.floor(index / 8) + 1;
                const col = index % 8 + 1;
                return <button type="button" key={index} tabIndex={index === (gridRow - 1) * 8 + gridCol - 1 ? 0 : -1} className={row <= (hoverSize?.[0] ?? rows) && col <= (hoverSize?.[1] ?? cols) ? 'is-selected' : ''} aria-label={`${row} ${l('rows')} × ${col} ${l('columnsCount')}`} onMouseEnter={() => setHoverSize([row, col])} onFocus={() => { setHoverSize(null); setRows(row); setCols(col); }} onKeyDown={event => {
                    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
                    if (step) {
                        event.preventDefault();
                        const nextRow = Math.max(1, Math.min(8, row + step[0]));
                        const nextCol = Math.max(1, Math.min(8, col + step[1]));
                        event.currentTarget.parentElement.children[(nextRow - 1) * 8 + nextCol - 1].focus();
                    }
                }} onClick={() => onInsert(row, col, header)} />;
            })}
        </div>
    </EditorDialog>;
}

export function TableRangeDialog({ editor, onClose }) {
    const context = tableContext(editor);
    const [range, setRange] = useState([1, 1, 1, Math.min(2, context?.map.width || 1)]);
    if (!context) return null;
    const valid = range.every((value, index) => Number.isInteger(value) && value >= 1 && value <= (index % 2 ? context.map.width : context.map.height));
    return <EditorDialog title={l('selectCells')} onClose={onClose} onSubmit={event => { event.preventDefault(); if (valid && selectTableRange(editor, ...range)) onClose(); }} footer={<>
        <button className="ee-button ee-primary" disabled={!valid}>{l('selectCells')}</button>
    </>}>
        <p className="ee-muted">{l('tableSelectionHint')}</p>
        <div className="ee-number-pair">{['fromRow', 'fromColumn', 'toRow', 'toColumn'].map((key, index) => <label key={key}>{l(key)}<input type="number" min="1" max={index % 2 ? context.map.width : context.map.height} value={range[index]} onChange={event => setRange(values => values.map((value, i) => i === index ? Number(event.target.value) : value))} /></label>)}</div>
    </EditorDialog>;
}
