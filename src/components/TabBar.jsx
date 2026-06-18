import React from 'react';

/**
 * 탭 바 컴포넌트
 * 기존 PyQt6 QTabWidget과 동일한 구조
 */
function TabBar({ tabs, activeTab, onTabChange, disabled = false }) {
  return (
    <div className="tab-bar-container">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab-item ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          disabled={disabled}
          data-tab={tab.id}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export { TabBar };
export default TabBar;
