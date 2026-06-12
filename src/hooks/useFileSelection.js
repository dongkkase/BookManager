import { useState, useCallback, useRef } from 'react';

/**
 * 파일 선택 상태 관리 훅
 * 
 * 파일 목록에서의 선택 상태를 관리하며,
 * 단일 선택, 다중 선택(Ctrl+클릭), 범위 선택(Shift+클릭)을 지원합니다.
 * 
 * 반환값:
 * - selectedFiles: 선택된 파일 경로 목록
 * - selectedFileData: 선택된 파일 데이터 (단일 선택 시 첫 번째 파일)
 * - lastSelectedIndex: 마지막으로 선택한 파일 인덱스
 * - selectFile: 단일 파일 선택
 * - toggleFile: 파일 선택 토글 (다중 선택용)
 * - rangeSelect: 범위 선택 (Shift+클릭용)
 * - clearSelection: 선택 초기화
 * - selectAll: 전체 선택
 * - deselectAll: 전체 선택 해제
 * - isInSelectionRange: 선택 범위 내 여부 확인
 */
export function useFileSelection(fileData = []) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(-1);
  const selectionStartRef = useRef(null);

  // --- 선택된 파일 데이터 가져오기 ---
  const selectedFileData = useCallback(() => {
    if (selectedFiles.length === 0) return null;
    const firstSelectedPath = selectedFiles[0];
    return fileData.find(file => file.path === firstSelectedPath) || null;
  }, [selectedFiles, fileData]);

  // --- 단일 파일 선택 ---
  const selectFile = useCallback((filePath, fileDataItem, index) => {
    setSelectedFiles([filePath]);
    setLastSelectedIndex(index !== undefined ? index : -1);
    selectionStartRef.current = { path: filePath, index };
  }, []);

  // --- 파일 선택 토글 (Ctrl+클릭) ---
  const toggleFile = useCallback((filePath, fileDataItem, index) => {
    setSelectedFiles(prev => {
      const exists = prev.includes(filePath);
      if (exists) {
        return prev.filter(path => path !== filePath);
      } else {
        return [...prev, filePath];
      }
    });
    setLastSelectedIndex(index !== undefined ? index : -1);
    selectionStartRef.current = { path: filePath, index };
  }, []);

  // --- 범위 선택 (Shift+클릭) ---
  const rangeSelect = useCallback((filePath, fileDataItem, index) => {
    if (selectionStartRef.current === null || index === undefined) {
      selectFile(filePath, fileDataItem, index);
      return;
    }

    const startIndex = selectionStartRef.current.index;
    const endIndex = index;

    let start, end;
    if (startIndex <= endIndex) {
      start = startIndex;
      end = endIndex;
    } else {
      start = endIndex;
      end = startIndex;
    }

    const newSelection = [];
    for (let i = start; i <= end; i++) {
      const file = fileData[i];
      if (file && file.path) {
        newSelection.push(file.path);
      }
    }

    setSelectedFiles(newSelection);
    setLastSelectedIndex(index);
  }, [fileData, selectFile]);

  // --- 선택 초기화 ---
  const clearSelection = useCallback(() => {
    setSelectedFiles([]);
    setLastSelectedIndex(-1);
    selectionStartRef.current = null;
  }, []);

  // --- 전체 선택 ---
  const selectAll = useCallback(() => {
    const allPaths = fileData.map(file => file.path).filter(Boolean);
    setSelectedFiles(allPaths);
  }, [fileData]);

  // --- 전체 선택 해제 ---
  const deselectAll = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // --- 선택 범위 내 여부 확인 ---
  const isInSelectionRange = useCallback((index) => {
    if (selectionStartRef.current === null) return false;
    const startIndex = selectionStartRef.current.index;
    if (startIndex === undefined || index === undefined) return false;
    return Math.min(startIndex, index) >= 0 && Math.max(startIndex, index) < fileData.length;
  }, [fileData.length]);

  // --- 선택된 파일 수 ---
  const selectedCount = selectedFiles.length;

  // --- 전체 선택 여부 ---
  const isAllSelected = fileData.length > 0 && selectedFiles.length === fileData.length;

  // --- 부분 선택 여부 ---
  const isPartiallySelected = selectedFiles.length > 0 && selectedFiles.length < fileData.length;

  return {
    selectedFiles,
    selectedFileData,
    lastSelectedIndex,
    selectedCount,
    isAllSelected,
    isPartiallySelected,
    selectFile,
    toggleFile,
    rangeSelect,
    clearSelection,
    selectAll,
    deselectAll,
    isInSelectionRange,
  };
}
