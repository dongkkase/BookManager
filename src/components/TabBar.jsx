import React, { useEffect, useRef, useState } from 'react';
import { canAcceptTabDrop, isFilePathDrag } from '../appShell';

/**
 * 탭 바 컴포넌트
 * 기존 PyQt6 QTabWidget과 동일한 구조
 */
function TabBar({ tabs, activeTab, onTabChange, onTabDrop, disabled = false, releaseNotice, t }) {
  const [dragHoverTab, setDragHoverTab] = useState('');
  const hoverTimerRef = useRef(null);

  const clearDragHover = () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setDragHoverTab('');
  };

  useEffect(() => clearDragHover, []);

  const handleDragOver = (event, tabId) => {
    if (disabled || !canAcceptTabDrop(tabId) || !isFilePathDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (dragHoverTab === tabId) return;
    clearDragHover();
    setDragHoverTab(tabId);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      onTabChange(tabId);
    }, 350);
  };

  const handleDrop = (event, tabId) => {
    if (disabled || !canAcceptTabDrop(tabId) || !isFilePathDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    clearDragHover();
    onTabDrop?.(tabId, event.dataTransfer);
  };

  return (
    <div className="tab-bar-container">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab-item ${activeTab === tab.id ? 'active' : ''} ${dragHoverTab === tab.id ? 'drag-hover' : ''}`.trim()}
          onClick={() => onTabChange(tab.id)}
          disabled={disabled}
          data-tab={tab.id}
          onDragEnter={(event) => handleDragOver(event, tab.id)}
          onDragOver={(event) => handleDragOver(event, tab.id)}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) clearDragHover();
          }}
          onDrop={(event) => handleDrop(event, tab.id)}
          title={tab.id === 'releases' && releaseNotice ? t('release_new_notice', [releaseNotice.date]) : undefined}
        >
          {tab.label}
          {tab.id === 'releases' && releaseNotice && (
              <span className="release-new-badge" aria-label={t('release_new_notice', [releaseNotice.date])}>NEW</span>
          )}
        </button>
      ))}
    </div>
  );
}

export { TabBar };
export default TabBar;
