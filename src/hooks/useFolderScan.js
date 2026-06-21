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
  const fileDataCacheRef = useRef({});
  const activeScansRef = useRef(new Map());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeScansRef.current.clear();
    };
  }, []);

  useEffect(() => {
    fileDataCacheRef.current = fileDataCache;
  }, [fileDataCache]);

  const getCacheKey = useCallback((folderPath, options = {}) => {
    const includeSubfolders = options.includeSubfolders ?? true;
    const enableDupCheck = options.enableDupCheck ?? false;
    const skipArchiveExtraction = options.skipArchiveExtraction === true;
    const dupFolders = (options.dupFolders || []).filter(Boolean).sort();
    return JSON.stringify({ folderPath, includeSubfolders, enableDupCheck, dupFolders, skipArchiveExtraction });
  }, []);

  // --- 폴더 스캔 ---
  const scanFolder = useCallback(async (folderPath, options = {}) => {
    const { includeSubfolders = true, enableDupCheck = false } = options;
    const force = options.force === true;
    const silent = options.silent === true;
    const fastInitial = options.fastInitial === true && options.skipArchiveExtraction !== true && !silent;

    if (!folderPath) {
      setStatusMessage(t('folder.status.no_folder') || '스캔할 폴더를 선택하세요');
      return [];
    }

    const cacheKey = getCacheKey(folderPath, options);

    // 캐시에 데이터가 있다면 재사용
    if (!force && fileDataCacheRef.current[cacheKey]) {
      return fileDataCacheRef.current[cacheKey];
    }

    if (activeScansRef.current.has(cacheKey)) {
      return activeScansRef.current.get(cacheKey);
    }

    const scanPromise = (async () => {
      currentFolderRef.current = folderPath;
      if (mountedRef.current && !silent) {
        setScanning(true);
        setScanProgress(0);
        setStatusMessage(t('folder.status.scanning') || '폴더 스캔 중...');
      }

      try {
        const requestOptions = {
          includeSubfolders,
          enableDupCheck,
          dupFolders: options.dupFolders || [],
          force,
        };

        if (fastInitial) {
          const quickFiles = await window.electronAPI.scanFolder(folderPath, {
            ...requestOptions,
            enableDupCheck: false,
            dupFolders: [],
            skipArchiveExtraction: true,
            suppressEvents: true,
          });

          if (!mountedRef.current) return quickFiles || [];
          setFileDataCache(prev => ({
            ...prev,
            [cacheKey]: quickFiles || [],
          }));
          const quickCount = quickFiles?.length || 0;
          setStatusMessage(
            t('folder.status.files_found')?.replace('{count}', quickCount) || `${quickCount}개 파일 발견`
          );
          setScanProgress(100);
          setScanning(false);

          window.electronAPI.scanFolder(folderPath, {
            ...requestOptions,
            force: false,
            skipArchiveExtraction: false,
            suppressEvents: true,
            background: true,
            reportTaskProgress: false,
            reportFileReady: true,
          }).then(files => {
            if (!mountedRef.current || currentFolderRef.current !== folderPath) return;
            setFileDataCache(prev => ({
              ...prev,
              [cacheKey]: files || [],
            }));
            setScanProgress(100);
            const count = files?.length || 0;
            setStatusMessage(
              t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
            );
          }).catch(error => {
            console.error('폴더 메타데이터 갱신 실패:', error);
          });

          return quickFiles || [];
        }

        const files = await window.electronAPI.scanFolder(folderPath, {
          ...requestOptions,
          skipArchiveExtraction: options.skipArchiveExtraction === true,
          suppressEvents: options.suppressEvents === true,
          reportTaskProgress: options.reportTaskProgress !== false,
          reportFileReady: options.reportFileReady !== false,
        });

        if (!mountedRef.current) return files || [];
        setFileDataCache(prev => ({
          ...prev,
          [cacheKey]: files || [],
        }));
        if (!silent) {
          setScanProgress(100);
          const count = files?.length || 0;
          setStatusMessage(
            t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
          );
        }

        return files || [];
      } catch (error) {
        console.error('폴더 스캔 실패:', error);
        if (mountedRef.current && !silent) setStatusMessage(t('folder.status.error') || '스캔 중 오류 발생');
        return [];
      } finally {
        activeScansRef.current.delete(cacheKey);
        if (mountedRef.current && !silent && activeScansRef.current.size === 0) setScanning(false);
      }
    })();

    activeScansRef.current.set(cacheKey, scanPromise);
    return scanPromise;
  }, [getCacheKey, t]);

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
  const getCachedFiles = useCallback((folderPath, options = {}) => {
    return fileDataCache[getCacheKey(folderPath, options)] || [];
  }, [fileDataCache, getCacheKey]);

  const updateCachedFiles = useCallback((folderPath, options = {}, updatedFiles = []) => {
    const files = Array.isArray(updatedFiles) ? updatedFiles.filter(file => file?.path) : [];
    if (!folderPath || files.length === 0) return;
    const preferredKey = getCacheKey(folderPath, options);
    setFileDataCache(prev => {
      const targetKeys = Object.keys(prev).filter(key => {
        if (key === preferredKey) return true;
        try {
          return JSON.parse(key).folderPath === folderPath;
        } catch {
          return false;
        }
      });
      if (targetKeys.length === 0) return prev;
      const updatedByPath = new Map(files.map(file => [file.path, file]));
      const next = { ...prev };
      for (const key of targetKeys) {
        const currentFiles = next[key] || [];
        next[key] = currentFiles.map(file => {
          const updated = updatedByPath.get(file.path);
          return updated ? { ...file, ...updated } : file;
        });
      }
      return next;
    });
  }, [getCacheKey]);

  // --- 캐시 초기화 ---
  const clearCache = useCallback((folderPath) => {
    if (folderPath) {
      // 특정 폴더 관련 캐시만 제거
      setFileDataCache(prev => {
        const newCache = { ...prev };
        Object.keys(newCache).forEach(key => {
          try {
            if (JSON.parse(key).folderPath === folderPath) delete newCache[key];
          } catch {
            delete newCache[key];
          }
        });
        return newCache;
      });
    } else {
      // 전체 캐시 초기화
      setFileDataCache({});
    }
  }, []);

  // --- IPC 이벤트 리스너 ---
  useEffect(() => {
    const handleFolderFileReady = (data) => {
      if (!data?.file?.path) return;
      if (data.folderPath && currentFolderRef.current !== data.folderPath) return;
      if (data.file.cover) {
        window.dispatchEvent(new CustomEvent('bookmanager:folder-thumbnail-ready', {
          detail: {
            src: data.file.cover,
            name: data.file.name || data.file.filename || data.file.path,
            path: data.file.path,
          },
        }));
      }
      setFileDataCache(prev => {
        const targetKey = prev[data.cacheKey]
          ? data.cacheKey
          : Object.keys(prev).find(key => {
              try {
                const parsed = JSON.parse(key);
                return parsed.folderPath === data.folderPath;
              } catch {
                return false;
              }
            });
        if (!targetKey) return prev;
        const currentFiles = prev[targetKey] || [];
        const index = currentFiles.findIndex(file => file.path === data.file.path);
        if (index < 0) return prev;
        const nextFiles = [...currentFiles];
        nextFiles[index] = {
          ...nextFiles[index],
          ...data.file,
        };
        return {
          ...prev,
          [targetKey]: nextFiles,
        };
      });
    };

    const handleScanProgress = (data) => {
      const { progress, message } = data || {};
      if (progress !== undefined) {
        setScanProgress(progress);
      }
      if (message) {
        setStatusMessage(message);
      }
    };

    const handleTaskProgress = (data) => {
      if (data?.task !== 'folder:scan') return;
      if (data.progress !== undefined) {
        setScanProgress(Math.max(0, Math.min(100, Number(data.progress) || 0)));
      }
      if (data.message) {
        setStatusMessage(data.message);
      }
    };

    const handleScanComplete = (data) => {
      const { files, folderPath, cacheKey } = data || {};
      if (folderPath && files && cacheKey) {
        setFileDataCache(prev => ({
          ...prev,
          [cacheKey]: files,
        }));
        setScanProgress(100);
        setScanning(false);
        const count = files.length || 0;
        setStatusMessage(
          t('folder.status.files_found')?.replace('{count}', count) || `${count}개 파일 발견`
        );
      }
    };

    const handleScanError = (data) => {
      const { error, message } = data || {};
      console.error('스캔 오류:', error || message);
      setScanning(false);
      setStatusMessage(message || (t('folder.status.error') || '스캔 중 오류 발생'));
    };

    let removeFileReady, removeProgress, removeTaskProgress, removeComplete, removeError;

    if (window.electronAPI?.onFolderFileReady) {
      removeFileReady = window.electronAPI.onFolderFileReady(handleFolderFileReady);
    }
    if (window.electronAPI?.onScanProgress) {
      removeProgress = window.electronAPI.onScanProgress(handleScanProgress);
    }
    if (window.electronAPI?.onTaskProgress) {
      removeTaskProgress = window.electronAPI.onTaskProgress(handleTaskProgress);
    }
    if (window.electronAPI?.onScanComplete) {
      removeComplete = window.electronAPI.onScanComplete(handleScanComplete);
    }
    if (window.electronAPI?.onScanError) {
      removeError = window.electronAPI.onScanError(handleScanError);
    }

    return () => {
      if (removeFileReady) removeFileReady();
      if (removeProgress) removeProgress();
      if (removeTaskProgress) removeTaskProgress();
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
    updateCachedFiles,
    clearCache,
  };
}
