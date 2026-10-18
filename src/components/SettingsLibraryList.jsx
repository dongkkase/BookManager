import React from 'react';
import { FaIcon } from './FaIcon';
import { groupLibraryItems, libraryDisplayName } from '../libraryPresentation';
import { moveLibraryEntry, moveLibraryGroup } from '../settingsLibraryOrder';

export function SettingsLibraryList({ entries, selectedPath, onSelect, onRemove, onChange, t }) {
    const listRef = React.useRef(null);
    const dragRef = React.useRef(null);
    const [drag, setDrag] = React.useState(null);
    const [dropTarget, setDropTarget] = React.useState(null);
    const groups = groupLibraryItems(entries);
    const visibleGroups = drag?.type === 'entry' && !groups.some(group => group.key === '')
        ? [...groups, { key: '', label: '', items: [] }]
        : groups;

    const endDrag = () => {
        dragRef.current = null;
        setDrag(null);
        setDropTarget(null);
    };

    const startDrag = (event, source) => {
        event.stopPropagation();
        dragRef.current = source;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source.type === 'entry' ? source.path : source.group);
        const preview = event.currentTarget.closest(source.type === 'entry'
            ? '.settings-library-list-item'
            : '.settings-library-group-heading');
        if (preview) event.dataTransfer.setDragImage(preview, 12, preview.offsetHeight / 2);
        setDrag(source);
        setDropTarget(null);
        onSelect('');
    };

    const targetForEvent = (event, group, path) => {
        const source = dragRef.current;
        if (!source) return null;
        if (source.type === 'group' && source.group === group) return null;
        if (source.type === 'entry' && source.path === path) return null;
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        return source.type === 'group'
            ? { type: 'group', group, position }
            : { type: 'entry', group, targetPath: path, position: path ? position : 'after' };
    };

    const dragOver = (event, group, path) => {
        if (!dragRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        const target = targetForEvent(event, group, path);
        event.dataTransfer.dropEffect = target ? 'move' : 'none';
        setDropTarget(previous => JSON.stringify(previous) === JSON.stringify(target) ? previous : target);
    };

    const drop = (event, group, path) => {
        const source = dragRef.current;
        if (!source) return;
        event.preventDefault();
        event.stopPropagation();
        const target = targetForEvent(event, group, path);
        if (target) {
            onChange(current => source.type === 'group'
                ? moveLibraryGroup(current, source.group, target.group, target.position)
                : moveLibraryEntry(current, source.path, target));
        }
        endDrag();
    };

    const moveWithKeyboard = (event, source) => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        const position = direction < 0 ? 'before' : 'after';
        if (source.type === 'group') {
            const index = groups.findIndex(group => group.key === source.group);
            const target = groups[index + direction];
            if (!target) return;
            onChange(current => moveLibraryGroup(current, source.group, target.key, position));
        } else {
            const items = groups.flatMap(group => group.items);
            const index = items.findIndex(entry => entry.path === source.path);
            const target = items[index + direction];
            if (!target) return;
            onChange(current => moveLibraryEntry(current, source.path, {
                group: target.group || '', targetPath: target.path, position,
            }));
        }
        requestAnimationFrame(() => {
            const attribute = source.type === 'group' ? 'data-library-drag-group' : 'data-library-drag-path';
            const value = source.type === 'group' ? source.group : source.path;
            [...(listRef.current?.querySelectorAll(`[${attribute}]`) || [])]
                .find(button => button.getAttribute(attribute) === value)?.focus({ preventScroll: true });
        });
    };

    return (
        <div
            ref={listRef}
            className="settings-list settings-library-list"
            onDragEnd={endDrag}
            onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);
            }}
        >
            {entries.length === 0 ? (
                <div className="settings-empty-list">{t('tf_empty_no_data')}</div>
            ) : visibleGroups.map(group => {
                const groupName = group.label || t('settings_library_ungrouped');
                const groupDrop = dropTarget?.group === group.key && !dropTarget.targetPath;
                const groupDropClass = groupDrop
                    ? dropTarget.type === 'group' ? `drop-${dropTarget.position}` : 'drop-inside'
                    : '';
                return (
                    <section
                        key={group.key}
                        className={`settings-library-group ${groupDropClass} ${drag?.type === 'group' && drag.group === group.key ? 'is-dragging' : ''}`}
                        data-library-group={group.key}
                        aria-label={groupName}
                        onDragOver={event => dragOver(event, group.key)}
                        onDrop={event => drop(event, group.key)}
                    >
                        <div className="settings-library-group-heading">
                            <button
                                type="button"
                                className="settings-library-drag-handle settings-library-group-drag-handle"
                                data-library-drag-group={group.key}
                                draggable={group.items.length > 0}
                                disabled={group.items.length === 0}
                                aria-label={`${t('settings_library_drag_group')}: ${groupName}`}
                                title={t('settings_library_drag_hint')}
                                onDragStart={event => startDrag(event, { type: 'group', group: group.key })}
                                onKeyDown={event => moveWithKeyboard(event, { type: 'group', group: group.key })}
                            >
                                <FaIcon name="gripVertical" size={12} />
                            </button>
                            <h4 title={groupName}>{groupName}</h4>
                        </div>
                        {group.items.map(entry => (
                            <div
                                className={`settings-list-item settings-library-list-item ${selectedPath === entry.path ? 'active' : ''} ${drag?.type === 'entry' && drag.path === entry.path ? 'is-dragging' : ''} ${dropTarget?.targetPath === entry.path ? `drop-${dropTarget.position}` : ''}`}
                                key={entry.path}
                                data-library-path={entry.path}
                                onClick={() => onSelect(entry.path)}
                                onDragOver={event => {
                                    if (dragRef.current?.type === 'entry') dragOver(event, group.key, entry.path);
                                }}
                                onDrop={event => {
                                    if (dragRef.current?.type === 'entry') drop(event, group.key, entry.path);
                                }}
                            >
                                <button
                                    type="button"
                                    className="settings-library-drag-handle"
                                    data-library-drag-path={entry.path}
                                    draggable
                                    aria-label={`${t('settings_library_drag_folder')}: ${libraryDisplayName(entry.path, entry.alias)}`}
                                    title={t('settings_library_drag_hint')}
                                    onClick={event => event.stopPropagation()}
                                    onDragStart={event => startDrag(event, { type: 'entry', path: entry.path })}
                                    onKeyDown={event => moveWithKeyboard(event, { type: 'entry', path: entry.path })}
                                >
                                    <FaIcon name="gripVertical" size={12} />
                                </button>
                                <button
                                    type="button"
                                    className="settings-library-list-main settings-library-select"
                                    aria-pressed={selectedPath === entry.path}
                                    onClick={() => onSelect(entry.path)}
                                >
                                    <span className="settings-library-list-title" title={entry.path}>
                                        {libraryDisplayName(entry.path, entry.alias)}
                                    </span>
                                    <span className="settings-library-list-path" title={entry.path}>{entry.path}</span>
                                </button>
                                <button
                                    type="button"
                                    className="settings-library-remove"
                                    aria-label={t('btn_remove')}
                                    title={t('btn_remove')}
                                    onClick={event => {
                                        event.stopPropagation();
                                        onRemove(entry.path);
                                    }}
                                >
                                    <FaIcon name="trash" size={11} />
                                </button>
                            </div>
                        ))}
                        {group.items.length === 0 && (
                            <div className="settings-library-drop-empty">{t('settings_library_drop_ungrouped')}</div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}
