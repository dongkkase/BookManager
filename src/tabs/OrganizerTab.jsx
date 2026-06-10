import React from 'react';

/**
 * Organizer 탭 컴포넌트
 * 코믹 파일 정리/구성 기능
 * 기존 PyQt6 Tab1Organizer와 동일한 구조
 */
function OrganizerTab({ config, t }) {
  const [fileList, setFileList] = React.useState([]);
  const [selectedItems, setSelectedItems] = React.useState(new Set());

  const handleAddFolder = async () => {
    if (window.electronAPI && window.electronAPI.dialog) {
      const folder = await window.electronAPI.dialog.selectFolder();
      if (folder) {
        // TODO: 폴더 내 파일 스캔 및 트리에 추가
        console.log('폴더 추가:', folder);
      }
    }
  };

  const handleAddFile = async () => {
    if (window.electronAPI && window.electronAPI.dialog) {
      const files = await window.electronAPI.dialog.selectFiles();
      if (files && files.length > 0) {
        // TODO: 파일 스캔 및 트리에 추가
        console.log('파일 추가:', files);
      }
    }
  };

  const handleRemoveSelected = () => {
    // TODO: 선택된 항목 제거
    setSelectedItems(new Set());
  };

  const handleClearAll = () => {
    setFileList([]);
    setSelectedItems(new Set());
  };

  const handleToggleAll = () => {
    if (selectedItems.size === fileList.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(fileList.map((_, i) => i)));
    }
  };

  return (
    <div className="tab-content organizer-tab">
      <div className="toolbar">
        <button className="toolbar-button" onClick={handleAddFolder}>
          <span className="icon">📁</span>
          <span>{t('organizer.add_folder') || '폴더 추가'}</span>
        </button>
        <button className="toolbar-button" onClick={handleAddFile}>
          <span className="icon">📄</span>
          <span>{t('organizer.add_file') || '파일 추가'}</span>
        </button>
        <div className="toolbar-separator" />
        <button className="toolbar-button" onClick={handleToggleAll}>
          <span className="icon">☑️</span>
          <span>{t('organizer.toggle_all') || '전체 체크/해제'}</span>
        </button>
        <button className="toolbar-button" onClick={handleRemoveSelected}>
          <span className="icon">🗑️</span>
          <span>{t('organizer.remove_selected') || '선택 삭제'}</span>
        </button>
        <button className="toolbar-button" onClick={handleClearAll}>
          <span className="icon">❌</span>
          <span>{t('organizer.clear_all') || '전체 삭제'}</span>
        </button>
        <div className="toolbar-spacer" />
        <span className="file-count">
          {t('organizer.count') || '개수'}: {fileList.length}
        </span>
      </div>

      <div className="file-tree-container">
        {fileList.length === 0 ? (
          <div className="empty-state">
            <img src="/draganddrop1.png" alt="Drag and Drop" className="empty-image" />
            <p>{t('organizer.drag_drop') || '파일이나 폴더를 여기에 드래그 앤 드롭하세요'}</p>
          </div>
        ) : (
          <div className="file-tree">
            {fileList.map((file, index) => (
              <div
                key={index}
                className={`tree-item ${selectedItems.has(index) ? 'selected' : ''}`}
                onClick={() => {
                  const newSelected = new Set(selectedItems);
                  if (newSelected.has(index)) {
                    newSelected.delete(index);
                  } else {
                    newSelected.add(index);
                  }
                  setSelectedItems(newSelected);
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedItems.has(index)}
                  onChange={() => {}}
                />
                <span className="file-name">{file.name}</span>
                <span className="file-path">{file.path}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default OrganizerTab;
