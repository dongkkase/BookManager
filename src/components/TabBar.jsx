import React from 'react';

/**
 * 탭 바 컴포넌트
 * 기존 PyQt6 QTabWidget과 동일한 구조
 */
function TabBar({ tabs, activeTab, onTabChange, disabled = false, releaseNotice, t }) {
  return (
    <div className="tab-bar-container">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab-item ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          disabled={disabled}
          data-tab={tab.id}
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
