import React from 'react';

/**
 * Renamer 탭 컴포넌트
 * 파일 이름 변경 기능
 * 기존 PyQt6 Tab2Renamer와 동일한 구조
 */
function RenamerTab({ config, t }) {
  const [fileList, setFileList] = React.useState([]);
  const [selectedItems, setSelectedItems] = React.useState(new Set());

  const handleAddFolder = async () => {
    if (window.electronAPI && window.electronAPI.dialog) {
      const folder = await window.electronAPI.dialog.selectFolder();
      if (folder) {
        console.log('리네이머 폴더 추가:', folder);
      }
    }
  };

  const handleAddFile = async () => {
    if (window.electronAPI && window.electronAPI.dialog) {
      const files = await window.electronAPI.dialog.selectFiles();
      if (files && files.length > 0) {
        console.log('리네이머 파일 추가:', files);
      }
    }
  };

  const handleRemoveSelected = () => {
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
    <div className="tab-content renamer-tab">
      <div className="toolbar">
        <button className="toolbar-button" onClick={handleAddFolder}>
          <span className="icon">📁</span>
          <span>{t('renamer.add_folder') || '폴더 추가'}</span>
        </button>
        <button className="toolbar-button" onClick={handleAddFile}>
          <span className="icon">📄</span>
          <span>{t('renamer.add_file') || '파일 추가'}</span>
        </button>
        <div className="toolbar-separator" />
        <button className="toolbar-button" onClick={handleToggleAll}>
          <span className="icon">☑️</span>
          <span>{t('renamer.toggle_all') || '전체 체크/해제'}</span>
        </button>
        <button className="toolbar-button" onClick={handleRemoveSelected}>
          <span className="icon">🗑️</span>
          <span>{t('renamer.remove_selected') || '선택 삭제'}</span>
        </button>
        <button className="toolbar-button" onClick={handleClearAll}>
          <span className="icon">❌</span>
          <span>{t('renamer.clear_all') || '전체 삭제'}</span>
        </button>
        <div className="toolbar-spacer" />
        <span className="file-count">
          {t('renamer.count') || '개수'}: {fileList.length}
        </span>
      </div>

      <div className="file-list-container">
        {fileList.length === 0 ? (
          <div className="empty-state">
            <img src="/draganddrop2.png" alt="Drag and Drop" className="empty-image" />
            <p>{t('renamer.drag_drop') || '리네이밍할 파일을 드래그 앤 드롭하세요'}</p>
          </div>
        ) : (
          <div className="file-list">
            {fileList.map((file, index) => (
              <div
                key={index}
                className={`list-item ${selectedItems.has(index) ? 'selected' : ''}`}
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
                <span className="original-name">{file.originalName}</span>
                <span className="arrow">→</span>
                <span className="new-name">{file.newName}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { RenamerTab };
export default RenamerTab;
