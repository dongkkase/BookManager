import React, { useState } from 'react';
import {
  FOLDER_GROUP_KEYS,
  FOLDER_SORT_KEYS,
} from '../../folderToolbarState';
import { FaIcon } from '../FaIcon';
import ToolbarDropdown from './ToolbarDropdown';

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
      <ToolbarDropdown
        buttonClassName={groupKey !== 'none' ? 'active' : ''}
        buttonLabel={t('folder_grouped')}
        open={openMenu === 'group'}
        setOpen={setMenu('group')}
      >
        {FOLDER_GROUP_KEYS.map(key => (
          <button
            key={key}
            type="button"
            role="menuitemradio"
            tabIndex={-1}
            aria-checked={groupKey === key}
            className={`dropdown-item ${groupKey === key ? 'active' : ''}`}
            onClick={() => {
              setGroupKey(key);
              setOpenMenu('');
            }}
          >
            <span className="check-mark" aria-hidden="true">{groupKey === key ? '✓' : ''}</span>
            <span className="dropdown-item-label">{groupLabels[key]}</span>
          </button>
        ))}
      </ToolbarDropdown>

      <ToolbarDropdown
        buttonClassName={metadataMissingOnly ? 'active' : ''}
        buttonLabel={t('folder_filter')}
        open={openMenu === 'filter'}
        setOpen={setMenu('filter')}
      >
        <button
          type="button"
          role="menuitemcheckbox"
          tabIndex={-1}
          aria-checked={metadataMissingOnly}
          className={`dropdown-item ${metadataMissingOnly ? 'active' : ''}`}
          onClick={() => setMetadataMissingOnly(!metadataMissingOnly)}
        >
          <span className="check-mark" aria-hidden="true">{metadataMissingOnly ? '✓' : ''}</span>
          <span className="dropdown-item-label">{t('filter_no_meta')}</span>
        </button>
      </ToolbarDropdown>

      <ToolbarDropdown
        buttonClassName={sortKey !== 'name' || sortOrder !== 'asc' ? 'active' : ''}
        buttonLabel={t('folder_sorted')}
        open={openMenu === 'sort'}
        setOpen={setMenu('sort')}
      >
        {FOLDER_SORT_KEYS.map(key => (
          <button
            key={key}
            type="button"
            role="menuitemradio"
            tabIndex={-1}
            aria-checked={sortKey === key}
            className={`dropdown-item ${sortKey === key ? 'active' : ''}`}
            onClick={() => {
              onSort(key, false);
              setOpenMenu('');
            }}
          >
            <span className="check-mark" aria-hidden="true">{sortKey === key ? '✓' : ''}</span>
            <span className="dropdown-item-label">{sortLabels[key]}</span>
          </button>
        ))}
        <div className="dropdown-separator" />
        <button type="button" role="menuitem" tabIndex={-1} className="dropdown-item" onClick={onToggleSortOrder}>
          <span className="check-mark" aria-hidden="true">{sortOrder === 'asc' ? '↑' : '↓'}</span>
          <span className="dropdown-item-label">{t('menu_toggle_order')}</span>
        </button>
      </ToolbarDropdown>

      <ToolbarDropdown
        buttonLabel={t('folder_layouts')}
        open={openMenu === 'layout'}
        setOpen={setMenu('layout')}
        menuClassName="layout-menu"
      >
        <button type="button" role="menuitem" tabIndex={-1} className="dropdown-item" onClick={() => runLayoutAction(onEditLayout)}><span aria-hidden="true" /><span className="dropdown-item-label">{t('menu_edit_layout')}</span></button>
        <button type="button" role="menuitem" tabIndex={-1} className="dropdown-item" onClick={() => runLayoutAction(onSaveLayout)}><span aria-hidden="true" /><span className="dropdown-item-label">{t('menu_save_layout')}</span></button>
        {savedLayouts.length > 0 && <div className="dropdown-separator" />}
        {savedLayouts.map(name => (
            <div key={name} className="saved-layout-row" role="none">
                <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="dropdown-item saved-layout-name"
                    title={name}
                    onClick={() => runLayoutAction(onApplyLayout, name)}
                >
                    <span aria-hidden="true" />
                    <span className="dropdown-item-label">{name}</span>
                </button>
                <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
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
                    tabIndex={-1}
                    className="saved-layout-action saved-layout-delete"
                    title={t('layout_delete_named', [name])}
                    aria-label={t('layout_delete_named', [name])}
                    onClick={() => runLayoutAction(onDeleteLayout, name)}
                >
                    <FaIcon name="trash" size={11} />
                </button>
            </div>
        ))}
      </ToolbarDropdown>

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
