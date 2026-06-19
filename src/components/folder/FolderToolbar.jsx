import React, { useEffect, useRef, useState } from 'react';
import {
  FOLDER_GROUP_KEYS,
  FOLDER_SORT_KEYS,
} from '../../folderToolbarState';
import { dropdownVerticalPlacement } from '../../interactionPolicy';

function Dropdown({ buttonClassName = '', buttonLabel, children, open, setOpen, menuClassName = '' }) {
  const ref = useRef(null);
  const menuRef = useRef(null);
  const [placement, setPlacement] = useState('down');

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

  useEffect(() => {
    if (!open || !ref.current || !menuRef.current) return;
    setPlacement(dropdownVerticalPlacement(
      ref.current.getBoundingClientRect(),
      menuRef.current.offsetHeight,
      window.innerHeight,
    ));
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
        {buttonLabel}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={`dropdown-menu dropdown-menu-${placement} ${menuClassName}`}
        >
          {children}
        </div>
      )}
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
}) {
  const [openMenu, setOpenMenu] = useState('');
  const setMenu = menu => open => setOpenMenu(open ? menu : '');

  const groupLabels = {
    none: '없음',
    folder_path: t('menu_folder'),
    ext: t('col_ext'),
    series: t('col_series'),
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
      >
        <button className="dropdown-item" onClick={onEditLayout}><span />{t('menu_edit_layout')}</button>
        <button className="dropdown-item" onClick={onSaveLayout}><span />{t('menu_save_layout')}</button>
        <button className="dropdown-item" onClick={onDeleteLayout}><span />{t('menu_del_layout')}</button>
        {savedLayouts.length > 0 && <div className="dropdown-separator" />}
        {savedLayouts.map(name => (
          <button key={name} className="dropdown-item" onClick={() => onApplyLayout(name)}>
            <span />
            {name}
          </button>
        ))}
      </Dropdown>

      <button className="toolbar-btn csv-btn" onClick={onExportCsv}>{t('folder_export_csv')}</button>
    </div>
  );
}

export { FolderToolbar };
