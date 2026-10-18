import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FOLDER_GROUP_KEYS,
  FOLDER_SORT_KEYS,
} from '../../folderToolbarState';
import { dropdownVerticalPlacement } from '../../interactionPolicy';
import { FaIcon } from '../FaIcon';
import MenuSurface from '../MenuSurface';

function toolbarDropdownLabel(label = '') {
  return String(label || '').replace(/\s*▼\s*$/u, '');
}

function Dropdown({ buttonClassName = '', buttonLabel, children, open, setOpen, menuClassName = '' }) {
  const ref = useRef(null);
  const menuRef = useRef(null);
  const [placement, setPlacement] = useState('down');
    const [horizontalOffset, setHorizontalOffset] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, setOpen]);

    useLayoutEffect(() => {
        if (!open || !ref.current || !menuRef.current) return;
        const triggerRect = ref.current.getBoundingClientRect();
        const panelRect = ref.current.closest('.folder-right-panel')?.getBoundingClientRect();
        const minLeft = Math.max(8, (panelRect?.left ?? 0) + 8);
        const maxRight = Math.min(window.innerWidth - 8, (panelRect?.right ?? window.innerWidth) - 8);
        menuRef.current.style.maxWidth = `${Math.max(0, maxRight - minLeft)}px`;
        setPlacement(dropdownVerticalPlacement(
            triggerRect,
            menuRef.current.offsetHeight,
            window.innerHeight,
        ));
        const left = Math.max(minLeft, Math.min(triggerRect.left, maxRight - menuRef.current.offsetWidth));
        setHorizontalOffset(left - triggerRect.left);
        menuRef.current.querySelector('button')?.focus();
    }, [open]);

  return (
    <div className="toolbar-dropdown" ref={ref}>
      <button
        className={`toolbar-btn ${buttonClassName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{toolbarDropdownLabel(buttonLabel)}</span>
        <FaIcon name="caret-down" size={9} />
      </button>
        <MenuSurface
            open={open}
            origin={placement === 'up' ? 'bottom left' : 'top left'}
          ref={menuRef}
          role="menu"
          className={`dropdown-menu dropdown-menu-${placement} ${menuClassName}`}
            style={{ left: horizontalOffset }}
        >
          {children}
        </MenuSurface>
    </div>
  );
}

function FolderToolbar({
  t,
  sortKey,
  sortOrder,
  onSort,
  onToggleSortOrder,
  groupKey,
  setGroupKey,
  metadataMissingOnly,
  setMetadataMissingOnly,
  savedLayouts = [],
  onEditLayout,
  onSaveLayout,
  onDeleteLayout,
  onApplyLayout,
  onExportCsv,
    children,
}) {
  const [openMenu, setOpenMenu] = useState('');
  const setMenu = menu => open => setOpenMenu(open ? menu : '');
    const runLayoutAction = (action, ...args) => {
        setOpenMenu('');
        action?.(...args);
    };
    const handleLayoutKeyDown = event => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    };

  const groupLabels = {
    none: t('menu_none'),
    folder_path: t('menu_folder'),
    ext: t('col_ext'),
    series: t('col_series'),
    author_series: `${t('col_writer')} + ${t('col_series')}`,
    title: t('col_title'),
    author: t('col_writer'),
    publisher: t('col_publisher'),
    genre: t('col_genre'),
  };
  const sortLabels = {
    name: t('col_name'),
    size: t('col_size'),
    modified: t('col_mtime'),
    ext: t('col_ext'),
    series: t('col_series'),
    title: t('col_title'),
    author: t('col_writer'),
  };

  return (
    <div className="folder-toolbar">
      <Dropdown
        buttonClassName={groupKey !== 'none' ? 'active' : ''}
        buttonLabel={t('folder_grouped')}
        open={openMenu === 'group'}
        setOpen={setMenu('group')}
      >
        {FOLDER_GROUP_KEYS.map(key => (
          <button
            key={key}
            className={`dropdown-item ${groupKey === key ? 'active' : ''}`}
            onClick={() => {
              setGroupKey(key);
              setOpenMenu('');
            }}
          >
            <span className="check-mark">{groupKey === key ? '✓' : ''}</span>
            {groupLabels[key]}
          </button>
        ))}
      </Dropdown>

      <Dropdown
        buttonClassName={metadataMissingOnly ? 'active' : ''}
        buttonLabel={t('folder_filter')}
        open={openMenu === 'filter'}
        setOpen={setMenu('filter')}
      >
        <button
          className={`dropdown-item ${metadataMissingOnly ? 'active' : ''}`}
          onClick={() => setMetadataMissingOnly(!metadataMissingOnly)}
        >
          <span className="check-mark">{metadataMissingOnly ? '✓' : ''}</span>
          {t('filter_no_meta')}
        </button>
      </Dropdown>

      <Dropdown
        buttonClassName={sortKey !== 'name' || sortOrder !== 'asc' ? 'active' : ''}
        buttonLabel={t('folder_sorted')}
        open={openMenu === 'sort'}
        setOpen={setMenu('sort')}
      >
        {FOLDER_SORT_KEYS.map(key => (
          <button
            key={key}
            className={`dropdown-item ${sortKey === key ? 'active' : ''}`}
            onClick={() => {
              onSort(key, false);
              setOpenMenu('');
            }}
          >
            <span className="check-mark">{sortKey === key ? '✓' : ''}</span>
            {sortLabels[key]}
          </button>
        ))}
        <div className="dropdown-separator" />
        <button className="dropdown-item" onClick={onToggleSortOrder}>
          <span className="check-mark">{sortOrder === 'asc' ? '↑' : '↓'}</span>
          {t('menu_toggle_order')}
        </button>
      </Dropdown>

      <Dropdown
        buttonLabel={t('folder_layouts')}
        open={openMenu === 'layout'}
        setOpen={setMenu('layout')}
        menuClassName="layout-menu"
      >
        <button type="button" role="menuitem" className="dropdown-item" onClick={() => runLayoutAction(onEditLayout)} onKeyDown={handleLayoutKeyDown}><span />{t('menu_edit_layout')}</button>
        <button type="button" role="menuitem" className="dropdown-item" onClick={() => runLayoutAction(onSaveLayout)} onKeyDown={handleLayoutKeyDown}><span />{t('menu_save_layout')}</button>
        {savedLayouts.length > 0 && <div className="dropdown-separator" />}
        {savedLayouts.map(name => (
            <div key={name} className="saved-layout-row" role="none" onKeyDown={handleLayoutKeyDown}>
                <button
                    type="button"
                    role="menuitem"
                    className="dropdown-item saved-layout-name"
                    title={name}
                    onClick={() => runLayoutAction(onApplyLayout, name)}
                >
                    <span />
                    <span>{name}</span>
                </button>
                <button
                    type="button"
                    role="menuitem"
                    className="saved-layout-action"
                    title={t('layout_edit_named', [name])}
                    aria-label={t('layout_edit_named', [name])}
                    onClick={() => runLayoutAction(onEditLayout, name)}
                >
                    <FaIcon name="pen" size={11} />
                </button>
                <button
                    type="button"
                    role="menuitem"
                    className="saved-layout-action saved-layout-delete"
                    title={t('layout_delete_named', [name])}
                    aria-label={t('layout_delete_named', [name])}
                    onClick={() => runLayoutAction(onDeleteLayout, name)}
                >
                    <FaIcon name="trash" size={11} />
                </button>
            </div>
        ))}
      </Dropdown>

        <button
            type="button"
            className="toolbar-btn csv-btn folder-toolbar-tooltip-btn"
            data-tooltip={t('folder.toolbar.export_csv_hint')}
            aria-description={t('folder.toolbar.export_csv_hint')}
            aria-label={t('folder_export_csv')}
            onClick={onExportCsv}
        >
            <span>CSV</span>
            <FaIcon name="download" size={11} />
        </button>
        {children}
    </div>
  );
}

export { FolderToolbar };
