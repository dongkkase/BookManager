import React from 'react';

/**
 * Metadata 탭 컴포넌트
 * 메타데이터 편집 기능
 * 기존 PyQt6 Tab3Metadata와 동일한 구조
 */
function MetadataTab({ config, t }) {
  const [fileList, setFileList] = React.useState([]);
  const [selectedFile, setSelectedFile] = React.useState(null);

  const handleAddFile = async () => {
    if (window.electronAPI && window.electronAPI.dialog) {
      const files = await window.electronAPI.dialog.selectFiles();
      if (files && files.length > 0) {
        console.log('메타데이터 파일 추가:', files);
      }
    }
  };

  const handleRemoveSelected = () => {
    setSelectedFile(null);
  };

  const handleClearAll = () => {
    setFileList([]);
    setSelectedFile(null);
  };

  return (
    <div className="tab-content metadata-tab">
      <div className="toolbar">
        <button className="toolbar-button" onClick={handleAddFile}>
          <span className="icon">📄</span>
          <span>{t('metadata.add_file') || '파일 추가'}</span>
        </button>
        <div className="toolbar-separator" />
        <button className="toolbar-button" onClick={handleRemoveSelected}>
          <span className="icon">🗑️</span>
          <span>{t('metadata.remove') || '제거'}</span>
        </button>
        <button className="toolbar-button" onClick={handleClearAll}>
          <span className="icon">❌</span>
          <span>{t('metadata.clear_all') || '전체 삭제'}</span>
        </button>
        <div className="toolbar-spacer" />
      </div>

      <div className="metadata-content">
        <div className="metadata-file-list">
          {fileList.length === 0 ? (
            <div className="empty-state">
              <p>{t('metadata.no_files') || '메타데이터를 편집할 파일을 추가하세요'}</p>
            </div>
          ) : (
            fileList.map((file, index) => (
              <div
                key={index}
                className={`metadata-file-item ${selectedFile === index ? 'selected' : ''}`}
                onClick={() => setSelectedFile(index)}
              >
                <span className="file-name">{file.name}</span>
              </div>
            ))
          )}
        </div>

        <div className="metadata-editor">
          {selectedFile !== null ? (
            <div className="metadata-fields">
              <div className="field-row">
                <label className="field-label">Title</label>
                <input type="text" className="field-input" />
              </div>
              <div className="field-row">
                <label className="field-label">Series</label>
                <input type="text" className="field-input" />
              </div>
              <div className="field-row">
                <label className="field-label">Number</label>
                <input type="text" className="field-input" />
              </div>
              <div className="field-row">
                <label className="field-label">Creator</label>
                <input type="text" className="field-input" />
              </div>
              <div className="field-row">
                <label className="field-label">Publisher</label>
                <input type="text" className="field-input" />
              </div>
              <div className="field-row">
                <label className="field-label">Date</label>
                <input type="date" className="field-input" />
              </div>
              <div className="field-row">
                <label className="field-label">Comments</label>
                <textarea className="field-textarea" rows={4} />
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>{t('metadata.select_file') || '편집할 파일을 선택하세요'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MetadataTab;
