import { useState, useCallback, useMemo, useRef } from 'react';
import { nextSelectionIndex } from '../folderSelectionState';

/**
 * 파일 선택 상태 관리 훅
 * 
 * 파일 목록에서의 선택 상태를 관리하며,
 * 단일 선택, 다중 선택(Windows/Linux Ctrl+클릭, macOS Cmd+클릭), 범위 선택(Shift+클릭)을 지원합니다.
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
  const [activeSelectedPath, setActiveSelectedPath] = useState('');
  const selectionStartRef = useRef(null);
  const fileLookup = useMemo(() => {
    const byPath = new Map();
    const indexByPath = new Map();
    fileData.forEach((file, index) => {
      if (!file?.path) return;
      byPath.set(file.path, file);
      indexByPath.set(file.path, index);
    });
    return { byPath, indexByPath };
  }, [fileData]);
  const selectedPathLookup = useMemo(() => new Set(selectedFiles), [selectedFiles]);

  // --- 선택된 파일 데이터 가져오기 ---
  const selectedFileData = useCallback(() => {
    if (selectedFiles.length === 0) return null;
    const selectedPath = activeSelectedPath && selectedPathLookup.has(activeSelectedPath)
      ? activeSelectedPath
      : selectedFiles[selectedFiles.length - 1];
    return fileLookup.byPath.get(selectedPath) || null;
  }, [activeSelectedPath, selectedFiles, selectedPathLookup, fileLookup]);

  // --- 단일 파일 선택 ---
  const selectFile = useCallback((filePath, fileDataItem, index) => {
    const resolvedIndex = fileLookup.indexByPath.get(filePath) ?? -1;
    setSelectedFiles([filePath]);
    setActiveSelectedPath(filePath);
    setLastSelectedIndex(resolvedIndex >= 0 ? resolvedIndex : (index ?? -1));
    selectionStartRef.current = { path: filePath, index: resolvedIndex >= 0 ? resolvedIndex : index };
  }, [fileLookup]);

  // --- 파일 선택 토글 (primary modifier+클릭) ---
  const toggleFile = useCallback((filePath, fileDataItem, index) => {
    const resolvedIndex = fileLookup.indexByPath.get(filePath) ?? -1;
    setSelectedFiles(prev => {
      const exists = prev.includes(filePath);
      if (exists) {
        const next = prev.filter(path => path !== filePath);
        setActiveSelectedPath(next[next.length - 1] || '');
        return next;
      } else {
        setActiveSelectedPath(filePath);
        return [...prev, filePath];
      }
    });
    setLastSelectedIndex(resolvedIndex >= 0 ? resolvedIndex : (index ?? -1));
    selectionStartRef.current = { path: filePath, index: resolvedIndex >= 0 ? resolvedIndex : index };
  }, [fileLookup]);

  // --- 범위 선택 (Shift+클릭) ---
  const rangeSelect = useCallback((filePath, fileDataItem, index) => {
    if (selectionStartRef.current === null || index === undefined) {
      selectFile(filePath, fileDataItem, index);
      return;
    }

    const startIndex = selectionStartRef.current.index;
    const resolvedIndex = fileLookup.indexByPath.get(filePath) ?? -1;
    const endIndex = resolvedIndex >= 0 ? resolvedIndex : index;

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
    setActiveSelectedPath(filePath);
    setLastSelectedIndex(endIndex);
  }, [fileData, fileLookup, selectFile]);

  // --- 선택 초기화 ---
  const clearSelection = useCallback(() => {
    setSelectedFiles([]);
    setActiveSelectedPath('');
    setLastSelectedIndex(-1);
    selectionStartRef.current = null;
  }, []);

  // --- 전체 선택 ---
  const selectAll = useCallback(() => {
    const allPaths = fileData.map(file => file.path).filter(Boolean);
    setSelectedFiles(allPaths);
    setActiveSelectedPath(allPaths[allPaths.length - 1] || '');
    setLastSelectedIndex(allPaths.length - 1);
  }, [fileData]);

  // --- 전체 선택 해제 ---
  const deselectAll = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  // --- 선택 반전 ---
  const invertSelection = useCallback(() => {
    const allPaths = fileData.map(file => file.path).filter(Boolean);
    setSelectedFiles(prev => {
      const next = allPaths.filter(path => !prev.includes(path));
      setActiveSelectedPath(next[next.length - 1] || '');
      setLastSelectedIndex(next.length > 0 ? fileLookup.indexByPath.get(next[next.length - 1]) ?? -1 : -1);
      return next;
    });
  }, [fileData, fileLookup]);

  const selectPaths = useCallback((paths = []) => {
    const validPaths = paths.filter(Boolean);
    setSelectedFiles(validPaths);
    setActiveSelectedPath(validPaths[validPaths.length - 1] || '');
    const lastPath = validPaths[validPaths.length - 1];
    const lastIndex = lastPath ? fileLookup.indexByPath.get(lastPath) ?? -1 : -1;
    setLastSelectedIndex(lastIndex);
    selectionStartRef.current = lastPath ? { path: lastPath, index: lastIndex } : null;
  }, [fileLookup]);

  const moveActiveSelection = useCallback((direction, extend = false) => {
    if (fileData.length === 0) return '';
    const currentIndex = activeSelectedPath
      ? fileLookup.indexByPath.get(activeSelectedPath) ?? -1
      : -1;
    const nextIndex = nextSelectionIndex(fileData.length, currentIndex, direction);
    const nextPath = fileData[nextIndex]?.path;
    if (!nextPath) return '';

    if (extend && selectionStartRef.current?.index !== undefined) {
      const start = Math.min(selectionStartRef.current.index, nextIndex);
      const end = Math.max(selectionStartRef.current.index, nextIndex);
      setSelectedFiles(fileData.slice(start, end + 1).map(file => file.path).filter(Boolean));
    } else {
      setSelectedFiles([nextPath]);
      selectionStartRef.current = { path: nextPath, index: nextIndex };
    }
    setActiveSelectedPath(nextPath);
    setLastSelectedIndex(nextIndex);
    return nextPath;
  }, [activeSelectedPath, fileData, fileLookup]);

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
    activeSelectedPath,
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
    invertSelection,
    selectPaths,
    moveActiveSelection,
    isInSelectionRange,
  };
}
