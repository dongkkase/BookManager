import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * 폴더 스캔 상태 관리 훅
 * 
 * 폴더 스캔 시작/진행/완료 상태를 관리하며,
 * Electron IPC를 통해 백그라운드 스캔과 통신합니다.
 * 
 * 반환값:
 * - scanning: 스캔 진행 중 여부
 * - scanProgress: 스캔 진행률 (0~100)
 * - fileDataCache: 폴더 경로별 파일 데이터 캐시
 * - statusMessage: 현재 상태 메시지
 * - scanFolder: 폴더 스캔 시작 함수
 * - cancelScan: 스캔 취소 함수
 * - clearCache: 캐시 초기화 함수
 */
export function useFolderScan(t) {
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [fileDataCache, setFileDataCache] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [abortController, setAbortController] = useState(null);

  const currentFolderRef = useRef(null);

  // --- 폴더 스캔 ---
  const scanFolder = useCallback(async (folderPath, options = {}) => {
    const { includeSubfolders = true, enableDupCheck = false } = options;

    if (!folderPath) {
      setStatusMessage(t('folder.status.no_folder') || '스캔할 폴더를 선택하세요');
      return [];
    }

    // 캐시에 데이터가 있다면 재사용
    if (fileDataCache[folderPath]) {
      return fileDataCache[folderPath];
    }

    currentFolderRef.current = folderPath;
    setScanning(true);
    setScanProgress(0);
    setStatusMessage(t('folder.status.scanning') || '폴더 스캔 중...');

    try {
      const files = await window.electronAPI.scanFolder(folderPath, {
        includeSubfolders,
        enableDupCheck,
      });

      // 스캔 완료
      setFileDataCache(prev => ({
        ...prev,
        [folderPath]: files || [],
      }));
      setScanProgress(100);
      const count = files?.length || 0;
      setStatusMessage(
        t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
      );

      return files || [];
    } catch (error) {
      console.error('폴더 스캔 실패:', error);
      setStatusMessage(t('folder.status.error') || '스캔 중 오류 발생');
      return [];
    } finally {
      setScanning(false);
    }
  }, [fileDataCache, t]);

  // --- 스캔 취소 ---
  const cancelScan = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setScanning(false);
    setStatusMessage('스캔이 취소되었습니다');
  }, [abortController]);

  // --- 캐시에서 파일 데이터 가져오기 ---
  const getCachedFiles = useCallback((folderPath) => {
    return fileDataCache[folderPath] || [];
  }, [fileDataCache]);

  // --- 캐시 초기화 ---
  const clearCache = useCallback((folderPath) => {
    if (folderPath) {
      // 특정 폴더 캐시만 제거
      setFileDataCache(prev => {
        const newCache = { ...prev };
        delete newCache[folderPath];
        return newCache;
      });
    } else {
      // 전체 캐시 초기화
      setFileDataCache({});
    }
  }, []);

  // --- IPC 이벤트 리스너 ---
  useEffect(() => {
    const handleScanProgress = (event, data) => {
      const { progress, message } = data || {};
      if (progress !== undefined) {
        setScanProgress(progress);
      }
      if (message) {
        setStatusMessage(message);
      }
    };

    const handleScanComplete = (event, data) => {
      const { files, folderPath } = data || {};
      if (folderPath && files) {
        setFileDataCache(prev => ({
          ...prev,
          [folderPath]: files,
        }));
        setScanProgress(100);
        setScanning(false);
        const count = files.length || 0;
        setStatusMessage(
          t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
        );
      }
    };

    const handleScanError = (event, data) => {
      const { error, message } = data || {};
      console.error('스캔 오류:', error || message);
      setScanning(false);
      setStatusMessage(message || (t('folder.status.error') || '스캔 중 오류 발생'));
    };

    let removeProgress, removeComplete, removeError;

    if (window.electronAPI?.onScanProgress) {
      removeProgress = window.electronAPI.onScanProgress(handleScanProgress);
    }
    if (window.electronAPI?.onScanComplete) {
      removeComplete = window.electronAPI.onScanComplete(handleScanComplete);
    }
    if (window.electronAPI?.onScanError) {
      removeError = window.electronAPI.onScanError(handleScanError);
    }

    return () => {
      if (removeProgress) removeProgress();
      if (removeComplete) removeComplete();
      if (removeError) removeError();
    };
  }, [t]);

  return {
    scanning,
    scanProgress,
    fileDataCache,
    statusMessage,
    scanFolder,
    cancelScan,
    getCachedFiles,
    clearCache,
  };
}
